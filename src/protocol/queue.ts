/**
 * Qoder's capacity queue notice.
 *
 * When the model gateway is at capacity it does not reject the request — it
 * accepts it, answers HTTP 200, and puts the verdict in the FIRST SSE frame. The
 * body is nested (a JSON string inside a JSON string inside the envelope). Two
 * shapes have been observed on live accounts:
 *
 *   // in line, the line drains
 *   {"code":"403","message":"{\"code\":\"10605\",\"message\":
 *     \"{\\\"isQueued\\\":true,\\\"modelKey\\\":\\\"qfmodel\\\",
 *       \\\"queueCount\\\":6228,\\\"retryAfterSeconds\\\":30,
 *       \\\"serviceAvailable\\\":true,\\\"waitTime\\\":193}\"}"}
 *
 *   // no capacity for this account at all (api3.qoder.sh, measured 2026-10-17)
 *   {"code":"403","message":"{\"code\":\"10605\",\"message\":
 *     \"{\\\"isQueued\\\":true,\\\"modelKey\\\":\\\"auto\\\",\\\"queueCount\\\":0,
 *       \\\"queueType\\\":\\\"p3\\\",\\\"retryAfterSeconds\\\":30,\\\"serviceAvailable\\\":false,
 *       \\\"subCode\\\":\\\"RESOURCE_LIMIT\\\",\\\"waitTime\\\":30}\",\"subCode\":\"RESOURCE_LIMIT\"}"}
 *
 * The two mean opposite things and must not share a message:
 * - `serviceAvailable: true`  → wait in line.
 * - `serviceAvailable: false` → there is nothing to wait FOR. `queueCount: 0`
 *   (no line), `subCode: RESOURCE_LIMIT`, and the verdict belongs to the
 *   account's priority lane (`queueType`, e.g. `p3`) rather than to a model: it
 *   came back identical for `auto`, `qmodel_38max`, `efficient` and `ultimate`
 *   on the same account, so changing model inside one provider cannot dodge it
 *   while changing provider can.
 *
 * Waiting costs time, not credits: 19 chat POSTs answered with this notice left
 * `addOnQuota.used` unchanged.
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
  /**
   * Gateway sub-code for the refusal, e.g. `RESOURCE_LIMIT`. Distinguishes an
   * entitlement/priority refusal from a plain full house, which is what makes
   * the message actionable instead of "try again later".
   */
  subCode?: string;
  /**
   * The gateway's priority-lane name for this account (`p3` on the
   * international service for accounts whose plan quota is 0). Account-scoped,
   * not model-scoped — that is the fact the user needs in order to stop
   * re-picking models.
   */
  queueType?: string;
  /** Which upstream model key the verdict applies to, e.g. `auto`. */
  modelKey?: string;
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

/** First non-empty string field, for the machine names the gateway labels with. */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    // `subCode` sits inside the same record as `isQueued` in the payloads seen
    // live, so one source is enough; the wrapper levels carry no extra names.
    subCode: textOf(payload.subCode),
    queueType: textOf(payload.queueType),
    modelKey: textOf(payload.modelKey),
  };
}

/** True when a gateway envelope is asking the caller to wait in line. */
export function isQueueEnvelope(envelope: unknown): boolean {
  return parseQueueNotice(envelope) !== null;
}

/**
 * Context needed to describe a queue failure to the user. Owned by
 * `formatQueueFailureMessage` so `protocol/stream.ts` (first-frame notice) and
 * `protocol/errors.ts` (same verdict arriving mid-stream or as an HTTP error)
 * cannot drift into telling two different stories about one gateway answer.
 */
export interface QueueFailureContext {
  /** Provider mode: wording differs because the lanes and the cures differ. */
  mode: "global" | "cn";
  /**
   * Attempts made including the first one. Omit when the verdict arrived from an
   * HTTP error or mid-stream frame, where this call does not own the retry loop
   * — the message then describes the gateway's answer without claiming a number.
   */
  attempts?: number;
  /** Wall-clock ms spent sleeping on Retry-After so far in this turn. */
  waitedMs?: number;
  /** Region manage/upgrade URL (`region.ts` → `manageUrl`). Not fetched live: an
   * error path must not add a network round trip. */
  manageUrl: string;
  /** The other Qoder region's provider id, offered as the switch target. */
  otherProviderID: string;
}

/** Seconds rendered with at most TWO contiguous digits, see `formatQueueFigure`. */
function formatWaitSecondsShort(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0";
  const seconds = Math.round(ms / 1000);
  if (seconds < 100) return String(seconds);
  return `${formatWaitMinutes(seconds)}分钟`;
}

/**
 * Render the queue verdict.
 *
 * Wording rules that are load-bearing, not style:
 * - Every interpolated number goes through `formatQueueFigure` /
 *   `formatWaitSecondsShort`. pi-ai's `isRetryableAssistantError()` substring-
 *   matches bare `429`/`500`/`502`/`503`/`520`/`524` plus the phrases
 *   `rate limit`/`server error`/`timed out`/`overloaded`, and a real queue
 *   number such as 5204 would silently reclassify a hard refusal as transient,
 *   making the caller burn another full wait against a gateway that already
 *   said no. `RESOURCE_LIMIT` is deliberately upper-cased: the bare phrase
 *   "rate limit" is what the classifier matches, and the gateway's own token is
 *   not a sentence.
 * - No credential wording (`凭证失效` / "credential expired"), which would
 *   trigger a pointless token refresh.
 * - `serviceAvailable:false` is quoted verbatim in both languages: it is the
 *   field a reader (or a maintainer grepping a session log) needs to verify the
 *   claim.
 * - Names the gateway did not report are rendered as "未提供"/"unset". Claiming
 *   `RESOURCE_LIMIT` when the payload omitted it would be a fabricated fact.
 * - The hard-refusal text must not contain "at capacity" (the ordinary-queue
 *   text may): the established test contract is that a hard refusal reads as a
 *   stop-and-switch verdict, not as a queue drain.
 */
export function formatQueueFailureMessage(notice: QoderQueueNotice, ctx: QueueFailureContext): string {
  const isCn = ctx.mode === "cn";
  const lane = notice.queueType ?? (isCn ? "未提供" : "unset");
  const sub = notice.subCode ?? (isCn ? "未提供" : "unset");
  const modelKey = notice.modelKey ?? (isCn ? "未提供" : "unset");
  const hard = notice.serviceAvailable === false;
  const waited = formatWaitSecondsShort(ctx.waitedMs ?? 0);
  const queueLabel = formatQueueFigure(notice.queueCount ?? 0);
  const tried =
    ctx.attempts === undefined
      ? undefined
      : isCn
        ? `已尝试 ${formatQueueFigure(ctx.attempts)} 次（累计等待 ${waited} 秒），结论相同。`
        : `${formatQueueFigure(ctx.attempts)} attempts (about ${waited} seconds of waiting) ended in the same verdict. `;

  if (hard) {
    return isCn
      ? [
          `[Qoder CN 无可用容量] 网关回 serviceAvailable:false（子码 ${sub}，队列长度 ${queueLabel}，优先级通道 ${lane}，模型 ${modelKey}）`,
          `- 说明：${tried ?? ""}这是账号优先级通道的容量限制，不是凭证问题。排队尝试不产生输出，实测也不扣 credits（代价只有时延）。`,
          `- 换模型无效：同一账号在 ${lane} 通道下各模型返回同一结论（实测 auto / qmodel_38max / efficient / ultimate 一致），请勿在同一 Provider 内反复挑模型。`,
          `- 解决建议：用 /model 切换到 ${ctx.otherProviderID} 或其他 Provider，或稍后重试。额度与计划：${ctx.manageUrl}`,
        ].join("\n")
      : [
          `[Qoder international has no spare capacity] The gateway answered serviceAvailable:false (sub code ${sub}, queue length ${queueLabel}, priority lane ${lane}, model ${modelKey})`,
          `- Meaning: ${tried ?? ""}This is the account's priority-lane capacity, not a credential problem. Queued attempts produce no output and are not billed (measured: 19 queued requests, credits unchanged) — the only cost is latency.`,
          `- Switching model will not help: every model of this account answers on the same ${lane} lane (measured across auto / qmodel_38max / efficient / ultimate).`,
          `- Next step: use /model to switch to ${ctx.otherProviderID} or another provider, or retry later. Plan and quota: ${ctx.manageUrl}`,
        ].join("\n");
  }

  return isCn
    ? [
        `[Qoder CN 上游排队] 模型网关当前容量已满，请求进入等待队列（队列长度 ${queueLabel}，优先级通道 ${lane}，模型 ${modelKey}）`,
        `- 说明：${tried ?? ""}队列尚未放行。凭证与额度正常，纯粹是上游排队；排队尝试不消耗 credits。`,
        `- 解决建议：稍后重试，或用 /model 切换到 ${ctx.otherProviderID} 等其他 Provider。额度与计划：${ctx.manageUrl}`,
      ].join("\n")
    : [
        // "is at capacity" is the established wording for the drainable case and
        // the only queue text allowed to carry it; the hard refusal above must
        // never read as "wait it out".
        `[Qoder upstream queue] The model gateway is at capacity and parked this request (queue length ${queueLabel}, priority lane ${lane}, model ${modelKey})`,
        `- Meaning: ${tried ?? ""}the queue has not cleared yet. Credentials and quota are fine; queued attempts are not billed.`,
        `- Next step: retry shortly, or switch provider with /model to ${ctx.otherProviderID} while the queue drains. Plan and quota: ${ctx.manageUrl}`,
      ].join("\n");
}

/**
 * Render the short-circuit message used while a hard-unavailable lane is in
 * cooldown — the request was never sent, so the user must not think it failed
 * for some other reason.
 */
export function formatLaneCooldownMessage(
  notice: QoderQueueNotice,
  remainingMs: number,
  ctx: QueueFailureContext,
): string {
  const isCn = ctx.mode === "cn";
  const lane = notice.queueType ?? (isCn ? "未提供" : "unset");
  const sub = notice.subCode ?? (isCn ? "未提供" : "unset");
  // Two digits max: same reason as every other number in here.
  const left = Math.min(99, Math.max(1, Math.ceil(remainingMs / 1000)));
  return isCn
    ? [
        `[Qoder CN 已跳过本次请求] 优先级通道 ${lane} 刚刚回过 serviceAvailable:false（子码 ${sub}），${left} 秒内不再重复等待。`,
        `- 说明：这次请求尚未发出。上一轮同通道请求按 Retry-After 等待后仍未放行，排队只会再消耗同样的时延。`,
        `- 解决建议：用 /model 切换到 ${ctx.otherProviderID} 或其他 Provider，或 ${left} 秒后重试。`,
      ].join("\n")
    : [
        `[Qoder request skipped] Priority lane ${lane} just refused service (sub code ${sub}, serviceAvailable:false), so this request was not sent; repeats are skipped for ${left} more seconds.`,
        `- Meaning: the previous request on this lane already waited through Retry-After and was still refused, so waiting again buys the same verdict.`,
        `- Next step: use /model to switch to ${ctx.otherProviderID} or another provider, or retry in ${left} seconds.`,
      ].join("\n");
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
