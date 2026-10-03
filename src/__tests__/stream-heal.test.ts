import type { Api, AssistantMessage, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

// The heal path reads and writes credentials through these exports; the main
// stream suite mocks only resolveQoderIdentity, so this suite owns a full mock
// of the module here.
const mockResolveIdentity = vi.fn().mockResolvedValue({
  access: "fake",
  userID: "test-user",
  email: "test@example.com",
  name: "Test User",
  machineID: "test-machine",
  refresh: "",
  expires: 0,
});
const mockGetCachedCredentials = vi.fn();
const mockRefresh = vi.fn();
const mockSave = vi.fn();

vi.mock("../auth/oauth.js", () => ({
  resolveQoderIdentity: (...args: unknown[]) => mockResolveIdentity(...args),
  getCachedCredentials: (...args: unknown[]) => mockGetCachedCredentials(...args),
  refreshQoderTokenForMode: (...args: unknown[]) => mockRefresh(...args),
  saveCredentialsToAuthFile: (...args: unknown[]) => mockSave(...args),
}));

import { streamQoder } from "../protocol/stream.js";

function sseEnvelope(body: object, statusCodeValue = 200): string {
  return (
    "data:" + JSON.stringify({ headers: {}, body: JSON.stringify(body), statusCodeValue, statusCode: "OK" }) + "\n\n"
  );
}

const EXPIRED_105_SSE = sseEnvelope({ code: "105", message: "Login expired, please try again" }, 403);

const OK_SSE =
  sseEnvelope({
    choices: [{ delta: { content: "hi", role: "assistant" }, index: 0 }],
    created: 1,
    id: "t",
    model: "auto",
    object: "chat.completion.chunk",
  }) +
  sseEnvelope({
    choices: [{ finish_reason: "stop", index: 0 }],
    created: 1,
    id: "t",
    model: "auto",
    object: "chat.completion.chunk",
    usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
  }) +
  "data:" +
  JSON.stringify({ headers: {}, body: "[DONE]", statusCodeValue: 200, statusCode: "OK" }) +
  "\n\n";

function sse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function makeModel(provider: "qoder" | "qoder-cn", id = provider === "qoder" ? "Auto" : "auto"): Model<Api> {
  // Global ids are display names ("Auto"); CN ids are slugs ("auto").
  return { id, api: "qoder-api" as Api, provider } as Model<Api>;
}

function makeContext(): Context {
  return {
    systemPrompt: "test",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  } as unknown as Context;
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const ev of stream) {
    events.push(ev);
    if (ev.type === "done" || ev.type === "error") break;
  }
  return events;
}

function errorEvent(events: AssistantMessageEvent[]): AssistantMessage | undefined {
  const ev = events.find((e) => e.type === "error");
  return ev && "error" in ev ? (ev.error as AssistantMessage) : undefined;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * The 60s heal cooldown is module state keyed by provider, so the suite runs as
 * an ordered script: qoder-cn tests do not consume qoder's slot and vice versa.
 * The qoder provider's single slot is consumed deliberately by test 2 so test 3
 * can observe the cooldown.
 */
describe("streamQoder 105 credential self-heal", () => {
  it("refreshes once and retries the request to a successful completion", async () => {
    mockGetCachedCredentials.mockReturnValue({
      access: "jt-old",
      refresh: "drt-chain|u|m",
      expires: Date.now() - 1000,
    });
    mockRefresh.mockResolvedValue({ access: "jt-new", refresh: "drt-rotated|u|m", expires: Date.now() + 3600_000 });

    const fetchMock = vi.fn().mockResolvedValueOnce(sse(EXPIRED_105_SSE)).mockResolvedValueOnce(sse(OK_SSE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events = await collect(streamQoder(makeModel("qoder-cn"), makeContext(), { apiKey: "jt-old" }));
    expect(errorEvent(events)).toBeUndefined();
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    // The rotated chain must be persisted for the provider that healed.
    expect(mockSave).toHaveBeenCalledWith("qoder-cn", expect.objectContaining({ access: "jt-new" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
  });

  it("adopts a token another window already rotated instead of double-refreshing", async () => {
    // The request went out with "jt-stale", but auth.json now holds a newer
    // access ("jt-fresh") written by another process. Re-refreshing with the
    // already-consumed chain would burn the one-shot rotation and force a full
    // re-login — the exact outcome the self-heal exists to prevent.
    // (This also consumes qoder's cooldown slot for the next test.)
    mockGetCachedCredentials.mockReturnValue({
      access: "jt-fresh",
      refresh: "drt-chain|u|m",
      expires: Date.now() + 3600_000,
    });

    const fetchMock = vi.fn().mockResolvedValueOnce(sse(EXPIRED_105_SSE)).mockResolvedValueOnce(sse(OK_SSE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events = await collect(streamQoder(makeModel("qoder"), makeContext(), { apiKey: "jt-stale" }));
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
  });

  it("surfaces the 105 error while the provider cooldown is active", async () => {
    // qoder's slot was set by the previous test; a new 105 must NOT refresh
    // again and must reach the user as an error instead of a refresh storm.
    mockGetCachedCredentials.mockReturnValue({ access: "jt-old", refresh: "drt-chain|u|m", expires: 0 });

    globalThis.fetch = vi.fn().mockResolvedValue(sse(EXPIRED_105_SSE)) as unknown as typeof fetch;
    const events = await collect(streamQoder(makeModel("qoder"), makeContext(), { apiKey: "jt-old" }));
    const err = errorEvent(events);
    expect(err?.stopReason).toBe("error");
    expect(err?.errorMessage).toMatch(/105/);
    // Global wording must point at /login qoder, never qoder-cn.
    expect(err?.errorMessage).toMatch(/\/login qoder(?!-cn)/);
    expect(err?.errorMessage).not.toMatch(/\/login qoder-cn/);
    expect(mockRefresh).not.toHaveBeenCalled();
    vi.clearAllMocks();
  });

  it("rethrows when no stored credentials exist to heal from", async () => {
    mockGetCachedCredentials.mockReturnValue(null);
    globalThis.fetch = vi.fn().mockResolvedValue(sse(EXPIRED_105_SSE)) as unknown as typeof fetch;

    const events = await collect(streamQoder(makeModel("qoder-cn"), makeContext(), { apiKey: "jt-x" }));
    const err = errorEvent(events);
    expect(err?.stopReason).toBe("error");
    expect(mockRefresh).not.toHaveBeenCalled();
    vi.clearAllMocks();
  });
});
