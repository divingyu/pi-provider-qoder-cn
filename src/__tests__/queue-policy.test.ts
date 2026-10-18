import { describe, expect, it } from "vitest";
import type { QoderQueueNotice } from "../protocol/queue.js";
import {
  allowedAttemptsFor,
  armLaneCooldown,
  DEFAULT_QUEUE_POLICY,
  isHardUnavailable,
  laneKey,
  nextSleepMs,
  pendingLaneCooldown,
  readQueuePolicy,
  resetLaneCooldowns,
} from "../protocol/queue-policy.js";

const REFUSAL: QoderQueueNotice = {
  retryAfterMs: 30_000,
  waitTimeSeconds: 30,
  queueCount: 0,
  serviceAvailable: false,
  subCode: "RESOURCE_LIMIT",
  queueType: "p3",
  modelKey: "auto",
};

const DRAINABLE: QoderQueueNotice = {
  retryAfterMs: 30_000,
  waitTimeSeconds: 193,
  queueCount: 6228,
  serviceAvailable: true,
};

describe("readQueuePolicy", () => {
  it("returns the shipped defaults for an empty environment", () => {
    expect(readQueuePolicy({})).toEqual(DEFAULT_QUEUE_POLICY);
  });

  it("keeps the hard refusal at one retry by default", () => {
    // Regression guard: raising this default turns a 31s failure into ~2 minutes
    // of dead time per call, which is the behaviour the fast-fail exists to avoid.
    expect(DEFAULT_QUEUE_POLICY.unavailableAttempts).toBe(1);
    expect(DEFAULT_QUEUE_POLICY.laneCooldownMs).toBe(0);
  });

  it("accepts integers inside the documented range", () => {
    const policy = readQueuePolicy({ QODER_QUEUE_UNAVAILABLE_ATTEMPTS: "4", QODER_QUEUE_MAX_TOTAL_WAIT_MS: "30000" });
    expect(policy.unavailableAttempts).toBe(4);
    expect(policy.totalWaitBudgetMs).toBe(30_000);
  });

  it("clamps absurd values instead of trusting them", () => {
    const policy = readQueuePolicy({ QODER_QUEUE_MAX_ATTEMPTS: "9999", QODER_QUEUE_SINGLE_WAIT_MS: "3600000" });
    expect(policy.maxAttempts).toBe(10);
    expect(policy.singleWaitCapMs).toBe(300_000);
  });

  it("falls back on garbage rather than throwing or waiting forever", () => {
    for (const raw of ["", "   ", "NaN", "Infinity", "abc", "1.5", "-3"]) {
      const policy = readQueuePolicy({ QODER_QUEUE_MAX_ATTEMPTS: raw, QODER_QUEUE_MAX_TOTAL_WAIT_MS: raw });
      expect(policy.maxAttempts).toBe(DEFAULT_QUEUE_POLICY.maxAttempts);
      expect(policy.totalWaitBudgetMs).toBe(DEFAULT_QUEUE_POLICY.totalWaitBudgetMs);
    }
  });

  it("treats an explicit 0 as intent, not as a missing value", () => {
    // A mistyped knob must not silently re-enable waiting: 0 means "do not wait".
    const policy = readQueuePolicy({ QODER_QUEUE_MAX_TOTAL_WAIT_MS: "0", QODER_QUEUE_JITTER_MS: "0" });
    expect(policy.totalWaitBudgetMs).toBe(0);
    expect(policy.jitterMs).toBe(0);
  });
});

describe("allowedAttemptsFor / isHardUnavailable", () => {
  it("splits the two verdicts", () => {
    expect(isHardUnavailable(REFUSAL)).toBe(true);
    expect(isHardUnavailable(DRAINABLE)).toBe(false);
    expect(isHardUnavailable({ retryAfterMs: 1, waitTimeSeconds: 0, queueCount: 5 })).toBe(false);
  });

  it("gives the refusal the short budget and the queue the long one", () => {
    const policy = { ...DEFAULT_QUEUE_POLICY, unavailableAttempts: 1, maxAttempts: 3 };
    expect(allowedAttemptsFor(policy, REFUSAL)).toBe(1);
    expect(allowedAttemptsFor(policy, DRAINABLE)).toBe(3);
  });
});

describe("nextSleepMs", () => {
  const noJitter = { ...DEFAULT_QUEUE_POLICY, jitterMs: 0 };

  it("respects the gateway's Retry-After when the budget allows", () => {
    expect(nextSleepMs(noJitter, REFUSAL, 0)).toBe(30_000);
  });

  it("clamps the sleep so the total budget is a real bound", () => {
    // The knob is only meaningful if it bounds the last sleep too: with a 40s
    // budget and 30s already waited, a 30s sleep would overshoot to 60s.
    const policy = { ...noJitter, totalWaitBudgetMs: 40_000 };
    expect(nextSleepMs(policy, REFUSAL, 30_000)).toBe(10_000);
    expect(nextSleepMs(policy, REFUSAL, 40_000)).toBe(0);
  });

  it("never exceeds the single-wait ceiling", () => {
    const policy = { ...noJitter, singleWaitCapMs: 5_000, totalWaitBudgetMs: 600_000 };
    expect(nextSleepMs(policy, { ...REFUSAL, retryAfterMs: 120_000 }, 0)).toBe(5_000);
  });

  it("keeps jitter inside its own ceiling", () => {
    const policy = { ...DEFAULT_QUEUE_POLICY, jitterMs: 2_000, totalWaitBudgetMs: 90_000 };
    // random() is contractually [0,1), so the spread must stay under jitterMs.
    expect(nextSleepMs(policy, { ...REFUSAL, retryAfterMs: 1_000 }, 0, () => 0)).toBe(1_000);
    expect(nextSleepMs(policy, { ...REFUSAL, retryAfterMs: 1_000 }, 0, () => 0.999999)).toBeLessThan(3_000);
    expect(nextSleepMs(policy, { ...REFUSAL, retryAfterMs: 1_000 }, 0, () => 0.5)).toBe(2_000);
  });

  it("returns 0 for a notice with no wait so the caller gives up instead of spinning", () => {
    expect(nextSleepMs(noJitter, { ...REFUSAL, retryAfterMs: 0 }, 0)).toBe(0);
  });
});

describe("lane cooldown memo", () => {
  it("is off unless a ttl is armed", () => {
    resetLaneCooldowns();
    expect(pendingLaneCooldown("global", 1_000)).toBeNull();
  });

  it("scopes the skip to the mode that refused", () => {
    resetLaneCooldowns();
    armLaneCooldown(laneKey("global", REFUSAL), 20_000, REFUSAL, 1_000);
    expect(pendingLaneCooldown("global", 5_000)?.remainingMs).toBe(16_000);
    // The CN account is a different lane on a different gateway: it must not be
    // muted by the international refusal.
    expect(pendingLaneCooldown("cn", 5_000)).toBeNull();
  });

  it("expires and forgets itself", () => {
    resetLaneCooldowns();
    armLaneCooldown(laneKey("global", REFUSAL), 1_000, REFUSAL, 10_000);
    expect(pendingLaneCooldown("global", 10_500)?.remainingMs).toBe(500);
    expect(pendingLaneCooldown("global", 11_000)).toBeNull();
    expect(pendingLaneCooldown("global", 12_000)).toBeNull();
  });

  it("treats a zero or garbage ttl as disarm", () => {
    resetLaneCooldowns();
    armLaneCooldown(laneKey("global", REFUSAL), 5_000, REFUSAL, 1_000);
    armLaneCooldown(laneKey("global", REFUSAL), 0, REFUSAL, 1_000);
    expect(pendingLaneCooldown("global", 1_000)).toBeNull();
    armLaneCooldown(laneKey("global", REFUSAL), Number.NaN, REFUSAL, 1_000);
    expect(pendingLaneCooldown("global", 1_000)).toBeNull();
  });

  it("keys by lane and sub code so a plain queue never mutes anything", () => {
    resetLaneCooldowns();
    expect(laneKey("global", REFUSAL)).toBe("global:p3:RESOURCE_LIMIT");
    expect(laneKey("global", DRAINABLE)).toBe("global:unknown:queued");
    // An ordinary queue is never armed (the caller only arms hard refusals), and
    // arming with a ttl of 0 is a no-op — that is the shipped default.
    armLaneCooldown(laneKey("global", DRAINABLE), DEFAULT_QUEUE_POLICY.laneCooldownMs, DRAINABLE, 1_000);
    expect(pendingLaneCooldown("global", 1_500)).toBeNull();
  });

  it("carries the original notice so the skip can name the lane", () => {
    resetLaneCooldowns();
    armLaneCooldown(laneKey("global", REFUSAL), 60_000, REFUSAL, 1_000);
    expect(pendingLaneCooldown("global", 2_000)?.notice).toMatchObject({ queueType: "p3", subCode: "RESOURCE_LIMIT" });
    resetLaneCooldowns();
  });
});
