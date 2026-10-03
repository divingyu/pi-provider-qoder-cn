/**
 * Error formatting and localization for Qoder API gateway responses.
 *
 * Normalizes numeric codes and upstream messages into user-friendly diagnostic
 * reports with countdowns to the next quota renewal (daily Beijing reset or
 * subscription cycle).
 */

import type { QoderMode } from "../region.js";

interface ParsedQoderError {
  code?: string;
  message?: string;
}

/**
 * Extract code and message from various Qoder error payload shapes:
 * - Direct JSON string: `{"code":"110","message":"Billing daily count exceeded"}`
 * - Nested JSON string: `{"code":"403","message":"{\"code\":\"110\",...}"}`
 * - Object with code/errorCode/message/errorMessage
 */
export function parseQoderErrorPayload(payload: unknown): ParsedQoderError | null {
  if (!payload) return null;
  let parsed: unknown = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  // Check if message is a nested JSON string (e.g. {"code":"403","message":"{\"code\":\"110\",...}"})
  if (typeof obj.message === "string" && obj.message.trim().startsWith("{")) {
    try {
      const nested = JSON.parse(obj.message);
      if (typeof nested === "object" && nested !== null) {
        const nestedObj = nested as Record<string, unknown>;
        return {
          code: String(nestedObj.code || nestedObj.errorCode || obj.code || ""),
          message: String(nestedObj.message || nestedObj.errorMessage || obj.message || ""),
        };
      }
    } catch {
      // not JSON, proceed
    }
  }

  const code = obj.code ?? obj.errorCode;
  const message = obj.message ?? obj.errorMessage;
  if (!code && !message) return null;
  return {
    code: code !== undefined ? String(code) : undefined,
    message: message !== undefined ? String(message) : undefined,
  };
}

/**
 * Calculate milliseconds remaining until the next Beijing time (UTC+8) midnight.
 */
export function msUntilBeijingMidnight(now = Date.now()): number {
  const beijingOffset = 8 * 3600_000;
  const beijingTime = now + beijingOffset;
  const beijingDate = new Date(beijingTime);
  const nextMidnightUtc = Date.UTC(
    beijingDate.getUTCFullYear(),
    beijingDate.getUTCMonth(),
    beijingDate.getUTCDate() + 1,
    0,
    0,
    0,
  );
  return nextMidnightUtc - beijingTime;
}

/**
 * Format the remaining countdown to the next Beijing time (UTC+8) midnight reset.
 */
export function getBeijingDailyResetCountdown(now = Date.now()): string {
  const diffMs = msUntilBeijingMidnight(now);
  const totalMinutes = Math.max(1, Math.round(diffMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

/**
 * Format stream/SSE or HTTP error payloads into human-readable diagnostic messages.
 */
export function formatQoderStreamError(
  statusCode: number,
  rawBody: unknown,
  now = Date.now(),
  mode: QoderMode = "cn",
): string {
  const parsed = parseQoderErrorPayload(rawBody);
  const code = parsed?.code;
  const message = parsed?.message || (typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody));
  const countdown = getBeijingDailyResetCountdown(now);
  // The 105 branch must name the provider the request actually ran against:
  // telling a Global user to "/login qoder-cn" sends them re-authenticating the
  // wrong account. CN keeps its established wording ("错误码 105" and
  // "凭证失效" are also the isCredentialExpiredError detection tokens); the
  // Global branch keeps "错误码 105" so detection stays stable across locales.
  const isCn = mode !== "global";

  if (code === "110" || /billing daily count exceeded/i.test(message) || /daily usage limit reached/i.test(message)) {
    return [
      `[Qoder CN 额度限制] 今日调用次数已达上限 (Billing daily count exceeded, 错误码 110)`,
      `- 刷新时间：将在北京时间 00:00 重置（约 ${countdown}后）`,
      `- 限制原因：当前处于个人标准版（免费版）或触发了单日频次熔断。若账号内有资源包/加油包（Add-on Credits），因免费版单日限制未解除暂无法扣减。`,
      `- 解决建议：等待次日重置；或使用 /model 切换至其他 Provider；个人版可开通 Pro 订阅解除每日限制，企业版请联系管理员调高单日限额。`,
    ].join("\n");
  }

  if (code === "117" || /team member credits exhausted/i.test(message)) {
    return [
      `[Qoder CN 企业额度限制] 企业分配给您的个人 Credits 额度已用尽 (错误码 117)`,
      `- 限制原因：管理员在企业控制台分配给您个人的可用 Credits 额度已耗尽。`,
      `- 解决建议：请联系企业管理员在 Qoder 团队管理后台为您增加成员 Credits 配额。`,
    ].join("\n");
  }

  if (code === "116" || /team administrator credits exhausted/i.test(message)) {
    return [
      `[Qoder CN 企业额度限制] 企业/团队管理员的 Credits 总余额已耗尽 (错误码 116)`,
      `- 限制原因：当前企业组织账户的 Credits 额度已全部用完。`,
      `- 解决建议：请联系企业管理员在控制台为组织账户充值或续期。`,
    ].join("\n");
  }

  if (code === "122" || /billing-group credits limit reached/i.test(message)) {
    return [
      `[Qoder CN 企业计费组限制] 您所在的企业计费组已达到本期支出上限 (错误码 122)`,
      `- 限制原因：计费组周期内已消耗完管理员设定的上限额度。`,
      `- 解决建议：请联系计费管理员或企业管理员调整该计费组的周期支出上限。`,
    ].join("\n");
  }

  if (code === "119" || /free usage limit for the selected model reached/i.test(message)) {
    return [
      `[Qoder CN 模型限免额度已满] 当前模型的免费体验额度已用完 (错误码 119)`,
      `- 刷新时间：将在北京时间 00:00 重置（约 ${countdown}后）`,
      `- 解决建议：可使用 /model 切换至其他付费模型（如 deepseek-v4-pro / glm-5.3）消耗 Credits 额度，或次日重置后继续使用。`,
    ].join("\n");
  }

  if (code === "113" || code === "118" || /quota exhausted/i.test(message) || /credits exhausted/i.test(message)) {
    return [
      `[Qoder CN 额度耗尽] 账户 Credits 余额已全部用尽 (错误码 ${code || 113})`,
      `- 限制原因：当前订阅套餐及资源包内的可用额度已全部扣减完毕。`,
      `- 解决建议：请前往 qoder.com.cn 购买资源包/加油包，或等待下一计费周期刷新。`,
    ].join("\n");
  }

  if (code === "105" || /token expired/i.test(message) || /login expired/i.test(message)) {
    if (isCn) {
      return [
        `[Qoder CN 凭证失效] 登录态已过期或 Token 失效 (错误码 105)`,
        `- 解决建议：请重新运行 /login qoder-cn，或更新环境变量中的个人访问令牌（PAT）。`,
      ].join("\n");
    }
    return [
      `[Qoder 凭证失效 | Credential expired] The login session or token has expired (错误码 105)`,
      `- Next step: run /login qoder again, or update the QODER_PERSONAL_ACCESS_TOKEN environment variable (PAT).`,
    ].join("\n");
  }

  if (rawBody === undefined || rawBody === null) {
    return `Upstream status ${statusCode}`;
  }
  const bodyStr = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
  const truncated = bodyStr.length > 500 ? `${bodyStr.slice(0, 500)}...` : bodyStr;
  return `Upstream status ${statusCode}: ${truncated}`;
}

/** True when the error is the mapped credential-expired (105) failure. */
export function isCredentialExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("错误码 105") || message.includes("凭证失效") || /token expired|login expired/i.test(message);
}
