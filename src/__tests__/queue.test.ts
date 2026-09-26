import { describe, expect, it } from "vitest";
import { isQueueEnvelope, MAX_QUEUE_RETRIES, parseQueueNotice, sleep } from "../protocol/queue.js";

/**
 * Payloads are copied verbatim from real gateway responses, including the
 * triple JSON encoding. Keeping them byte-accurate is what makes the parser
 * trustworthy: the nesting is the whole difficulty.
 */
function queueEnvelope(inner: Record<string, unknown>) {
  return {
    statusCodeValue: 403,
    body: JSON.stringify({
      code: "403",
      message: JSON.stringify({ code: "10605", message: JSON.stringify(inner) }),
    }),
  };
}

describe("parseQueueNotice", () => {
  it("reads the queue notice out of the deeply nested gateway body", () => {
    const notice = parseQueueNotice(
      queueEnvelope({
        isQueued: true,
        modelKey: "qfmodel",
        queueCount: 6228,
        queueType: "p3",
        retryAfterSeconds: 30,
        serviceAvailable: true,
        waitTime: 193,
      }),
    );

    expect(notice).toEqual({ retryAfterMs: 30_000, waitTimeSeconds: 193, queueCount: 6228 });
  });

  it("returns null for a normal streaming envelope", () => {
    expect(parseQueueNotice({ statusCodeValue: 200, body: '{"choices":[{"delta":{"content":"hi"}}]' })).toBeNull();
  });

  it("returns null for a non-queue 403 so real errors are still reported", () => {
    const envelope = {
      statusCodeValue: 403,
      body: JSON.stringify({ code: "403", message: JSON.stringify({ code: "10403", message: "not authorized" }) }),
    };

    expect(parseQueueNotice(envelope)).toBeNull();
    expect(isQueueEnvelope(envelope)).toBe(false);
  });

  it("falls back to a sane wait when the gateway omits retryAfterSeconds", () => {
    const notice = parseQueueNotice(queueEnvelope({ isQueued: true, queueCount: 12 }));

    expect(notice?.retryAfterMs).toBe(30_000);
    expect(notice?.waitTimeSeconds).toBe(0);
  });

  it("caps an absurd wait so a session cannot hang", () => {
    const notice = parseQueueNotice(queueEnvelope({ isQueued: true, retryAfterSeconds: 999_999 }));

    expect(notice?.retryAfterMs).toBe(120_000);
  });

  it("ignores non-JSON noise and malformed bodies", () => {
    expect(parseQueueNotice({ statusCodeValue: 403, body: "<html>502</html>" })).toBeNull();
    expect(parseQueueNotice(undefined)).toBeNull();
    expect(parseQueueNotice("nope")).toBeNull();
  });

  it("finds the notice no matter which level it is nested at", () => {
    // Flattened by one level on purpose: the gateway has changed this before.
    const notice = parseQueueNotice({
      statusCodeValue: 403,
      body: JSON.stringify({ code: "10605", message: JSON.stringify({ isQueued: true, retryAfterSeconds: 5 }) }),
    });

    expect(notice?.retryAfterMs).toBe(5_000);
  });
});

describe("queue retry policy", () => {
  it("retries a bounded number of times", () => {
    expect(MAX_QUEUE_RETRIES).toBeGreaterThan(0);
    expect(MAX_QUEUE_RETRIES).toBeLessThanOrEqual(5);
  });

  it("sleep resolves after the delay", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });

  it("sleep rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toThrow(/queue/i);
  });

  it("sleep rejects when the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/queue/i);
  });
});
