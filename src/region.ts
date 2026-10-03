import { getQoderCNEndpoints, QODER_CN_OFFICIAL } from "./vpc.js";

export type QoderMode = "global" | "cn";

export interface QoderRegionConfig {
  mode: QoderMode;
  providerID: "qoder" | "qoder-cn";
  baseUrl: string;
  openApiUrl: string;
  centerUrl: string;
  manageUrl: string;
  patManageUrl: string;
  deviceLoginUrl?: string;
  modelCacheFile: string;
  patEnvNames: readonly string[];
  loginName: string;
  userNameFallback: string;
  userEmailFallback: string;
  usageTitle: string;
  supportsBrowserLogin: boolean;
}

const QODER_REGIONS: Record<QoderMode, QoderRegionConfig> = {
  global: {
    mode: "global",
    providerID: "qoder",
    baseUrl: "https://api3.qoder.sh/",
    openApiUrl: "https://openapi.qoder.sh",
    centerUrl: "https://center.qoder.sh",
    manageUrl: "https://qoder.com",
    patManageUrl: "https://qoder.com/account/integrations",
    deviceLoginUrl: "https://qoder.com/device/selectAccounts",
    modelCacheFile: "qoder-models-cache.json",
    patEnvNames: ["QODER_API_KEY", "QODER_PERSONAL_ACCESS_TOKEN", "QODER_PAT"],
    loginName: "Qoder (Browser OAuth / PAT)",
    userNameFallback: "Qoder User",
    userEmailFallback: "user@qoder.com",
    usageTitle: "Qoder AI Plan",
    supportsBrowserLogin: true,
  },
  cn: {
    mode: "cn",
    providerID: "qoder-cn",
    baseUrl: QODER_CN_OFFICIAL.baseUrl,
    openApiUrl: QODER_CN_OFFICIAL.openApiUrl,
    centerUrl: QODER_CN_OFFICIAL.centerUrl,
    manageUrl: QODER_CN_OFFICIAL.manageUrl,
    patManageUrl: "https://qoder.com.cn/account/integrations",
    modelCacheFile: "qoder-cn-models-cache.json",
    patEnvNames: ["QODERCN_API_KEY", "QODERCN_PERSONAL_ACCESS_TOKEN", "QODERCN_PAT"],
    loginName: "Qoder CN (PAT)",
    userNameFallback: "Qoder CN User",
    userEmailFallback: "user@qoder.com.cn",
    usageTitle: "Qoder CN Plan",
    supportsBrowserLogin: false,
  },
};

/** Every region this fork knows how to talk to. */
export const QODER_MODES: readonly QoderMode[] = ["global", "cn"];

/**
 * Regions whose provider is actually registered with Pi.
 * Both CN and Global providers are registered so users can seamlessly use either.
 */
export const QODER_PROVIDER_MODES: readonly QoderMode[] = ["cn", "global"];

export function getQoderRegionConfig(mode: QoderMode): QoderRegionConfig {
  return QODER_REGIONS[mode];
}

/**
 * Resolve a region field, preferring the live enterprise endpoint for CN.
 *
 * Every CN URL must come from the same resolved instance as the gateway, or a
 * request signed for one VPC would be sent to another.
 */
function getRegionValue(mode: QoderMode, field: "baseUrl" | "openApiUrl" | "centerUrl" | "manageUrl"): string {
  if (mode === "cn") return getQoderCNEndpoints()[field];
  return getQoderRegionConfig(mode)[field];
}

export function getQoderBaseUrl(mode: QoderMode): string {
  return getRegionValue(mode, "baseUrl");
}

export function getQoderOpenApiUrl(mode: QoderMode): string {
  return getRegionValue(mode, "openApiUrl");
}

export function getQoderCenterUrl(mode: QoderMode): string {
  return getRegionValue(mode, "centerUrl");
}

export function getQoderManageUrl(mode: QoderMode): string {
  return getRegionValue(mode, "manageUrl");
}

export function getQoderModelListURL(mode: QoderMode): string {
  return `${getQoderBaseUrl(mode)}algo/api/v2/model/list?Encode=1`;
}

export function getQoderChatURL(mode: QoderMode): string {
  return `${getQoderBaseUrl(mode)}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
}

export function getQoderExchangeURL(mode: QoderMode): string {
  return `${getQoderOpenApiUrl(mode)}/api/v1/jobToken/exchange`;
}

export function getQoderUserInfoURL(mode: QoderMode): string {
  return `${getQoderOpenApiUrl(mode)}/api/v1/userinfo`;
}

export function getQoderUsageURL(mode: QoderMode): string {
  return `${getQoderOpenApiUrl(mode)}/api/v2/quota/usage`;
}

export function getQoderRefreshURL(mode: QoderMode): string {
  // The official Qoder CN CLI refreshes job tokens on the OpenAPI host
  // (POST /api/v1/jobToken/refresh); the legacy algo path has no match in the
  // official bundle and refreshes never succeeded against it.
  return `${getQoderOpenApiUrl(mode)}/api/v1/jobToken/refresh`;
}

export function getQoderDeviceRefreshURL(mode: QoderMode): string {
  return `${getQoderOpenApiUrl(mode)}/api/v1/deviceToken/refresh`;
}

export function getQoderDeviceLoginURL(codeChallenge: string, machineID: string, nonce: string): string {
  const baseUrl = getQoderRegionConfig("global").deviceLoginUrl;
  if (!baseUrl) throw new Error("Qoder browser login URL is not configured");
  return `${baseUrl}?challenge=${codeChallenge}&challenge_method=S256&machine_id=${machineID}&nonce=${nonce}`;
}

export function getQoderDevicePollURL(nonce: string, codeVerifier: string): string {
  const baseUrl = getQoderRegionConfig("global").openApiUrl;
  return `${baseUrl}/api/v1/deviceToken/poll?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;
}
