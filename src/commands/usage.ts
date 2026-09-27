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
 *   orgResourcePackage  enterprise deployments: the org-wide credit pool;
 *     the personal buckets are absent and `percentage` is a 0-1 fraction
 *
 * `expiresAt` is a millisecond epoch; Qoder sends year 9999 for quotas without
 * an expiry, which reads as "never" rather than a distant date.
 *
 * Rendering is a column grid — label, bar, used/limit, percent, remainder — so
 * every bar starts on the same column no matter which buckets came back. The
 * bar is coloured by how much of the allowance is gone (green / yellow / red);
 * the codes are raw SGR escapes, which the TUI strips before measuring width
 * and `Text` wraps preserve, so no colour dependency is needed.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { msUntilBeijingMidnight } from "../protocol/errors.js";
import { getQoderRegionConfig, getQoderUsageURL, type QoderMode } from "../region.js";

/** One quota bucket as returned by Qoder. Fields are optional: the API omits buckets and rounds values. */
interface QoderQuotaBucket {
  total?: number;
  /** Enterprise payloads report the allowance cap as `cap` instead of `total`. */
  cap?: number;
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
  orgResourcePackage?: QoderQuotaBucket;
  isPlanQuotaProrated?: boolean;
  [key: string]: unknown;
}

/** The command's presentation model, kept separate from the raw payload for testability. */
export interface QoderUsageView {
  title: string;
  lines: string[];
}

/** SGR codes emitted verbatim; keeping them literal avoids a colour dependency. */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

const FILLED_CHAR = "\u2588";
const EMPTY_CHAR = "\u2591";
const UNKNOWN_CHAR = "?";
const BAR_WIDTH = 20;
/** Gutter between grid columns: wide enough to read, cheap enough to keep lines under 80 cells. */
const COLUMN_GAP = "  ";

/** Wrap `text` in an SGR code, restoring the terminal state afterwards. A no-op when there is no code. */
function paint(text: string, code: string | undefined): string {
  return code && text ? `${code}${text}${ANSI.reset}` : text;
}

/** Green while there is room, yellow once it starts to hurt, red at 85% or when the quota is gone. */
export function usageColor(percentage: number | undefined, danger = false): string | undefined {
  if (danger) return `${ANSI.red}${ANSI.bold}`;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return undefined;
  if (percentage >= 85) return `${ANSI.red}${ANSI.bold}`;
  if (percentage >= 60) return ANSI.yellow;
  return ANSI.green;
}

/**
 * Fixed-width progress bar.
 *
 * The plain form is what the tests and the `plain` output path produce; the
 * coloured form paints the filled run with the usage-threshold colour and the
 * remainder dim, so the bar reads as a gauge instead of a wall of hyphens. An
 * absent percentage renders as all-unknown rather than looking empty.
 */
export function usageBar(
  percentage: number | undefined,
  options: { width?: number; color?: boolean; danger?: boolean } = {},
): string {
  const width = options.width ?? BAR_WIDTH;
  const known = typeof percentage === "number" && Number.isFinite(percentage);
  const filled = known ? Math.max(0, Math.min(width, Math.round((percentage / 100) * width))) : 0;
  const fill = known ? FILLED_CHAR.repeat(filled) : "";
  const rest = known ? EMPTY_CHAR.repeat(width - filled) : UNKNOWN_CHAR.repeat(width);
  if (!options.color) return `[${fill}${rest}]`;

  return (
    paint("[", ANSI.dim) +
    paint(fill, usageColor(percentage, options.danger)) +
    paint(rest, ANSI.dim) +
    paint("]", ANSI.dim)
  );
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
 * Format remaining time until the next Beijing midnight (00:00 UTC+8) reset.
 */
export function formatDailyResetCountdown(now = Date.now()): string {
  const diffMs = msUntilBeijingMidnight(now);
  const totalMinutes = Math.max(1, Math.round(diffMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const countdown = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `00:00 UTC+8 (in ${countdown})`;
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
  // Local calendar date: an UTC slice shows the previous day for same-evening
  // expiries east of UTC.
  return `${new Date(timestamp).toLocaleDateString("sv")} (in ${relative})`;
}

/** One bar row: a label, the gauge, and the numbers that make the gauge legible. */
interface UsageRow {
  label: string;
  percent: number | undefined;
  /** Absent on the overall row, which reports a percentage rather than a bucket. */
  used?: number;
  total?: number;
  remaining?: number;
  unit?: string;
  /** Closes the row when there is no used/limit pair to print. */
  tail?: string;
  danger?: boolean;
}

/** A `label  value` row that shares the grid's label column but carries no bar. */
interface UsageNote {
  label: string;
  value: string;
  color?: string;
}

/** True when a row carries an allowance to report. */
function isBucketRow(row: UsageRow): boolean {
  return typeof row.used === "number" || typeof row.total === "number";
}

/** Right-align `text` without colouring the filler, so padding stays invisible. */
function rightCell(text: string, width: number, code?: string): string {
  return " ".repeat(Math.max(0, width - text.length)) + paint(text, code);
}

/**
 * Lay the rows out as a column grid: label, bar, used/limit, percent, remainder.
 *
 * Widths come from the rows that actually rendered, so a plan without an add-on
 * bucket reserves nothing for one and the bars still start on the same column.
 * Only the bar and its percentage are coloured; the numbers stay plain so they
 * remain readable under a theme this extension does not control.
 */
function renderUsageRows(rows: UsageRow[], notes: UsageNote[], color: boolean): string[] {
  const buckets = rows.filter(isBucketRow);
  const usedWidth = Math.max(0, ...buckets.map((row) => formatAmount(row.used).length));
  const totalWidth = Math.max(0, ...buckets.map((row) => formatAmount(row.total).length));
  const unitWidth = Math.max(0, ...buckets.map((row) => (row.unit ?? "").length));
  const remainWidth = Math.max(0, ...buckets.map((row) => formatAmount(row.remaining).length));
  const labelWidth = Math.max(0, ...rows.map((row) => row.label.length), ...notes.map((note) => note.label.length));
  const percentWidth = Math.max(0, ...rows.map((row) => (row.percent === undefined ? 1 : `${row.percent}%`.length)));
  // A row without a bucket still needs the column filled, or its percent would drift left.
  const amountWidth = buckets.length > 0 ? usedWidth + 3 + totalWidth + 1 + unitWidth : 0;
  const remainder = (row: UsageRow): string =>
    isBucketRow(row) ? `${formatAmount(row.remaining).padStart(remainWidth)} left` : (row.tail ?? "");
  const remainderWidth = Math.max(0, ...rows.map((row) => remainder(row).length));

  const lines = rows.map((row) => {
    const amount = isBucketRow(row)
      ? `${formatAmount(row.used).padStart(usedWidth)} / ${formatAmount(row.total).padStart(totalWidth)} ${(row.unit ?? "").padEnd(unitWidth)}`
      : " ".repeat(amountWidth);
    const percent = row.percent === undefined ? UNKNOWN_CHAR : `${row.percent}%`;
    return [
      row.label.padEnd(labelWidth),
      usageBar(row.percent, { color, danger: row.danger }),
      amount,
      rightCell(percent, percentWidth, color ? usageColor(row.percent, row.danger) : undefined),
      remainder(row).padEnd(remainderWidth),
    ].join(COLUMN_GAP);
  });

  for (const note of notes) {
    lines.push(`${note.label.padEnd(labelWidth)}${COLUMN_GAP}${color ? paint(note.value, note.color) : note.value}`);
  }
  return lines.map((line) => line.replace(/ +$/, ""));
}

/** Map one API bucket onto a bar row, preferring the reported percentage over a derived one. */
function bucketRow(label: string, bucket: QoderQuotaBucket | undefined, danger: boolean): UsageRow {
  const rawPercent = bucket?.percentage;
  const derivedPercent =
    typeof bucket?.used === "number" && typeof bucket?.total === "number" && bucket.total > 0
      ? (bucket.used / bucket.total) * 100
      : undefined;
  const percent = formatPercent(
    typeof rawPercent === "number" && Number.isFinite(rawPercent) ? rawPercent : derivedPercent,
  );
  return {
    label,
    percent,
    used: bucket?.used,
    total: bucket?.total,
    remaining: bucket?.remaining,
    unit: bucket?.unit || "credits",
    danger,
  };
}

/** True when a bucket carries any allowance to report. */
function hasBucket(bucket: QoderQuotaBucket | undefined): boolean {
  if (!bucket) return false;
  return (bucket.total ?? 0) > 0 || (bucket.used ?? 0) > 0;
}

/** Read a quota bucket tolerating the API's snake/camel duplication. */
function pickBucket(
  raw: QoderQuotaUsage | undefined,
  camel: "userQuota" | "addOnQuota" | "orgResourcePackage" | "sharedQuota",
): QoderQuotaBucket | undefined {
  if (!raw) return undefined;
  const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return (raw[snake] ?? raw[camel]) as QoderQuotaBucket | undefined;
}

/**
 * Turn a quota payload into the lines the command prints.
 *
 * Exported so the formatting can be unit-tested against captured payloads
 * without a live token.
 */
export function formatQoderUsage(
  raw: QoderQuotaUsage,
  mode: QoderMode,
  now = Date.now(),
  options: { color?: boolean; user?: { name?: string; email?: string } } = {},
): QoderUsageView {
  const color = options.color ?? false;
  const region = getQoderRegionConfig(mode);
  const danger = Boolean(raw?.isQuotaExceeded);

  const userType = raw?.userType ? ` (${raw.userType})` : "";

  const showUserQuota = hasBucket(pickBucket(raw, "userQuota"));
  const showAddOnQuota = hasBucket(pickBucket(raw, "addOnQuota"));
  // Enterprise deployments return the allowance as orgResourcePackage (with a
  // shared_quota fallback) and leave the personal buckets (and
  // totalUsagePercentage) empty. Its `percentage` is a 0-1 fraction, so the row
  // derives the percent from used/cap instead.
  const org = pickBucket(raw, "orgResourcePackage") ?? pickBucket(raw, "sharedQuota");
  const showOrg = hasBucket(org);
  const orgPercent =
    typeof org?.used === "number" && typeof org?.cap === "number" && org.cap > 0
      ? formatPercent((org.used / org.cap) * 100)
      : undefined;
  const overallPercent = formatPercent(showOrg ? raw?.totalUsagePercentage || orgPercent : raw?.totalUsagePercentage);

  const rows: UsageRow[] = [{ label: "Overall", percent: overallPercent, tail: "used", danger }];
  if (showUserQuota) rows.push(bucketRow("Plan quota", pickBucket(raw, "userQuota"), danger));
  if (showAddOnQuota) rows.push(bucketRow("Add-on", pickBucket(raw, "addOnQuota"), danger));
  if (showOrg && org)
    rows.push(bucketRow("Enterprise", { ...org, percentage: undefined, total: org.cap ?? org.total }, danger));

  const isPersonalStandard = raw?.userType === "personal_standard" || raw?.userType === "free";
  const notes: UsageNote[] = [];
  if (danger) {
    notes.push({ label: "Status", value: "quota exceeded", color: ANSI.red });
  }
  if (!showUserQuota && !showAddOnQuota && !showOrg) notes.push({ label: "Buckets", value: "none returned" });
  if (raw?.isPlanQuotaProrated) notes.push({ label: "Note", value: "plan quota is prorated" });

  const user = options.user;
  if (user && (user.name || user.email)) {
    notes.push({ label: "User", value: [user.name, user.email].filter(Boolean).join(" · ") });
  }

  // For personal standard/free plans (which never expire on a billing cycle),
  // show the daily reset countdown so users always know when their daily limit refreshes.
  if (isPersonalStandard || (!showOrg && formatResetTime(raw?.expiresAt, now) === "never")) {
    notes.push({ label: "Daily reset", value: formatDailyResetCountdown(now) });
  }

  // The official Qoder CLI renders this field as "Expires": it is the quota's
  // validity end (personal or enterprise alike), not a recurring reset.
  notes.push({ label: "Expires", value: formatResetTime(raw?.expiresAt, now) });
  // The add-on detail page is plan-specific; the upgrade page is the generic
  // fallback, and the region console is the last resort.
  const manageUrl = raw?.addOnQuota?.detailUrl || raw?.upgradeUrl || region.manageUrl;
  if (manageUrl) notes.push({ label: "Manage", value: manageUrl });

  const title = `${region.usageTitle}${userType}`;
  return {
    title: region.usageTitle,
    lines: [paint(title, color ? ANSI.bold : undefined), ...renderUsageRows(rows, notes, color)],
  };
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

/** Resolved access token plus the stored display identity for the usage view. */
interface UsageIdentity {
  access: string;
  name: string;
  email: string;
}

/**
 * Resolve the access token (preferring the registry so an expired token is
 * refreshed first) together with the stored display identity. The quota
 * payload itself carries no user-facing name, so the identity stored at login
 * is used as-is and only fetched fresh when missing or for a foreign token.
 */
async function resolveUsageIdentity(
  providerID: string,
  mode: QoderMode,
  ctx?: ExtensionCommandContext,
  withIdentity = true,
): Promise<UsageIdentity | undefined> {
  let access: string | undefined;
  try {
    access = (await ctx?.modelRegistry?.getApiKeyForProvider(providerID)) || undefined;
  } catch {
    // A registry miss falls through to the stored credentials.
  }

  // Imported lazily so this module stays importable in tests without pi.
  const { getCachedCredentials } = await import("../auth/oauth.js");
  const stored = getCachedCredentials("", providerID);
  access = access || stored?.access || undefined;
  if (!access) return undefined;
  if (!withIdentity) return { access, name: "", email: "" };

  // Identity only matches when the stored credential IS the resolved token;
  // a registry-injected foreign token would display someone else's name.
  const storedMatches = stored?.access === access;
  let name = (storedMatches && stored?.name) || "";
  let email = (storedMatches && stored?.email) || "";
  if (!name && !email) {
    // Best effort: a missing identity is cosmetic, so any failure stays silent.
    try {
      const { fetchUserInfo } = await import("../auth/pat.js");
      const info = await fetchUserInfo(access, mode);
      name = info.name || "";
      email = info.email || "";
    } catch {
      // Cosmetic only.
    }
  }
  return { access, name, email };
}

/** Arguments accepted after the command name. */
const FORMAT_ARGS = new Set(["json", "raw", "debug"]);
/** Arguments that ask for the grid without SGR codes, for piping into a file or a log. */
const PLAIN_ARGS = new Set(["plain", "no-color", "nocolor"]);

/**
 * Decide whether to emit colour.
 *
 * The TUI renders SGR codes and strips them before measuring width, so a UI is
 * enough to colourise. Without one the output is a plain terminal, which only
 * gets codes when it is a TTY. `NO_COLOR` and an explicit `plain` argument
 * always win, and `json` output is never styled.
 */
export function shouldColorize(
  args: string,
  options: { hasUI?: boolean; isTTY?: boolean; env?: Record<string, string | undefined> } = {},
): boolean {
  if (PLAIN_ARGS.has((args || "").trim().toLowerCase())) return false;
  const env = options.env ?? process.env;
  if (env.NO_COLOR || env.TERM === "dumb" || env.FORCE_COLOR === "0") return false;
  if (options.hasUI) return true;
  return options.isTTY ?? Boolean(process.stdout?.isTTY);
}

/**
 * Run `/qoder-cn.usage`.
 *
 * `json` (or `raw`) prints the untouched payload, for when the formatted view
 * hides a field while diagnosing a quota question. `plain` drops the colour.
 */
export async function runUsageCommand(mode: QoderMode, args: string, ctx?: ExtensionCommandContext): Promise<void> {
  const region = getQoderRegionConfig(mode);
  const providerID = region.providerID;
  const wantsRaw = FORMAT_ARGS.has((args || "").trim().toLowerCase());

  try {
    const identity = await resolveUsageIdentity(providerID, mode, ctx, !wantsRaw);
    const accessToken = identity?.access;
    if (!accessToken) {
      ctx?.ui?.notify(`No ${providerID} credentials. Run /login ${providerID} first.`, "warning");
      return;
    }

    const raw = await fetchQoderQuota(accessToken, mode);
    const color = !wantsRaw && shouldColorize(args, { hasUI: Boolean(ctx?.ui) });
    const output = wantsRaw
      ? JSON.stringify(raw, null, 2)
      : formatQoderUsage(raw, mode, Date.now(), { color, user: identity }).lines.join("\n");

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
