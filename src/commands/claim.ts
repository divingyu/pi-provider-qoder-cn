/**
 * `/qoder-cn.claim` — daily check-in to claim 100 free Credits.
 *
 * Qoder runs a daily 100 Credits claim event for personal users (both free and
 * pro tiers) resetting daily at 10:00 UTC+8 (Beijing time). The claimed
 * credits are Add-on Credits with a 30-day validity window.
 *
 * The official desktop client calls:
 *   GET  <openApiUrl>/sash/api/v1/me/campaigns
 *   POST <openApiUrl>/sash/api/v1/me/campaigns/{campaignId}/claim
 *
 * Essential headers required by the gateway to expose and grant desktop benefits:
 *   Authorization: Bearer <accessToken>
 *   Cosy-ClientType: 10   (10 = desktop client; 5 = web which hides daily campaigns)
 *   Cosy-MachineId: <machineID>
 *   Cosy-Version: 0.3.3
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { toEpochMs } from "../auth/expiry.js";
import { getMachineId } from "../cosy.js";
import { getQoderOpenApiUrl, getQoderRegionConfig, type QoderMode } from "../region.js";

/** Benefit details included in the campaign payload. */
export interface QoderCampaignBenefit {
  kind: string; // "CREDITS"
  amount: number; // 100
  modelScope?: {
    modelSeries?: {
      key?: string; // "ALL_MODELS"
    };
  };
  validity?: {
    mode?: string; // "RELATIVE_DAYS"
    days?: number; // 30
  };
}

/** One campaign entry returned by GET /sash/api/v1/me/campaigns. */
export interface QoderCampaignItem {
  campaignId: string;
  campaignKey?: string;
  actionType: string; // "CLAIM_BENEFIT"
  claimStatus: "UNCLAIMED" | "CLAIMED" | string;
  startAt?: number;
  endAt?: number;
  benefit?: QoderCampaignBenefit;
  placements?: Array<{
    type?: string;
    content?: {
      zh?: { title?: string; description?: string; detailUrl?: string };
      en?: { title?: string; description?: string; detailUrl?: string };
    };
  }>;
}

/** Payload returned by GET /sash/api/v1/me/campaigns. */
export interface QoderCampaignsResponse {
  uid?: string;
  showCampaign?: boolean;
  claimable?: boolean;
  campaignUrl?: string;
  campaigns?: QoderCampaignItem[];
  [key: string]: unknown;
}

/** Payload returned by POST /sash/api/v1/me/campaigns/{campaignId}/claim. */
export interface QoderClaimResponse {
  grantId?: string;
  status?: string; // "CLAIMED"
  replayed?: boolean;
  benefit?: QoderCampaignBenefit;
  campaignId?: string;
  campaignKey?: string;
  claimedAt?: string;
  grantedAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

/** Check-in grant details used by both the claim command and the usage display. */
export interface CheckinGrantInfo {
  claimed: boolean;
  amount: number;
  claimedAt?: string;
  expiresAt?: string;
  validityDays?: number;
  campaignId?: string;
  campaignTitle?: string;
  /** Timestamp until which this grant information is fresh (next Beijing 10:00 AM). */
  cacheUntil?: number;
}

function piAgentDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".pi", "agent");
}

export function getCheckinCachePath(mode: QoderMode = "cn"): string {
  const file = mode === "cn" ? "qoder-cn-checkin.json" : "qoder-checkin.json";
  return join(piAgentDir(), file);
}

export function readCheckinCache(mode: QoderMode = "cn"): CheckinGrantInfo | null {
  try {
    const file = getCheckinCachePath(mode);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as CheckinGrantInfo;
  } catch {
    return null;
  }
}

export function writeCheckinCache(info: CheckinGrantInfo, mode: QoderMode = "cn"): boolean {
  try {
    const file = getCheckinCachePath(mode);
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(info, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
} as const;

function paint(text: string, code: string | undefined): string {
  return code && text ? `${code}${text}${ANSI.reset}` : text;
}

/**
 * Calculate milliseconds remaining until the next Beijing time (UTC+8) 10:00 AM.
 * The daily claim event resets at 10:00 Beijing time every day.
 */
export function msUntilBeijing10AM(now = Date.now()): number {
  const beijingOffset = 8 * 3600_000;
  const beijingTime = now + beijingOffset;
  const beijingDate = new Date(beijingTime);
  let targetUtc = Date.UTC(beijingDate.getUTCFullYear(), beijingDate.getUTCMonth(), beijingDate.getUTCDate(), 10, 0, 0);
  if (beijingTime >= targetUtc) {
    targetUtc += 24 * 3600_000;
  }
  return targetUtc - beijingTime;
}

/** Format milliseconds into a human-friendly countdown (e.g. "22小时10分钟"). */
export function formatCountdownBeijing(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

/** Format an ISO date string or timestamp into local Beijing time string. */
export function formatDateTime(isoOrMs: string | number | undefined): string {
  if (!isoOrMs) return "n/a";
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return String(isoOrMs);
  // Display in UTC+8
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Device risk identity (UMID) the desktop app attaches to SASH requests.
 *
 * Verified against the live global API: WITHOUT these headers the campaigns
 * endpoint returns only marketing banners (claimable:false); WITH them the
 * daily CLAIM_BENEFIT campaign appears. The values come from the desktop
 * app's own UMID component (`resources/umid/runtime-info.exe`), invoked as
 * `runtime-info.exe <environment> --account-stdin` with
 * `{"account":"<userId>"}` on stdin (environment: 3 = global, 0 = cn).
 */
export interface SashMachineIdentity {
  machineToken: string;
  machineCode: string;
  machineType: string;
}

const printableAscii = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && /^[\x20-\x7e]+$/.test(v.trim());

const identityMemCache = new Map<string, { identity: SashMachineIdentity; expiresAt: number }>();
const IDENTITY_TTL_MS = 30 * 60_000;

/** Candidate locations of the desktop app's UMID component. */
function candidateUmidExes(): string[] {
  const custom = process.env.QODER_UMID_EXE;
  if (custom) return [custom];
  const localAppData =
    process.env.LOCALAPPDATA || join(process.env.HOME || process.env.USERPROFILE || homedir(), "AppData", "Local");
  const roots = [join(localAppData, "Programs", "Qoder"), "C:\\Program Files\\Qoder", "D:\\Qoder"];
  return roots.map((r) => join(r, "resources", "umid", "runtime-info.exe"));
}

/**
 * The desktop app spawns the component with `--account-stdin` and writes
 * `{"account":"<userId>"}` to its stdin; spawnSync's `input` option mirrors
 * that exactly (execFile cannot feed stdin).
 */
function runUmidExe(exe: string, environment: number, accountId: string): string {
  const res = spawnSync(exe, [String(environment), "--account-stdin"], {
    input: JSON.stringify({ account: accountId }),
    timeout: 10_000,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`runtime-info exited ${res.status}: ${String(res.stderr || "").slice(0, 120)}`);
  return String(res.stdout || "");
}

/**
 * Resolve the desktop device identity for SASH requests.
 *
 * Spawns the installed Qoder desktop's own UMID component (same machine, same
 * account — the exact computation the official client performs before every
 * campaigns call). Returns null when the component is unavailable so callers
 * degrade to identity-less requests instead of failing.
 */
export async function resolveSashMachineIdentity(
  mode: QoderMode,
  accountId: string | undefined,
): Promise<SashMachineIdentity | null> {
  if (!accountId) return null;
  const key = `${mode}:${accountId}`;
  const hit = identityMemCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.identity;

  // Desktop app: environment 3 = global, 0 = cn (asar: environment: e === "global" ? 3 : 0).
  const environment = mode === "global" ? 3 : 0;
  for (const exe of candidateUmidExes()) {
    if (!existsSync(exe)) continue;
    try {
      const stdout = await runUmidExe(exe, environment, accountId);
      const parsed = JSON.parse(stdout) as {
        machineToken?: unknown;
        machineCode?: unknown;
        machineType?: unknown;
      };
      if (
        !printableAscii(parsed.machineToken) ||
        !printableAscii(parsed.machineCode) ||
        !printableAscii(parsed.machineType)
      ) {
        continue;
      }
      const identity = {
        machineToken: parsed.machineToken.trim(),
        machineCode: parsed.machineCode.trim(),
        machineType: parsed.machineType.trim(),
      };
      identityMemCache.set(key, { identity, expiresAt: Date.now() + IDENTITY_TTL_MS });
      return identity;
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

/**
 * Headers required by the Qoder SASH gateway to authorize desktop benefits.
 *
 * The risk-identity headers must mirror the desktop app's own `YBr` builder:
 * the global gateway hides every CLAIM_BENEFIT campaign from requests that
 * lack a valid device attestation (marketing banners still come back, which
 * is why a missing identity looks like "no campaign" instead of an error).
 */
function buildSashHeaders(
  accessToken: string,
  machineID: string,
  identity?: SashMachineIdentity | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Cosy-ClientType": "10",
    "Cosy-Version": "1.13.3",
    "Cosy-MachineId": machineID,
    "Cosy-MachineOS": "x86_64_windows",
    "Cosy-MachineHostname": hostname(),
    "User-Agent": "Qoder",
  };
  if (identity) {
    headers["Cosy-MachineToken"] = identity.machineToken;
    headers["Cosy-MachineCode"] = identity.machineCode;
    headers["Cosy-MachineType"] = identity.machineType;
  }
  return headers;
}

/** Fetch available campaigns for the account. */
export async function fetchQoderCampaigns(
  accessToken: string,
  machineID: string,
  mode: QoderMode,
  identity?: SashMachineIdentity | null,
): Promise<QoderCampaignsResponse> {
  const url = `${getQoderOpenApiUrl(mode)}/sash/api/v1/me/campaigns?forceRefresh=true`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildSashHeaders(accessToken, machineID, identity),
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  let data: QoderCampaignsResponse | undefined;
  try {
    data = JSON.parse(text) as QoderCampaignsResponse;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const detail = (data?.message as string | undefined) || text.slice(0, 200);
    throw new Error(`Failed to query Qoder campaigns (${response.status}): ${detail}`);
  }
  if (!data) throw new Error("Qoder campaigns response was not JSON.");
  return data;
}

/** Claim a benefit from an active campaign. */
export async function claimQoderCampaign(
  accessToken: string,
  machineID: string,
  campaignId: string,
  mode: QoderMode,
  identity?: SashMachineIdentity | null,
): Promise<QoderClaimResponse> {
  const url = `${getQoderOpenApiUrl(mode)}/sash/api/v1/me/campaigns/${encodeURIComponent(campaignId)}/claim`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildSashHeaders(accessToken, machineID, identity),
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  let data: QoderClaimResponse | undefined;
  try {
    data = JSON.parse(text) as QoderClaimResponse;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const detail = (data?.message as string | undefined) || text.slice(0, 200);
    throw new Error(`Failed to claim Qoder benefit (${response.status}): ${detail}`);
  }
  if (!data) throw new Error("Qoder claim response was not JSON.");
  return data;
}

/**
 * Fetch the current check-in grant info for the account.
 *
 * Calls GET /sash/api/v1/me/campaigns and, if claimed today, replays the claim
 * endpoint (which is idempotent) to retrieve the exact grant timestamps.
 * Writes to local cache on success and falls back to cache on failure.
 */
export async function fetchCheckinGrantInfo(
  accessToken: string,
  machineID: string,
  mode: QoderMode,
  identity?: SashMachineIdentity | null,
): Promise<CheckinGrantInfo | null> {
  // If we already have fresh, cached grant info for the current Beijing day,
  // return it directly to avoid redundant network round-trips on every usage check.
  const cached = readCheckinCache(mode);
  if (cached?.claimed && cached.expiresAt && cached.cacheUntil && Date.now() < cached.cacheUntil) {
    return cached;
  }

  try {
    const campaignsData = await fetchQoderCampaigns(accessToken, machineID, mode, identity);
    const campaigns = campaignsData.campaigns || [];
    const dailyCreditCampaign =
      campaigns.find(
        (c) => c.actionType === "CLAIM_BENEFIT" && (c.benefit?.kind === "CREDITS" || c.benefit?.amount === 100),
      ) || campaigns.find((c) => c.actionType === "CLAIM_BENEFIT");

    if (!dailyCreditCampaign) return null;

    const title = dailyCreditCampaign.placements?.[0]?.content?.zh?.title || "每天领 100 Credits";
    const amount = dailyCreditCampaign.benefit?.amount || 100;
    const validityDays = dailyCreditCampaign.benefit?.validity?.days || 30;
    // Prefer the server-reported campaign window; fall back to the next
    // 10:00 UTC+8 boundary. Keeping this identical to runClaimCommand's
    // computation avoids the cache flip-flopping between two anchors.
    const endAtMs = toEpochMs(dailyCreditCampaign.endAt);
    const cacheUntil = endAtMs && endAtMs > Date.now() ? endAtMs : Date.now() + msUntilBeijing10AM();

    let info: CheckinGrantInfo;
    if (dailyCreditCampaign.claimStatus === "CLAIMED") {
      try {
        const claimRes = await claimQoderCampaign(
          accessToken,
          machineID,
          dailyCreditCampaign.campaignId,
          mode,
          identity,
        );
        info = {
          claimed: true,
          amount: claimRes.benefit?.amount || amount,
          claimedAt: claimRes.claimedAt || cached?.claimedAt,
          expiresAt: claimRes.expiresAt || cached?.expiresAt,
          validityDays: claimRes.benefit?.validity?.days || validityDays,
          campaignId: dailyCreditCampaign.campaignId,
          campaignTitle: title,
          cacheUntil,
        };
      } catch {
        info = {
          claimed: true,
          amount,
          claimedAt: cached?.claimedAt,
          expiresAt: cached?.expiresAt,
          validityDays,
          campaignId: dailyCreditCampaign.campaignId,
          campaignTitle: title,
          cacheUntil,
        };
      }
    } else {
      info = {
        claimed: false,
        amount,
        validityDays,
        campaignId: dailyCreditCampaign.campaignId,
        campaignTitle: title,
        cacheUntil,
      };
    }

    writeCheckinCache(info, mode);
    return info;
  } catch {
    return readCheckinCache(mode);
  }
}

/** Resolve credentials and machine ID for the claim operation. */
async function resolveCredentials(
  providerID: string,
  ctx?: ExtensionCommandContext,
): Promise<{ accessToken: string; machineID: string; userID: string } | null> {
  let accessToken: string | undefined;
  try {
    accessToken = (await ctx?.modelRegistry?.getApiKeyForProvider(providerID)) || undefined;
  } catch {
    // Registry miss falls through
  }

  const { getCachedCredentials } = await import("../auth/oauth.js");
  const stored = getCachedCredentials("", providerID);
  accessToken = accessToken || stored?.access || undefined;
  if (!accessToken) return null;

  const machineID = stored?.machineID || getMachineId();
  const userID = stored?.userID || "";
  return { accessToken, machineID, userID };
}

/**
 * Run `/qoder-cn.claim`.
 *
 * Supports `json` argument to print raw response objects.
 */
export async function runClaimCommand(mode: QoderMode, args: string, ctx?: ExtensionCommandContext): Promise<void> {
  const region = getQoderRegionConfig(mode);
  const providerID = region.providerID;
  const wantsRaw = ["json", "raw", "debug"].includes((args || "").trim().toLowerCase());

  try {
    const creds = await resolveCredentials(providerID, ctx);
    if (!creds) {
      const msg =
        mode === "cn"
          ? `未找到 ${providerID} 登录凭据，请先运行 /login ${providerID}`
          : `No ${providerID} credentials found. Run /login ${providerID} first.`;
      ctx?.ui?.notify(msg, "warning");
      if (!ctx?.ui) console.warn(msg);
      return;
    }

    const { accessToken, machineID, userID } = creds;
    // The global gateway hides CLAIM_BENEFIT campaigns without desktop device
    // attestation (verified live: banners-only without the UMID headers, daily
    // 100-credits campaign with them). Best-effort: claim still works on CN.
    const identity = await resolveSashMachineIdentity(mode, userID).catch(() => null);
    const campaignsData = await fetchQoderCampaigns(accessToken, machineID, mode, identity);
    const campaigns = campaignsData.campaigns || [];

    // Find the daily 100 Credits claim campaign
    const dailyCreditCampaign =
      campaigns.find(
        (c) => c.actionType === "CLAIM_BENEFIT" && (c.benefit?.kind === "CREDITS" || c.benefit?.amount === 100),
      ) || campaigns.find((c) => c.actionType === "CLAIM_BENEFIT");

    if (!dailyCreditCampaign) {
      if (wantsRaw) {
        const rawJson = JSON.stringify(campaignsData, null, 2);
        ctx?.ui?.notify(rawJson, "info");
        if (!ctx?.ui) console.log(rawJson);
        return;
      }
      // Two distinct causes with different remedies:
      // - no device attestation (identity unresolved): the gateway hides all
      //   claim campaigns — install/launch the desktop app or point
      //   QODER_UMID_EXE at its runtime-info.exe;
      // - attested but genuinely nothing offered for this account/region.
      const msg =
        identity === null
          ? mode === "cn"
            ? "⚠️ 未找到 Qoder 桌面端设备指纹组件（runtime-info.exe），服务端因此不下发可领取的签到活动。请安装并打开 Qoder 桌面端，或设置 QODER_UMID_EXE 指向其 resources/umid/runtime-info.exe 后重试。"
            : "⚠️ Daily check-in campaigns are hidden without desktop device attestation, and the Qoder desktop UMID component (runtime-info.exe) was not found on this machine.\n- Install/launch the Qoder desktop app, or set QODER_UMID_EXE to its resources/umid/runtime-info.exe, then retry."
          : mode === "cn"
            ? "ℹ️ 当前暂无可领取的签到活动（每日 10:00 UTC+8 开放刷新）"
            : "ℹ️ Device verified, but no claimable check-in campaign is offered for this account/region right now (the campaign list carries banners only; claims reset at 10:00 UTC+8 when offered).";
      ctx?.ui?.notify(msg, identity === null ? "warning" : "info");
      if (!ctx?.ui) console.log(msg);
      return;
    }

    const content =
      mode === "cn"
        ? dailyCreditCampaign.placements?.[0]?.content?.zh || dailyCreditCampaign.placements?.[0]?.content?.en
        : dailyCreditCampaign.placements?.[0]?.content?.en || dailyCreditCampaign.placements?.[0]?.content?.zh;
    const campaignTitle = content?.title || (mode === "cn" ? "每天领 100 Credits" : "Claim 100 Credits Daily");
    const amount = dailyCreditCampaign.benefit?.amount || 100;
    const validityDays = dailyCreditCampaign.benefit?.validity?.days || 30;

    // Use campaign endAt if available, otherwise compute next 10:00 AM UTC+8
    const endAtMs = toEpochMs(dailyCreditCampaign.endAt);
    const remainingToReset = endAtMs && endAtMs > Date.now() ? endAtMs - Date.now() : msUntilBeijing10AM();
    const countdown = formatCountdownBeijing(remainingToReset);

    // Case 1: Already claimed today
    if (dailyCreditCampaign.claimStatus === "CLAIMED") {
      const cached = readCheckinCache(mode);
      writeCheckinCache(
        {
          claimed: true,
          amount,
          validityDays,
          campaignId: dailyCreditCampaign.campaignId,
          campaignTitle,
          claimedAt: cached?.claimedAt,
          expiresAt: cached?.expiresAt,
          cacheUntil: Date.now() + remainingToReset,
        },
        mode,
      );
      if (wantsRaw) {
        const rawJson = JSON.stringify(dailyCreditCampaign, null, 2);
        ctx?.ui?.notify(rawJson, "info");
        if (!ctx?.ui) console.log(rawJson);
        return;
      }

      const lines =
        mode === "cn"
          ? [
              paint(`ℹ️ 今日 ${amount} Credits 已经领取过，无需重复操作`, ANSI.cyan),
              `- 活动名称：${campaignTitle}`,
              `- 额度说明：${amount} Credits（全模型通用资源包，${validityDays} 天有效）`,
              `- 下次刷新：明日 10:00 UTC+8（距刷新约 ${countdown}）`,
            ]
          : [
              paint(`ℹ️ Today's ${amount} Credits already claimed.`, ANSI.cyan),
              `- Campaign: ${campaignTitle}`,
              `- Benefit: ${amount} Credits (${validityDays}-day validity)`,
              `- Next reset: Daily at 10:00 UTC+8 (in ~${countdown})`,
            ];
      const output = lines.join("\n");
      ctx?.ui?.notify(output, "info");
      if (!ctx?.ui) console.log(output);
      return;
    }

    // Case 2: Available to claim
    const claimRes = await claimQoderCampaign(accessToken, machineID, dailyCreditCampaign.campaignId, mode, identity);

    const grantAmount = claimRes.benefit?.amount || amount;
    const grantDays = claimRes.benefit?.validity?.days || validityDays;
    const expiresText = claimRes.expiresAt ? formatDateTime(claimRes.expiresAt) : `${grantDays} 天后`;

    writeCheckinCache(
      {
        claimed: true,
        amount: grantAmount,
        claimedAt: claimRes.claimedAt,
        expiresAt: claimRes.expiresAt,
        validityDays: grantDays,
        campaignId: dailyCreditCampaign.campaignId,
        campaignTitle,
        cacheUntil: Date.now() + remainingToReset,
      },
      mode,
    );

    const lines =
      mode === "cn"
        ? [
            paint(`🎉 成功领取今日 ${grantAmount} Credits！`, `${ANSI.green}${ANSI.bold}`),
            `- 额度类型：全模型通用资源包（Add-on Credits）`,
            `- 有效期限：${grantDays} 天（有效期至 ${expiresText}）`,
            `- 领取流水：${claimRes.grantId || "ok"}`,
            `- 下次刷新：明日 10:00 UTC+8（距刷新约 ${countdown}）`,
          ]
        : [
            paint(`🎉 Successfully claimed ${grantAmount} Credits!`, `${ANSI.green}${ANSI.bold}`),
            `- Type: Universal Add-on Credits`,
            `- Validity: ${grantDays} days (expires ${expiresText})`,
            `- Grant ID: ${claimRes.grantId || "ok"}`,
            `- Next reset: Daily at 10:00 UTC+8 (in ~${countdown})`,
          ];
    const output = lines.join("\n");
    ctx?.ui?.notify(output, "info");
    if (!ctx?.ui) console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errText = mode === "cn" ? `❌ 每日签到领取失败: ${message}` : `❌ Daily check-in claim failed: ${message}`;
    ctx?.ui?.notify(errText, "error");
    if (!ctx?.ui) console.error(errText);
  }
}
