import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { formatInactiveCredentialMessage, isOpenApiInactiveCredential } from "../protocol/errors.js";
import { hasAllowance, pickBucket, type QoderQuotaBucket, quotaNumber } from "../quota.js";
import { getQoderRegionConfig, getQoderUsageURL, type QoderMode } from "../region.js";

interface QoderUsageInfo {
  [key: string]: unknown;
  userQuota?: QoderQuotaBucket;
  /** Purchased or check-in top-ups; the personal plan bucket is often zeroed while these carry the credits. */
  addOnQuota?: QoderQuotaBucket;
  orgResourcePackage?: QoderQuotaBucket;
  totalUsagePercentage?: number;
  isQuotaExceeded?: boolean;
  expiresAt?: number;
}

export interface QoderProviderUsage {
  summary?: string;
  subscriptionTitle?: string;
  resetAt?: string;
  manageUrl?: string;
  usageBuckets?: Array<{
    id: string;
    label: string;
    usedDisplay: string;
    limitDisplay?: string;
    unit?: string;
    resetAt?: string;
  }>;
  raw?: Record<string, unknown>;
}

/** Drop float noise from a summed quota without forcing two decimals on a round number. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * ISO timestamp for the reset, or `undefined` when there is nothing honest to say.
 *
 * Qoder encodes "no expiry" as year 9999 (253402214400000); rendered as a date
 * that reads as a plan resetting in 8000 years, so the sentinel becomes absent.
 * A seconds-precision value is tolerated, matching the usage command.
 */
function resetTimestamp(expiresAt: number | undefined): string | undefined {
  const ms = quotaNumber(expiresAt);
  if (ms <= 0) return undefined;
  const timestamp = ms < 1e12 ? ms * 1000 : ms;
  if (new Date(timestamp).getUTCFullYear() >= 9999) return undefined;
  return new Date(timestamp).toISOString();
}

export async function fetchQoderUsageForMode(
  credentials: OAuthCredentials,
  mode: QoderMode,
): Promise<QoderProviderUsage> {
  const region = getQoderRegionConfig(mode);
  const response = await fetch(getQoderUsageURL(mode), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.access}`,
      Accept: "application/json",
      "User-Agent": "pi-provider-qoder-cn",
    },
  });

  if (!response.ok) {
    // openapi judges this credential separately from the model gateway, and the
    // refusal survives a fresh PAT exchange, so name the boundary rather than
    // sending the user through /login.
    const body = await response.text().catch(() => "");
    if (isOpenApiInactiveCredential(response.status, body)) {
      throw new Error(formatInactiveCredentialMessage(getQoderUsageURL(mode), credentials.access, mode));
    }
    throw new Error(`Failed to fetch Qoder usage: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as QoderUsageInfo;
  const org = pickBucket(raw, "orgResourcePackage") ?? pickBucket(raw, "sharedQuota");
  const resetAt = resetTimestamp(raw.expiresAt);

  // Report every bucket that carries an allowance. The personal plan bucket is
  // routinely zeroed while the spendable credits sit in the add-on pack, so
  // reading only the plan bucket reported "0.00 credits remaining" to accounts
  // that still had credit.
  const buckets = [
    { id: "user-quota", label: "User Quota", quota: pickBucket(raw, "userQuota") },
    { id: "add-on-quota", label: "Add-on", quota: pickBucket(raw, "addOnQuota") },
    { id: "org-resource-package", label: "Org Resource Package", quota: org },
  ].filter((entry) => hasAllowance(entry.quota));

  const usageBuckets = buckets.map(({ id, label, quota }) => ({
    id,
    label,
    usedDisplay: round2(quotaNumber(quota?.used)).toFixed(2),
    limitDisplay: round2(quotaNumber(quota?.total ?? quota?.cap)).toFixed(2),
    unit: quota?.unit || "credits",
    resetAt,
  }));

  // The summary totals the remaining across the reported buckets rather than
  // trusting a single one, and stays quiet when the account has none.
  const remaining = buckets.reduce((sum, { quota }) => sum + Math.max(0, quotaNumber(quota?.remaining)), 0);
  const unit = buckets[0]?.quota?.unit || "credits";

  return {
    summary: buckets.length > 0 ? `${round2(remaining)} ${unit} remaining` : "",
    subscriptionTitle: region.usageTitle,
    resetAt,
    manageUrl: region.manageUrl,
    usageBuckets,
    raw: raw as unknown as Record<string, unknown>,
  };
}
