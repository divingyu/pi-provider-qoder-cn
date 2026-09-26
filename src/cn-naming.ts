/**
 * Qoder CN model naming.
 *
 * Qoder's catalog identifies models by an opaque upstream key
 * (`qmodel_38max`, `qfmodel`, `qmodel_latest`, ...) and a human display name
 * (`Qwen3.8-Max`). Pi needs a stable model id, and this fork deliberately uses
 * a lowercase slug (`qwen3.8-max`) rather than the upstream package's
 * whitespace-stripped display name (`Qwen3.8-Max`).
 *
 * The slug scheme is not cosmetic: `settings.json` persists `enabledModels`
 * entries such as `qoder-cn/qwen3.8-flash`, and existing users' session files
 * reference those ids. Keeping the slug on upgrade is what makes this package a
 * drop-in replacement instead of a reconfiguration.
 *
 * Every mapping is keyed by the upstream key because the display name is not a
 * reliable identifier: the CN catalog has shipped `Qwen3.6-Flash` and
 * `Qwen3.8-Flash` under the same `qfmodel` key, and `Kimi-K2.6/2.7/2.8` under
 * `kmodel`. The key is stable; the display name is not.
 */

/** A pi-visible CN model: the id users type and the label the picker shows. */
export interface QoderCNModelInfo {
  id: string;
  name: string;
}

/**
 * Upstream key -> friendly pi model. This is the authoritative table for CN.
 *
 * `auto` is the smart-routing entry; `qmodel_38max` is Qwen 3.8-Max (the
 * catalog also ships a `qwen3.8-max` alias key, handled below).
 */
export const QODER_CN_FRIENDLY_MODELS: Readonly<Record<string, QoderCNModelInfo>> = Object.freeze({
  auto: { id: "auto", name: "Auto · Qoder CN" },
  "qoder-cn": { id: "auto", name: "Auto · Qoder CN" },
  qmodel_38max: { id: "qwen3.8-max", name: "Qwen 3.8-Max · Qoder CN" },
  qfmodel: { id: "qwen3.8-flash", name: "Qwen 3.8-Flash · Qoder CN" },
  qmodel_latest: { id: "qwen3.7-max", name: "Qwen 3.7-Max · Qoder CN" },
  qmodel: { id: "qwen3.7-plus", name: "Qwen 3.7-Plus · Qoder CN" },
  q37fmodel: { id: "qwen3.7-flash", name: "Qwen 3.7-Flash · Qoder CN" },
  dmodel: { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro · Qoder CN" },
  dfmodel: { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash · Qoder CN" },
  gmodel: { id: "glm-5.3", name: "GLM-5.3 · Qoder CN" },
  gfmodel: { id: "glm-5.3-flash", name: "GLM-5.3-Flash · Qoder CN" },
  gm51model: { id: "glm-5.2", name: "GLM 5.2 · Qoder CN" },
  kmodel_latest: { id: "kimi-k3", name: "Kimi-K3 · Qoder CN" },
  kmodel: { id: "kimi-k2.7-code", name: "Kimi-K2.7-Code · Qoder CN" },
  mmodel: { id: "minimax-m2.7", name: "MiniMax M2.7 · Qoder CN" },
});

/**
 * Aliases the CN catalog ships alongside an upstream key. Older releases
 * emitted these as the `models[].id`, and caches written by them still exist
 * on disk, so they must keep resolving.
 */
const CN_MODEL_KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
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
  "minimax-m3": "mmodel",
});

/** Turn a display name into a lowercase slug: `Qwen 3.8-Max` -> `qwen3.8-max`. */
export function slugifyQoderCNModel(displayName?: string): string {
  const slug = (displayName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "");
  return slug || "qodermodel";
}

/**
 * Human label for a CN model: insert spaces into a camel-cased display name and
 * suffix the region, so the picker reads `Qwen 3.8-Max · Qoder CN`.
 */
export function prettifyQoderCNModelName(displayName?: string): string {
  const pretty = (displayName || "Qoder CN Model")
    .replace(/Qwen(\d)/g, "Qwen $1")
    .replace(/Qwen([\d.]+)-/g, "Qwen $1 ")
    .replace(/DeepSeek\s*V(\d)-/g, "DeepSeek V$1 ")
    .replace(/\s+/g, " ")
    .trim();
  return pretty.includes("Qoder CN") ? pretty : `${pretty} · Qoder CN`;
}

/**
 * Map a catalog entry onto the pi-visible model.
 *
 * Prefers the curated table so a display-name change upstream cannot silently
 * rename the model in `settings.json`. Falls back to a slug of the display name
 * so a newly launched model still appears with a stable id.
 */
export function toQoderCNModelInfo(upstreamKey: string | undefined, displayName?: string): QoderCNModelInfo {
  const friendly = upstreamKey ? QODER_CN_FRIENDLY_MODELS[upstreamKey] : undefined;
  if (friendly) return friendly;
  return {
    id: slugifyQoderCNModel(displayName || upstreamKey),
    name: prettifyQoderCNModelName(displayName || upstreamKey),
  };
}

/**
 * Resolve a pi-visible CN model id back to the upstream key sent in requests.
 *
 * Accepts both schemes (slug and whitespace-stripped display name) plus the raw
 * key, because ids from caches written by either package version must keep
 * working.
 */
export function toQoderCNUpstreamKey(modelId: string | undefined): string {
  const id = modelId || "";
  const alias = CN_MODEL_KEY_ALIASES[id];
  if (alias) return alias;
  if (QODER_CN_FRIENDLY_MODELS[id]) return id;
  // Already an upstream key (e.g. `qfmodel`).
  if (Object.hasOwn(QODER_CN_FRIENDLY_MODELS, id)) return id;
  return id || "auto";
}

/**
 * Whether a cached catalog `configs` entry answers to `modelId`.
 *
 * Matches the curated slug, the raw upstream key, and the whitespace-stripped
 * display name the upstream package uses (`Qwen3.8-Flash`), so a cache or
 * `settings.json` written by either package resolves.
 */
export function isQoderCNModelId(entry: { key?: string; display_name?: string } | undefined, modelId: string): boolean {
  if (!entry) return false;
  const info = toQoderCNModelInfo(entry.key, entry.display_name);
  if (info.id === modelId) return true;
  if (entry.key === modelId) return true;
  // The upstream package exposes the display name with whitespace removed.
  const stripped = (entry.display_name || "").replace(/\s+/g, "");
  return stripped.toLowerCase() === modelId.toLowerCase();
}
