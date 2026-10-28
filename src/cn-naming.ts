/**
 * Qoder CN model naming.
 *
 * Qoder's catalog identifies entries by an upstream key (`qmodel_38max`,
 * `qfmodel`, `kmodel_latest`, ...) and a human display name (`Qwen3.8-Max`).
 *
 * ## The catalog key is a slot, the display name is the model
 *
 * Upstream reuses a key for whatever generation currently occupies that slot:
 * `kmodel_latest` has served Kimi-K2.6, K3 and K3.1-Pro, `qfmodel` has served
 * Qwen 3.6-Flash and 3.8-Flash, and `dfmodel` dropped its "V4" prefix. Treating
 * the key as identity is what once pinned a user's picker to `kimi-k3` while the
 * endpoint had already moved to Kimi-K3.1-Pro — the entry displayed a model it
 * was no longer talking to.
 *
 * So identity comes from the display name: pi-visible ids are slugs of it
 * (`Kimi-K3.1-Pro` -> `kimi-k3.1-pro`), and the catalog key is carried
 * separately as the upstream routing key. A model that disappears upstream
 * disappears from the picker, and a model that is upgraded upstream arrives
 * under a new id instead of silently changing behaviour behind an old one.
 *
 * ## What still keeps old ids alive
 *
 * `settings.json` persists `enabledModels` as `qoder-cn/<id>` and session files
 * reference the same ids. `LEGACY_CN_MODEL_IDS` therefore keeps retired slugs
 * routable and matchable — the upstream key they map to is still what requests
 * send — but retired entries are no longer advertised, so the picker only shows
 * what the catalog currently offers.
 */

/** A pi-visible CN model: the id users type and the label the picker shows. */
export interface QoderCNModelInfo {
  id: string;
  name: string;
}

/**
 * Retired pi ids, kept only so a `settings.json` or session written by an older
 * release still resolves. These are never advertised by the catalog.
 *
 * Each value is the upstream key that id was routed to; the catalog's current
 * occupant of that key answers the request, which is the same behaviour the id
 * had before it was retired.
 */
export const LEGACY_CN_MODEL_IDS: Readonly<Record<string, string>> = Object.freeze({
  "qwen3.6-flash": "qfmodel",
  "qwen3.6-plus": "qmodel",
  "qwen3.7-flash": "q37fmodel",
  "qwen3.7-max": "qmodel_latest",
  "glm-5.1": "gm51model",
  "glm-5.2": "gm51model",
  "kimi-k2.6": "kmodel",
  "kimi-k2.7": "kmodel",
  "kimi-k2.7-code": "kmodel",
  "kimi-k2.8-preview": "kmodel",
  "kimi-k3": "kmodel_latest",
  "minimax-m2.7": "mmodel",
  "minimax-m3": "mmodel",
});

/**
 * CN slugs that do not follow from their display name.
 *
 * Only `auto` qualifies: routing has no model name to slug, and every release
 * has called it `auto`, so the id is fixed by contract rather than derived.
 */
export const FIXED_CN_MODEL_IDS: Readonly<Record<string, QoderCNModelInfo>> = Object.freeze({
  auto: { id: "auto", name: "Auto · Qoder CN" },
});

/** Turn a display name into a lowercase slug: `Qwen 3.8-Max` -> `qwen3.8-max`. */
export function slugifyQoderCNModel(displayName?: string): string {
  const slug = (displayName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "")
    // `kimi-k3.1-pro` stays readable; collapse any run of separators.
    .replace(/-{2,}/g, "-");
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
    .replace(/DeepSeek([Vv]\d)-/g, "DeepSeek $1 ")
    .replace(/\s+/g, " ")
    .trim();
  return pretty.includes("Qoder CN") ? pretty : `${pretty} · Qoder CN`;
}

/**
 * Map a catalog entry onto the pi-visible model.
 *
 * The display name decides identity, so an upstream upgrade becomes a new model
 * id instead of a silent change behind an old one. `auto` is the one entry whose
 * id cannot come from a display name.
 */
export function toQoderCNModelInfo(upstreamKey: string | undefined, displayName?: string): QoderCNModelInfo {
  const fixed = upstreamKey ? FIXED_CN_MODEL_IDS[upstreamKey] : undefined;
  if (fixed) return fixed;
  return {
    id: slugifyQoderCNModel(displayName || upstreamKey),
    name: prettifyQoderCNModelName(displayName || upstreamKey),
  };
}

/**
 * Resolve a pi-visible CN model id back to the upstream key sent in requests.
 *
 * Accepts the display-name slug, a retired slug from an older release, and a raw
 * catalog key (which is what the cached `configs` map is keyed by). A current
 * slug cannot be mapped from the id alone — the catalog decides which key backs
 * it — so this returns the id unchanged and the catalog lookup answers first.
 */
export function toQoderCNUpstreamKey(modelId: string | undefined): string {
  const id = modelId || "";
  const legacy = LEGACY_CN_MODEL_IDS[id];
  if (legacy) return legacy;
  if (FIXED_CN_MODEL_IDS[id]) return id;
  // Raw catalog keys and unrecognised ids pass through; the caller's catalog
  // lookup is what turns a slug into a key.
  return id || "auto";
}

/**
 * Whether a cached catalog `configs` entry answers to `modelId`.
 *
 * Matches the current display-name slug, a retired slug whose upstream key is
 * the entry's key, and the raw catalog key itself.
 */
export function isQoderCNModelId(entry: { key?: string; display_name?: string } | undefined, modelId: string): boolean {
  if (!entry) return false;
  const info = toQoderCNModelInfo(entry.key, entry.display_name);
  if (info.id === modelId) return true;
  if (entry.key === modelId) return true;
  // A retired slug routed to this entry's key still resolves to it.
  const legacyKey = LEGACY_CN_MODEL_IDS[modelId];
  if (legacyKey !== undefined && legacyKey === entry.key) return true;
  // The upstream package exposes the display name with whitespace removed.
  const stripped = (entry.display_name || "").replace(/\s+/g, "");
  return stripped.toLowerCase() === modelId.toLowerCase();
}
