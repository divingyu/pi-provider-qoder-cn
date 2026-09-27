import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { getQoderRegionConfig, getQoderUsageURL, type QoderMode } from "../region.js";

interface QoderQuota {
  total?: number;
  /** Enterprise payloads report the allowance cap as `cap` instead of `total`. */
  cap?: number;
  used: number;
  remaining: number;
  percentage: number;
  unit: string;
}

interface QoderUsageInfo {
  [key: string]: unknown;
  userQuota?: QoderQuota;
  orgResourcePackage: QoderQuota;
  totalUsagePercentage: number;
  isQuotaExceeded: boolean;
  expiresAt: number;
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
    throw new Error(`Failed to fetch Qoder usage: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as QoderUsageInfo;
  const usageBuckets = [];

  const userQuota = ((raw as Record<string, unknown>).user_quota ?? raw.userQuota) as QoderQuota | undefined;
  const org = ((raw as Record<string, unknown>).org_resource_package ??
    raw.orgResourcePackage ??
    (raw as Record<string, unknown>).shared_quota ??
    (raw as Record<string, unknown>).sharedQuota) as QoderQuota | undefined;

  if (userQuota) {
    usageBuckets.push({
      id: "user-quota",
      label: "User Quota",
      usedDisplay: userQuota.used.toFixed(2),
      limitDisplay: (userQuota.total ?? userQuota.cap ?? 0).toFixed(2),
      unit: userQuota.unit,
      resetAt: raw.expiresAt ? new Date(raw.expiresAt).toISOString() : undefined,
    });
  }

  const orgLimit = org?.cap ?? org?.total ?? 0;
  if (org && orgLimit > 0) {
    usageBuckets.push({
      id: "org-resource-package",
      label: "Org Resource Package",
      usedDisplay: org.used.toFixed(2),
      limitDisplay: orgLimit.toFixed(2),
      unit: org.unit,
      resetAt: raw.expiresAt ? new Date(raw.expiresAt).toISOString() : undefined,
    });
  }

  const remainingText = userQuota
    ? `${userQuota.remaining.toFixed(2)} ${userQuota.unit} remaining`
    : org
      ? `${org.remaining.toFixed(2)} ${org.unit} remaining`
      : "";

  return {
    summary: remainingText,
    subscriptionTitle: region.usageTitle,
    resetAt: raw.expiresAt ? new Date(raw.expiresAt).toISOString() : undefined,
    manageUrl: region.manageUrl,
    usageBuckets,
    raw: raw as unknown as Record<string, unknown>,
  };
}
