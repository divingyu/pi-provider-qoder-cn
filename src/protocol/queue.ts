/**
 * Qoder's capacity queue notice.
 *
 * When the model gateway is at capacity it does not reject the request — it
 * accepts it and answers with an HTTP 403 whose body carries `isQueued: true`
 * plus how long to wait. The body is nested (a JSON string inside a JSON string
 * inside the envelope), for example:
 *
 *   {"code":"403","message":"{\"code\":\"10605\",\"message\":
 *     \"{\\\"isQueued\\\":true,\\\"modelKey\\\":\\\"qfmodel\\\",
 *       \\\"queueCount\\\":6228,\\\"retryAfterSeconds\\\":30,
 *       \\\"serviceAvailable\\\":true,\\\"waitTime\\\":193}\"}"}
 *
 * `serviceAvailable: true` alongside `isQueued: true` is the tell: nothing is
 * wrong with the credentials or the request, the caller is simply waiting in
 * line. Surfacing that as a fatal error hands the user three levels of escaped
 * JSON, so it is recognised here and retried by the caller instead.
 *
 * The nesting depth has changed between gateway versions, so the payload is
 * located by digging rather than by indexing a fixed path.
 */

/** Attempts after the first one, so a queued request is tried 1 + 3 times. */
export const MAX_QUEUE_RETRIES = 3;
/** Ceiling for one wait, so an absurd `waitTime` cannot hang a session. */
const MAX_WAIT_MS = 120_000;
/** Used when the gateway omits `retryAfterSeconds`. */
const DEFAULT_RETRY_SECONDS = 30;

export interface QoderQueueNotice {
  /** How long to wait before retrying, in milliseconds. */
  retryAfterMs: number;
  /** Gateway's own estimate of the remaining wait, in seconds, for display. */
  waitTimeSeconds: number;
  /** Position/queue length reported by the gateway, for display. */
  queueCount: number;
  /**
   * `serviceAvailable` as reported by the gateway, or `undefined` when the
   * payload omits it. `false` means the service has no capacity to serve *any*
   * request right now (observed alongside `queueCount: 0` on api3.qoder.sh on
   * 2026-10-06) — waiting through the full retry budget just re-derives the
   * same verdict, so the caller short-circuits on it instead of sleeping 4x.
   */
  serviceAvailable?: boolean;
}

function digForQueue(node: unknown, depth: number): Record<string, unknown> | null {
  if (depth > 6) return null;

  // A JSON string is decoded and searched as well, which is what reaches the
  // deeply nested body without hard-coding its shape.
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return digForQueue(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }

  if (node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = digForQueue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  if (record.isQueued === true) return record;

  for (const value of Object.values(record)) {
    const found = digForQueue(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Extract the queue notice from a decoded SSE envelope
 * (`{ statusCodeValue, body }`), or return null when it is not a queue notice.
 */
export function parseQueueNotice(envelope: unknown): QoderQueueNotice | null {
  const payload = digForQueue(envelope, 0);
  if (!payload) return null;

  // The server has been seen sending both a millisecond hint and a seconds
  // field; prefer the explicit millisecond value when present.
  const retryMs =
    positiveNumber(payload.retry_after_ms, 0) ||
    positiveNumber(payload.retryAfterSeconds, DEFAULT_RETRY_SECONDS) * 1000;
  return {
    retryAfterMs: Math.min(retryMs, MAX_WAIT_MS),
    waitTimeSeconds: positiveNumber(payload.waitTime, 0),
    queueCount: positiveNumber(payload.queueCount, 0),
    // Only a real boolean is surfaced; a missing field must not be read as
    // "unavailable" (that would collapse the normal queue into a hard stop).
    serviceAvailable: typeof payload.serviceAvailable === "boolean" ? payload.serviceAvailable : undefined,
  };
}

/** True when a gateway envelope is asking the caller to wait in line. */
export function isQueueEnvelope(envelope: unknown): boolean {
  return parseQueueNotice(envelope) !== null;
}

/**
 * Render a queue figure with at most TWO contiguous digits.
 *
 * This is not cosmetics: pi-ai's `isRetryableAssistantError()` matches bare
 * `429`/`500`/`502`/`503`/`520`/`524` inside the error message, so interpolating
 * a real queue number like 5204 or a 503s wait would silently reclassify a
 * "stop now, switch provider" error as transient and make the caller burn
 * another full retry budget against a gateway that already said it is not
 * serving. Keeping a `.` or a unit between the digits breaks that match.
 */
export function formatQueueFigure(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 100) return String(Math.round(n));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1000).toFixed(1)}k`;
}

/** Whole minutes, clamped to two digits, for "how long to wait" text. */
export function formatWaitMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "<1";
  return String(Math.min(99, Math.max(1, Math.round(seconds / 60))));
}

/**
 * Wait for `ms`, rejecting early when the caller's abort signal fires.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted while waiting for the Qoder queue."));
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted while waiting for the Qoder queue."));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
