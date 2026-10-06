import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  ToolCall,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import * as PiAi from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRequestContext, streamQoder } from "../protocol/stream.js";
import { loadLiveFixture } from "./live-fixture.js";

// Pin the identity so the mocked fetch below only ever serves the chat request.
// Without a resolved identity, streamQoder fetches /userinfo first and consumes
// the mock response, leaving the chat read to fail on a locked stream.
vi.mock("../auth/oauth.js", () => ({
  resolveQoderIdentity: vi.fn().mockResolvedValue({
    access: "fake",
    userID: "test-user",
    email: "test@example.com",
    name: "Test User",
    machineID: "test-machine",
    refresh: "",
    expires: 0,
  }),
}));

/**
 * Build a single SSE `data:` line carrying a Qoder envelope:
 *   { headers, body: <JSON string>, statusCodeValue, statusCode }
 * The server wraps the OpenAI-style chunk inside `body` as a JSON string.
 */
function sseEnvelope(body: object, statusCodeValue = 200, statusCode = "OK"): string {
  return (
    "data:" +
    JSON.stringify({
      headers: { "Content-Type": ["application/json"] },
      body: JSON.stringify(body),
      statusCodeValue,
      statusCode,
    }) +
    "\n\n"
  );
}

const DONE_SSE =
  "data:" +
  JSON.stringify({
    headers: { "Content-Type": ["application/json"] },
    body: "[DONE]",
    statusCodeValue: 200,
    statusCode: "OK",
  }) +
  "\n\n";

function chunk(delta: object, extra: object = {}): object {
  return {
    choices: [{ delta, index: 0 }],
    created: 1,
    id: "test-id",
    model: "auto",
    object: "chat.completion.chunk",
    ...extra,
  };
}

function finishChunk(finish_reason: string, extra: object = {}): object {
  return {
    choices: [{ finish_reason, index: 0 }],
    created: 1,
    id: "test-id",
    model: "auto",
    object: "chat.completion.chunk",
    usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
    ...extra,
  };
}

const SUCCESS_SSE = loadLiveFixture("global").interactions.chat.response.body as string;

const BLOCKED_SSE = sseEnvelope(
  { code: "provider_error", message: "Session blocked", request_id: "r", type: "provider_error" },
  406,
  "Not Acceptable",
);

function mockFetch(body: string): typeof fetch {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function makeModel(provider = "qoder", id = "Lite"): Model<Api> {
  return { id, api: "qoder-api" as Api, provider } as Model<Api>;
}

function makeContext(): Context {
  return {
    systemPrompt: "test",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  } as unknown as Context;
}

/**
 * Build the TranscriptContext pi-ai >=0.86 actually hands providers: the system
 * prompt and tool declarations are folded into a leading system message by
 * normalizeContext(), and there are NO top-level `systemPrompt` / `tools`
 * fields. This is the shape that regressed tool binding in 0.4.5.
 */
function makeTranscriptContext(): TranscriptContext {
  return PiAi.normalizeContext({
    systemPrompt: "you are helpful",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        name: "read",
        description: "read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
  } as unknown as Context);
}

/** Reverse the Qoder body encoding and parse the request JSON. */
interface DecodedQoderBody {
  tools: Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }>;
  messages: Array<{ role: string; content?: unknown }>;
  [key: string]: unknown;
}

function decodeQoderBody(init: RequestInit | undefined): DecodedQoderBody {
  const custom = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
  const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const encoded = Buffer.from(init?.body as Uint8Array).toString("utf8");
  const rearranged = [...encoded]
    .map((character) => (character === "$" ? "=" : standard[custom.indexOf(character)] || character))
    .join("");
  const third = Math.floor(rearranged.length / 3);
  const base64 =
    rearranged.slice(rearranged.length - third) +
    rearranged.slice(third, rearranged.length - third) +
    rearranged.slice(0, third);
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as DecodedQoderBody;
}

async function consume(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const ev of stream) {
    events.push(ev);
    if (ev.type === "done" || ev.type === "error") break;
  }
  return events;
}

describe("streamQoder", () => {
  const originalFetch = globalThis.fetch;
  const originalCnPat = process.env.QODERCN_PERSONAL_ACCESS_TOKEN;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCnPat === undefined) delete process.env.QODERCN_PERSONAL_ACCESS_TOKEN;
    else process.env.QODERCN_PERSONAL_ACCESS_TOKEN = originalCnPat;
    vi.restoreAllMocks();
  });

  it("replays a recorded-format SSE fixture into text + stop", async () => {
    globalThis.fetch = mockFetch(SUCCESS_SSE);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    expect(done, "expected a done event").toBeDefined();
    const msg = (done as { message: AssistantMessage }).message;
    expect(msg.stopReason).toBe("stop");
    const text = msg.content.find((c) => c.type === "text");
    expect(text && "text" in text ? text.text : "").toBe("OK");
  });

  it("sends the internal upstream key for a friendly model id", async () => {
    globalThis.fetch = mockFetch(SUCCESS_SSE);
    await consume(streamQoder(makeModel("qoder", "Lite"), makeContext(), { apiKey: "fake" }));

    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(init?.headers).toEqual(expect.objectContaining({ "X-Model-Key": "lite" }));

    const custom = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
    const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const encoded = Buffer.from(init?.body as Uint8Array).toString("utf8");
    const rearranged = [...encoded]
      .map((character) => (character === "$" ? "=" : standard[custom.indexOf(character)] || character))
      .join("");
    const third = Math.floor(rearranged.length / 3);
    const base64 =
      rearranged.slice(rearranged.length - third) +
      rearranged.slice(third, rearranged.length - third) +
      rearranged.slice(0, third);
    const body = JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as {
      chat_context: { extra: { modelConfig: { key: string } } };
      model_config: { key: string };
    };
    expect(body.chat_context.extra.modelConfig.key).toBe("lite");
    expect(body.model_config.key).toBe("lite");
  });

  it("binds tools delivered via the transcript system message (pi-ai >=0.86)", async () => {
    globalThis.fetch = mockFetch(SUCCESS_SSE);
    await consume(streamQoder(makeModel(), makeTranscriptContext(), { apiKey: "fake" }));

    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    const body = decodeQoderBody(init);

    // The tool declared on the transcript's leading system message must reach
    // the request as a structured OpenAI function — not be dropped to `[]`,
    // which is what made the model free-form ChatML tool calls as plain text.
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({
      type: "function",
      function: { name: "read", description: "read a file" },
    });

    // The system prompt is recovered from the transcript and re-injected as a
    // leading role:system message (Qoder ignores the top-level `system` field).
    expect(body.messages[0]).toMatchObject({ role: "system", content: "you are helpful" });
    expect(body.messages.some((m: { role: string }) => m.role === "user")).toBe(true);
  });

  it("binds chat hosts to provider ids even when only a CN PAT is set", async () => {
    process.env.QODERCN_PERSONAL_ACCESS_TOKEN = "pt-cn-only";

    globalThis.fetch = mockFetch(SUCCESS_SSE);
    await consume(streamQoder(makeModel("qoder"), makeContext(), { apiKey: "fake" }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/api3\.qoder\.sh\//),
      expect.any(Object),
    );

    globalThis.fetch = mockFetch(SUCCESS_SSE);
    await consume(streamQoder(makeModel("qoder-cn", "Qwen3.7-Plus"), makeContext(), { apiKey: "fake" }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/gateway\.qoder\.com\.cn\//),
      expect.any(Object),
    );
  });

  it("surfaces an upstream 406 'Session blocked' as an error event, not a silent stop", async () => {
    globalThis.fetch = mockFetch(BLOCKED_SSE);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const err = events.find((e) => e.type === "error");
    expect(err, "expected an error event").toBeDefined();
    const msg = (err as { error: AssistantMessage }).error;
    expect(msg.stopReason).toBe("error");
    expect(msg.errorMessage).toMatch(/Session blocked/);
    expect(msg.errorMessage).toMatch(/406/);
    // Must NOT emit a silent done/stop.
    expect(events.find((e) => e.type === "done")).toBeUndefined();
  });

  it("preserves finish_reason=length instead of overwriting to stop", async () => {
    const sse =
      sseEnvelope(chunk({ content: "partial", role: "assistant" })) + sseEnvelope(finishChunk("length")) + DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    const msg = (done as { message: AssistantMessage }).message;
    expect(msg.stopReason).toBe("length");
  });

  it("captures usage, responseId and responseModel from the finish chunk", async () => {
    const sse =
      sseEnvelope(chunk({ content: "OK", role: "assistant" })) +
      sseEnvelope(
        finishChunk("stop", {
          id: "chatcmpl-abc123",
          model: "qmodel_latest",
          usage: {
            prompt_tokens: 42,
            completion_tokens: 7,
            total_tokens: 49,
            completion_tokens_details: { reasoning_tokens: 3 },
            // prompt_tokens (42) INCLUDES cached_tokens (5) per OpenAI
            // semantics; pi-core expects `input` to exclude them
            // (promptTokens = input + cacheRead + cacheWrite), so input =
            // 42 - 5 - 10 = 27. cacheable_tokens is a capacity metric, not a
            // write count, and must not be mapped to cacheWrite.
            prompt_tokens_details: { cacheable_tokens: 99, cache_write_tokens: 10, cached_tokens: 5 },
          },
        }),
      ) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    const msg = (done as { message: AssistantMessage }).message;
    expect(msg.responseId).toBe("chatcmpl-abc123");
    expect(msg.responseModel).toBe("qmodel_latest");
    expect(msg.usage.input).toBe(27);
    expect(msg.usage.output).toBe(7);
    expect(msg.usage.totalTokens).toBe(49);
    expect(msg.usage.cacheRead).toBe(5);
    expect(msg.usage.cacheWrite).toBe(10);
  });

  it("emits a done event with reason=length when finish_reason is length", async () => {
    const sse =
      sseEnvelope(chunk({ content: "partial", role: "assistant" })) + sseEnvelope(finishChunk("length")) + DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    expect(done, "expected a done event").toBeDefined();
    expect((done as { reason: string }).reason).toBe("length");
  });

  it("reports a tool_use stop reason when the stream emits tool calls", async () => {
    const sse =
      sseEnvelope(
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              function: { name: "bash", arguments: '{"command":"ls"}' },
            },
          ],
        }),
      ) +
      sseEnvelope(finishChunk("tool_calls")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    const msg = (done as { message: AssistantMessage }).message;
    expect(msg.stopReason).toBe("toolUse");
    const toolCall = msg.content.find((c) => c.type === "toolCall");
    expect(toolCall).toBeDefined();
  });

  it("assembles reasoning chunks before the final answer", async () => {
    const sse =
      sseEnvelope(chunk({ reasoning_content: "check " })) +
      sseEnvelope(chunk({ reasoning_content: "twice" })) +
      sseEnvelope(chunk({ content: "done" })) +
      sseEnvelope(finishChunk("stop")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake", reasoning: "high" }));
    const done = events.find((event) => event.type === "done") as { message: AssistantMessage };

    expect(done.message.content).toEqual([
      { type: "thinking", thinking: "check twice" },
      { type: "text", text: "done" },
    ]);
    expect(events.map((event) => event.type)).toContain("thinking_delta");
  });

  it("reports a degenerate turn instead of a silent stop", async () => {
    // The gateway failed to parse the model's tool call and leaked its DSML
    // markup into reasoning_content: the turn carries no text and no tool call,
    // and finish_reason is still "stop". Reading that as a finished task ended
    // the agent turn with nothing to show and nothing to retry.
    const sse =
      sseEnvelope(chunk({ reasoning_content: "Let me look.</invoke>\n</invoke>\n</invoke>" })) +
      sseEnvelope(finishChunk("stop")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake", reasoning: "high" }));

    const error = events.find((event) => event.type === "error") as { error: AssistantMessage };
    expect(error, "expected an error event").toBeDefined();
    expect(error.error.errorMessage).toMatch(/degenerate model output/);
    expect(events.find((event) => event.type === "done")).toBeUndefined();
  });

  it("keeps a normal turn and strips the residue from its thinking", async () => {
    const sse =
      sseEnvelope(chunk({ reasoning_content: "thinking</invoke>\n</invoke>" })) +
      sseEnvelope(chunk({ content: "the answer" })) +
      sseEnvelope(finishChunk("stop")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake", reasoning: "high" }));

    const done = events.find((event) => event.type === "done") as { message: AssistantMessage };
    expect(done, "expected a done event").toBeDefined();
    const thinking = done.message.content.find((block) => block.type === "thinking") as { thinking: string };
    expect(thinking.thinking).toBe("thinking\n");
    expect(done.message.content.find((block) => block.type === "text")).toMatchObject({ text: "the answer" });
  });

  it("assembles parallel tool calls by their stream indexes", async () => {
    const sse =
      sseEnvelope(
        chunk({
          tool_calls: [
            { index: 0, id: "call_a", function: { name: "read", arguments: '{"path":' } },
            { index: 1, id: "call_b", function: { name: "search", arguments: '{"query":' } },
          ],
        }),
      ) +
      sseEnvelope(
        chunk({
          tool_calls: [
            { index: 0, function: { arguments: '"/a"}' } },
            { index: 1, function: { arguments: '"needle"}' } },
          ],
        }),
      ) +
      sseEnvelope(finishChunk("tool_calls")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const done = events.find((event) => event.type === "done") as { message: AssistantMessage };
    const calls = done.message.content.filter((block): block is ToolCall => block.type === "toolCall");

    expect(calls).toEqual([
      { type: "toolCall", id: "call_a", name: "read", arguments: { path: "/a" } },
      { type: "toolCall", id: "call_b", name: "search", arguments: { query: "needle" } },
    ]);
  });

  it("preserves text emitted before and after a tool call", async () => {
    const sse =
      sseEnvelope(chunk({ content: "before" })) +
      sseEnvelope(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{}" } }] })) +
      sseEnvelope(chunk({ content: " after" })) +
      sseEnvelope(finishChunk("tool_calls")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const done = events.find((event) => event.type === "done") as { message: AssistantMessage };

    expect(done.message.content).toEqual([
      { type: "text", text: "before after" },
      { type: "toolCall", id: "call_1", name: "lookup", arguments: {} },
    ]);
  });

  it("emits a tool call that arrives with no arguments", async () => {
    // A no-argument tool, or a model that sends id+name and stops. The block
    // used to be created only inside `if (tc.function?.arguments)`, so this
    // produced a toolCallsState entry and NO content block — and the finalizer
    // then set stopReason "toolUse" on a message with no tool call in it. pi's
    // agent loop had nothing to execute and the turn ended silently, mid-task.
    const sse =
      sseEnvelope(
        chunk({
          tool_calls: [{ index: 0, id: "call_1", function: { name: "advisor", arguments: "" } }],
        }),
      ) +
      sseEnvelope(finishChunk("tool_calls")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    const msg = (done as { message: AssistantMessage }).message;
    const toolCall = msg.content.find((c) => c.type === "toolCall") as ToolCall | undefined;
    expect(toolCall, "a named tool call must reach the message even with no arguments").toBeDefined();
    expect(toolCall?.name).toBe("advisor");
    expect(toolCall?.id).toBe("call_1");
    expect(toolCall?.arguments).toEqual({});
    expect(msg.stopReason).toBe("toolUse");
  });

  it("picks up an id and name that arrive after the block is open", async () => {
    // Streamed the other way round: arguments first, identity later.
    const sse =
      sseEnvelope(chunk({ tool_calls: [{ index: 0, function: { name: "bash", arguments: '{"comm' } }] })) +
      sseEnvelope(chunk({ tool_calls: [{ index: 0, id: "call_9", function: { arguments: 'and":"ls"}' } }] })) +
      sseEnvelope(finishChunk("tool_calls")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    const msg = (done as { message: AssistantMessage }).message;
    const toolCall = msg.content.find((c) => c.type === "toolCall") as ToolCall | undefined;
    expect(toolCall?.id).toBe("call_9");
    expect(toolCall?.name).toBe("bash");
    expect(toolCall?.arguments).toEqual({ command: "ls" });
  });

  it("does not claim toolUse when no tool call reached the message", async () => {
    // A malformed stream: a tool_calls delta with neither id nor name. Better a
    // clean "stop" than a message that says toolUse and carries nothing, which
    // the agent loop cannot act on and cannot report.
    const sse =
      sseEnvelope(chunk({ content: "thinking about it", role: "assistant" })) +
      sseEnvelope(chunk({ tool_calls: [{ index: 0, function: {} }] })) +
      sseEnvelope(finishChunk("stop")) +
      DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    const msg = (done as { message: AssistantMessage }).message;
    expect(msg.content.find((c) => c.type === "toolCall")).toBeUndefined();
    expect(msg.stopReason).toBe("stop");
  });
  it("finishes when the gateway sends [DONE] but keeps the body open", async () => {
    // Qoder's gateway does not always close the HTTP body after the sentinel.
    // The read loop used to keep awaiting reader.read() until the socket went
    // away, so a fully streamed reply never produced a done event and the
    // agent appeared to hang with no error.
    const sse = sseEnvelope(chunk({ content: "OK", role: "assistant" })) + sseEnvelope(finishChunk("stop")) + DONE_SSE;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        // Deliberately never call controller.close().
      },
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = vi.fn(
      async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as unknown as typeof fetch;

    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    expect(done, "expected a done event even though the body stayed open").toBeDefined();
    const msg = (done as { message: AssistantMessage }).message;
    expect(msg.stopReason).toBe("stop");
    const text = msg.content.find((c) => c.type === "text");
    expect(text && "text" in text ? text.text : "").toBe("OK");
    // The reader is released rather than left holding the connection.
    expect(cancelled).toBe(true);
  });

  it("finishes on a bare 'data: [DONE]' line with the body left open", async () => {
    // Same sentinel, unwrapped.
    const sse = `${sseEnvelope(chunk({ content: "hi", role: "assistant" }))}data: [DONE]\n\n`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
      },
    });
    globalThis.fetch = vi.fn(
      async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    ) as unknown as typeof fetch;

    const stream = streamQoder(makeModel(), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);

    const done = events.find((e) => e.type === "done");
    expect(done, "expected a done event for the bare sentinel").toBeDefined();
    const msg = (done as { message: AssistantMessage }).message;
    const text = msg.content.find((c) => c.type === "text");
    expect(text && "text" in text ? text.text : "").toBe("hi");
  });

  it("reports aborted when the request is cancelled before streaming starts", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        }),
    ) as unknown as typeof fetch;

    const eventsPromise = consume(
      streamQoder(makeModel(), makeContext(), { apiKey: "fake", signal: controller.signal }),
    );
    controller.abort();
    const events = await eventsPromise;

    const error = events.find((event) => event.type === "error") as { error: AssistantMessage };
    expect(error.error.stopReason).toBe("aborted");
    expect(events.find((event) => event.type === "done")).toBeUndefined();
  });
});

describe("resolveRequestContext", () => {
  const flatContext = {
    systemPrompt: "legacy prompt",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "bash", description: "run a command", parameters: { type: "object", properties: {} } }],
  } as unknown as Context;

  it("falls back to flat Context fields when transcript helpers are absent (pi-ai <=0.85)", () => {
    // An empty helpers object simulates the pi-ai 0.85 namespace, which exports
    // none of the transcript helpers. The provider must still bind tools and the
    // system prompt from the legacy top-level Context fields instead of crashing
    // or shipping `tools: []`.
    const resolved = resolveRequestContext({}, flatContext);
    expect(resolved.systemText).toBe("legacy prompt");
    expect(resolved.tools.map((t) => t.name)).toEqual(["bash"]);
    expect(resolved.messages).toBe(flatContext.messages);
  });

  it("treats a partial transcript toolkit as legacy (defensive: missing getSystemMessageText)", () => {
    // All transcript helpers except getSystemMessageText. Without the full set we
    // cannot reconstruct the system prompt from the transcript, so the resolver
    // must fall back to the flat Context fields rather than drop the prompt.
    const partial = {
      collapseSystemMessages: PiAi.collapseSystemMessages,
      getCurrentTools: PiAi.getCurrentTools,
      getInitialSystemMessage: PiAi.getInitialSystemMessage,
      withoutInitialSystemMessage: PiAi.withoutInitialSystemMessage,
    };
    const resolved = resolveRequestContext(partial, flatContext);
    expect(resolved.systemText).toBe("legacy prompt");
    expect(resolved.tools.map((t) => t.name)).toEqual(["bash"]);
  });

  it("resolves tools + prompt from the transcript when helpers are present (pi-ai >=0.86)", () => {
    const transcript = PiAi.normalizeContext({
      systemPrompt: "you are helpful",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "read", description: "read a file", parameters: { type: "object", properties: {} } }],
    } as unknown as Context);

    const resolved = resolveRequestContext(PiAi, transcript);
    expect(resolved.tools.map((t) => t.name)).toEqual(["read"]);
    expect(resolved.systemText).toBe("you are helpful");
    // The consolidated leading system message is dropped from the conversation
    // (reqBody re-injects systemText as its own role:system message).
    expect(resolved.messages.some((m) => m.role === "system")).toBe(false);
    expect(resolved.messages.some((m) => m.role === "user")).toBe(true);
  });
});

/**
 * Retry-path integration guards around the peek stage (audit note: the queue
 * retry loop previously had no stream-level coverage, and the new peek-105
 * shares that seam).
 */
describe("streamQoder retry hygiene", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function sseText(body: string): Response {
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  const QUEUE_SSE = sseEnvelope({ isQueued: true, retry_after_ms: 1, waitTime: 1, queueCount: 2 }, 200, "OK");

  it("retries a queued first response to a single clean start", async () => {
    // Queue notice must win the peek (retry silently) and never be mistaken
    // for a credential-expired envelope by the post-peek 105 check.
    const fetchMock = vi.fn().mockResolvedValueOnce(sseText(QUEUE_SSE)).mockResolvedValueOnce(sseText(SUCCESS_SSE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stream = streamQoder(makeModel("qoder-cn", "auto"), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(events.filter((e) => e.type === "start")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-signs the request on every queue retry, since the gateway de-duplicates signed requests", async () => {
    // Live finding (2026-10-06, api3.qoder.sh): replaying a request with the same
    // COSY Authorization payload/timestamp/signature is answered with HTTP 200 +
    // first envelope `{"code":"403","message":"Duplicate request"}` (code 103) even
    // when the body carries a new request_id. The queue retry must therefore
    // rebuild AND re-sign per attempt, while keeping the affinity keys stable.
    const fetchMock = vi.fn().mockResolvedValueOnce(sseText(QUEUE_SSE)).mockResolvedValueOnce(sseText(SUCCESS_SSE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stream = streamQoder(makeModel("qoder-cn", "auto"), makeContext(), { apiKey: "fake", sessionId: "s-1" });
    await consume(stream);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [first, second] = fetchMock.mock.calls;
    const h1 = first[1]?.headers as Record<string, string>;
    const h2 = second[1]?.headers as Record<string, string>;
    expect(h1.Authorization).not.toBe(h2.Authorization);

    const b1 = decodeQoderBody(first[1]);
    const b2 = decodeQoderBody(second[1]);
    // Rotated per attempt…
    expect(b1.request_id).not.toBe(b2.request_id);
    expect((b1.business as { id: string }).id).not.toBe((b2.business as { id: string }).id);
    expect(b1.is_retry).toBe(false);
    expect(b2.is_retry).toBe(true);
    // …while prompt-cache affinity stays pinned to the same turn.
    expect(b2.chat_record_id).toBe(b1.chat_record_id);
    expect(b2.session_id).toBe(b1.session_id);
  });

  it("stops after ONE Retry-After when the gateway says serviceAvailable:false", async () => {
    // serviceAvailable:false = 网关当前根本没能力服务（真机 2026-10-06 见过 queueCount:0 也它）。
    // 继续把 1+3 预算跑完只能得到同样的结论，实测会白等 91-150 秒，所以只按 Retry-After 等一轮。
    const DOWN_SSE = sseEnvelope(
      { isQueued: true, retry_after_ms: 1, waitTime: 503, queueCount: 5204, queueType: "p3", serviceAvailable: false },
      200,
      "OK",
    );
    // 每次调用必须返**新的** Response：Response 体只能读一次，复用同一个实例
    // 会在第二次 attempt 上报 "ReadableStream is locked"。
    const fetchMock = vi.fn(async () => sseText(DOWN_SSE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events = await consume(streamQoder(makeModel("qoder-cn", "auto"), makeContext(), { apiKey: "fake" }));
    const terminal = events.filter((e) => e.type === "done" || e.type === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.type).toBe("error");
    const message = String((terminal[0] as { error?: { errorMessage?: string } }).error?.errorMessage ?? "");
    expect(message).toContain("serviceAvailable:false");
    expect(message).toContain("/model");
    expect(message).not.toContain("at capacity");
    // 排队次数：首次 + 一次按 Retry-After 的重试，不多打
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 文案必须保持“硬失败”：不能出现 pi-ai 认作瞬时错误的连续 3 位数字
    expect(message).not.toMatch(/(429|500|502|503|520|524)/);
    // 也不能被归成凭证失效（否则会触发无意义的 token 刷新）
    expect(message).not.toContain("凭证失效");
  });

  it("keeps the full 1+3 budget when the queue merely says serviceAvailable:true", async () => {
    // 正常的排队（服务可用、只是在排队）不能被快停掉：这是默认行为，必须回归住。
    const UP_SSE = sseEnvelope(
      { isQueued: true, retry_after_ms: 1, waitTime: 193, queueCount: 6228, serviceAvailable: true },
      200,
      "OK",
    );
    const fetchMock = vi.fn(async () => sseText(UP_SSE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events = await consume(streamQoder(makeModel("qoder-cn", "auto"), makeContext(), { apiKey: "fake" }));
    const terminal = events.filter((e) => e.type === "error");
    expect(terminal).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 + MAX_QUEUE_RETRIES
    const message = String((terminal[0] as { error?: { errorMessage?: string } }).error?.errorMessage ?? "");
    expect(message).toContain("at capacity");
    expect(message).not.toMatch(/(429|500|502|503|520|524)/);
  });

  it("salts chat_record_id with the session so identical prompts never collide", async () => {
    // stableChatRecordID() used to be a pure function of (model, messages, tools,
    // maxTokens), so two sessions opening with the same message presented the
    // same record id — a duplicate to any gateway that keys on it.
    const recordOf = async (sessionId: string): Promise<string> => {
      globalThis.fetch = mockFetch(SUCCESS_SSE);
      const stream = streamQoder(makeModel("qoder-cn", "auto"), makeContext(), { apiKey: "fake", sessionId });
      await consume(stream);
      return decodeQoderBody(vi.mocked(globalThis.fetch).mock.calls[0][1]).chat_record_id as string;
    };

    const a = await recordOf("session-a");
    const b = await recordOf("session-b");
    const aAgain = await recordOf("session-a");
    expect(a).not.toBe(b);
    expect(aAgain).toBe(a);
  });

  it("surfaces a mid-stream 105 once and lets the cooldown stop the second heal", async () => {
    // A 105 after real content cannot be caught pre-start. The outer catch may
    // take one heal (via the mocked oauth module — no second in-band chat POST),
    // but the retry must not start another refresh cycle: the provider cooldown
    // and the single-attempt structure have to terminate the turn in ONE
    // terminal event, never a refresh storm.
    const midStream105 =
      sseEnvelope(chunk({ content: "partial", role: "assistant" })) +
      sseEnvelope({ code: "105", message: "Login expired" }, 403, "Forbidden");
    const refreshOk = new Response(JSON.stringify({ token: "jt-healed", expires_in: 3600 }), { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseText(midStream105)) // attempt 1: content then 105
      .mockResolvedValueOnce(refreshOk); // the single heal's refresh POST
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stream = streamQoder(makeModel("qoder-cn", "mid-105"), makeContext(), { apiKey: "fake" });
    const events = await consume(stream);
    const terminal = events.filter((e) => e.type === "done" || e.type === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.type).toBe("error");
    // Exactly one chat POST: the heal retried with the fresh token, hit the
    // cooldown-protected single-attempt path, and ended the turn.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("agent_chat_generation"))).toHaveLength(1);
  });
});
