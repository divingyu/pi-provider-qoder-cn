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

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
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

/** Headers required by the Qoder SASH gateway to authorize desktop benefits. */
function buildSashHeaders(accessToken: string, machineID: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Cosy-ClientType": "10",
    "Cosy-Version": "0.3.3",
    "Cosy-MachineId": machineID,
    "User-Agent": "Qoder/0.3.3",
  };
}

/** Fetch available campaigns for the account. */
export async function fetchQoderCampaigns(
  accessToken: string,
  machineID: string,
  mode: QoderMode,
): Promise<QoderCampaignsResponse> {
  const url = `${getQoderOpenApiUrl(mode)}/sash/api/v1/me/campaigns?forceRefresh=true`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildSashHeaders(accessToken, machineID),
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
): Promise<QoderClaimResponse> {
  const url = `${getQoderOpenApiUrl(mode)}/sash/api/v1/me/campaigns/${encodeURIComponent(campaignId)}/claim`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildSashHeaders(accessToken, machineID),
    body: JSON.stringify({}),
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

/** Resolve credentials and machine ID for the claim operation. */
async function resolveCredentials(
  providerID: string,
  ctx?: ExtensionCommandContext,
): Promise<{ accessToken: string; machineID: string } | null> {
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
  return { accessToken, machineID };
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
      const msg = `未找到 ${providerID} 登录凭据，请先运行 /login ${providerID}`;
      ctx?.ui?.notify(msg, "warning");
      if (!ctx?.ui) console.warn(msg);
      return;
    }

    const { accessToken, machineID } = creds;
    const campaignsData = await fetchQoderCampaigns(accessToken, machineID, mode);
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
      const msg = "ℹ️ 当前暂无可领取的签到活动（每日 10:00 UTC+8 开放刷新）";
      ctx?.ui?.notify(msg, "info");
      if (!ctx?.ui) console.log(msg);
      return;
    }

    const zhContent = dailyCreditCampaign.placements?.[0]?.content?.zh;
    const campaignTitle = zhContent?.title || "每天领 100 Credits";
    const amount = dailyCreditCampaign.benefit?.amount || 100;
    const validityDays = dailyCreditCampaign.benefit?.validity?.days || 30;
    const countdown = formatCountdownBeijing(msUntilBeijing10AM());

    // Case 1: Already claimed today
    if (dailyCreditCampaign.claimStatus === "CLAIMED") {
      if (wantsRaw) {
        const rawJson = JSON.stringify(dailyCreditCampaign, null, 2);
        ctx?.ui?.notify(rawJson, "info");
        if (!ctx?.ui) console.log(rawJson);
        return;
      }

      const lines = [
        paint(`ℹ️ 今日 ${amount} Credits 已经领取过，无需重复操作`, ANSI.cyan),
        `- 活动名称：${campaignTitle}`,
        `- 额度说明：${amount} Credits（全模型通用资源包，${validityDays} 天有效）`,
        `- 下次刷新：明日 10:00 UTC+8（距刷新约 ${countdown}）`,
      ];
      const output = lines.join("\n");
      ctx?.ui?.notify(output, "info");
      if (!ctx?.ui) console.log(output);
      return;
    }

    // Case 2: Available to claim
    const claimRes = await claimQoderCampaign(accessToken, machineID, dailyCreditCampaign.campaignId, mode);

    if (wantsRaw) {
      const rawJson = JSON.stringify(claimRes, null, 2);
      ctx?.ui?.notify(rawJson, "info");
      if (!ctx?.ui) console.log(rawJson);
      return;
    }

    const grantAmount = claimRes.benefit?.amount || amount;
    const grantDays = claimRes.benefit?.validity?.days || validityDays;
    const expiresText = claimRes.expiresAt ? formatDateTime(claimRes.expiresAt) : `${grantDays} 天后`;

    const lines = [
      paint(`🎉 成功领取今日 ${grantAmount} Credits！`, `${ANSI.green}${ANSI.bold}`),
      `- 额度类型：全模型通用资源包（Add-on Credits）`,
      `- 有效期限：${grantDays} 天（有效期至 ${expiresText}）`,
      `- 领取流水：${claimRes.grantId || "ok"}`,
      `- 下次刷新：明日 10:00 UTC+8（距刷新约 ${countdown}）`,
    ];
    const output = lines.join("\n");
    ctx?.ui?.notify(output, "info");
    if (!ctx?.ui) console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errText = `❌ 每日签到领取失败: ${message}`;
    ctx?.ui?.notify(errText, "error");
    if (!ctx?.ui) console.error(errText);
  }
}
