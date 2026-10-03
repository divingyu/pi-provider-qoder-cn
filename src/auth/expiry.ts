/**
 * Shared expiry parsing for Qoder credential responses.
 *
 * Qoder's token endpoints are inconsistent about `expires_in`: the live
 * `jobToken/exchange` fixture returns `86400000` (24h in **milliseconds**)
 * while RFC 6749 says seconds. The official CLI's rule — values beyond 24h
 * are milliseconds — was applied in `pat.ts` and the refresh path, but not in
 * the device-flow login. A raw-seconds interpretation of a millisecond value
 * puts `expires` ~2.74 years out, which disables pi's proactive refresh
 * entirely (it only fires at `expires - 5min`), so the token would rot on the
 * server while every local layer believes it is fresh. This module applies
 * the one correct rule to all three call sites.
 */

/** 24 hours in seconds; values above it from `expires_in` are milliseconds. */
const ONE_DAY_SECONDS = 86_400;

/** A token the server never told us about is assumed to live 24h, not 30d:
 *  a short default costs one extra refresh, a long default guarantees a
 *  hard 105 at the worst possible moment. */
const FALLBACK_TTL_MS = 24 * 3600_000;

/**
 * Resolve an absolute expiry from a response's `expires_at` / `expires_in`.
 * Returns epoch milliseconds, already normalized for the unit ambiguity.
 */
export function resolveTokenExpiryMs(expiresAt?: string | number, expiresIn?: number, now = Date.now()): number {
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
      // Epoch: seconds below the 1e12 cliff, milliseconds above it.
      return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
    }
    const parsed = Date.parse(String(expiresAt));
    if (!Number.isNaN(parsed)) return parsed;
    const numeric = Number.parseInt(String(expiresAt), 10);
    if (!Number.isNaN(numeric) && numeric > 0) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
  }
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    return now + (expiresIn > ONE_DAY_SECONDS ? expiresIn : expiresIn * 1000);
  }
  return now + FALLBACK_TTL_MS;
}

/**
 * Normalize an epoch timestamp that may arrive in seconds or milliseconds.
 * Used for campaign windows (`endAt`), where the same inconsistency was seen
 * across Qoder's APIs (quota `expiresAt` is ms, campaign `endAt` is seconds).
 */
export function toEpochMs(value: number | undefined, now = Date.now()): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const ms = value < 1e12 ? value * 1000 : value;
  // Clamp the year-9999 sentinel and other absurd futures to a sane horizon so
  // a cache anchor can never outlive plausibility.
  return ms > now + 365 * 86400_000 ? now + FALLBACK_TTL_MS : ms;
}
