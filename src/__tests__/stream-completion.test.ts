import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  TextContent,
  ThinkingContent,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLaneCooldowns } from "../protocol/queue-policy.js";
import { streamQoder } from "../protocol/stream.js";

// Pin the identity so mocked fetch only ever serves the chat request.
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

function sseEnvelope(body: object | string, statusCodeValue = 200, statusCode = "OK"): string {
  return (
    "data:" +
    JSON.stringify({
      headers: { "Content-Type": ["application/json"] },
      body: typeof body === "string" ? body : JSON.stringify(body),
      statusCodeValue,
      statusCode,
    }) +
    "\n\n"
  );
}

const DONE_SSE = sseEnvelope("[DONE]");
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
function finishChunk(finish_reason: string): object {
  return {
    choices: [{ finish_reason, index: 0 }],
    created: 1,
    id: "test-id",
    model: "auto",
    object: "chat.completion.chunk",
    usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
  };
}

function mockFetch(body: string): typeof fetch {
  return vi.fn(
    async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  ) as unknown as typeof fetch;
}
function makeModel(): Model<Api> {
  return { id: "Lite", api: "qoder-api" as Api, provider: "qoder" } as Model<Api>;
}
function makeContext(): Context {
  return { systemPrompt: "test", messages: [{ role: "user", content: "hi" }], tools: [] } as unknown as Context;
}
async function consume(s: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const ev of s) {
    events.push(ev);
    if (ev.type === "done" || ev.type === "error") break;
  }
  return events;
}
function textOf(m: AssistantMessage | undefined): string {
  return (m?.content ?? [])
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("");
}
function thinkingOf(m: AssistantMessage | undefined): string {
  return (m?.content ?? [])
    .filter((b): b is ThinkingContent => b.type === "thinking")
    .map((b) => b.thinking)
    .join("");
}

describe("streamQoder: stream termination", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetLaneCooldowns();
    vi.restoreAllMocks();
  });

  it("reports a mid-sentence cut (no [DONE], no finish_reason) as a retryable error", async () => {
    const sse =
      sseEnvelope(chunk({ content: "Let me analyze " })) + sseEnvelope(chunk({ content: "this file, then I" }));
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const error = events.find((e) => e.type === "error") as { error: AssistantMessage } | undefined;

    expect(events.find((e) => e.type === "done")).toBeUndefined();
    expect(error, "expected an error event").toBeDefined();
    expect((error as { error: AssistantMessage }).error.stopReason).toBe("error");
    expect((error as { error: AssistantMessage }).error.errorMessage).toMatch(/incomplete stream/);
    // Keep the partial text so the user can see where it stopped.
    expect(textOf((error as { error: AssistantMessage }).error)).toBe("Let me analyze this file, then I");
  });

  it("reports an empty body as an error, never a silent done/stop", async () => {
    globalThis.fetch = mockFetch("");
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const error = events.find((e) => e.type === "error") as { error: AssistantMessage } | undefined;

    expect(events.find((e) => e.type === "done")).toBeUndefined();
    expect(error).toBeDefined();
    expect((error as { error: AssistantMessage }).error.stopReason).toBe("error");
    expect((error as { error: AssistantMessage }).error.errorMessage).toMatch(/no content deltas/);
  });

  it("reports a bare [DONE] with no content as an error", async () => {
    globalThis.fetch = mockFetch(DONE_SSE);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const error = events.find((e) => e.type === "error") as { error: AssistantMessage } | undefined;

    expect(events.find((e) => e.type === "done")).toBeUndefined();
    expect(error).toBeDefined();
    expect((error as { error: AssistantMessage }).error.stopReason).toBe("error");
  });

  it("tolerates [DONE] without a finish chunk (gateway wraps the sentinel)", async () => {
    const sse = sseEnvelope(chunk({ content: "a complete reply" })) + DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const done = events.find((e) => e.type === "done") as { reason: string; message: AssistantMessage } | undefined;

    expect(done).toBeDefined();
    expect((done as { reason: string }).reason).toBe("stop");
    expect(textOf((done as { message: AssistantMessage }).message)).toBe("a complete reply");
  });

  it("still honours finish_reason=length when [DONE] is missing", async () => {
    const sse = sseEnvelope(chunk({ content: "truncated" })) + sseEnvelope(finishChunk("length"));
    globalThis.fetch = mockFetch(sse);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const done = events.find((e) => e.type === "done") as { reason: string; message: AssistantMessage } | undefined;

    expect(done).toBeDefined();
    expect((done as { reason: string }).reason).toBe("length");
    expect((done as { message: AssistantMessage }).message.stopReason).toBe("length");
  });

  it("keeps a fully terminated turn as done/stop", async () => {
    const sse = sseEnvelope(chunk({ content: "OK", role: "assistant" })) + sseEnvelope(finishChunk("stop")) + DONE_SSE;
    globalThis.fetch = mockFetch(sse);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const done = events.find((e) => e.type === "done") as { reason: string; message: AssistantMessage } | undefined;

    expect(done).toBeDefined();
    expect((done as { reason: string }).reason).toBe("stop");
    expect(textOf((done as { message: AssistantMessage }).message)).toBe("OK");
  });
});

describe("streamQoder: thinking tag classification", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetLaneCooldowns();
    vi.restoreAllMocks();
  });

  const run = async (
    sse: string,
  ): Promise<{ events: AssistantMessageEvent[]; message: AssistantMessage | undefined }> => {
    globalThis.fetch = mockFetch(sse);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const done = events.find((e) => e.type === "done") as { message: AssistantMessage } | undefined;
    return { events, message: done?.message };
  };

  const finish = sseEnvelope(finishChunk("stop")) + DONE_SSE;

  it("shape A: reasoning_content carries the thinking body, content carries closer + answer", async () => {
    // Historical M1 split. Behaviour must stay exactly as before the fix.
    const sse =
      sseEnvelope(chunk({ reasoning_content: "<thinking>let me reason" })) +
      sseEnvelope(chunk({ reasoning_content: " about it" })) +
      sseEnvelope(chunk({ content: "</thinking>\n\n**2**" })) +
      finish;

    const { message } = await run(sse);
    expect(thinkingOf(message)).toBe("let me reason about it");
    expect(textOf(message)).toBe("**2**");
  });

  it("shape B: reasoning_content has only the opener, thinking body lands in content", async () => {
    const sse =
      sseEnvelope(chunk({ reasoning_content: "<thinking>" })) +
      sseEnvelope(chunk({ content: "let me reason about it" })) +
      sseEnvelope(chunk({ content: "</thinking>\n\n**2**" })) +
      finish;

    const { message } = await run(sse);
    expect(thinkingOf(message)).toBe("let me reason about it");
    expect(textOf(message)).toBe("**2**");
    expect(textOf(message)).not.toContain("</thinking>");
  });

  it("shape C: no reasoning_content at all, thinking body lands in content", async () => {
    const sse =
      sseEnvelope(chunk({ content: "let me reason about it" })) +
      sseEnvelope(chunk({ content: "</thinking>\n\n**2**" })) +
      finish;

    const { message } = await run(sse);
    expect(thinkingOf(message)).toBe("let me reason about it");
    expect(textOf(message)).toBe("**2**");
  });

  it("shape C with <think> variant", async () => {
    const sse =
      sseEnvelope(chunk({ content: "reasoning here" })) + sseEnvelope(chunk({ content: "</think>answer" })) + finish;

    const { message } = await run(sse);
    expect(thinkingOf(message)).toBe("reasoning here");
    expect(textOf(message)).toBe("answer");
  });

  it("shape D: healthy paired tags all in content stay untouched", async () => {
    const sse = sseEnvelope(chunk({ content: "<thinking>reason</thinking>**2**" })) + finish;

    const { message } = await run(sse);
    expect(thinkingOf(message)).toBe("reason");
    expect(textOf(message)).toBe("**2**");
  });

  it("an orphan closer split across deltas is still classified", async () => {
    const sse =
      sseEnvelope(chunk({ content: "thinking text" })) +
      sseEnvelope(chunk({ content: "</think" })) +
      sseEnvelope(chunk({ content: "ing>\n\n**2**" })) +
      finish;

    const { message } = await run(sse);
    expect(thinkingOf(message)).toBe("thinking text");
    expect(textOf(message)).toBe("**2**");
  });

  it("truncated before the closer is still an error, with no silent done/stop", async () => {
    // No closer ever arrives, so there is no tag signal to classify by. The
    // conservative choice is visible text (rather than guessing it is all
    // reasoning), but the turn MUST be flagged as an error so it is not
    // silently treated as a finished answer and replayed into the prompt.
    const sse =
      sseEnvelope(chunk({ content: "thinking text" })) + sseEnvelope(chunk({ content: " cut off mid-sentence" }));
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const error = events.find((e) => e.type === "error") as { error: AssistantMessage } | undefined;

    expect(events.find((e) => e.type === "done")).toBeUndefined();
    expect(error).toBeDefined();
    expect((error as { error: AssistantMessage }).error.stopReason).toBe("error");
    expect(textOf((error as { error: AssistantMessage }).error)).toBe("thinking text cut off mid-sentence");
  });

  it("truncated after classification keeps reasoning in the thinking channel", async () => {
    // The closer is seen (classification settles), but the stream ends before
    // the answer. The reasoning must stay in the thinking channel.
    const sse = sseEnvelope(chunk({ content: "thinking text" })) + sseEnvelope(chunk({ content: "</thinking>" }));
    globalThis.fetch = mockFetch(sse);

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    const error = events.find((e) => e.type === "error") as { error: AssistantMessage } | undefined;

    expect(error).toBeDefined();
    expect((error as { error: AssistantMessage }).error.stopReason).toBe("error");
    expect(thinkingOf((error as { error: AssistantMessage }).error)).toBe("thinking text");
    expect(textOf((error as { error: AssistantMessage }).error)).toBe("");
  });

  it("a plain reply with no tags is still streamed as text", async () => {
    const sse = sseEnvelope(chunk({ content: "just a plain answer" })) + finish;
    const { message } = await run(sse);
    expect(textOf(message)).toBe("just a plain answer");
    expect(thinkingOf(message)).toBe("");
  });

  it("a tagless reply longer than the classify buffer cap loses no text", async () => {
    // Reaching CONTENT_CLASSIFY_BUFFER_LIMIT releases the buffer mid-stream;
    // the remainder must still arrive and be appended in order.
    const first = "a".repeat(9000);
    const rest = "and then the conclusion";
    const sse = sseEnvelope(chunk({ content: first })) + sseEnvelope(chunk({ content: rest })) + finish;
    const { message } = await run(sse);

    expect(textOf(message)).toBe(first + rest);
    expect(thinkingOf(message)).toBe("");
  });

  it("emits text immediately when thinking is disabled", async () => {
    // With options.reasoning === false no parser is created, so content must
    // not sit in the classification buffer until finalize.
    const sse = sseEnvelope(chunk({ content: "immediate" })) + finish;
    globalThis.fetch = mockFetch(sse);
    const events = await consume(
      streamQoder(makeModel(), makeContext(), { apiKey: "fake", reasoning: false as unknown as undefined }),
    );
    const done = events.find((e) => e.type === "done") as { message: AssistantMessage } | undefined;

    expect(done).toBeDefined();
    expect(textOf(done?.message)).toBe("immediate");
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
  });
});
