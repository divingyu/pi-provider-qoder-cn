var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cn-naming.ts
function slugifyQoderCNModel(displayName) {
  const slug = (displayName || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").replace(/^-+|-+$/g, "");
  return slug || "qodermodel";
}
function prettifyQoderCNModelName(displayName) {
  const pretty = (displayName || "Qoder CN Model").replace(/Qwen(\d)/g, "Qwen $1").replace(/Qwen([\d.]+)-/g, "Qwen $1 ").replace(/DeepSeek\s*V(\d)-/g, "DeepSeek V$1 ").replace(/\s+/g, " ").trim();
  return pretty.includes("Qoder CN") ? pretty : `${pretty} \xB7 Qoder CN`;
}
function toQoderCNModelInfo(upstreamKey, displayName) {
  const friendly = upstreamKey ? QODER_CN_FRIENDLY_MODELS[upstreamKey] : void 0;
  if (friendly) return friendly;
  return {
    id: slugifyQoderCNModel(displayName || upstreamKey),
    name: prettifyQoderCNModelName(displayName || upstreamKey)
  };
}
function toQoderCNUpstreamKey(modelId) {
  const id = modelId || "";
  const alias = CN_MODEL_KEY_ALIASES[id];
  if (alias) return alias;
  if (QODER_CN_FRIENDLY_MODELS[id]) return id;
  if (Object.hasOwn(QODER_CN_FRIENDLY_MODELS, id)) return id;
  return id || "auto";
}
function isQoderCNModelId(entry, modelId) {
  if (!entry) return false;
  const info = toQoderCNModelInfo(entry.key, entry.display_name);
  if (info.id === modelId) return true;
  if (entry.key === modelId) return true;
  const stripped = (entry.display_name || "").replace(/\s+/g, "");
  return stripped.toLowerCase() === modelId.toLowerCase();
}
var QODER_CN_FRIENDLY_MODELS, CN_MODEL_KEY_ALIASES;
var init_cn_naming = __esm({
  "src/cn-naming.ts"() {
    "use strict";
    QODER_CN_FRIENDLY_MODELS = Object.freeze({
      auto: { id: "auto", name: "Auto \xB7 Qoder CN" },
      "qoder-cn": { id: "auto", name: "Auto \xB7 Qoder CN" },
      qmodel_38max: { id: "qwen3.8-max", name: "Qwen 3.8-Max \xB7 Qoder CN" },
      qfmodel: { id: "qwen3.8-flash", name: "Qwen 3.8-Flash \xB7 Qoder CN" },
      qmodel_latest: { id: "qwen3.7-max", name: "Qwen 3.7-Max \xB7 Qoder CN" },
      qmodel: { id: "qwen3.7-plus", name: "Qwen 3.7-Plus \xB7 Qoder CN" },
      q37fmodel: { id: "qwen3.7-flash", name: "Qwen 3.7-Flash \xB7 Qoder CN" },
      dmodel: { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro \xB7 Qoder CN" },
      dfmodel: { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash \xB7 Qoder CN" },
      gmodel: { id: "glm-5.3", name: "GLM-5.3 \xB7 Qoder CN" },
      gfmodel: { id: "glm-5.3-flash", name: "GLM-5.3-Flash \xB7 Qoder CN" },
      gm51model: { id: "glm-5.2", name: "GLM 5.2 \xB7 Qoder CN" },
      kmodel_latest: { id: "kimi-k3", name: "Kimi-K3 \xB7 Qoder CN" },
      kmodel: { id: "kimi-k2.7-code", name: "Kimi-K2.7-Code \xB7 Qoder CN" },
      mmodel: { id: "minimax-m2.7", name: "MiniMax M2.7 \xB7 Qoder CN" }
    });
    CN_MODEL_KEY_ALIASES = Object.freeze({
      "qwen3.8-max": "qmodel_38max",
      "qwen3.8-flash": "qfmodel",
      "qwen3.7-max": "qmodel_latest",
      "qwen3.7-plus": "qmodel",
      "qwen3.7-flash": "q37fmodel",
      "deepseek-v4-pro": "dmodel",
      "deepseek-v4-flash": "dfmodel",
      "glm-5.3": "gmodel",
      "glm-5.3-flash": "gfmodel",
      "glm-5.2": "gm51model",
      "glm-5.1": "gm51model",
      "kimi-k3": "kmodel_latest",
      "kimi-k2.7-code": "kmodel",
      "kimi-k2.7": "kmodel",
      "kimi-k2.6": "kmodel",
      "kimi-k2.8-preview": "kmodel",
      "qwen3.6-flash": "qfmodel",
      "qwen3.6-plus": "qmodel",
      "minimax-m2.7": "mmodel",
      "minimax-m3": "mmodel"
    });
  }
});

// src/cosy.ts
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function rsaEncryptBase64(data) {
  const key = {
    key: qoderRSAPublicKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
  };
  const encrypted = crypto.publicEncrypt(key, typeof data === "string" ? Buffer.from(data) : data);
  return encrypted.toString("base64");
}
function aesEncryptCBCBase64(plaintext, keyStr) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(keyStr), Buffer.from(keyStr));
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}
function computeSigPath(urlStr) {
  const parsed = new URL(urlStr);
  let sigPath = parsed.pathname;
  if (sigPath.startsWith("/algo")) {
    sigPath = sigPath.substring("/algo".length);
  }
  return sigPath;
}
function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}
function getMachineId() {
  const home = getHomeDir();
  const paths = [join(home, ".qoder", ".auth", "machine_id"), join(home, ".pi", "agent", "qoder-machine-id")];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const val = readFileSync(p, "utf8").trim();
        if (val) return val;
      } catch {
      }
    }
  }
  const newId = crypto.randomUUID();
  try {
    const savePath = paths[1];
    mkdirSync(dirname(savePath), { recursive: true });
    writeFileSync(savePath, newId, "utf8");
  } catch {
  }
  return newId;
}
function buildAuthHeaders(body, requestURL, creds) {
  if (!creds.userID) {
    throw new Error("cosy: user id is empty");
  }
  if (!creds.authToken) {
    throw new Error("cosy: auth token is empty");
  }
  const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const userInfo = {
    uid: creds.userID,
    security_oauth_token: creds.authToken,
    name: creds.name || "",
    aid: "",
    email: creds.email || ""
  };
  const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey);
  const cosyKey = rsaEncryptBase64(aesKey);
  const timestamp = Math.floor(Date.now() / 1e3).toString();
  const requestId = crypto.randomUUID();
  const cosyPayload = {
    version: "v1",
    requestId,
    info: infoB64,
    cosyVersion: QODER_GATEWAY_COSY_VERSION,
    ideVersion: ""
  };
  const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString("base64");
  const sigPath = computeSigPath(requestURL);
  const bodyBytes = body ? Buffer.isBuffer(body) ? body : Buffer.from(body) : Buffer.alloc(0);
  const sig = crypto.createHash("md5").update(payloadB64).update("\n").update(cosyKey).update("\n").update(timestamp).update("\n").update(bodyBytes).update("\n").update(sigPath).digest("hex");
  const bodyHash = crypto.createHash("md5").update(bodyBytes).digest("hex");
  const bodyLen = bodyBytes.length.toString();
  const machineID = creds.machineID || getMachineId();
  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userID,
    "Cosy-Date": timestamp,
    "Cosy-Version": QODER_GATEWAY_COSY_VERSION,
    "Cosy-Machineid": machineID,
    "Cosy-Machinetoken": machineID,
    "Cosy-Machinetype": QoderMachineTypeMagic,
    "Cosy-Machineos": QoderMachineOS,
    "Cosy-Clienttype": QODER_CLIENT_TYPE,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLen,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QoderDataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QoderLoginVersion,
    "X-Request-Id": crypto.randomUUID()
  };
}
var qoderRSAPublicKey, QODER_GATEWAY_COSY_VERSION, QODER_OPENAPI_COSY_VERSION, QODER_CLIENT_TYPE, QoderDataPolicy, QoderLoginVersion, QoderMachineOS, QoderMachineTypeMagic;
var init_cosy = __esm({
  "src/cosy.ts"() {
    "use strict";
    qoderRSAPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
    QODER_GATEWAY_COSY_VERSION = "1.1.38";
    QODER_OPENAPI_COSY_VERSION = "1.0.1";
    QODER_CLIENT_TYPE = "5";
    QoderDataPolicy = "disagree";
    QoderLoginVersion = "v2";
    QoderMachineOS = process.platform === "win32" ? process.arch === "arm64" ? "aarch64_windows" : "x86_64_windows" : process.arch === "arm64" ? "aarch64_linux" : "x86_64_linux";
    QoderMachineTypeMagic = "5";
  }
});

// src/vpc.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function getHomeDir2() {
  return process.env.HOME || process.env.USERPROFILE || homedir2();
}
function piAgentDir() {
  return join2(getHomeDir2(), ".pi", "agent");
}
function settingsFilePath() {
  return join2(piAgentDir(), "qoder-cn-settings.json");
}
function parseQoderVpcInstance(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return void 0;
  let host = value;
  if (host.startsWith("https://")) host = host.slice(8);
  else if (host.startsWith("http://")) host = host.slice(7);
  host = host.replace(/\/.*$/, "").toLowerCase();
  if (host.endsWith(`.${QODER_VPC_SUFFIX}`)) {
    host = host.slice(0, host.length - QODER_VPC_SUFFIX.length - 1);
  }
  if (host.endsWith("-gateway")) host = host.slice(0, -"-gateway".length);
  if (host.endsWith("-openapi")) host = host.slice(0, -"-openapi".length);
  return INSTANCE_NAME_RE.test(host) ? host : void 0;
}
function readVpcEndpointFromSettings() {
  try {
    const path = settingsFilePath();
    if (!existsSync2(path)) return void 0;
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
    const value = parsed?.vpc_endpoint ?? parsed?.vpcEndpoint ?? parsed?.vpcInstanceName;
    if (value !== void 0 && value !== "") return String(value);
  } catch {
  }
  return void 0;
}
function readQoderVpcEndpoint() {
  const fromEnv = process.env.QODER_VPC_ENDPOINT || process.env.QODERCN_VPC_ENDPOINT;
  if (fromEnv) return fromEnv;
  return readVpcEndpointFromSettings() ?? "";
}
function isResetValue(value) {
  const lowered = value.toLowerCase();
  return !value || lowered === "official" || lowered === "default" || lowered === "none" || lowered === "clear";
}
function resolveQoderCNEndpoints(rawInput) {
  const value = String(rawInput ?? "").trim();
  const official = { raw: "", ...QODER_CN_OFFICIAL, isDefault: true };
  if (isResetValue(value)) return official;
  let host = value;
  if (host.startsWith("https://")) host = host.slice(8);
  else if (host.startsWith("http://")) host = host.slice(7);
  host = host.replace(/\/.*$/, "").trim().toLowerCase();
  if (OFFICIAL_HOSTS.has(host)) return official;
  const isVpcHost = host.endsWith(`.${QODER_VPC_SUFFIX}`);
  if (isVpcHost || !host.includes(".")) {
    const instance = parseQoderVpcInstance(host);
    if (instance) {
      return {
        raw: `${instance}.${QODER_VPC_SUFFIX}`,
        instance,
        baseUrl: `https://${instance}-gateway.${QODER_VPC_SUFFIX}/`,
        openApiUrl: `https://${instance}-openapi.${QODER_VPC_SUFFIX}`,
        centerUrl: `https://${instance}-gateway.${QODER_VPC_SUFFIX}`,
        manageUrl: `https://${instance}.${QODER_VPC_SUFFIX}`,
        isDefault: false
      };
    }
  }
  const baseOrigin = `https://${host}`;
  return {
    raw: host,
    baseUrl: `${baseOrigin}/`,
    openApiUrl: baseOrigin,
    centerUrl: baseOrigin,
    manageUrl: baseOrigin,
    isDefault: false
  };
}
function getQoderCNEndpoints() {
  if (!cachedEndpoints) cachedEndpoints = resolveQoderCNEndpoints(readQoderVpcEndpoint());
  return cachedEndpoints;
}
function saveQoderVpcEndpoint(raw) {
  try {
    const dir = piAgentDir();
    if (!existsSync2(dir)) mkdirSync2(dir, { recursive: true });
    const path = settingsFilePath();
    let payload = {};
    if (existsSync2(path)) {
      try {
        const parsed = JSON.parse(readFileSync2(path, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed;
        }
      } catch {
        payload = {};
      }
    }
    payload.vpc_endpoint = raw || "";
    writeFileSync2(path, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.error("[pi-provider-qoder-cn] Failed to save qoder-cn-settings.json:", error);
  }
}
function setQoderCNEndpoint(raw) {
  cachedEndpoints = resolveQoderCNEndpoints(raw);
  saveQoderVpcEndpoint(cachedEndpoints.raw);
  return cachedEndpoints;
}
var QODER_VPC_SUFFIX, OFFICIAL_HOSTS, QODER_CN_OFFICIAL, INSTANCE_NAME_RE, cachedEndpoints;
var init_vpc = __esm({
  "src/vpc.ts"() {
    "use strict";
    QODER_VPC_SUFFIX = "vpc.qoder.com.cn";
    OFFICIAL_HOSTS = /* @__PURE__ */ new Set(["gateway.qoder.com.cn", "openapi.qoder.com.cn", "qoder.com.cn"]);
    QODER_CN_OFFICIAL = Object.freeze({
      baseUrl: "https://gateway.qoder.com.cn/",
      openApiUrl: "https://openapi.qoder.com.cn",
      centerUrl: "https://gateway.qoder.com.cn",
      manageUrl: "https://qoder.com.cn"
    });
    INSTANCE_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
    cachedEndpoints = null;
  }
});

// src/region.ts
function getQoderRegionConfig(mode) {
  return QODER_REGIONS[mode];
}
function getRegionValue(mode, field) {
  if (mode === "cn") return getQoderCNEndpoints()[field];
  return getQoderRegionConfig(mode)[field];
}
function getQoderBaseUrl(mode) {
  return getRegionValue(mode, "baseUrl");
}
function getQoderOpenApiUrl(mode) {
  return getRegionValue(mode, "openApiUrl");
}
function getQoderModelListURL(mode) {
  return `${getQoderBaseUrl(mode)}algo/api/v2/model/list?Encode=1`;
}
function getQoderChatURL(mode) {
  return `${getQoderBaseUrl(mode)}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
}
function getQoderExchangeURL(mode) {
  return `${getQoderOpenApiUrl(mode)}/api/v1/jobToken/exchange`;
}
function getQoderUserInfoURL(mode) {
  return `${getQoderOpenApiUrl(mode)}/api/v1/userinfo`;
}
function getQoderUsageURL(mode) {
  return `${getQoderOpenApiUrl(mode)}/api/v2/quota/usage`;
}
function getQoderRefreshURL(mode) {
  return `${getQoderOpenApiUrl(mode)}/api/v1/jobToken/refresh`;
}
function getQoderDeviceLoginURL(codeChallenge, machineID, nonce) {
  const baseUrl = getQoderRegionConfig("global").deviceLoginUrl;
  if (!baseUrl) throw new Error("Qoder browser login URL is not configured");
  return `${baseUrl}?challenge=${codeChallenge}&challenge_method=S256&machine_id=${machineID}&nonce=${nonce}`;
}
function getQoderDevicePollURL(nonce, codeVerifier) {
  const baseUrl = getQoderRegionConfig("global").openApiUrl;
  return `${baseUrl}/api/v1/deviceToken/poll?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;
}
var QODER_REGIONS, QODER_PROVIDER_MODES;
var init_region = __esm({
  "src/region.ts"() {
    "use strict";
    init_vpc();
    QODER_REGIONS = {
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
        supportsBrowserLogin: true
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
        supportsBrowserLogin: false
      }
    };
    QODER_PROVIDER_MODES = ["cn"];
  }
});

// src/catalog.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, join as join3 } from "node:path";
function getHomeDir3() {
  return process.env.HOME || process.env.USERPROFILE || homedir3();
}
function getQoderCachePath(mode) {
  return join3(getHomeDir3(), ".pi", "agent", getQoderRegionConfig(mode).modelCacheFile);
}
function readParsedModelCache(mode) {
  const cachePath = getQoderCachePath(mode);
  if (modelCacheMem.has(cachePath)) {
    return modelCacheMem.get(cachePath) ?? null;
  }
  if (!existsSync3(cachePath)) {
    modelCacheMem.set(cachePath, null);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync3(cachePath, "utf8"));
    modelCacheMem.set(cachePath, data);
    return data;
  } catch {
    modelCacheMem.set(cachePath, null);
    return null;
  }
}
function writeParsedModelCache(mode, data) {
  const cachePath = getQoderCachePath(mode);
  mkdirSync3(dirname2(cachePath), { recursive: true });
  writeFileSync3(cachePath, JSON.stringify(data, null, 2), "utf-8");
  modelCacheMem.set(cachePath, data);
}
function toQoderModelId(displayName) {
  return (displayName || "QoderModel").replace(/\s+/g, "");
}
function buildThinkingLevelMap(entry) {
  const tc = entry.thinking_config;
  if (!tc) return void 0;
  const efforts = tc.enabled?.efforts;
  if (efforts && typeof efforts === "object") {
    const supported = new Set(Object.keys(efforts));
    const map = { off: tc.disabled ? "disabled" : null };
    for (const level of PI_THINKING_LEVELS) {
      map[level] = supported.has(level) ? level : null;
    }
    return map;
  }
  if (tc.enabled) {
    const map = { off: tc.disabled ? "disabled" : null };
    for (const level of PI_THINKING_LEVELS) {
      map[level] = "enabled";
    }
    return map;
  }
  return void 0;
}
function getCachedModels(mode) {
  const data = readParsedModelCache(mode);
  if (data && Array.isArray(data.models)) {
    const models = data.models.map((model) => {
      const config = data.configs?.[model.id];
      const display = config?.display_name;
      if (mode === "cn") return applyCnModelIdentity(model, config, display);
      const staticModel = staticModels.find((seed) => seed.upstreamKey === model.id);
      if (display) return { ...model, id: toQoderModelId(display), name: display };
      if (staticModel) return { ...model, id: staticModel.id, name: staticModel.name };
      return model.name ? { ...model, id: toQoderModelId(model.name) } : model;
    });
    if (data.configs && typeof data.configs === "object" && !hasAutoCatalogEntry(data.configs, mode)) {
      return models.filter((model) => model.id.toLowerCase() !== "auto");
    }
    return models;
  }
  return mode === "cn" ? staticCnModels : staticModels;
}
function hasAutoCatalogEntry(configs, mode) {
  return Object.values(configs).some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const config = entry;
    if (config.key?.toLowerCase() === "auto") return true;
    return mode === "cn" ? toQoderCNModelInfo(config.key, config.display_name).id === "auto" : toQoderModelId(config.display_name) === "auto";
  });
}
function applyCnModelIdentity(model, config, display) {
  const key = config?.key ?? model.upstreamKey ?? model.id;
  const info = toQoderCNModelInfo(key, display ?? model.name);
  return { ...model, id: info.id, name: info.name, upstreamKey: key };
}
function getCachedModelConfig(modelId, mode) {
  const data = readParsedModelCache(mode);
  if (data) {
    const direct = data.configs?.[modelId];
    const matchesDirect = direct && (mode === "cn" ? isQoderCNModelId(direct, modelId) : toQoderModelId(direct.display_name) === modelId);
    if (matchesDirect) {
      return withMaxContextAsDefault(direct);
    }
    const legacyEntry = Object.values(data.configs || {}).find(
      (entry) => entry && typeof entry === "object" && // CN accepts the slug, the raw upstream key, and the upstream id scheme.
      (mode === "cn" ? isQoderCNModelId(entry, modelId) : toQoderModelId(entry.display_name) === modelId)
    );
    if (legacyEntry) {
      return withMaxContextAsDefault(legacyEntry);
    }
  }
  const staticModel = (mode === "cn" ? staticCnModels : staticModels).find((model) => model.id === modelId);
  if (staticModel) {
    return {
      key: staticModel.upstreamKey || modelId,
      is_reasoning: staticModel.reasoning,
      source: "system"
    };
  }
  if (mode === "cn") {
    const key = toQoderCNUpstreamKey(modelId);
    if (key) {
      const seed = staticCnModels.find((model) => model.upstreamKey === key);
      return {
        key,
        is_reasoning: seed?.reasoning ?? true,
        source: "system"
      };
    }
  }
  return null;
}
function contextWindowFromCatalog(entry) {
  const contextConfig = entry.context_config;
  if (contextConfig && typeof contextConfig === "object") {
    let advertised = 0;
    for (const configVal of Object.values(contextConfig)) {
      if (configVal && typeof configVal === "object" && typeof configVal.token_count === "number") {
        if (configVal.token_count > advertised) advertised = configVal.token_count;
      }
    }
    if (advertised > 0) return advertised;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
function withMaxContextAsDefault(entry) {
  const contextConfig = entry.context_config;
  if (!contextConfig || typeof contextConfig !== "object") return entry;
  const maxTokenCount = Math.max(
    ...Object.values(contextConfig).map((config) => typeof config?.token_count === "number" ? config.token_count : 0)
  );
  if (maxTokenCount <= 0) return entry;
  return {
    ...entry,
    context_config: Object.fromEntries(
      Object.entries(contextConfig).map(([name, config]) => [
        name,
        { ...config, is_default: config.token_count === maxTokenCount }
      ])
    )
  };
}
function isCacheStale(mode) {
  const data = readParsedModelCache(mode);
  if (!data || typeof data.updatedAt !== "number") return true;
  return Date.now() - data.updatedAt > 36e5;
}
async function updateQoderModelsCache(authToken, userID, name, email, mode) {
  const modelListURL = getQoderModelListURL(mode);
  try {
    const headers = buildAuthHeaders(null, modelListURL, {
      userID,
      authToken,
      name,
      email
    });
    const response = await fetch(modelListURL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers
      }
    });
    if (!response.ok) {
      return;
    }
    const resData = await response.json();
    const chatModels = resData.chat || [];
    if (chatModels.length === 0) return;
    const newModels = [];
    const configs = {};
    for (const entry of chatModels) {
      const key = entry.key;
      if (!key || !entry.enable || !entry.display_name) continue;
      const display = entry.display_name;
      const ctxLen = contextWindowFromCatalog(entry);
      const isVL = !!entry.is_vl;
      const isReasoning = !!entry.is_reasoning || !!entry.thinking_config;
      const supportsEffort = !!entry.thinking_config?.enabled?.efforts;
      const thinkingLevelMap = buildThinkingLevelMap(entry);
      const modelInfo = mode === "cn" ? toQoderCNModelInfo(key, display) : { id: toQoderModelId(display), name: display };
      configs[modelInfo.id] = entry;
      if (mode === "cn" && modelInfo.id !== key) configs[key] = entry;
      if (newModels.some((model) => model.id === modelInfo.id)) continue;
      newModels.push({
        id: modelInfo.id,
        name: modelInfo.name,
        api: "qoder-api",
        provider: getQoderRegionConfig(mode).providerID,
        baseUrl: getQoderBaseUrl(mode),
        reasoning: isReasoning,
        supportsEffort,
        thinkingLevelMap,
        input: isVL ? ["text", "image"] : ["text"],
        cost: ZERO_COST,
        contextWindow: ctxLen,
        maxTokens: MAX_OUTPUT_TOKENS
      });
    }
    if (newModels.length === 0) return;
    const cacheData = {
      updatedAt: Date.now(),
      models: newModels,
      configs
    };
    writeParsedModelCache(mode, cacheData);
  } catch {
  }
}
var ZERO_COST, MAX_OUTPUT_TOKENS, DEFAULT_CONTEXT_WINDOW, modelCacheMem, staticModels, staticCnModels, PI_THINKING_LEVELS;
var init_catalog = __esm({
  "src/catalog.ts"() {
    "use strict";
    init_cn_naming();
    init_cosy();
    init_region();
    ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    MAX_OUTPUT_TOKENS = 131072;
    DEFAULT_CONTEXT_WINDOW = 1e6;
    modelCacheMem = /* @__PURE__ */ new Map();
    staticModels = [
      {
        id: "Auto",
        upstreamKey: "auto",
        name: "Auto",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Ultimate",
        upstreamKey: "ultimate",
        name: "Ultimate",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Performance",
        upstreamKey: "performance",
        name: "Performance",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Efficient",
        upstreamKey: "efficient",
        name: "Efficient",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Lite",
        upstreamKey: "lite",
        name: "Lite",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Qwen3.7Plus",
        upstreamKey: "qmodel",
        name: "Qwen3.7 Plus",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Cantus",
        upstreamKey: "cmodel",
        name: "Cantus",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Qwen3.8-Max",
        upstreamKey: "qmodel_preview",
        name: "Qwen3.8-Max",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Qwen3.7-Max",
        upstreamKey: "qmodel_latest",
        name: "Qwen3.7-Max",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "DeepSeek-V4-Pro",
        upstreamKey: "dmodel",
        name: "DeepSeek-V4-Pro",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "DeepSeek-V4-Flash",
        upstreamKey: "dfmodel",
        name: "DeepSeek-V4-Flash",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "GLM-5.2",
        upstreamKey: "gm51model",
        name: "GLM-5.2",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Kimi-K2.7-Code",
        upstreamKey: "kmodel",
        name: "Kimi-K2.7-Code",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        // Catalog advertises 256K; not included in the 1M live test in issue #13.
        contextWindow: 256e3,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "Kimi-K3",
        upstreamKey: "kmodel_latest",
        name: "Kimi-K3",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      },
      {
        id: "MiniMax-M3",
        upstreamKey: "mmodel",
        name: "MiniMax-M3",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: getQoderBaseUrl("global"),
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS
      }
    ];
    staticCnModels = [
      {
        id: "auto",
        upstreamKey: "auto",
        name: "Auto \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        // CN Auto has not been live-tested at 1M; the live catalog reports 200K.
        contextWindow: 2e5,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Qoder CN smart routing; live catalog reports 200K max input."
      },
      {
        id: "qwen3.8-max",
        upstreamKey: "qmodel_38max",
        name: "Qwen 3.8-Max \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Qwen 3.8-Max (qmodel_38max); 1M context."
      },
      {
        id: "qwen3.8-flash",
        upstreamKey: "qfmodel",
        name: "Qwen 3.8-Flash \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Qwen 3.8-Flash (qfmodel); multimodal MoE, 1M context."
      },
      {
        id: "qwen3.7-max",
        upstreamKey: "qmodel_latest",
        name: "Qwen 3.7-Max \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Qwen 3.7-Max (qmodel_latest); context options 200K/400K/1M."
      },
      {
        id: "qwen3.7-plus",
        upstreamKey: "qmodel",
        name: "Qwen 3.7-Plus \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Qwen 3.7-Plus (qmodel); context options 200K/400K/1M."
      },
      {
        id: "qwen3.7-flash",
        upstreamKey: "q37fmodel",
        name: "Qwen 3.7-Flash \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Qwen 3.7-Flash (q37fmodel); vision-language Flash, 1M context."
      },
      {
        id: "deepseek-v4-pro",
        upstreamKey: "dmodel",
        name: "DeepSeek V4 Pro \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "DeepSeek V4 Pro (dmodel); 1M context."
      },
      {
        id: "deepseek-v4-flash",
        upstreamKey: "dfmodel",
        name: "DeepSeek V4 Flash \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "DeepSeek V4 Flash (dfmodel); 1M context."
      },
      {
        id: "glm-5.3",
        upstreamKey: "gmodel",
        name: "GLM-5.3 \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "GLM-5.3 (gmodel); Zhipu flagship open-source, 1M context."
      },
      {
        id: "glm-5.3-flash",
        upstreamKey: "gfmodel",
        name: "GLM-5.3-Flash \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "GLM-5.3-Flash (gfmodel); 1M context."
      },
      {
        id: "glm-5.2",
        upstreamKey: "gm51model",
        name: "GLM 5.2 \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "GLM 5.2 (gm51model); 1M context."
      },
      {
        id: "kimi-k3",
        upstreamKey: "kmodel_latest",
        name: "Kimi-K3 \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Kimi-K3 (kmodel_latest); 1M context."
      },
      {
        id: "kimi-k2.7-code",
        upstreamKey: "kmodel",
        name: "Kimi-K2.7-Code \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        // Live catalog advertises 256K for this entry.
        contextWindow: 256e3,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "Kimi-K2.7-Code (kmodel); 256K context."
      },
      {
        id: "minimax-m2.7",
        upstreamKey: "mmodel",
        name: "MiniMax M2.7 \xB7 Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: false,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        // Live CN catalog reports 200K; not confirmed at 1M.
        contextWindow: 2e5,
        maxTokens: MAX_OUTPUT_TOKENS,
        description: "MiniMax M2.7 (mmodel); 200K context."
      }
    ];
    PI_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
  }
});

// src/auth/pat.ts
function isPatRefresh(refresh) {
  return refresh.startsWith(`${PAT_REFRESH_PREFIX}|`);
}
function encodePatRefresh(pat, jobRefreshToken, userID, machineID) {
  return [PAT_REFRESH_PREFIX, pat, jobRefreshToken, userID, machineID].join("|");
}
function decodePatRefresh(refresh) {
  const parts = refresh.split("|");
  return {
    pat: parts[1] || "",
    jobRefreshToken: parts[2] || "",
    userID: parts[3] || "",
    machineID: parts[4] || ""
  };
}
async function exchangeJobToken(pat, mode) {
  const res = await fetch(getQoderExchangeURL(mode), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      "Cosy-Version": QODER_OPENAPI_COSY_VERSION,
      "Cosy-ClientType": QODER_CLIENT_TYPE
    },
    body: JSON.stringify({ personal_token: pat })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Qoder PAT exchange failed: ${res.status} ${res.statusText}. ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error("Qoder PAT exchange returned no job token");
  }
  let expiresAt = Date.now() + 24 * 60 * 60 * 1e3;
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  } else if (data.expires_in) {
    expiresAt = Date.now() + (data.expires_in > 86400 ? data.expires_in : data.expires_in * 1e3);
  }
  return {
    jobToken: data.token,
    jobRefreshToken: data.refresh_token || "",
    expiresAt
  };
}
async function fetchUserInfo(jobToken, mode) {
  let userID = "";
  let email = "";
  let name = "";
  try {
    const res = await fetch(getQoderUserInfoURL(mode), {
      headers: {
        Authorization: `Bearer ${jobToken}`,
        Accept: "application/json",
        "User-Agent": UA,
        "Cosy-Version": QODER_OPENAPI_COSY_VERSION,
        "Cosy-ClientType": QODER_CLIENT_TYPE
      }
    });
    if (res.ok) {
      const info = await res.json();
      userID = info.id || "";
      email = info.email || "";
      name = info.name || info.username || "";
    }
  } catch {
  }
  return { userID, email, name };
}
async function credentialsFromPat(pat, mode) {
  const region = getQoderRegionConfig(mode);
  const { jobToken, jobRefreshToken, expiresAt } = await exchangeJobToken(pat, mode);
  const { userID, email, name } = await fetchUserInfo(jobToken, mode);
  const machineID = getMachineId();
  return {
    refresh: encodePatRefresh(pat, jobRefreshToken, userID, machineID),
    access: jobToken,
    expires: expiresAt - 5 * 60 * 1e3,
    // 5 min buffer
    userID,
    email: email || region.userEmailFallback,
    name: name || region.userNameFallback,
    machineID
  };
}
var UA, PAT_REFRESH_PREFIX;
var init_pat = __esm({
  "src/auth/pat.ts"() {
    "use strict";
    init_cosy();
    init_region();
    UA = "pi-provider-qoder-cn";
    PAT_REFRESH_PREFIX = "pat";
  }
});

// src/auth/login.ts
import crypto2 from "node:crypto";
function getPrompt(callbacks) {
  return callbacks.onPrompt;
}
function getSelect(callbacks) {
  const fn = callbacks.onSelect;
  return typeof fn === "function" ? fn : void 0;
}
function isLoginCancellation(error, callbacks) {
  if (getSignal(callbacks)?.aborted) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("cancel");
}
function getProgress(callbacks) {
  return callbacks.onProgress;
}
function getSignal(callbacks) {
  return callbacks.signal;
}
function generatePKCE() {
  const codeVerifier = crypto2.randomBytes(32).toString("base64url");
  const codeChallenge = crypto2.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
function parseExpiresAt(s, expiresInSeconds) {
  if (s) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    const ms = Number.parseInt(s, 10);
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  if (expiresInSeconds && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1e3;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1e3;
}
async function confirmCnEndpoint(callbacks, mode) {
  if (mode !== "cn") return;
  const current = getQoderCNEndpoints();
  const envNames = ["QODER_VPC_ENDPOINT", "QODERCN_VPC_ENDPOINT"].filter((name) => process.env[name]);
  const personalId = "personal";
  const enterpriseId = "enterprise";
  const options = [
    { id: personalId, label: "Personal account \u2014 public gateway (qoder.com.cn)" },
    { id: enterpriseId, label: "Enterprise account \u2014 use a VPC endpoint" }
  ];
  let message = current.isDefault ? "Choose the Qoder CN endpoint to log in against (default: personal account)" : `Choose the Qoder CN endpoint to log in against (current: ${current.raw})`;
  if (envNames.length > 0) {
    message += `
(current value comes from ${envNames.join(" / ")}; it still wins after a restart)`;
  }
  const choice = await askEndpointChoice(callbacks, message, options);
  if (choice === personalId) {
    setQoderCNEndpoint("");
    if (envNames.length > 0) {
      getProgress(callbacks)?.(
        `Personal gateway selected. However, ${envNames.join(" / ")} takes precedence and restores the enterprise endpoint after a restart; remove the variable, then log in again.`
      );
    }
    return;
  }
  if (choice === enterpriseId) {
    const prompt = getPrompt(callbacks);
    const raw = await prompt({
      message: "Enterprise VPC endpoint (instance name or domain)",
      placeholder: "acme",
      allowEmpty: true
    });
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    const value = raw?.trim();
    if (!value) return;
    setQoderCNEndpoint(value);
    return;
  }
}
async function askEndpointChoice(callbacks, message, options) {
  const select = getSelect(callbacks);
  if (select) {
    try {
      const picked = await select({ message, options });
      if (picked) return picked;
      return void 0;
    } catch (error) {
      if (isLoginCancellation(error, callbacks)) throw error;
    }
  }
  const prompt = getPrompt(callbacks);
  const lines = options.map((option, index) => `${index + 1}. ${option.label}`);
  const raw = await prompt({
    message: `${message}
${lines.join("\n")}
Enter a number (Enter = 1, personal account)`,
    placeholder: "1",
    allowEmpty: true
  });
  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  const trimmed = raw?.trim();
  if (!trimmed) return options[0]?.id;
  const byIndex = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= options.length) {
    return options[byIndex - 1]?.id;
  }
  const byId = options.find((option) => option.id === trimmed || option.label === trimmed);
  return byId?.id ?? options[0]?.id;
}
async function interactiveLogin(callbacks, mode) {
  const region = getQoderRegionConfig(mode);
  await confirmCnEndpoint(callbacks, mode);
  const prompt = getPrompt(callbacks);
  const pat = await prompt({
    message: !region.supportsBrowserLogin ? "Paste a Qoder CN Personal Access Token, or leave empty to cancel" : "Paste a Qoder Personal Access Token (pt-...), or leave empty for browser login",
    placeholder: "pt-...",
    allowEmpty: true
  });
  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  if (pat?.trim()) {
    return patLogin(callbacks, pat.trim(), mode);
  }
  if (!region.supportsBrowserLogin) {
    throw new Error(
      `Qoder CN browser login is not supported here. Paste a Qoder CN PAT from ${region.patManageUrl} or set QODERCN_PERSONAL_ACCESS_TOKEN.`
    );
  }
  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  return runDeviceFlow(callbacks);
}
async function patLogin(callbacks, providedPat, mode) {
  const region = getQoderRegionConfig(mode);
  let pat = providedPat;
  if (!pat) {
    const prompt = getPrompt(callbacks);
    const entered = await prompt({
      message: !region.supportsBrowserLogin ? "Paste your Qoder CN Personal Access Token" : "Paste your Qoder Personal Access Token (pt-...)",
      placeholder: "pt-...",
      allowEmpty: false
    });
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    pat = entered?.trim();
  }
  if (!pat) {
    throw new Error("No Personal Access Token provided");
  }
  getProgress(callbacks)?.("Exchanging access token...");
  let creds;
  try {
    creds = await credentialsFromPat(pat, mode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${detail}. Check that the PAT is copied in full (64 characters for pt-... tokens) and was issued for the selected endpoint.`
    );
  }
  getProgress(callbacks)?.("Login successful!");
  return creds;
}
function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("Login cancelled"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function runDeviceFlow(callbacks) {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const nonce = crypto2.randomUUID();
  const machineID = getMachineId();
  const verificationURI = getQoderDeviceLoginURL(codeChallenge, machineID, nonce);
  getProgress(callbacks)?.("Please complete login in your browser...");
  callbacks.onAuth({
    url: verificationURI,
    instructions: "Click to sign in with your Qoder account in the browser."
  });
  const pollURL = getQoderDevicePollURL(nonce, codeVerifier);
  const pollInterval = 2e3;
  const maxAttempts = 90;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    await abortableDelay(pollInterval, getSignal(callbacks));
    try {
      const response = await fetch(pollURL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "pi-provider-qoder-cn"
        },
        signal: getSignal(callbacks)
      });
      if (response.status === 202 || response.status === 404) {
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Device token poll failed: ${response.status} ${response.statusText}. Response: ${errText}`);
      }
      const tokenData = await response.json();
      if (!tokenData.token) {
        throw new Error("Device token poll returned empty access token");
      }
      const expireMs = parseExpiresAt(tokenData.expires_at, tokenData.expires_in);
      getProgress(callbacks)?.("Fetching user profile...");
      let email = "";
      let name = "";
      try {
        const userinfoRes = await fetch(getQoderUserInfoURL("global"), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenData.token}`,
            Accept: "application/json",
            "User-Agent": "pi-provider-qoder-cn"
          }
        });
        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          email = userinfo.email || "";
          name = userinfo.name || userinfo.username || "";
        }
      } catch {
      }
      getProgress(callbacks)?.("Login successful!");
      return {
        refresh: `${tokenData.refresh_token}|${tokenData.user_id}|${machineID}`,
        access: tokenData.token,
        expires: expireMs - 5 * 60 * 1e3,
        // 5 min buffer
        userID: tokenData.user_id,
        email,
        name,
        machineID
      };
    } catch (e) {
      const err = e;
      if (err.name === "AbortError" || getSignal(callbacks)?.aborted) {
        throw new Error("Login cancelled");
      }
      throw e;
    }
  }
  throw new Error("Authorization timed out");
}
var init_login = __esm({
  "src/auth/login.ts"() {
    "use strict";
    init_cosy();
    init_region();
    init_vpc();
    init_pat();
  }
});

// src/auth/oauth.ts
var oauth_exports = {};
__export(oauth_exports, {
  autoLoginQoderFromEnvironment: () => autoLoginQoderFromEnvironment,
  clearQoderAuthMemCache: () => clearQoderAuthMemCache,
  getCachedCredentials: () => getCachedCredentials,
  getQoderPatForMode: () => getQoderPatForMode,
  loginQoderForMode: () => loginQoderForMode,
  refreshQoderTokenForMode: () => refreshQoderTokenForMode,
  resolveQoderIdentity: () => resolveQoderIdentity
});
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname3, join as join4 } from "node:path";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
function getHomeDir4() {
  return process.env.HOME || process.env.USERPROFILE || homedir4();
}
function getAuthFilePath() {
  return join4(getHomeDir4(), ".pi", "agent", "auth.json");
}
function clearQoderAuthMemCache() {
  authFileMem = void 0;
  identityCache.clear();
}
function readAuthFileCached() {
  const authPath = getAuthFilePath();
  if (authFileMem !== void 0) {
    if (authFileMem === null) return null;
    if (authFileMem.path === authPath) return authFileMem.data;
  }
  if (!existsSync4(authPath)) {
    authFileMem = null;
    return null;
  }
  try {
    const data = JSON.parse(readFileSync4(authPath, "utf-8"));
    authFileMem = { path: authPath, data };
    return data;
  } catch {
    authFileMem = null;
    return null;
  }
}
function getQoderPatForMode(mode) {
  for (const envName of getQoderRegionConfig(mode).patEnvNames) {
    const value = process.env[envName];
    if (value) return value;
  }
  return "";
}
function saveCredentialsToAuthFile(providerID, credentials) {
  try {
    const authPath = getAuthFilePath();
    const dir = dirname3(authPath);
    if (!existsSync4(dir)) {
      mkdirSync4(dir, { recursive: true, mode: 448 });
    }
    let auth;
    try {
      auth = JSON.parse(readFileSync4(authPath, "utf-8")) ?? {};
    } catch {
      const cached = readAuthFileCached();
      auth = cached ? { ...cached } : {};
    }
    auth[providerID] = { type: "oauth", ...credentials };
    writeFileSync4(authPath, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 384 });
    authFileMem = { path: authPath, data: auth };
    const q = credentials;
    if (q.access && q.userID) {
      identityCache.set(`${providerID}:${q.access}`, q);
    }
  } catch (err) {
    console.error(`[pi-provider-qoder] Failed to write auth storage for ${providerID}:`, err);
  }
}
async function autoLoginQoderFromEnvironment(providerID, mode) {
  const pat = getQoderPatForMode(mode);
  if (!pat) return;
  const credentials = await credentialsFromPat(pat, mode);
  if (typeof AuthStorage2?.create === "function") {
    try {
      const authStorage = AuthStorage2.create();
      authStorage.set(providerID, { type: "oauth", ...credentials });
    } catch {
      saveCredentialsToAuthFile(providerID, credentials);
    }
  } else {
    saveCredentialsToAuthFile(providerID, credentials);
  }
  const qCreds = credentials;
  await updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode);
}
function getCachedCredentials(_accessToken, providerID = "qoder") {
  const auth = readAuthFileCached();
  if (!auth) return null;
  const creds = auth[providerID] || (providerID === "qoder" ? auth.qoder : null);
  if (creds?.userID || creds?.access) {
    if (creds.access && creds.userID) {
      identityCache.set(`${providerID}:${creds.access}`, creds);
    }
    return creds;
  }
  return null;
}
async function resolveQoderIdentity(accessToken, providerID, mode) {
  const region = getQoderRegionConfig(mode);
  const cacheKey = `${providerID}:${accessToken}`;
  const mem = identityCache.get(cacheKey);
  if (mem?.userID) return mem;
  const cached = getCachedCredentials(accessToken, providerID);
  if (cached?.userID && cached.access === accessToken) {
    identityCache.set(cacheKey, cached);
    return cached;
  }
  const info = await fetchUserInfo(accessToken, mode);
  const machineID = getMachineId();
  const stored = readAuthFileCached()?.[providerID];
  const creds = {
    access: accessToken,
    userID: info.userID || "qoder-user",
    email: info.email || region.userEmailFallback,
    name: info.name || region.userNameFallback,
    machineID,
    refresh: stored?.refresh || "",
    expires: stored?.expires || 0
  };
  identityCache.set(cacheKey, creds);
  saveCredentialsToAuthFile(providerID, creds);
  return creds;
}
async function loginQoderForMode(callbacks, mode) {
  const providerID = getQoderRegionConfig(mode).providerID;
  const pat = getQoderPatForMode(mode);
  if (pat) {
    try {
      const creds2 = await credentialsFromPat(pat, mode);
      const qCreds = creds2;
      updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {
      });
      saveCredentialsToAuthFile(providerID, creds2);
      return creds2;
    } catch {
    }
  }
  const creds = await interactiveLogin(callbacks, mode);
  try {
    const qCreds = creds;
    updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {
    });
  } catch {
  }
  saveCredentialsToAuthFile(providerID, creds);
  return creds;
}
async function refreshQoderTokenForMode(credentials, mode) {
  if (isPatRefresh(credentials.refresh)) {
    const { pat } = decodePatRefresh(credentials.refresh);
    if (pat) {
      try {
        const refreshed = await credentialsFromPat(pat, mode);
        const qCreds = refreshed;
        updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {
        });
        return refreshed;
      } catch {
      }
    }
    return {
      ...credentials,
      expires: Date.now() + 60 * 60 * 1e3
      // extend 1 hour to retry later
    };
  }
  const parts = credentials.refresh.split("|");
  const refreshToken = parts[0] || "";
  const userID = parts[1] || "";
  const machineID = parts[2] || getMachineId();
  const prev = credentials;
  const prevName = prev.name || "";
  const prevEmail = prev.email || "";
  const refreshURL = getQoderRefreshURL(mode);
  try {
    const response = await fetch(refreshURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.access}`,
        Accept: "application/json",
        "User-Agent": "pi-provider-qoder-cn"
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (response.ok) {
      const data = await response.json();
      const newAccess = data.token;
      const newRefresh = data.refresh_token || refreshToken;
      let expireMs = Date.now() + 30 * 24 * 60 * 60 * 1e3;
      if (data.expires_at) {
        const parsed = Date.parse(data.expires_at);
        if (!Number.isNaN(parsed)) expireMs = parsed;
      } else if (data.expires_in) {
        expireMs = Date.now() + (data.expires_in > 86400 ? data.expires_in : data.expires_in * 1e3);
      }
      const refreshed = {
        ...credentials,
        refresh: `${newRefresh}|${userID}|${machineID}`,
        access: newAccess,
        expires: expireMs - 5 * 60 * 1e3,
        userID,
        email: prevEmail,
        name: prevName,
        machineID
      };
      updateQoderModelsCache(newAccess, userID, prevName, prevEmail, mode).catch(() => {
      });
      return refreshed;
    }
  } catch {
  }
  const refreshedFallback = {
    ...credentials,
    expires: Date.now() + 60 * 60 * 1e3
    // extend for 1 hour
  };
  return refreshedFallback;
}
var AuthStorage2, identityCache, authFileMem;
var init_oauth = __esm({
  "src/auth/oauth.ts"() {
    "use strict";
    init_catalog();
    init_cosy();
    init_region();
    init_login();
    init_pat();
    AuthStorage2 = PiCodingAgent.AuthStorage;
    identityCache = /* @__PURE__ */ new Map();
  }
});

// src/index.ts
init_oauth();

// src/auth/usage.ts
init_region();
async function fetchQoderUsageForMode(credentials, mode) {
  const region = getQoderRegionConfig(mode);
  const response = await fetch(getQoderUsageURL(mode), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.access}`,
      Accept: "application/json",
      "User-Agent": "pi-provider-qoder-cn"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Qoder usage: ${response.status} ${response.statusText}`);
  }
  const raw = await response.json();
  const usageBuckets = [];
  const userQuota = raw.user_quota ?? raw.userQuota;
  const org = raw.org_resource_package ?? raw.orgResourcePackage ?? raw.shared_quota ?? raw.sharedQuota;
  if (userQuota) {
    usageBuckets.push({
      id: "user-quota",
      label: "User Quota",
      usedDisplay: userQuota.used.toFixed(2),
      limitDisplay: (userQuota.total ?? userQuota.cap ?? 0).toFixed(2),
      unit: userQuota.unit,
      resetAt: raw.expiresAt ? new Date(raw.expiresAt).toISOString() : void 0
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
      resetAt: raw.expiresAt ? new Date(raw.expiresAt).toISOString() : void 0
    });
  }
  const remainingText = userQuota ? `${userQuota.remaining.toFixed(2)} ${userQuota.unit} remaining` : org ? `${org.remaining.toFixed(2)} ${org.unit} remaining` : "";
  return {
    summary: remainingText,
    subscriptionTitle: region.usageTitle,
    resetAt: raw.expiresAt ? new Date(raw.expiresAt).toISOString() : void 0,
    manageUrl: region.manageUrl,
    usageBuckets,
    raw
  };
}

// src/index.ts
init_catalog();

// src/protocol/errors.ts
function parseQoderErrorPayload(payload) {
  if (!payload) return null;
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed;
  if (typeof obj.message === "string" && obj.message.trim().startsWith("{")) {
    try {
      const nested = JSON.parse(obj.message);
      if (typeof nested === "object" && nested !== null) {
        const nestedObj = nested;
        return {
          code: String(nestedObj.code || nestedObj.errorCode || obj.code || ""),
          message: String(nestedObj.message || nestedObj.errorMessage || obj.message || "")
        };
      }
    } catch {
    }
  }
  const code = obj.code ?? obj.errorCode;
  const message = obj.message ?? obj.errorMessage;
  if (!code && !message) return null;
  return {
    code: code !== void 0 ? String(code) : void 0,
    message: message !== void 0 ? String(message) : void 0
  };
}
function msUntilBeijingMidnight(now = Date.now()) {
  const beijingOffset = 8 * 36e5;
  const beijingTime = now + beijingOffset;
  const beijingDate = new Date(beijingTime);
  const nextMidnightUtc = Date.UTC(
    beijingDate.getUTCFullYear(),
    beijingDate.getUTCMonth(),
    beijingDate.getUTCDate() + 1,
    0,
    0,
    0
  );
  return nextMidnightUtc - beijingTime;
}
function getBeijingDailyResetCountdown(now = Date.now()) {
  const diffMs = msUntilBeijingMidnight(now);
  const totalMinutes = Math.max(1, Math.round(diffMs / 6e4));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}\u5C0F\u65F6${minutes}\u5206\u949F` : `${minutes}\u5206\u949F`;
}
function formatQoderStreamError(statusCode, rawBody, now = Date.now()) {
  const parsed = parseQoderErrorPayload(rawBody);
  const code = parsed?.code;
  const message = parsed?.message || (typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody));
  const countdown = getBeijingDailyResetCountdown(now);
  if (code === "110" || /billing daily count exceeded/i.test(message) || /daily usage limit reached/i.test(message)) {
    return [
      `[Qoder CN \u989D\u5EA6\u9650\u5236] \u4ECA\u65E5\u8C03\u7528\u6B21\u6570\u5DF2\u8FBE\u4E0A\u9650 (Billing daily count exceeded, \u9519\u8BEF\u7801 110)`,
      `- \u5237\u65B0\u65F6\u95F4\uFF1A\u5C06\u5728\u5317\u4EAC\u65F6\u95F4 00:00 \u91CD\u7F6E\uFF08\u7EA6 ${countdown}\u540E\uFF09`,
      `- \u9650\u5236\u539F\u56E0\uFF1A\u5F53\u524D\u5904\u4E8E\u4E2A\u4EBA\u6807\u51C6\u7248\uFF08\u514D\u8D39\u7248\uFF09\u6216\u89E6\u53D1\u4E86\u5355\u65E5\u9891\u6B21\u7194\u65AD\u3002\u82E5\u8D26\u53F7\u5185\u6709\u8D44\u6E90\u5305/\u52A0\u6CB9\u5305\uFF08Add-on Credits\uFF09\uFF0C\u56E0\u514D\u8D39\u7248\u5355\u65E5\u9650\u5236\u672A\u89E3\u9664\u6682\u65E0\u6CD5\u6263\u51CF\u3002`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u7B49\u5F85\u6B21\u65E5\u91CD\u7F6E\uFF1B\u6216\u4F7F\u7528 /model \u5207\u6362\u81F3\u5176\u4ED6 Provider\uFF1B\u4E2A\u4EBA\u7248\u53EF\u5F00\u901A Pro \u8BA2\u9605\u89E3\u9664\u6BCF\u65E5\u9650\u5236\uFF0C\u4F01\u4E1A\u7248\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u8C03\u9AD8\u5355\u65E5\u9650\u989D\u3002`
    ].join("\n");
  }
  if (code === "117" || /team member credits exhausted/i.test(message)) {
    return [
      `[Qoder CN \u4F01\u4E1A\u989D\u5EA6\u9650\u5236] \u4F01\u4E1A\u5206\u914D\u7ED9\u60A8\u7684\u4E2A\u4EBA Credits \u989D\u5EA6\u5DF2\u7528\u5C3D (\u9519\u8BEF\u7801 117)`,
      `- \u9650\u5236\u539F\u56E0\uFF1A\u7BA1\u7406\u5458\u5728\u4F01\u4E1A\u63A7\u5236\u53F0\u5206\u914D\u7ED9\u60A8\u4E2A\u4EBA\u7684\u53EF\u7528 Credits \u989D\u5EA6\u5DF2\u8017\u5C3D\u3002`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u8BF7\u8054\u7CFB\u4F01\u4E1A\u7BA1\u7406\u5458\u5728 Qoder \u56E2\u961F\u7BA1\u7406\u540E\u53F0\u4E3A\u60A8\u589E\u52A0\u6210\u5458 Credits \u914D\u989D\u3002`
    ].join("\n");
  }
  if (code === "116" || /team administrator credits exhausted/i.test(message)) {
    return [
      `[Qoder CN \u4F01\u4E1A\u989D\u5EA6\u9650\u5236] \u4F01\u4E1A/\u56E2\u961F\u7BA1\u7406\u5458\u7684 Credits \u603B\u4F59\u989D\u5DF2\u8017\u5C3D (\u9519\u8BEF\u7801 116)`,
      `- \u9650\u5236\u539F\u56E0\uFF1A\u5F53\u524D\u4F01\u4E1A\u7EC4\u7EC7\u8D26\u6237\u7684 Credits \u989D\u5EA6\u5DF2\u5168\u90E8\u7528\u5B8C\u3002`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u8BF7\u8054\u7CFB\u4F01\u4E1A\u7BA1\u7406\u5458\u5728\u63A7\u5236\u53F0\u4E3A\u7EC4\u7EC7\u8D26\u6237\u5145\u503C\u6216\u7EED\u671F\u3002`
    ].join("\n");
  }
  if (code === "122" || /billing-group credits limit reached/i.test(message)) {
    return [
      `[Qoder CN \u4F01\u4E1A\u8BA1\u8D39\u7EC4\u9650\u5236] \u60A8\u6240\u5728\u7684\u4F01\u4E1A\u8BA1\u8D39\u7EC4\u5DF2\u8FBE\u5230\u672C\u671F\u652F\u51FA\u4E0A\u9650 (\u9519\u8BEF\u7801 122)`,
      `- \u9650\u5236\u539F\u56E0\uFF1A\u8BA1\u8D39\u7EC4\u5468\u671F\u5185\u5DF2\u6D88\u8017\u5B8C\u7BA1\u7406\u5458\u8BBE\u5B9A\u7684\u4E0A\u9650\u989D\u5EA6\u3002`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u8BF7\u8054\u7CFB\u8BA1\u8D39\u7BA1\u7406\u5458\u6216\u4F01\u4E1A\u7BA1\u7406\u5458\u8C03\u6574\u8BE5\u8BA1\u8D39\u7EC4\u7684\u5468\u671F\u652F\u51FA\u4E0A\u9650\u3002`
    ].join("\n");
  }
  if (code === "119" || /free usage limit for the selected model reached/i.test(message)) {
    return [
      `[Qoder CN \u6A21\u578B\u9650\u514D\u989D\u5EA6\u5DF2\u6EE1] \u5F53\u524D\u6A21\u578B\u7684\u514D\u8D39\u4F53\u9A8C\u989D\u5EA6\u5DF2\u7528\u5B8C (\u9519\u8BEF\u7801 119)`,
      `- \u5237\u65B0\u65F6\u95F4\uFF1A\u5C06\u5728\u5317\u4EAC\u65F6\u95F4 00:00 \u91CD\u7F6E\uFF08\u7EA6 ${countdown}\u540E\uFF09`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u53EF\u4F7F\u7528 /model \u5207\u6362\u81F3\u5176\u4ED6\u4ED8\u8D39\u6A21\u578B\uFF08\u5982 deepseek-v4-pro / glm-5.3\uFF09\u6D88\u8017 Credits \u989D\u5EA6\uFF0C\u6216\u6B21\u65E5\u91CD\u7F6E\u540E\u7EE7\u7EED\u4F7F\u7528\u3002`
    ].join("\n");
  }
  if (code === "113" || code === "118" || /quota exhausted/i.test(message) || /credits exhausted/i.test(message)) {
    return [
      `[Qoder CN \u989D\u5EA6\u8017\u5C3D] \u8D26\u6237 Credits \u4F59\u989D\u5DF2\u5168\u90E8\u7528\u5C3D (\u9519\u8BEF\u7801 ${code || 113})`,
      `- \u9650\u5236\u539F\u56E0\uFF1A\u5F53\u524D\u8BA2\u9605\u5957\u9910\u53CA\u8D44\u6E90\u5305\u5185\u7684\u53EF\u7528\u989D\u5EA6\u5DF2\u5168\u90E8\u6263\u51CF\u5B8C\u6BD5\u3002`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u8BF7\u524D\u5F80 qoder.com.cn \u8D2D\u4E70\u8D44\u6E90\u5305/\u52A0\u6CB9\u5305\uFF0C\u6216\u7B49\u5F85\u4E0B\u4E00\u8BA1\u8D39\u5468\u671F\u5237\u65B0\u3002`
    ].join("\n");
  }
  if (code === "105" || /token expired/i.test(message) || /login expired/i.test(message)) {
    return [
      `[Qoder CN \u51ED\u8BC1\u5931\u6548] \u767B\u5F55\u6001\u5DF2\u8FC7\u671F\u6216 Token \u5931\u6548 (\u9519\u8BEF\u7801 105)`,
      `- \u89E3\u51B3\u5EFA\u8BAE\uFF1A\u8BF7\u91CD\u65B0\u8FD0\u884C /login qoder-cn\uFF0C\u6216\u66F4\u65B0\u73AF\u5883\u53D8\u91CF\u4E2D\u7684\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF08PAT\uFF09\u3002`
    ].join("\n");
  }
  if (rawBody === void 0 || rawBody === null) {
    return `Upstream status ${statusCode}`;
  }
  const bodyStr = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
  const truncated = bodyStr.length > 500 ? `${bodyStr.slice(0, 500)}...` : bodyStr;
  return `Upstream status ${statusCode}: ${truncated}`;
}

// src/commands/usage.ts
init_region();
var ANSI = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m"
};
var FILLED_CHAR = "\u2588";
var EMPTY_CHAR = "\u2591";
var UNKNOWN_CHAR = "?";
var BAR_WIDTH = 20;
var COLUMN_GAP = "  ";
function paint(text, code) {
  return code && text ? `${code}${text}${ANSI.reset}` : text;
}
function usageColor(percentage, danger = false) {
  if (danger) return `${ANSI.red}${ANSI.bold}`;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return void 0;
  if (percentage >= 85) return `${ANSI.red}${ANSI.bold}`;
  if (percentage >= 60) return ANSI.yellow;
  return ANSI.green;
}
function usageBar(percentage, options = {}) {
  const width = options.width ?? BAR_WIDTH;
  const known = typeof percentage === "number" && Number.isFinite(percentage);
  const filled = known ? Math.max(0, Math.min(width, Math.round(percentage / 100 * width))) : 0;
  const fill = known ? FILLED_CHAR.repeat(filled) : "";
  const rest = known ? EMPTY_CHAR.repeat(width - filled) : UNKNOWN_CHAR.repeat(width);
  if (!options.color) return `[${fill}${rest}]`;
  return paint("[", ANSI.dim) + paint(fill, usageColor(percentage, options.danger)) + paint(rest, ANSI.dim) + paint("]", ANSI.dim);
}
function formatAmount(value, unit) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  const rounded = Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}
function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return Math.round(value * 10) / 10;
}
function formatDailyResetCountdown(now = Date.now()) {
  const diffMs = msUntilBeijingMidnight(now);
  const totalMinutes = Math.max(1, Math.round(diffMs / 6e4));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const countdown = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `00:00 UTC+8 (in ${countdown})`;
}
function formatResetTime(expiresAt, now = Date.now()) {
  const ms = Number(expiresAt);
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  const timestamp = ms < 1e12 ? ms * 1e3 : ms;
  if (new Date(timestamp).getUTCFullYear() >= 9999) return "never";
  const delta = timestamp - now;
  if (delta <= 0) return "expired";
  const totalMinutes = Math.round(delta / 6e4);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  const relative = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${new Date(timestamp).toLocaleDateString("sv")} (in ${relative})`;
}
function isBucketRow(row) {
  return typeof row.used === "number" || typeof row.total === "number";
}
function rightCell(text, width, code) {
  return " ".repeat(Math.max(0, width - text.length)) + paint(text, code);
}
function renderUsageRows(rows, notes, color) {
  const buckets = rows.filter(isBucketRow);
  const usedWidth = Math.max(0, ...buckets.map((row) => formatAmount(row.used).length));
  const totalWidth = Math.max(0, ...buckets.map((row) => formatAmount(row.total).length));
  const unitWidth = Math.max(0, ...buckets.map((row) => (row.unit ?? "").length));
  const remainWidth = Math.max(0, ...buckets.map((row) => formatAmount(row.remaining).length));
  const labelWidth = Math.max(0, ...rows.map((row) => row.label.length), ...notes.map((note) => note.label.length));
  const percentWidth = Math.max(0, ...rows.map((row) => row.percent === void 0 ? 1 : `${row.percent}%`.length));
  const amountWidth = buckets.length > 0 ? usedWidth + 3 + totalWidth + 1 + unitWidth : 0;
  const remainder = (row) => isBucketRow(row) ? `${formatAmount(row.remaining).padStart(remainWidth)} left` : row.tail ?? "";
  const remainderWidth = Math.max(0, ...rows.map((row) => remainder(row).length));
  const lines = rows.map((row) => {
    const amount = isBucketRow(row) ? `${formatAmount(row.used).padStart(usedWidth)} / ${formatAmount(row.total).padStart(totalWidth)} ${(row.unit ?? "").padEnd(unitWidth)}` : " ".repeat(amountWidth);
    const percent = row.percent === void 0 ? UNKNOWN_CHAR : `${row.percent}%`;
    return [
      row.label.padEnd(labelWidth),
      usageBar(row.percent, { color, danger: row.danger }),
      amount,
      rightCell(percent, percentWidth, color ? usageColor(row.percent, row.danger) : void 0),
      remainder(row).padEnd(remainderWidth)
    ].join(COLUMN_GAP);
  });
  for (const note of notes) {
    lines.push(`${note.label.padEnd(labelWidth)}${COLUMN_GAP}${color ? paint(note.value, note.color) : note.value}`);
  }
  return lines.map((line) => line.replace(/ +$/, ""));
}
function bucketRow(label, bucket, danger) {
  const rawPercent = bucket?.percentage;
  const derivedPercent = typeof bucket?.used === "number" && typeof bucket?.total === "number" && bucket.total > 0 ? bucket.used / bucket.total * 100 : void 0;
  const percent = formatPercent(
    typeof rawPercent === "number" && Number.isFinite(rawPercent) ? rawPercent : derivedPercent
  );
  return {
    label,
    percent,
    used: bucket?.used,
    total: bucket?.total,
    remaining: bucket?.remaining,
    unit: bucket?.unit || "credits",
    danger
  };
}
function hasBucket(bucket) {
  if (!bucket) return false;
  return (bucket.total ?? 0) > 0 || (bucket.used ?? 0) > 0;
}
function pickBucket(raw, camel) {
  if (!raw) return void 0;
  const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return raw[snake] ?? raw[camel];
}
function formatQoderUsage(raw, mode, now = Date.now(), options = {}) {
  const color = options.color ?? false;
  const region = getQoderRegionConfig(mode);
  const danger = Boolean(raw?.isQuotaExceeded);
  const userType = raw?.userType ? ` (${raw.userType})` : "";
  const showUserQuota = hasBucket(pickBucket(raw, "userQuota"));
  const showAddOnQuota = hasBucket(pickBucket(raw, "addOnQuota"));
  const org = pickBucket(raw, "orgResourcePackage") ?? pickBucket(raw, "sharedQuota");
  const showOrg = hasBucket(org);
  const orgPercent = typeof org?.used === "number" && typeof org?.cap === "number" && org.cap > 0 ? formatPercent(org.used / org.cap * 100) : void 0;
  const overallPercent = formatPercent(showOrg ? raw?.totalUsagePercentage || orgPercent : raw?.totalUsagePercentage);
  const rows = [{ label: "Overall", percent: overallPercent, tail: "used", danger }];
  if (showUserQuota) rows.push(bucketRow("Plan quota", pickBucket(raw, "userQuota"), danger));
  if (showAddOnQuota) rows.push(bucketRow("Add-on", pickBucket(raw, "addOnQuota"), danger));
  if (showOrg && org)
    rows.push(bucketRow("Enterprise", { ...org, percentage: void 0, total: org.cap ?? org.total }, danger));
  const isPersonalStandard = raw?.userType === "personal_standard" || raw?.userType === "free";
  const notes = [];
  if (danger) {
    notes.push({ label: "Status", value: "quota exceeded", color: ANSI.red });
  }
  if (!showUserQuota && !showAddOnQuota && !showOrg) notes.push({ label: "Buckets", value: "none returned" });
  if (raw?.isPlanQuotaProrated) notes.push({ label: "Note", value: "plan quota is prorated" });
  if (isPersonalStandard || !showOrg && formatResetTime(raw?.expiresAt, now) === "never") {
    notes.push({ label: "Daily reset", value: formatDailyResetCountdown(now) });
  }
  notes.push({ label: "Expires", value: formatResetTime(raw?.expiresAt, now) });
  const manageUrl = raw?.addOnQuota?.detailUrl || raw?.upgradeUrl || region.manageUrl;
  if (manageUrl) notes.push({ label: "Manage", value: manageUrl });
  const title = `${region.usageTitle}${userType}`;
  return {
    title: region.usageTitle,
    lines: [paint(title, color ? ANSI.bold : void 0), ...renderUsageRows(rows, notes, color)]
  };
}
async function fetchQoderQuota(accessToken, mode) {
  const response = await fetch(getQoderUsageURL(mode), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "pi-provider-qoder-cn"
    }
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = void 0;
  }
  if (!response.ok) {
    const detail = data?.message || data?.error || text.slice(0, 200);
    const hint = response.status === 401 || response.status === 403 ? `Re-login with /login ${getQoderRegionConfig(mode).providerID}.` : "";
    const parts = [`Qoder usage request failed: ${response.status} ${response.statusText}`, hint, detail];
    throw new Error(parts.filter(Boolean).join("\n"));
  }
  if (!data) throw new Error("Qoder usage response was not JSON.");
  return data;
}
async function resolveAccessToken(providerID, ctx) {
  try {
    const fromRegistry = await ctx?.modelRegistry?.getApiKeyForProvider(providerID);
    if (fromRegistry) return fromRegistry;
  } catch {
  }
  const { getCachedCredentials: getCachedCredentials2 } = await Promise.resolve().then(() => (init_oauth(), oauth_exports));
  return getCachedCredentials2("", providerID)?.access || void 0;
}
var FORMAT_ARGS = /* @__PURE__ */ new Set(["json", "raw", "debug"]);
var PLAIN_ARGS = /* @__PURE__ */ new Set(["plain", "no-color", "nocolor"]);
function shouldColorize(args, options = {}) {
  if (PLAIN_ARGS.has((args || "").trim().toLowerCase())) return false;
  const env = options.env ?? process.env;
  if (env.NO_COLOR || env.TERM === "dumb" || env.FORCE_COLOR === "0") return false;
  if (options.hasUI) return true;
  return options.isTTY ?? Boolean(process.stdout?.isTTY);
}
async function runUsageCommand(mode, args, ctx) {
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
    const color = !wantsRaw && shouldColorize(args, { hasUI: Boolean(ctx?.ui) });
    const output = wantsRaw ? JSON.stringify(raw, null, 2) : formatQoderUsage(raw, mode, Date.now(), { color }).lines.join("\n");
    ctx?.ui?.notify(output, "info");
    if (!ctx?.ui) console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx?.ui?.notify(message, "error");
    if (!ctx?.ui) console.error(message);
  }
}

// src/protocol/stream.ts
init_oauth();
init_catalog();
init_cosy();
init_region();
import crypto3 from "node:crypto";
import * as PiAi from "@earendil-works/pi-ai";
import {
  clampThinkingLevel
} from "@earendil-works/pi-ai";

// src/protocol/encoding.ts
var qoderCustomAlphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
var qoderStdAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var encodeTable = new Uint8Array(256);
for (let i = 0; i < encodeTable.length; i++) {
  encodeTable[i] = i;
}
for (let i = 0; i < qoderStdAlphabet.length; i++) {
  encodeTable[qoderStdAlphabet.charCodeAt(i)] = qoderCustomAlphabet.charCodeAt(i);
}
encodeTable["=".charCodeAt(0)] = "$".charCodeAt(0);
function qoderEncodeBody(plaintext) {
  const std = Buffer.isBuffer(plaintext) ? plaintext.toString("base64") : Buffer.from(plaintext).toString("base64");
  const n = std.length;
  const a = Math.floor(n / 3);
  const out = Buffer.allocUnsafe(n);
  let dst = 0;
  for (let i = n - a; i < n; i++) {
    out[dst++] = encodeTable[std.charCodeAt(i)];
  }
  for (let i = a; i < n - a; i++) {
    out[dst++] = encodeTable[std.charCodeAt(i)];
  }
  for (let i = 0; i < a; i++) {
    out[dst++] = encodeTable[std.charCodeAt(i)];
  }
  return out;
}

// src/protocol/queue.ts
var MAX_QUEUE_RETRIES = 3;
var MAX_WAIT_MS = 12e4;
var DEFAULT_RETRY_SECONDS = 30;
function digForQueue(node, depth) {
  if (depth > 6) return null;
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return digForQueue(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = digForQueue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = node;
  if (record.isQueued === true) return record;
  for (const value of Object.values(record)) {
    const found = digForQueue(value, depth + 1);
    if (found) return found;
  }
  return null;
}
function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function parseQueueNotice(envelope) {
  const payload = digForQueue(envelope, 0);
  if (!payload) return null;
  const retryMs = positiveNumber(payload.retry_after_ms, 0) || positiveNumber(payload.retryAfterSeconds, DEFAULT_RETRY_SECONDS) * 1e3;
  return {
    retryAfterMs: Math.min(retryMs, MAX_WAIT_MS),
    waitTimeSeconds: positiveNumber(payload.waitTime, 0),
    queueCount: positiveNumber(payload.queueCount, 0)
  };
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted while waiting for the Qoder queue."));
      return;
    }
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted while waiting for the Qoder queue."));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// src/protocol/thinking.ts
var THINKING_TAG_VARIANTS = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" }
];
var ALL_THINKING_TAGS = THINKING_TAG_VARIANTS.flatMap((variant) => [variant.open, variant.close]);
function getTrailingPossibleTagPrefixLength(text, tag) {
  const maxPrefixLength = Math.min(text.length, tag.length - 1);
  for (let len = maxPrefixLength; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
function getMaxTrailingPossibleTagPrefixLength(text, tags) {
  let maxLength = 0;
  for (const tag of tags) {
    maxLength = Math.max(maxLength, getTrailingPossibleTagPrefixLength(text, tag));
  }
  return maxLength;
}
function stripThinkingTags(text) {
  let out = text;
  for (const { open, close } of THINKING_TAG_VARIANTS) {
    if (open.length > 0 && out.includes(open)) out = out.split(open).join("");
    if (close.length > 0 && out.includes(close)) out = out.split(close).join("");
  }
  return out;
}
var DSML_TAG = /<\/?[\uFF5C|]{0,2}\s*DSML\s*[\uFF5C|]{0,2}[^>]*>|<\/?(?:invoke|invocation|parameter|function_call|function_calls)\b[^>]*>/g;
var DEGENERATE_DSML_TAIL = /(?:(?:<\/?(?:invoke|invocation|parameter|function_call|function_calls)\b[^>]*>)\s*|(?:<\/?[\uFF5C|]{0,2}\s*DSML\s*[\uFF5C|]{0,2}[^>]*>)\s*){2,}$/;
function stripDsmlResidue(text) {
  return text.replace(DSML_TAG, "").replace(/\n{3,}/g, "\n\n");
}
function isDegenerateDsmlTurn(message, rawReasoning) {
  if (message.stopReason === "toolUse") return false;
  const content = Array.isArray(message.content) ? message.content : [];
  if (content.some((block) => block.type === "text" && block.text.trim().length > 0)) return false;
  return DEGENERATE_DSML_TAIL.test(rawReasoning);
}
var ThinkingTagParser = class {
  constructor(output, stream) {
    this.output = output;
    this.stream = stream;
  }
  output;
  stream;
  textBuffer = "";
  inThinking = false;
  thinkingExtracted = false;
  thinkingBlockIndex = null;
  textBlockIndex = null;
  lastTextBlockIndex = null;
  activeEndTag = THINKING_TAG_VARIANTS[0].close;
  processChunk(chunk) {
    this.textBuffer += chunk;
    while (this.textBuffer.length > 0) {
      const prevLength = this.textBuffer.length;
      if (!this.inThinking && !this.thinkingExtracted) {
        this.processBeforeThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.inThinking) {
        this.processInsideThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.thinkingExtracted) {
        this.processAfterThinking();
        break;
      }
      if (this.textBuffer.length >= prevLength) break;
    }
  }
  finalize() {
    if (this.textBuffer.length === 0) return;
    if (this.inThinking && this.thinkingBlockIndex !== null) {
      const block = this.output.content[this.thinkingBlockIndex];
      block.thinking += this.textBuffer;
      this.stream.push({
        type: "thinking_delta",
        contentIndex: this.thinkingBlockIndex,
        delta: this.textBuffer,
        partial: this.output
      });
      this.stream.push({
        type: "thinking_end",
        contentIndex: this.thinkingBlockIndex,
        content: block.thinking,
        partial: this.output
      });
    } else {
      this.emitText(this.textBuffer);
    }
    this.textBuffer = "";
  }
  getTextBlockIndex() {
    return this.textBlockIndex ?? this.lastTextBlockIndex;
  }
  processBeforeThinking() {
    let bestOpenPos = -1;
    let bestOpenVariant = null;
    let bestClosePos = -1;
    let bestCloseVariant = null;
    for (const variant of THINKING_TAG_VARIANTS) {
      const openPos = this.textBuffer.indexOf(variant.open);
      if (openPos !== -1 && (bestOpenPos === -1 || openPos < bestOpenPos)) {
        bestOpenPos = openPos;
        bestOpenVariant = variant;
      }
      const closePos = this.textBuffer.indexOf(variant.close);
      if (closePos !== -1 && (bestClosePos === -1 || closePos < bestClosePos)) {
        bestClosePos = closePos;
        bestCloseVariant = variant;
      }
    }
    if (bestOpenVariant !== null && (bestCloseVariant === null || bestOpenPos < bestClosePos)) {
      if (bestOpenPos > 0) this.emitText(this.textBuffer.slice(0, bestOpenPos));
      this.textBuffer = this.textBuffer.slice(bestOpenPos + bestOpenVariant.open.length);
      this.activeEndTag = bestOpenVariant.close;
      this.inThinking = true;
      return;
    }
    if (bestCloseVariant !== null) {
      if (bestClosePos > 0) this.emitText(this.textBuffer.slice(0, bestClosePos));
      this.textBuffer = this.textBuffer.slice(bestClosePos + bestCloseVariant.close.length);
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      else if (this.textBuffer.startsWith("\n")) this.textBuffer = this.textBuffer.slice(1);
      return;
    }
    const trailingPrefixLength = getMaxTrailingPossibleTagPrefixLength(this.textBuffer, ALL_THINKING_TAGS);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitText(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }
  processInsideThinking() {
    const endPos = this.textBuffer.indexOf(this.activeEndTag);
    if (endPos !== -1) {
      if (endPos > 0) this.emitThinking(this.textBuffer.slice(0, endPos));
      if (this.thinkingBlockIndex !== null) {
        const block = this.output.content[this.thinkingBlockIndex];
        this.stream.push({
          type: "thinking_end",
          contentIndex: this.thinkingBlockIndex,
          content: block.thinking,
          partial: this.output
        });
      }
      this.textBuffer = this.textBuffer.slice(endPos + this.activeEndTag.length);
      this.inThinking = false;
      this.thinkingExtracted = true;
      this.lastTextBlockIndex = this.textBlockIndex;
      this.textBlockIndex = null;
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      return;
    }
    const trailingPrefixLength = getTrailingPossibleTagPrefixLength(this.textBuffer, this.activeEndTag);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitThinking(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }
  processAfterThinking() {
    this.emitText(this.textBuffer);
    this.textBuffer = "";
  }
  emitText(text) {
    if (!text) return;
    if (this.textBlockIndex === null) {
      this.textBlockIndex = this.output.content.length;
      this.output.content.push({ type: "text", text: "" });
      this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.textBlockIndex];
    block.text += text;
    this.stream.push({ type: "text_delta", contentIndex: this.textBlockIndex, delta: text, partial: this.output });
  }
  emitThinking(thinking) {
    if (!thinking) return;
    if (this.thinkingBlockIndex === null) {
      if (this.textBlockIndex !== null) {
        this.thinkingBlockIndex = this.textBlockIndex;
        this.output.content.splice(this.thinkingBlockIndex, 0, { type: "thinking", thinking: "" });
        this.textBlockIndex = this.textBlockIndex + 1;
      } else {
        this.thinkingBlockIndex = this.output.content.length;
        this.output.content.push({ type: "thinking", thinking: "" });
      }
      this.stream.push({ type: "thinking_start", contentIndex: this.thinkingBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.thinkingBlockIndex];
    block.thinking += thinking;
    this.stream.push({
      type: "thinking_delta",
      contentIndex: this.thinkingBlockIndex,
      delta: thinking,
      partial: this.output
    });
  }
};

// src/protocol/transform.ts
function getContentText(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => {
      if (c.type === "text") return c.text;
      if (c.type === "thinking") return c.thinking;
      return "";
    }).join("");
  }
  return "";
}
function getContentImages(msg) {
  if (!Array.isArray(msg.content)) return [];
  return msg.content.filter((c) => c.type === "image");
}
function transformTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}
function transformMessagesForQoder(messages) {
  const normalizedMessages = [];
  const droppedToolCallIds = /* @__PURE__ */ new Set();
  for (const msg of messages) {
    if (msg.role === "assistant" && (msg.stopReason === "error" || msg.stopReason === "aborted")) {
      const am = msg;
      if (Array.isArray(am.content)) {
        for (const block of am.content) {
          if (block.type === "toolCall") {
            const id = block.id;
            if (id) droppedToolCallIds.add(id);
          }
        }
      }
      continue;
    }
    if (msg.role === "toolResult" && droppedToolCallIds.has(msg.toolCallId)) {
      continue;
    }
    if (msg.role === "user") {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const hasImage = msg.content.some((c) => c.type === "image");
        if (hasImage) {
          content = msg.content.map((c) => {
            if (c.type === "text") {
              return { type: "text", text: c.text };
            }
            if (c.type === "image") {
              const img = c;
              return {
                type: "image_url",
                image_url: {
                  url: `data:${img.mimeType};base64,${img.data}`
                }
              };
            }
            return null;
          }).filter((p) => p !== null);
        } else {
          content = getContentText(msg);
        }
      }
      normalizedMessages.push({
        role: "user",
        content
      });
    } else if (msg.role === "assistant") {
      const am = msg;
      let content = "";
      let reasoningContent = "";
      const toolCalls = [];
      if (Array.isArray(am.content)) {
        for (const block of am.content) {
          if (block.type === "text") {
            content += block.text;
          } else if (block.type === "thinking") {
            reasoningContent += stripDsmlResidue(block.thinking);
          } else if (block.type === "toolCall") {
            const tc = block;
            toolCalls.push({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments)
              }
            });
          }
        }
      } else {
        content = am.content || "";
      }
      const mapped = {
        role: "assistant",
        content: content || (toolCalls.length > 0 || reasoningContent ? " " : null)
      };
      if (reasoningContent) {
        mapped.reasoning_content = reasoningContent;
      }
      if (toolCalls.length > 0) {
        mapped.tool_calls = toolCalls;
      }
      normalizedMessages.push(mapped);
    } else if (msg.role === "toolResult") {
      const tr = msg;
      normalizedMessages.push({
        role: "tool",
        tool_call_id: tr.toolCallId,
        content: getContentText(tr)
      });
      const images = getContentImages(tr);
      if (images.length > 0) {
        normalizedMessages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `[${images.length} image${images.length === 1 ? "" : "s"} returned by the previous tool call]`
            },
            ...images.map(
              (img) => ({
                type: "image_url",
                image_url: { url: `data:${img.mimeType};base64,${img.data}` }
              })
            )
          ]
        });
      }
    }
  }
  return normalizedMessages;
}

// src/protocol/stream.ts
function stableHash(prefix, ...inputs) {
  const hash = crypto3.createHash("sha256");
  hash.update(prefix);
  for (const input of inputs) {
    hash.update("\0");
    hash.update(input);
  }
  return hash.digest("hex").slice(0, 16);
}
function stableChatRecordID(model, messages, tools, maxTokens) {
  const hash = crypto3.createHash("sha256");
  hash.update("qoder-record");
  hash.update("\0");
  hash.update(model);
  for (const msg of messages) {
    if (msg?.role) {
      hash.update("\0");
      hash.update(msg.role);
    }
    if (msg?.content) {
      hash.update("\0");
      hash.update(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
    }
  }
  if (tools) {
    hash.update("\0");
    hash.update(JSON.stringify(tools));
  }
  hash.update("\0");
  hash.update(`mt=${maxTokens}`);
  return hash.digest("hex").slice(0, 16);
}
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return part.text;
      return "";
    }).join("\n");
  }
  return "";
}
var PeekableReader = class {
  constructor(inner) {
    this.inner = inner;
  }
  inner;
  pending = [];
  text = "";
  /** Read one chunk, replaying peeked bytes first.
   */
  async read() {
    const buffered = this.pending.shift();
    if (buffered) return { done: false, value: buffered };
    return await this.inner.read();
  }
  /**
   * Buffer chunks until the first complete line is available, and return the
   * text seen so far. Every byte read here is replayed by later `read()` calls.
   */
  async peekLine(decoder) {
    while (!this.text.includes("\n")) {
      const { done, value } = await this.inner.read();
      if (done) break;
      this.pending.push(value);
      this.text += decoder.decode(value, { stream: true });
    }
    return this.text;
  }
  cancel(reason) {
    return this.inner.cancel(reason);
  }
};
async function peekQueueNotice(reader, decoder) {
  const text = await reader.peekLine(decoder);
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  if (!firstLine.startsWith("data:")) return null;
  const payload = firstLine.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return parseQueueNotice(JSON.parse(payload));
  } catch {
    return null;
  }
}
function resolveRequestContext(piAi, context) {
  const {
    collapseSystemMessages,
    getCurrentTools,
    getInitialSystemMessage,
    getSystemMessageText,
    withoutInitialSystemMessage
  } = piAi;
  const hasTranscript = typeof collapseSystemMessages === "function" && typeof getCurrentTools === "function" && typeof getInitialSystemMessage === "function" && typeof getSystemMessageText === "function" && typeof withoutInitialSystemMessage === "function";
  if (!hasTranscript) {
    return {
      messages: context.messages,
      systemText: contentToText(context.systemPrompt || ""),
      tools: context.tools ?? []
    };
  }
  const collapsed = collapseSystemMessages(context);
  const transcriptMessages = collapsed.messages;
  const initialSystem = getInitialSystemMessage(transcriptMessages);
  const tools = getCurrentTools(transcriptMessages);
  const systemText = contentToText(
    initialSystem && getSystemMessageText ? getSystemMessageText(initialSystem) : context.systemPrompt || ""
  );
  const messages = withoutInitialSystemMessage(transcriptMessages);
  return { messages, systemText, tools };
}
function streamQoder(model, context, options) {
  const StreamCtor = PiAi.AssistantMessageEventStream;
  const stream = new StreamCtor();
  const output = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
  (async () => {
    try {
      const providerMode = model.provider === "qoder-cn" ? "cn" : "global";
      const region = getQoderRegionConfig(providerMode);
      const accessToken = options?.apiKey;
      if (!accessToken) {
        throw new Error(
          providerMode === "cn" ? "Qoder CN credentials not set. Run /login qoder-cn or set QODERCN_PERSONAL_ACCESS_TOKEN." : "Qoder credentials not set. Run /login qoder or set QODER_PERSONAL_ACCESS_TOKEN."
        );
      }
      const ident = await resolveQoderIdentity(accessToken, model.provider, providerMode);
      const userID = ident.userID || "qoder-user";
      const name = ident.name || region.userNameFallback;
      const email = ident.email || region.userEmailFallback;
      const machineID = ident.machineID || getMachineId();
      const modelConfig = getCachedModelConfig(model.id, providerMode);
      if (!modelConfig?.key) {
        throw new Error(`Unknown Qoder model id: ${model.id}`);
      }
      const qoderModel = modelConfig.key;
      const isReasoning = !!modelConfig.is_reasoning;
      const resolved = resolveRequestContext(PiAi, context);
      const normalizedMessages = transformMessagesForQoder(resolved.messages);
      const systemText = resolved.systemText;
      let lastUserText = "";
      for (let i = normalizedMessages.length - 1; i >= 0; i--) {
        if (normalizedMessages[i].role === "user") {
          const content = normalizedMessages[i].content;
          lastUserText = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => "text" in c ? c.text : "").join("") : "";
          break;
        }
      }
      const stablePart = stableHash("qoder-session", userID, qoderModel);
      const sessionID = options?.sessionId ? `${stablePart}-${options.sessionId}` : `${stablePart}-${crypto3.randomUUID()}`;
      let maxTokens = MAX_OUTPUT_TOKENS;
      if (options?.maxTokens && options.maxTokens < maxTokens) {
        maxTokens = options.maxTokens;
      }
      const toolsRaw = resolved.tools.length > 0 ? transformTools(resolved.tools) : void 0;
      const recordID = stableChatRecordID(qoderModel, normalizedMessages, toolsRaw, maxTokens);
      const requestedLevel = options?.reasoning;
      const clamped = requestedLevel ? clampThinkingLevel(model, requestedLevel) : void 0;
      const reasoningLevel = clamped === "off" ? void 0 : clamped;
      const parameters = { max_tokens: maxTokens };
      if (reasoningLevel) {
        parameters.enable_thinking = true;
        const mapped = model.thinkingLevelMap?.[reasoningLevel];
        const effort = mapped && mapped !== "enabled" && mapped !== "disabled" ? mapped : reasoningLevel;
        if (modelConfig?.thinking_config?.enabled?.efforts && typeof effort === "string") {
          parameters.reasoning_effort = effort;
        }
      } else {
        parameters.enable_thinking = false;
      }
      const reqBody = {
        request_id: crypto3.randomUUID(),
        request_set_id: recordID,
        chat_record_id: recordID,
        session_id: sessionID,
        stream: true,
        chat_task: "FREE_INPUT",
        is_reply: true,
        is_retry: false,
        source: 1,
        version: "3",
        session_type: "qodercli",
        agent_id: "agent_common",
        task_id: "common",
        code_language: "",
        chat_prompt: "",
        image_urls: null,
        aliyun_user_type: "",
        // Qoder's server ignores the top-level `system` field (verified: the
        // model never sees it). Inject the system prompt as a leading
        // role:system message instead, which the server does honor.
        system: "",
        messages: systemText ? [{ role: "system", content: systemText }, ...normalizedMessages] : normalizedMessages,
        tools: toolsRaw || [],
        parameters,
        chat_context: {
          chatPrompt: "",
          imageUrls: null,
          extra: {
            context: [],
            modelConfig: {
              key: qoderModel,
              is_reasoning: isReasoning
            },
            originalContent: lastUserText
          },
          features: [],
          text: lastUserText
        },
        model_config: modelConfig,
        business: {
          product: "cli",
          version: "1.0.0",
          type: "agent",
          stage: "start",
          id: crypto3.randomUUID(),
          name: lastUserText.substring(0, 30),
          begin_at: Date.now()
        }
      };
      const bodyBytes = Buffer.from(JSON.stringify(reqBody));
      const encodedBytes = qoderEncodeBody(bodyBytes);
      const chatURL = getQoderChatURL(providerMode);
      const headers = buildAuthHeaders(encodedBytes, chatURL, {
        userID,
        authToken: accessToken,
        name,
        email,
        machineID
      });
      const modelSource = modelConfig.source || "system";
      let queuedAttempt = 0;
      let reader;
      let decoder;
      let buffer = "";
      let bufferStart = 0;
      for (; ; ) {
        const response = await fetch(chatURL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            "Accept-Encoding": "identity",
            "X-Model-Key": qoderModel,
            "X-Model-Source": modelSource,
            ...headers
          },
          body: encodedBytes,
          signal: options?.signal
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(formatQoderStreamError(response.status, errText));
        }
        const body = response.body;
        if (!body) throw new Error("No response body");
        reader = new PeekableReader(body.getReader());
        decoder = new TextDecoder();
        buffer = "";
        bufferStart = 0;
        const queue = await peekQueueNotice(reader, decoder);
        if (queue) {
          await reader.cancel().catch(() => {
          });
          if (queuedAttempt >= MAX_QUEUE_RETRIES) {
            throw new Error(
              `Qoder is at capacity: the request stayed queued after ${queuedAttempt + 1} attempts (~${queue.waitTimeSeconds}s wait reported). Try again shortly.`
            );
          }
          queuedAttempt++;
          await sleep(queue.retryAfterMs, options?.signal);
          continue;
        }
        break;
      }
      if (!reader || !decoder) throw new Error("No response body");
      let contentBlockIndex = -1;
      let thinkingBlockIndex = -1;
      let rawReasoningTail = "";
      const toolCallsState = [];
      const thinkingEnabled = options?.reasoning !== false && options?.reasoning !== "off";
      const thinkingParser = thinkingEnabled ? new ThinkingTagParser(output, stream) : null;
      stream.push({ type: "start", partial: output });
      let sawDone = false;
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bufferStart > 0) {
          buffer = buffer.substring(bufferStart);
          bufferStart = 0;
        }
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const lineEnd = buffer.indexOf("\n", bufferStart);
          if (lineEnd === -1) break;
          const line = buffer.substring(bufferStart, lineEnd).trim();
          bufferStart = lineEnd + 1;
          if (!line.startsWith("data:")) continue;
          const dataStr = line.substring(5).trim();
          if (dataStr === "[DONE]") {
            sawDone = true;
            break;
          }
          try {
            const envelope = JSON.parse(dataStr);
            if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
              throw new Error(formatQoderStreamError(envelope.statusCodeValue, envelope.body));
            }
            const innerStr = envelope.body;
            if (innerStr === "[DONE]") {
              sawDone = true;
              break;
            }
            if (!innerStr) continue;
            const inner = JSON.parse(innerStr);
            if (inner.id) output.responseId = inner.id;
            if (inner.model) output.responseModel = inner.model;
            if (inner.usage) {
              const u = inner.usage;
              const promptTokens = u.prompt_tokens ?? 0;
              const cacheReadTokens = u.prompt_tokens_details?.cached_tokens ?? 0;
              const cacheWriteTokens = u.prompt_tokens_details?.cache_write_tokens ?? 0;
              output.usage.input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
              output.usage.output = u.completion_tokens ?? 0;
              output.usage.totalTokens = u.total_tokens ?? 0;
              output.usage.cacheRead = cacheReadTokens;
              output.usage.cacheWrite = cacheWriteTokens;
            }
            if (inner.choices && inner.choices.length > 0) {
              const choice = inner.choices[0];
              const delta = choice.delta;
              if (delta) {
                if (delta.reasoning_content) {
                  rawReasoningTail = (rawReasoningTail + delta.reasoning_content).slice(-512);
                  const reasoningChunk = stripDsmlResidue(stripThinkingTags(delta.reasoning_content));
                  if (reasoningChunk) {
                    if (thinkingBlockIndex === -1) {
                      thinkingBlockIndex = output.content.length;
                      output.content.push({ type: "thinking", thinking: "" });
                      stream.push({ type: "thinking_start", contentIndex: thinkingBlockIndex, partial: output });
                    }
                    const block = output.content[thinkingBlockIndex];
                    block.thinking += reasoningChunk;
                    stream.push({
                      type: "thinking_delta",
                      contentIndex: thinkingBlockIndex,
                      delta: reasoningChunk,
                      partial: output
                    });
                  }
                }
                if (delta.content) {
                  if (thinkingBlockIndex !== -1) {
                    const block = output.content[thinkingBlockIndex];
                    stream.push({
                      type: "thinking_end",
                      contentIndex: thinkingBlockIndex,
                      content: block.thinking,
                      partial: output
                    });
                    thinkingBlockIndex = -1;
                  }
                  if (thinkingParser) {
                    thinkingParser.processChunk(delta.content);
                  } else {
                    if (contentBlockIndex === -1) {
                      contentBlockIndex = output.content.length;
                      output.content.push({ type: "text", text: "" });
                      stream.push({ type: "text_start", contentIndex: contentBlockIndex, partial: output });
                    }
                    const block = output.content[contentBlockIndex];
                    block.text += delta.content;
                    stream.push({
                      type: "text_delta",
                      contentIndex: contentBlockIndex,
                      delta: delta.content,
                      partial: output
                    });
                  }
                }
                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsState[idx]) {
                      toolCallsState[idx] = { arguments: "", id: "", name: "", contentIndex: 0 };
                    }
                    const state = toolCallsState[idx];
                    if (tc.id) state.id = tc.id;
                    if (tc.function?.name) state.name = tc.function.name;
                    if (state.emittedStart === void 0 && (state.id || state.name)) {
                      state.emittedStart = true;
                      state.contentIndex = output.content.length;
                      output.content.push({
                        type: "toolCall",
                        id: state.id,
                        name: state.name,
                        arguments: {}
                      });
                      stream.push({ type: "toolcall_start", contentIndex: state.contentIndex, partial: output });
                    }
                    if (state.emittedStart) {
                      const block = output.content[state.contentIndex];
                      block.id = state.id;
                      block.name = state.name;
                    }
                    if (tc.function?.arguments) {
                      const argDelta = tc.function.arguments;
                      state.arguments += argDelta;
                      stream.push({
                        type: "toolcall_delta",
                        contentIndex: state.contentIndex,
                        delta: argDelta,
                        partial: output
                      });
                    }
                  }
                }
              }
              if (choice.finish_reason) {
                output.stopReason = choice.finish_reason;
              }
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              if (process.env.QODER_DEBUG) {
                console.error("[pi-provider-qoder] skipping malformed SSE line:", dataStr.slice(0, 200));
              }
              continue;
            }
            throw e;
          }
        }
      }
      await reader.cancel().catch(() => {
      });
      if (thinkingParser) {
        thinkingParser.finalize();
      }
      if (thinkingBlockIndex !== -1) {
        const block = output.content[thinkingBlockIndex];
        stream.push({
          type: "thinking_end",
          contentIndex: thinkingBlockIndex,
          content: block.thinking,
          partial: output
        });
      }
      for (const state of toolCallsState) {
        if (state?.emittedStart && !state.emittedEnd) {
          state.emittedEnd = true;
          let args = {};
          try {
            args = JSON.parse(state.arguments || "{}");
          } catch {
          }
          const block = output.content[state.contentIndex];
          block.arguments = args;
          stream.push({
            type: "toolcall_end",
            contentIndex: state.contentIndex,
            toolCall: {
              type: "toolCall",
              id: state.id,
              name: state.name,
              arguments: args
            },
            partial: output
          });
        }
      }
      if (toolCallsState.some((state) => state?.emittedStart)) {
        output.stopReason = "toolUse";
      }
      if (isDegenerateDsmlTurn(output, rawReasoningTail)) {
        output.stopReason = "error";
        output.errorMessage = "Qoder server error: degenerate model output (unparseable DSML tool-call markup, no tool call executed)";
        stream.push({ type: "error", reason: "error", error: output });
        stream.end();
        return;
      }
      stream.push({
        type: "done",
        reason: output.stopReason,
        message: output
      });
      stream.end();
    } catch (e) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = e instanceof Error ? e.message : String(e);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      try {
        stream.end();
      } catch {
      }
    }
  })();
  return stream;
}

// src/index.ts
init_region();
var QODER_API = "qoder-api";
async function registerQoderApi() {
  try {
    const compat = await import("@earendil-works/pi-ai/compat");
    const register = compat.registerApiProvider;
    if (typeof register !== "function") return;
    register(
      { api: QODER_API, stream: streamQoder, streamSimple: streamQoder },
      "provider:qoder"
    );
  } catch {
  }
}
function modelsForProvider(mode, providerID) {
  const cached = getCachedModels(mode);
  const modelsToUse = cached.length > 0 ? cached : mode === "cn" ? staticCnModels : staticModels;
  return modelsToUse.map((m) => ({
    ...m,
    provider: providerID,
    baseUrl: getQoderBaseUrl(mode)
  }));
}
function createQoderOAuth(mode) {
  const region = getQoderRegionConfig(mode);
  return {
    name: region.loginName,
    login: (callbacks) => loginQoderForMode(callbacks, mode),
    refreshToken: (credentials) => refreshQoderTokenForMode(credentials, mode),
    getApiKey: (cred) => cred.access,
    // NOTE: no `modifyModels` hook on purpose. OMP (Bun) does a whole-catalog
    // structuredClone before invoking it, and its bundled catalog contains a
    // model with a non-cloneable property -> "The object can not be cloned."
    // removes qoder from `omp models`. Models are supplied at registration
    // via `modelsForProvider` and refreshed by the startup/session cache hooks.
    fetchUsage: (credentials) => fetchQoderUsageForMode(credentials, mode)
  };
}
function registerQoderProvider(pi, mode) {
  const providerID = getQoderRegionConfig(mode).providerID;
  const oauth = createQoderOAuth(mode);
  pi.registerProvider(providerID, {
    baseUrl: getQoderBaseUrl(mode),
    api: QODER_API,
    models: modelsForProvider(mode, providerID),
    oauth,
    // pi-coding-agent resolves its own nested @earendil-works/pi-ai copy, so the
    // structurally identical Model/Context types are nominally distinct here.
    streamSimple: streamQoder
  });
}
async function refreshModelsAtStartup(mode) {
  const providerID = getQoderRegionConfig(mode).providerID;
  if (!isCacheStale(mode)) return;
  const credentials = getCachedCredentials("", providerID);
  if (!credentials?.access) return;
  const region = getQoderRegionConfig(mode);
  await updateQoderModelsCache(
    credentials.access,
    credentials.userID || "qoder-user",
    credentials.name || region.userNameFallback,
    credentials.email || region.userEmailFallback,
    mode
  );
}
async function index_default(pi) {
  await registerQoderApi();
  for (const mode of QODER_PROVIDER_MODES) {
    const providerID = getQoderRegionConfig(mode).providerID;
    try {
      await autoLoginQoderFromEnvironment(providerID, mode);
      await refreshModelsAtStartup(mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[pi-provider-qoder-cn] Automatic login failed for ${providerID}: ${message}`);
    }
  }
  pi.on("session_start", async (_event, ctx) => {
    for (const mode of QODER_PROVIDER_MODES) {
      try {
        const region = getQoderRegionConfig(mode);
        const providerID = region.providerID;
        const accessToken = await ctx.modelRegistry.getApiKeyForProvider(providerID);
        if (!accessToken || !isCacheStale(mode)) continue;
        const creds = getCachedCredentials(accessToken, providerID);
        const userID = creds?.userID || "qoder-user";
        const name = creds?.name || region.userNameFallback;
        const email = creds?.email || region.userEmailFallback;
        await updateQoderModelsCache(accessToken, userID, name, email, mode);
      } catch {
      }
    }
  });
  for (const mode of QODER_PROVIDER_MODES) registerQoderProvider(pi, mode);
  registerCommands(pi);
}
function registerCommands(pi) {
  pi.registerCommand("qoder-cn.usage", {
    description: "Show qoder-cn quota: plan + add-on credits, used/limit and reset (append 'json' for the raw payload)",
    handler: async (args, ctx) => {
      await runUsageCommand("cn", args, ctx);
    }
  });
}
export {
  index_default as default
};
