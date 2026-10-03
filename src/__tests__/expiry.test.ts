import { describe, expect, it } from "vitest";
import { resolveTokenExpiryMs, toEpochMs } from "../auth/expiry.js";

/** Fixed "now" so every assertion is deterministic. */
const NOW = Date.UTC(2026, 9, 3, 4, 0, 0);

describe("resolveTokenExpiryMs", () => {
  it("treats expires_in above 24h as milliseconds (the live fixture shape)", () => {
    // The recorded global exchange returns 86400000 (24h in ms). Interpreting
    // it as seconds would put the expiry ~2.74 years out and permanently
    // disable pi's proactive refresh — this is the P0 the helper exists for.
    const expiry = resolveTokenExpiryMs(undefined, 86_400_000, NOW);
    expect(expiry).toBe(NOW + 86_400_000);
  });

  it("treats RFC 6749 second values as seconds", () => {
    expect(resolveTokenExpiryMs(undefined, 3600, NOW)).toBe(NOW + 3_600_000);
    // The boundary itself (exactly 24h) stays seconds per the official rule.
    expect(resolveTokenExpiryMs(undefined, 86_400, NOW)).toBe(NOW + 86_400_000);
  });

  it("prefers an ISO expires_at over expires_in", () => {
    const iso = new Date(NOW + 7_200_000).toISOString();
    expect(resolveTokenExpiryMs(iso, 60, NOW)).toBe(NOW + 7_200_000);
  });

  it("accepts numeric expires_at in seconds or milliseconds", () => {
    const sec = Math.floor(NOW / 1000) + 3600;
    expect(resolveTokenExpiryMs(String(sec), undefined, NOW)).toBe(sec * 1000);
    expect(resolveTokenExpiryMs(NOW + 60_000, undefined, NOW)).toBe(NOW + 60_000);
  });

  it("falls back to a short conservative TTL, never 30 days", () => {
    // A too-long default guarantees a hard 105; a too-short one costs a refresh.
    expect(resolveTokenExpiryMs(undefined, undefined, NOW)).toBe(NOW + 24 * 3600_000);
    expect(resolveTokenExpiryMs("garbage", -5, NOW)).toBe(NOW + 24 * 3600_000);
  });
});

describe("toEpochMs", () => {
  it("normalizes seconds vs milliseconds", () => {
    expect(toEpochMs(1791079140, NOW)).toBe(1791079140000); // campaign endAt: seconds
    expect(toEpochMs(1791079140000, NOW)).toBe(1791079140000); // quota expiresAt: ms
  });

  it("clamps absurd futures (year-9999 sentinel) into a sane horizon", () => {
    expect(toEpochMs(253402214400000, NOW)).toBe(NOW + 24 * 3600_000);
  });

  it("rejects junk", () => {
    expect(toEpochMs(0, NOW)).toBeUndefined();
    expect(toEpochMs(undefined, NOW)).toBeUndefined();
    expect(toEpochMs(Number.NaN, NOW)).toBeUndefined();
  });
});
