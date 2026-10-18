/**
 * Queue wait policy — the numbers that decide how long a queued Qoder request is
 * allowed to keep a turn waiting, and how a hard "no capacity" verdict is spread
 * across the rest of the turn.
 *
 * Why this is a separate module: the retry loop lives in `protocol/stream.ts`
 * inside a closure that is re-entered by the credential (105) self-heal, and the
 * message text has to agree with `protocol/errors.ts` for the same gateway
 * verdict. Both the arithmetic and the wording are therefore owned here, away
 * from the transport, and covered by direct unit tests.
 *
 * Measurement basis (live account on api3.qoder.sh, 2026-10-17/18):
 * - The international gateway answers the queue notice with
 *   `queueType:"p3"`, `subCode:"RESOURCE_LIMIT"`, `queueCount:0` and
 *   `serviceAvailable:false` for an account whose `userQuota.total` is 0. The
 *   verdict is per ACCOUNT LANE, not per model: `auto`, `qmodel_38max`,
 *   `efficient` and `ultimate` all returned the same p3 notice, so switching
 *   model inside one provider cannot dodge it.
 * - One failed request costs ~31-39s of wall clock (first notice, one
 *   Retry-After sleep of 30s, second notice, give up).
 * - Queued attempts are NOT billed: 19 chat POSTs, 0 served, `addOnQuota.used`
 *   stayed at 9 (measured via /api/v2/quota/usage before and after). Extra
 *   patience therefore costs TIME only, never credits — which is why patience is
 *   opt-in instead of a default.
 * - The per-attempt release rate is strongly time-correlated, not an independent
 *   coin flip: 6/21 (~0.26) across one early-morning window versus 0/19 in a
 *   later window. Any default chosen from the point estimate would be a guess,
 *   so the default keeps the existing fast-fail and the budget is env-driven.
 */

import type { QoderMode } from "../region.js";
import type { QoderQueueNotice } from "./queue.js";

/** One policy snapshot per request; read once so a mid-turn env change cannot
 * make two attempts of the same turn disagree. */
export interface QoderQueuePolicy {
  /** Attempts allowed for the hard `serviceAvailable:false` verdict, counted
   * AFTER the first one. Default 1: the gateway is saying it has no capacity at
   * all, and burning the full budget only re-derives the same verdict. */
  unavailableAttempts: number;
  /** Attempts allowed for an ordinary queue (`serviceAvailable` true/absent). */
  maxAttempts: number;
  /** Wall-clock ceiling for every queue sleep in ONE turn (across the 105
   * self-heal re-entry, so a wedged lane cannot cost 2× the budget). */
  totalWaitBudgetMs: number;
  /** Ceiling for a single sleep, so an absurd `retryAfterSeconds` cannot hang. */
  singleWaitCapMs: number;
  /** Random extra spread on each wait, so parallel sessions do not retry in lockstep. */
  jitterMs: number;
  /** How long a hard-unavailable verdict short-circuits later requests without
   * touching the network. Set to 0 to disable. */
  laneCooldownMs: number;
}

export const DEFAULT_QUEUE_POLICY: QoderQueuePolicy = Object.freeze({
  unavailableAttempts: 1,
  maxAttempts: 3,
  totalWaitBudgetMs: 90_000,
  singleWaitCapMs: 120_000,
  jitterMs: 2_000,
  /**
   * OFF by default. A skipped request is a request the user expected to be sent,
   * and "the lane refused a moment ago" is an inference, not a gateway answer:
   * it holds on the international service (every model of the account answered
   * `p3`/`RESOURCE_LIMIT`), but it would also suppress a request that was about
   * to be served. Opt in with `QODER_QUEUE_LANE_COOLDOWN_MS=20000` when a whole
   * agent turn is otherwise spending 31s per call on a dead lane.
   */
  laneCooldownMs: 0,
});

/** Absolute ceilings for the env knobs: past these a value is a typo, not intent. */
const LIMITS = {
  attempts: { min: 0, max: 10 },
  budgetMs: { min: 0, max: 15 * 60_000 },
  singleMs: { min: 1_000, max: 5 * 60_000 },
  jitterMs: { min: 0, max: 30_000 },
  cooldownMs: { min: 0, max: 5 * 60_000 },
} as const;

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number(trimmed);
  // Number.isFinite rejects NaN/Infinity, and a non-integer attempt count would
  // silently turn `attempt >= max` into an off-by-one.
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  // A negative knob is a typo, not "zero attempts": zero is spelled `0`.
  if (value < 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Read the policy from the environment. Unknown/garbage values fall back to the
 * defaults rather than throwing: a mistyped knob must not take the provider down.
 */
export function readQueuePolicy(env: NodeJS.ProcessEnv = process.env): QoderQueuePolicy {
  return {
    unavailableAttempts: clampInt(
      env.QODER_QUEUE_UNAVAILABLE_ATTEMPTS,
      LIMITS.attempts.min,
      LIMITS.attempts.max,
      DEFAULT_QUEUE_POLICY.unavailableAttempts,
    ),
    maxAttempts: clampInt(
      env.QODER_QUEUE_MAX_ATTEMPTS,
      LIMITS.attempts.min,
      LIMITS.attempts.max,
      DEFAULT_QUEUE_POLICY.maxAttempts,
    ),
    totalWaitBudgetMs: clampInt(
      env.QODER_QUEUE_MAX_TOTAL_WAIT_MS,
      LIMITS.budgetMs.min,
      LIMITS.budgetMs.max,
      DEFAULT_QUEUE_POLICY.totalWaitBudgetMs,
    ),
    singleWaitCapMs: clampInt(
      env.QODER_QUEUE_SINGLE_WAIT_MS,
      LIMITS.singleMs.min,
      LIMITS.singleMs.max,
      DEFAULT_QUEUE_POLICY.singleWaitCapMs,
    ),
    jitterMs: clampInt(
      env.QODER_QUEUE_JITTER_MS,
      LIMITS.jitterMs.min,
      LIMITS.jitterMs.max,
      DEFAULT_QUEUE_POLICY.jitterMs,
    ),
    laneCooldownMs: clampInt(
      env.QODER_QUEUE_LANE_COOLDOWN_MS,
      LIMITS.cooldownMs.min,
      LIMITS.cooldownMs.max,
      DEFAULT_QUEUE_POLICY.laneCooldownMs,
    ),
  };
}

/** How many attempts are allowed for this particular notice. */
export function allowedAttemptsFor(policy: QoderQueuePolicy, notice: QoderQueueNotice): number {
  return notice.serviceAvailable === false ? policy.unavailableAttempts : policy.maxAttempts;
}

/**
 * How long to sleep before the next attempt, bounded by the turn budget.
 *
 * The old loop slept `notice.retryAfterMs` unconditionally, so a "total budget"
 * knob would have been advisory only. `waitedMs` is the turn-level accumulator
 * (see `stream.ts`), which is also what keeps the 105 self-heal re-entry from
 * restarting the budget.
 *
 * `random` is injectable so tests stay deterministic.
 */
export function nextSleepMs(
  policy: QoderQueuePolicy,
  notice: QoderQueueNotice,
  waitedMs: number,
  random: () => number = Math.random,
): number {
  if (!Number.isFinite(notice.retryAfterMs) || notice.retryAfterMs <= 0) return 0;
  const remaining = Math.max(0, policy.totalWaitBudgetMs - waitedMs);
  if (remaining === 0) return 0;
  const base = Math.min(notice.retryAfterMs, policy.singleWaitCapMs, remaining);
  // random() is [0,1), so the spread never exceeds the configured ceiling.
  const jitter = policy.jitterMs > 0 ? random() * policy.jitterMs : 0;
  // Jitter may not push a bounded wait back over the bound.
  return Math.max(0, Math.min(policy.singleWaitCapMs, remaining, base + jitter));
}

/** True when the notice is the hard "this lane has no capacity" verdict. */
export function isHardUnavailable(notice: QoderQueueNotice): boolean {
  return notice.serviceAvailable === false;
}

/** Lane identity for the cooldown memo. Keyed by region + gateway lane/sub code
 * so a `p3` starvation verdict cannot mute a different lane, and an ordinary
 * queue (which has no subCode) never arms it. */
export function laneKey(mode: QoderMode, notice: QoderQueueNotice): string {
  return `${mode}:${notice.queueType ?? "unknown"}:${notice.subCode ?? "queued"}`;
}

interface ArmedLane {
  /** Epoch ms until which repeats are skipped. */
  until: number;
  /** The notice that armed it, kept so the skip can name the lane. */
  notice: QoderQueueNotice;
}

const armedLanes = new Map<string, ArmedLane>();

/**
 * Record "this lane refused service", so later requests in the same process can
 * fail immediately instead of each paying another ~31s of Retry-After theatre.
 */
export function armLaneCooldown(key: string, ttlMs: number, notice: QoderQueueNotice, now: number = Date.now()): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    armedLanes.delete(key);
    return;
  }
  armedLanes.set(key, { until: now + ttlMs, notice });
}

/**
 * The first armed lane for `mode` that is still cooling down, if any.
 * Called BEFORE the request is sent: the point of the cooldown is to not spend
 * the round trip at all, so a check after the response would be worthless.
 */
export function pendingLaneCooldown(
  mode: QoderMode,
  now: number = Date.now(),
): { key: string; remainingMs: number; notice: QoderQueueNotice } | null {
  for (const [key, entry] of armedLanes) {
    if (!key.startsWith(`${mode}:`)) continue;
    const remaining = entry.until - now;
    if (remaining > 0) return { key, remainingMs: remaining, notice: entry.notice };
    armedLanes.delete(key);
  }
  return null;
}

/** Remaining cooldown for one exact key, in ms (0 when not cooling down). */
export function laneCooldownRemainingMs(key: string, now: number = Date.now()): number {
  const entry = armedLanes.get(key);
  if (!entry) return 0;
  const remaining = entry.until - now;
  if (remaining > 0) return remaining;
  armedLanes.delete(key);
  return 0;
}

/** Test/shutdown helper: forget every armed lane. */
export function resetLaneCooldowns(): void {
  armedLanes.clear();
}
