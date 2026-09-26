/**
 * `/qoder-cn.usage` — show the Qoder CN plan quota and add-on credits.
 *
 * Pi 0.87 has no provider-level usage surface: `ExtensionOAuthConfig` exposes
 * only `name`, `isSubscription`, `login`, `refreshToken`, `getApiKey` and
 * `modifyModels`, and nothing in the core reads an `oauth.fetchUsage` hook
 * (the field the upstream package sets is inert). A provider that wants a quota
 * view therefore has to register its own slash command, which is what this
 * module does.
 *
 * The endpoint is `GET <openApiUrl>/api/v2/quota/usage` with the OAuth access
 * token as a Bearer credential. The response carries two independent buckets:
 *
 *   userQuota     the plan allowance (may be prorated on a mid-cycle upgrade)
 *   addOnQuota    purchased top-up credits, which have their own expiry
 *
 * `expiresAt` is a millisecond epoch; Qoder sends year 9999 for plans that do
 * not reset, which reads as "never" rather than a distant date.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getQoderRegionConfig, getQoderUsageURL, type QoderMode } from "../region.js";

/** One quota bucket as returned by Qoder. Fields are optional: the API omits buckets and rounds values. */
interface QoderQuotaBucket {
  total?: number;
  used?: number;
  remaining?: number;
  percentage?: number;
  unit?: string;
  detailUrl?: string;
}

/** The `/api/v2/quota/usage` payload. Only the fields this command renders are typed. */
export interface QoderQuotaUsage {
  userId?: string;
  userType?: string;
  usageType?: string;
  totalUsagePercentage?: number;
  isQuotaExceeded?: boolean;
  expiresAt?: number;
  upgradeUrl?: string;
  userQuota?: QoderQuotaBucket;
  addOnQuota?: QoderQuotaBucket;
  isPlanQuotaProrated?: boolean;
  [key: string]: unknown;
}

/** The command's presentation model, kept separate from the raw payload for testability. */
export interface QoderUsageView {
  title: string;
  lines: string[];
}

/** Fixed-width progress bar; `undefined` renders as all-unknown rather than looking empty. */
export function usageBar(percentage: number | undefined, width = 20): string {
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return `[${"?".repeat(width)}]`;
  const ratio = Math.max(0, Math.min(1, percentage / 100));
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

/** Format a credit amount, dropping trailing float noise (`12.5` stays, `12.500000001` does not). */
export function formatAmount(value: number | undefined, unit?: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  const rounded = Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

/** Round a percentage for display, tolerating the API's occasional absent value. */
export function formatPercent(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(value * 10) / 10;
}

/**
 * Render `expiresAt` as an absolute date plus a relative countdown.
 *
 * Qoder encodes "no expiry" as year 9999 (253402214400000), which would
 * otherwise render as a meaningless date; that case reads as `never`.
 */
export function formatResetTime(expiresAt: number | undefined, now = Date.now()): string {
  const ms = Number(expiresAt);
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  // Tolerate a seconds-precision value from a future API revision.
  const timestamp = ms < 1e12 ? ms * 1e3 : ms;
  if (new Date(timestamp).getUTCFullYear() >= 9999) return "never";

  const delta = timestamp - now;
  if (delta <= 0) return "expired";

  const totalMinutes = Math.round(delta / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const relative = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${new Date(timestamp).toISOString().slice(0, 10)} (in ${relative})`;
}

/** One `bar label: used / limit (pct) · remaining left` row. */
export function formatBucketLine(label: string, bucket: QoderQuotaBucket | undefined): string {
  const unit = bucket?.unit || "credits";
  const rawPercent = bucket?.percentage;
  const derivedPercent =
    typeof bucket?.used === "number" && typeof bucket?.total === "number" && bucket.total > 0
      ? (bucket.used / bucket.total) * 100
      : undefined;
  const percent = formatPercent(
    typeof rawPercent === "number" && Number.isFinite(rawPercent) ? rawPercent : derivedPercent,
  );
  const percentText = percent === undefined ? "?" : `${percent}%`;
  return `  ${usageBar(percent)} ${label}: ${formatAmount(bucket?.used, unit)} / ${formatAmount(
    bucket?.total,
    unit,
  )} used (${percentText}) · ${formatAmount(bucket?.remaining, unit)} left`;
}

/** True when a bucket carries any allowance to report. */
function hasBucket(bucket: QoderQuotaBucket | undefined): boolean {
  if (!bucket) return false;
  return (bucket.total ?? 0) > 0 || (bucket.used ?? 0) > 0;
}

/**
 * Turn a quota payload into the lines the command prints.
 *
 * Exported so the formatting can be unit-tested against captured payloads
 * without a live token.
 */
export function formatQoderUsage(raw: QoderQuotaUsage, mode: QoderMode, now = Date.now()): QoderUsageView {
  const region = getQoderRegionConfig(mode);
  const lines: string[] = [];

  const userType = raw?.userType ? ` (${raw.userType})` : "";
  const overallPercent = formatPercent(raw?.totalUsagePercentage);
  lines.push(`${region.usageTitle}${userType}`);
  lines.push(`${usageBar(overallPercent)} ${overallPercent === undefined ? "?" : `${overallPercent}%`} used`);
  if (raw?.isQuotaExceeded) lines.push("  ! quota exceeded");

  const showUserQuota = hasBucket(raw?.userQuota);
  const showAddOnQuota = hasBucket(raw?.addOnQuota);
  if (showUserQuota) lines.push(formatBucketLine("Plan quota", raw.userQuota));
  if (showAddOnQuota) lines.push(formatBucketLine("Add-on quota", raw.addOnQuota));
  if (!showUserQuota && !showAddOnQuota) lines.push("  No quota buckets returned.");

  if (raw?.isPlanQuotaProrated) lines.push("  (plan quota is prorated)");

  lines.push(`Resets: ${formatResetTime(raw?.expiresAt, now)}`);

  // The add-on detail page is plan-specific; the upgrade page is the generic
  // fallback, and the region console is the last resort.
  const manageUrl = raw?.addOnQuota?.detailUrl || raw?.upgradeUrl || region.manageUrl;
  if (manageUrl) lines.push(`Manage: ${manageUrl}`);

  return { title: region.usageTitle, lines };
}

/**
 * Fetch and parse the quota payload.
 *
 * Throws a message that names the recovery step, because the only realistic
 * failures are an expired token and a wrong-region (VPC vs public) endpoint.
 * A non-JSON body is kept in the error so a proxy block is diagnosable.
 */
export async function fetchQoderQuota(accessToken: string, mode: QoderMode): Promise<QoderQuotaUsage> {
  const response = await fetch(getQoderUsageURL(mode), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "pi-provider-qoder-cn",
    },
  });

  const text = await response.text();
  let data: QoderQuotaUsage | undefined;
  try {
    data = JSON.parse(text) as QoderQuotaUsage;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const detail = (data?.message as string | undefined) || (data?.error as string | undefined) || text.slice(0, 200);
    const hint =
      response.status === 401 || response.status === 403
        ? `Re-login with /login ${getQoderRegionConfig(mode).providerID}.`
        : "";
    const parts = [`Qoder usage request failed: ${response.status} ${response.statusText}`, hint, detail];
    throw new Error(parts.filter(Boolean).join("\n"));
  }
  if (!data) throw new Error("Qoder usage response was not JSON.");
  return data;
}

/** Resolve the access token, preferring the registry so an expired token is refreshed first. */
async function resolveAccessToken(providerID: string, ctx?: ExtensionCommandContext): Promise<string | undefined> {
  try {
    const fromRegistry = await ctx?.modelRegistry?.getApiKeyForProvider(providerID);
    if (fromRegistry) return fromRegistry;
  } catch {
    // A registry miss falls through to the stored credentials.
  }

  // Imported lazily so this module stays importable in tests without pi.
  const { getCachedCredentials } = await import("../auth/oauth.js");
  // `||` rather than `??`: an empty access string is as unusable as a missing one.
  return getCachedCredentials("", providerID)?.access || undefined;
}

/** Arguments accepted after the command name. */
const FORMAT_ARGS = new Set(["json", "raw", "debug"]);

/**
 * Run `/qoder-cn.usage`.
 *
 * `json` (or `raw`) prints the untouched payload, for when the formatted view
 * hides a field while diagnosing a quota question.
 */
export async function runUsageCommand(mode: QoderMode, args: string, ctx?: ExtensionCommandContext): Promise<void> {
  const region = getQoderRegionConfig(mode);
  const providerID = region.providerID;
  const wantsRaw = FORMAT_ARGS.has((args || "").trim().toLowerCase());

  try {
    const accessToken = await resolveAccessToken(providerID, ctx);
    if (!accessToken) {
      ctx?.ui?.notify(`No ${providerID} credentials. Run /login ${providerID} first.`, "warning");
      return;
    }

    const raw = await fetchQoderQuota(accessToken, mode);
    const output = wantsRaw ? JSON.stringify(raw, null, 2) : formatQoderUsage(raw, mode).lines.join("\n");

    // `notify` is the only extension output channel that also reaches the
    // transcript after the command returns.
    ctx?.ui?.notify(output, "info");
    if (!ctx?.ui) console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx?.ui?.notify(message, "error");
    if (!ctx?.ui) console.error(message);
  }
}
