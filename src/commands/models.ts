/**
 * `/qoder-cn.models` — force a catalog refresh and report what changed.
 *
 * Qoder serves its model list from `/algo/api/v2/model/list`, and the extension
 * already refreshes it at startup when the cache is older than an hour. That is
 * enough for a daily session and not enough for anyone watching a launch: the
 * window between "upstream added a model" and "it appears in `/model`" was up to
 * an hour plus a restart, with nothing to trigger it by hand.
 *
 * This command closes that gap. It refreshes unconditionally, re-registers the
 * provider so the new list is live in the running session, and reports the diff
 * — because "refreshed" alone does not tell a user whether Kimi-K3 turned into
 * Kimi-K3.1-Pro, and a silent rename is exactly the failure that made the picker
 * disagree with the endpoint.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  clearQoderModelsMemCache,
  getCachedModels,
  type QoderCatalogDiff,
  updateQoderModelsCache,
} from "../catalog.js";
import { getQoderRegionConfig, type QoderMode } from "../region.js";

/** Render the diff as the lines the command prints. */
export function formatCatalogDiff(diff: QoderCatalogDiff, mode: QoderMode, color = false): string[] {
  const region = getQoderRegionConfig(mode);
  const paint = (text: string, code: string) => (color ? `${code}${text}\x1b[0m` : text);
  const lines = [`${region.usageTitle} models · ${diff.total} offered by the catalog`];

  if (diff.added.length > 0) {
    lines.push("", paint(`New (${diff.added.length})`, "\x1b[32m"));
    for (const model of diff.added) lines.push(`  + ${model.id}  ${model.name}`);
  }
  if (diff.renamed.length > 0) {
    lines.push("", paint(`Renamed upstream (${diff.renamed.length})`, "\x1b[33m"));
    for (const model of diff.renamed) lines.push(`  ~ ${model.id}  ${model.from} -> ${model.to}`);
  }
  if (diff.removed.length > 0) {
    lines.push("", paint(`Gone (${diff.removed.length})`, "\x1b[31m"));
    for (const model of diff.removed) lines.push(`  - ${model.id}  ${model.name}`);
  }
  if (diff.added.length === 0 && diff.renamed.length === 0 && diff.removed.length === 0) {
    lines.push("", "No change since the last refresh.");
  }
  lines.push("", `Provider list refreshed in this session; /model now shows ${diff.total} entries.`);
  return lines;
}

/**
 * Refresh the catalog for one region.
 *
 * `refreshProvider` re-registers the pi provider so the running session picks the
 * new list up. It is optional so the command can be exercised without a host.
 */
export async function refreshCatalog(
  mode: QoderMode,
  accessToken: string,
  identity: { userID?: string; name?: string; email?: string },
  refreshProvider?: () => void,
): Promise<QoderCatalogDiff | null> {
  const region = getQoderRegionConfig(mode);
  // A refresh must not read the process-memory copy: the whole point is to
  // replace it with what the catalog says now.
  clearQoderModelsMemCache();
  const diff = await updateQoderModelsCache(
    accessToken,
    identity.userID || "qoder-user",
    identity.name || region.userNameFallback,
    identity.email || region.userEmailFallback,
    mode,
  );
  if (diff) {
    clearQoderModelsMemCache();
    refreshProvider?.();
  }
  return diff;
}

export async function runModelsCommand(
  mode: QoderMode,
  args: string,
  ctx?: ExtensionCommandContext,
  refreshProvider?: () => void,
): Promise<void> {
  const region = getQoderRegionConfig(mode);
  const providerID = region.providerID;
  const target = (args || "").trim().toLowerCase();
  const plain = target === "plain";
  const wantsList = target === "list";

  try {
    const accessToken = await ctx?.modelRegistry?.getApiKeyForProvider(providerID);
    if (!accessToken) {
      ctx?.ui?.notify(`No ${providerID} credentials. Run /login ${providerID} first.`, "warning");
      return;
    }

    if (wantsList) {
      // Show the cache as-is: useful when the network is unavailable or when the
      // question is "what did pi actually load", not "what does upstream say".
      const models = getCachedModels(mode);
      ctx?.ui?.notify(
        [`${region.usageTitle} models`, ...models.map((model) => `  ${model.id}  ${model.name}`)].join("\n"),
      );
      return;
    }

    const diff = await refreshCatalog(mode, accessToken, {}, refreshProvider);

    if (!diff) {
      ctx?.ui?.notify(
        `Could not refresh the ${providerID} model catalog (network, credentials, or an unexpected payload). The existing list is unchanged.`,
        "warning",
      );
      return;
    }

    ctx?.ui?.notify(formatCatalogDiff(diff, mode, !plain).join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx?.ui?.notify(`Model refresh failed: ${message}`, "error");
  }
}
