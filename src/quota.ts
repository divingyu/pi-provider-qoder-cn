/**
 * Quota buckets as Qoder's `/api/v2/quota/usage` returns them.
 *
 * Two surfaces read that payload: the `/qoder-cn.usage` command and the
 * provider `fetchUsage` hook. Both need the same shape and the same answer to
 * "does this bucket carry anything?", so the predicates live here once. They had
 * drifted apart: the command asked only for `total` or `used`, and an enterprise
 * deployment reports its allowance as `cap` with no `total` at all, so the row
 * vanished the moment the cycle refreshed and `used` returned to zero.
 */

/** One quota bucket. Every field is optional: the API omits buckets and rounds values. */
export interface QoderQuotaBucket {
  total?: number;
  /** Enterprise deployments report the allowance as `cap` instead of `total`. */
  cap?: number;
  used?: number;
  remaining?: number;
  /**
   * Share already consumed, as a 0-1 fraction on the live API (94% arrives as
   * `0.94`). Renderers prefer deriving this from used/limit and keep the
   * enterprise variants `detailUrl` for the pages behind them.
   */
  percentage?: number;
  unit?: string;
  detailUrl?: string;
}

/** Bucket names `/api/v2/quota/usage` may return, in camelCase. */
export type QoderQuotaBucketName = "userQuota" | "addOnQuota" | "orgResourcePackage" | "sharedQuota";

/** A reported number, or zero when the API omitted it. */
export function quotaNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The allowance a bucket carries: `total`, or `cap` for enterprise deployments. */
export function bucketLimit(bucket: QoderQuotaBucket): number {
  return quotaNumber(bucket.total ?? bucket.cap);
}

/**
 * True when a bucket carries an allowance worth a row.
 *
 * `used` alone cannot decide it: a freshly refreshed enterprise cycle reports
 * `used: 0` (or omits the field) while `cap` and `remaining` still name the
 * credits available, and a pool whose `total` has not been filled in yet can
 * still hold remaining credits.
 */
export function hasAllowance(bucket: QoderQuotaBucket | undefined): boolean {
  if (!bucket) return false;
  return bucketLimit(bucket) > 0 || quotaNumber(bucket.used) > 0 || quotaNumber(bucket.remaining) > 0;
}

/** Read a bucket from a payload, tolerating the API's snake/camel duplication. */
export function pickBucket(raw: object | undefined, camel: QoderQuotaBucketName): QoderQuotaBucket | undefined {
  if (!raw) return undefined;
  const source = raw as Record<string, unknown>;
  const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return (source[snake] ?? source[camel]) as QoderQuotaBucket | undefined;
}
