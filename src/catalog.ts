import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { isQoderCNModelId, toQoderCNModelInfo, toQoderCNUpstreamKey } from "./cn-naming.js";
import { buildAuthHeaders } from "./cosy.js";
import { getQoderBaseUrl, getQoderModelListURL, getQoderRegionConfig, type QoderMode } from "./region.js";

export const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Maximum output tokens sent per request. Aliyun Model Studio (the upstream
 * behind Qoder's CN catalog) documents Max Output Length = 131072 for every
 * model we expose (qwen3.8-max/flash, qwen3.7-max/plus/flash), in both normal
 * and thinking modes (thinking chain alone goes up to 262144). The Qoder
 * /model/list catalog does not return a per-model output cap, so this single
 * constant is the source of truth for both static models and request sending.
 * qodercli ships a conservative 32e3 default and caps its UI at 65536; we use
 * the documented upstream ceiling so reasoning chains and long generations
 * are not truncated.
 */
export const MAX_OUTPUT_TOKENS = 131072;

/**
 * Fallback context window when the catalog omits `context_config`.
 *
 * Qoder's `/model/list` often ships `max_input_tokens` as a stale 180K floor
 * even for models that accept 1M-token prompts (verified against global `lite`
 * through 1,000K tokens). When `context_config` is present we use its largest
 * `token_count` instead, so models that truly advertise 200K/256K stay there.
 */
export const DEFAULT_CONTEXT_WINDOW = 1000000;

/** Shape of a single entry returned by the Qoder /model/list endpoint. */
export interface QoderModelEntry {
  key?: string;
  enable?: boolean;
  display_name?: string;
  max_input_tokens?: number;
  context_config?: Record<string, { token_count?: number; is_default?: boolean }>;
  is_vl?: boolean;
  is_reasoning?: boolean;
  thinking_config?: {
    disabled?: unknown;
    enabled?: { efforts?: Record<string, { is_default?: boolean }>; is_default?: boolean };
  };
  source?: string;
  [key: string]: unknown;
}

export interface QoderModelDef {
  id: string;
  upstreamKey?: string;
  name: string;
  api: "qoder-api";
  provider: "qoder" | "qoder-cn";
  baseUrl: string;
  reasoning: boolean;
  supportsEffort: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input: ("text" | "image")[];
  cost: typeof ZERO_COST;
  contextWindow: number;
  maxTokens: number;
  description?: string;
}

function getHomeDir(): string {
  // Prefer process.env.HOME so vitest setup can isolate caches. Node 26+ caches
  // os.homedir() from process start, ignoring later HOME changes.
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getQoderCachePath(mode: QoderMode): string {
  return join(getHomeDir(), ".pi", "agent", getQoderRegionConfig(mode).modelCacheFile);
}

interface ParsedModelCache {
  updatedAt?: number;
  models?: QoderModelDef[];
  configs?: Record<string, QoderModelEntry>;
}

/** In-memory cache keyed by absolute cache path (HOME-safe across tests). */
const modelCacheMem = new Map<string, ParsedModelCache | null>();

/** Clear process-memory model caches (also used by tests that mutate cache files). */
export function clearQoderModelsMemCache(): void {
  modelCacheMem.clear();
}

function readParsedModelCache(mode: QoderMode): ParsedModelCache | null {
  const cachePath = getQoderCachePath(mode);
  if (modelCacheMem.has(cachePath)) {
    return modelCacheMem.get(cachePath) ?? null;
  }
  if (!existsSync(cachePath)) {
    modelCacheMem.set(cachePath, null);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(cachePath, "utf8")) as ParsedModelCache;
    modelCacheMem.set(cachePath, data);
    return data;
  } catch {
    modelCacheMem.set(cachePath, null);
    return null;
  }
}

function writeParsedModelCache(mode: QoderMode, data: ParsedModelCache): void {
  const cachePath = getQoderCachePath(mode);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
  modelCacheMem.set(cachePath, data);
}

/**
 * Derive the only public model id from Qoder's display name.
 * The upstream key remains available solely inside the matching config entry.
 */
export function toQoderModelId(displayName?: string): string {
  return (displayName || "QoderModel").replace(/\s+/g, "");
}

export const staticModels: QoderModelDef[] = [
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    contextWindow: 256000,
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
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
    maxTokens: MAX_OUTPUT_TOKENS,
  },
];

/**
 * Static CN catalog used before the live `/model/list` cache exists.
 *
 * Ids are the friendly slugs from `cn-naming.ts` (`qwen3.8-max`), not the
 * whitespace-stripped display names the upstream package uses
 * (`Qwen3.8-Max`). `settings.json` persists `enabledModels` as
 * `qoder-cn/qwen3.8-flash`, so changing the id scheme would silently disable
 * the model for existing users. `upstreamKey` is what requests actually send.
 *
 * Context windows and effort support mirror the live CN catalog captured in
 * `qoder-cn-models-cache.json`; where the live value is smaller than the
 * generic 1M fallback (Auto, MiniMax) the smaller value is pinned deliberately.
 */
export const staticCnModels: QoderModelDef[] = [
  {
    id: "auto",
    upstreamKey: "auto",
    name: "Auto · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    // CN Auto has not been live-tested at 1M; the live catalog reports 200K.
    contextWindow: 200000,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qoder CN smart routing; live catalog reports 200K max input.",
  },
  {
    id: "qwen3.8-max",
    upstreamKey: "qmodel_38max",
    name: "Qwen 3.8-Max · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qwen 3.8-Max (qmodel_38max); 1M context.",
  },
  {
    id: "qwen3.8-flash",
    upstreamKey: "qfmodel",
    name: "Qwen 3.8-Flash · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qwen 3.8-Flash (qfmodel); multimodal MoE, 1M context.",
  },
  {
    id: "qwen3.7-max",
    upstreamKey: "qmodel_latest",
    name: "Qwen 3.7-Max · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qwen 3.7-Max (qmodel_latest); context options 200K/400K/1M.",
  },
  {
    id: "qwen3.7-plus",
    upstreamKey: "qmodel",
    name: "Qwen 3.7-Plus · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qwen 3.7-Plus (qmodel); context options 200K/400K/1M.",
  },
  {
    id: "qwen3.7-flash",
    upstreamKey: "q37fmodel",
    name: "Qwen 3.7-Flash · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Qwen 3.7-Flash (q37fmodel); vision-language Flash, 1M context.",
  },
  {
    id: "deepseek-v4-pro",
    upstreamKey: "dmodel",
    name: "DeepSeek V4 Pro · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "DeepSeek V4 Pro (dmodel); 1M context.",
  },
  {
    id: "deepseek-v4-flash",
    upstreamKey: "dfmodel",
    name: "DeepSeek V4 Flash · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "DeepSeek V4 Flash (dfmodel); 1M context.",
  },
  {
    id: "glm-5.3",
    upstreamKey: "gmodel",
    name: "GLM-5.3 · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "GLM-5.3 (gmodel); Zhipu flagship open-source, 1M context.",
  },
  {
    id: "glm-5.3-flash",
    upstreamKey: "gfmodel",
    name: "GLM-5.3-Flash · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "GLM-5.3-Flash (gfmodel); 1M context.",
  },
  {
    id: "glm-5.2",
    upstreamKey: "gm51model",
    name: "GLM 5.2 · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "GLM 5.2 (gm51model); 1M context.",
  },
  {
    id: "kimi-k3",
    upstreamKey: "kmodel_latest",
    name: "Kimi-K3 · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: true,
    input: ["text", "image"],
    cost: ZERO_COST,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Kimi-K3 (kmodel_latest); 1M context.",
  },
  {
    id: "kimi-k2.7-code",
    upstreamKey: "kmodel",
    name: "Kimi-K2.7-Code · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: true,
    supportsEffort: false,
    input: ["text", "image"],
    cost: ZERO_COST,
    // Live catalog advertises 256K for this entry.
    contextWindow: 256000,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "Kimi-K2.7-Code (kmodel); 256K context.",
  },
  {
    id: "minimax-m2.7",
    upstreamKey: "mmodel",
    name: "MiniMax M2.7 · Qoder CN",
    api: "qoder-api",
    provider: "qoder-cn",
    baseUrl: getQoderBaseUrl("cn"),
    reasoning: false,
    supportsEffort: false,
    input: ["text"],
    cost: ZERO_COST,
    // Live CN catalog reports 200K; not confirmed at 1M.
    contextWindow: 200000,
    maxTokens: MAX_OUTPUT_TOKENS,
    description: "MiniMax M2.7 (mmodel); 200K context.",
  },
];

/** pi thinking levels in display order (matches the pi-ai SDK this build targets). */
const PI_THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Map Qoder's `thinking_config` to pi's `thinkingLevelMap` so the TUI exposes
 * the levels the upstream model actually supports.
 *
 * Qoder has two shapes:
 *   - effort-based: `thinking_config.enabled.efforts = { low, medium, xhigh, ... }`
 *     Each effort key is already a pi level name, so supported levels map to
 *     themselves and the rest are pinned to null (hidden in the picker).
 *     `xhigh`/`max` are only shown when the map carries them, otherwise the
 *     picker tops out at `high`.
 *   - toggle-based: `thinking_config.enabled` without `efforts` (only on/off).
 *     Every pi level is exposed and maps to "enabled" so a user picking any
 *     level turns thinking on; the exact effort sent upstream is decided at
 *     request time.
 * Returns undefined for models that do not support thinking, so pi falls back
 * to `reasoning: false`-style behavior (only `off`).
 */
function buildThinkingLevelMap(entry: QoderModelEntry): ThinkingLevelMap | undefined {
  const tc = entry.thinking_config;
  if (!tc) return undefined;
  const efforts = tc.enabled?.efforts;
  if (efforts && typeof efforts === "object") {
    const supported = new Set(Object.keys(efforts));
    // `off` (disable thinking) is selectable when the catalog advertises a
    // `disabled` option; otherwise pin it to null to hide it.
    const map: ThinkingLevelMap = { off: tc.disabled ? "disabled" : null };
    for (const level of PI_THINKING_LEVELS) {
      map[level] = supported.has(level) ? level : null;
    }
    return map;
  }
  // toggle-only (enabled/disabled, no efforts) — expose every level as "on".
  // `off` is selectable when the catalog advertises `disabled`.
  if (tc.enabled) {
    const map: ThinkingLevelMap = { off: tc.disabled ? "disabled" : null };
    for (const level of PI_THINKING_LEVELS) {
      map[level] = "enabled";
    }
    return map;
  }
  return undefined;
}

export function getCachedModels(mode: QoderMode): QoderModelDef[] {
  const data = readParsedModelCache(mode);
  if (data && Array.isArray(data.models)) {
    const models = data.models.map((model: QoderModelDef) => {
      const config = data.configs?.[model.id] as QoderModelEntry | undefined;
      const display = config?.display_name;
      if (mode === "cn") return applyCnModelIdentity(model, config, display);
      const staticModel = staticModels.find((seed) => seed.upstreamKey === model.id);
      if (display) return { ...model, id: toQoderModelId(display), name: display };
      if (staticModel) return { ...model, id: staticModel.id, name: staticModel.name };
      return model.name ? { ...model, id: toQoderModelId(model.name) } : model;
    });
    // Older releases injected `auto` without a corresponding service config.
    // Keep an explicitly enabled service model, but drop the legacy fallback.
    //
    // The catalog casing differs by writer (`auto` here, `Auto` from the
    // upstream package) and CN re-keys ids to lowercase, so detect the entry by
    // identity rather than by one exact key spelling.
    if (data.configs && typeof data.configs === "object" && !hasAutoCatalogEntry(data.configs, mode)) {
      return models.filter((model: QoderModelDef) => model.id.toLowerCase() !== "auto");
    }
    return models;
  }
  return mode === "cn" ? staticCnModels : staticModels;
}

/** Whether the stored catalog carries an explicit `auto` service config. */
function hasAutoCatalogEntry(configs: Record<string, unknown>, mode: QoderMode): boolean {
  return Object.values(configs).some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const config = entry as QoderModelEntry;
    if (config.key?.toLowerCase() === "auto") return true;
    return mode === "cn"
      ? toQoderCNModelInfo(config.key, config.display_name).id === "auto"
      : toQoderModelId(config.display_name) === "auto";
  });
}

/**
 * Re-key a cached CN model onto its friendly id.
 *
 * Caches written by the upstream package store the whitespace-stripped display
 * name (`Qwen3.8-Flash`); this fork stores the slug (`qwen3.8-flash`). Rewriting
 * the entry on read means either cache resolves to the id users configured,
 * without forcing a cache refresh.
 */
function applyCnModelIdentity(
  model: QoderModelDef,
  config: QoderModelEntry | undefined,
  display: string | undefined,
): QoderModelDef {
  const key = config?.key ?? model.upstreamKey ?? model.id;
  const info = toQoderCNModelInfo(key, display ?? model.name);
  return { ...model, id: info.id, name: info.name, upstreamKey: key };
}

export function getCachedModelConfig(modelId: string, mode: QoderMode): QoderModelEntry | null {
  const data = readParsedModelCache(mode);
  if (data) {
    const direct = data.configs?.[modelId] as QoderModelEntry | undefined;
    const matchesDirect =
      direct && (mode === "cn" ? isQoderCNModelId(direct, modelId) : toQoderModelId(direct.display_name) === modelId);
    if (matchesDirect) {
      return withMaxContextAsDefault(direct);
    }

    // Read old cache shapes without preserving their raw-key aliases.
    const legacyEntry = Object.values(data.configs || {}).find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        // CN accepts the slug, the raw upstream key, and the upstream id scheme.
        (mode === "cn"
          ? isQoderCNModelId(entry as QoderModelEntry, modelId)
          : toQoderModelId((entry as QoderModelEntry).display_name) === modelId),
    ) as QoderModelEntry | undefined;
    if (legacyEntry) {
      return withMaxContextAsDefault(legacyEntry);
    }
  }

  const staticModel = (mode === "cn" ? staticCnModels : staticModels).find((model) => model.id === modelId);
  if (staticModel) {
    return {
      key: staticModel.upstreamKey || modelId,
      is_reasoning: staticModel.reasoning,
      source: "system",
    };
  }

  // CN addresses models by either the friendly slug or the raw upstream key.
  // A cache miss must still resolve, or a model the user configured before an
  // upgrade stops working until the catalog cache is rewritten.
  if (mode === "cn") {
    const key = toQoderCNUpstreamKey(modelId);
    if (key) {
      const seed = staticCnModels.find((model) => model.upstreamKey === key);
      return {
        key,
        is_reasoning: seed?.reasoning ?? true,
        source: "system",
      };
    }
  }

  return null;
}

/** Resolve contextWindow from a catalog entry. Exported for tests. */
export function contextWindowFromCatalog(entry: QoderModelEntry): number {
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

/** Prefer the largest context option when Qoder exposes selectable contexts. */
function withMaxContextAsDefault(entry: QoderModelEntry): QoderModelEntry {
  const contextConfig = entry.context_config;
  if (!contextConfig || typeof contextConfig !== "object") return entry;

  const maxTokenCount = Math.max(
    ...Object.values(contextConfig).map((config) => (typeof config?.token_count === "number" ? config.token_count : 0)),
  );
  if (maxTokenCount <= 0) return entry;

  return {
    ...entry,
    context_config: Object.fromEntries(
      Object.entries(contextConfig).map(([name, config]) => [
        name,
        { ...config, is_default: config.token_count === maxTokenCount },
      ]),
    ),
  };
}

export function isCacheStale(mode: QoderMode): boolean {
  const data = readParsedModelCache(mode);
  if (!data || typeof data.updatedAt !== "number") return true;
  // Stale if older than 1 hour
  return Date.now() - data.updatedAt > 3600_000;
}

export async function updateQoderModelsCache(
  authToken: string,
  userID: string,
  name: string,
  email: string,
  mode: QoderMode,
): Promise<void> {
  const modelListURL = getQoderModelListURL(mode);
  try {
    const headers = buildAuthHeaders(null, modelListURL, {
      userID,
      authToken,
      name,
      email,
    });

    const response = await fetch(modelListURL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers,
      },
    });

    if (!response.ok) {
      return;
    }

    const resData = (await response.json()) as { chat?: QoderModelEntry[] };
    const chatModels = resData.chat || [];
    if (chatModels.length === 0) return;

    const newModels: QoderModelDef[] = [];
    const configs: Record<string, QoderModelEntry> = {};

    for (const entry of chatModels) {
      const key = entry.key;
      if (!key || !entry.enable || !entry.display_name) continue;

      const display = entry.display_name;
      // Prefer the largest selectable context option the catalog advertises
      // (e.g. 1M when 200K/400K/1M are offered). If none is advertised, use
      // DEFAULT_CONTEXT_WINDOW rather than the stale 180K `max_input_tokens`
      // floor. Do not seed from DEFAULT_CONTEXT_WINDOW before scanning
      // context_config: that would inflate models that only advertise 200K.
      const ctxLen = contextWindowFromCatalog(entry);
      const isVL = !!entry.is_vl;
      const isReasoning = !!entry.is_reasoning || !!entry.thinking_config;
      const supportsEffort = !!entry.thinking_config?.enabled?.efforts;
      const thinkingLevelMap = buildThinkingLevelMap(entry);
      // CN exposes the friendly slug (`qwen3.8-flash`); global exposes the
      // whitespace-stripped display name. The config is stored under every id
      // scheme the catalog ships, so a request can resolve the upstream key
      // whichever id pi hands back.
      const modelInfo =
        mode === "cn" ? toQoderCNModelInfo(key, display) : { id: toQoderModelId(display), name: display };

      configs[modelInfo.id] = entry;
      // CN keeps the raw upstream key as an extra lookup entry: the catalog ships
      // aliases (`qmodel_38max`/`qwen3.8-max`) and older caches stored raw keys
      // as the model id. Global deliberately rejects raw keys (they must not
      // become public model ids), so the alias is CN-only.
      if (mode === "cn" && modelInfo.id !== key) configs[key] = entry;

      // The CN catalog ships several keys for one model (`qmodel_38max` and
      // `qwen3.8-max`; `qfmodel`, `qwen3.8-flash` and `qwen3.6-flash`). All of
      // them map onto one friendly id, so emit each model once.
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
        maxTokens: MAX_OUTPUT_TOKENS,
      });
    }

    if (newModels.length === 0) return;

    const cacheData = {
      updatedAt: Date.now(),
      models: newModels,
      configs,
    };

    writeParsedModelCache(mode, cacheData);
  } catch {}
}
