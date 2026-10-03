import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import {
  autoLoginQoderFromEnvironment,
  getCachedCredentials,
  loginQoderForMode,
  refreshQoderTokenForMode,
} from "./auth/oauth.js";
import { fetchQoderUsageForMode } from "./auth/usage.js";
import { getCachedModels, isCacheStale, staticCnModels, staticModels, updateQoderModelsCache } from "./catalog.js";
import { runClaimCommand } from "./commands/claim.js";
import { runUsageCommand } from "./commands/usage.js";
import { streamQoder } from "./protocol/stream.js";
import { getQoderBaseUrl, getQoderRegionConfig, QODER_PROVIDER_MODES, type QoderMode } from "./region.js";

// pi supports a `fetchUsage` hook on the oauth config at runtime, but it is not
// part of the published ProviderConfig type. Declare the extension locally.
type OAuthConfigWithUsage = NonNullable<ProviderConfig["oauth"]> & {
  fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
};

const QODER_API = "qoder-api" as Api;

async function registerQoderApi(): Promise<void> {
  try {
    const compat = await import("@earendil-works/pi-ai/compat");
    const register = (compat as Record<string, unknown>).registerApiProvider;
    if (typeof register !== "function") return; // OMP / hosts without the export
    (register as (config: unknown, source: string) => void)(
      { api: QODER_API, stream: streamQoder, streamSimple: streamQoder },
      "provider:qoder",
    );
  } catch {
    // Host has no compat registry; registerProvider(streamSimple) is enough.
  }
}

function modelsForProvider(mode: QoderMode, providerID: string): Model<Api>[] {
  const cached = getCachedModels(mode);
  const modelsToUse = cached.length > 0 ? cached : mode === "cn" ? staticCnModels : staticModels;

  return modelsToUse.map((m) => ({
    ...m,
    provider: providerID,
    baseUrl: getQoderBaseUrl(mode),
  })) as unknown as Model<Api>[];
}

function createQoderOAuth(mode: QoderMode): OAuthConfigWithUsage {
  const region = getQoderRegionConfig(mode);
  return {
    name: region.loginName,
    login: (callbacks) => loginQoderForMode(callbacks, mode),
    refreshToken: (credentials, signal?: AbortSignal) => refreshQoderTokenForMode(credentials, mode, signal),
    getApiKey: (cred: OAuthCredentials) => cred.access,
    // NOTE: no `modifyModels` hook on purpose. OMP (Bun) does a whole-catalog
    // structuredClone before invoking it, and its bundled catalog contains a
    // model with a non-cloneable property -> "The object can not be cloned."
    // removes qoder from `omp models`. Models are supplied at registration
    // via `modelsForProvider` and refreshed by the startup/session cache hooks.
    fetchUsage: (credentials) => fetchQoderUsageForMode(credentials, mode),
  };
}

function registerQoderProvider(pi: ExtensionAPI, mode: QoderMode): void {
  const providerID = getQoderRegionConfig(mode).providerID;
  const oauth = createQoderOAuth(mode);
  pi.registerProvider(providerID, {
    baseUrl: getQoderBaseUrl(mode),
    api: QODER_API,
    models: modelsForProvider(mode, providerID) as unknown as ProviderConfig["models"],
    oauth: oauth as ProviderConfig["oauth"],
    // pi-coding-agent resolves its own nested @earendil-works/pi-ai copy, so the
    // structurally identical Model/Context types are nominally distinct here.
    streamSimple: streamQoder as unknown as ProviderConfig["streamSimple"],
  });
}

async function refreshModelsAtStartup(mode: QoderMode): Promise<void> {
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
    mode,
  );
}

export default async function (pi: ExtensionAPI) {
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

  // Refresh the models cache once per session at startup if it is missing or
  // stale (>1h old), rather than on every message in the stream hot path.
  // Login/refresh are the other rebuild triggers; this covers the case where
  // the cache was deleted while the token is still valid.
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
        // Best-effort: fall back to the existing cache / static models.
      }
    }
  });

  for (const mode of QODER_PROVIDER_MODES) registerQoderProvider(pi, mode);

  registerCommands(pi);
}

/**
 * Register the slash commands this fork adds on top of the upstream provider.
 *
 * Pi's `registerCommand` takes `{ handler, description }` (not a bare
 * function), and the handler signature is `(args, ctx) => Promise<void>`.
 */
function registerCommands(pi: ExtensionAPI): void {
  // CN commands
  pi.registerCommand("qoder-cn.usage", {
    description: "Show Qoder CN quota: plan + add-on credits, used/limit and reset (append 'json' for the raw payload)",
    handler: async (args: string, ctx) => {
      await runUsageCommand("cn", args, ctx);
    },
  });

  pi.registerCommand("qoder-cn.claim", {
    description: "Claim Qoder CN daily 100 free Credits reward (resets daily at 10:00 UTC+8)",
    handler: async (args: string, ctx) => {
      await runClaimCommand("cn", args, ctx);
    },
  });

  // Global commands
  pi.registerCommand("qoder.usage", {
    description: "Show Qoder Global quota: plan + add-on credits and check-in status (append 'json' for raw payload)",
    handler: async (args: string, ctx) => {
      await runUsageCommand("global", args, ctx);
    },
  });

  pi.registerCommand("qoder.claim", {
    description: "Claim Qoder Global daily 100 free Credits reward (resets daily at 10:00 UTC+8)",
    handler: async (args: string, ctx) => {
      await runClaimCommand("global", args, ctx);
    },
  });
}
