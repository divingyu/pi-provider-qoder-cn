import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { updateQoderModelsCache } from "../catalog.js";
import { getMachineId } from "../cosy.js";
import { getQoderDeviceRefreshURL, getQoderRefreshURL, getQoderRegionConfig, type QoderMode } from "../region.js";
import { interactiveLogin } from "./login.js";
import { credentialsFromPat, decodePatRefresh, fetchUserInfo, isPatRefresh } from "./pat.js";

export interface QoderCredentials extends OAuthCredentials {
  userID: string;
  email: string;
  name: string;
  machineID: string;
}

/**
 * `AuthStorage` is not part of every pi-coding-agent release's public exports,
 * so it is read off the module namespace instead of imported by name: a missing
 * export must degrade to the auth-file fallback below, not break the build.
 */
const AuthStorage = (
  PiCodingAgent as unknown as {
    AuthStorage?: { create?: () => { set: (providerID: string, credentials: unknown) => void } };
  }
).AuthStorage;

const identityCache = new Map<string, QoderCredentials>();

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getAuthFilePath(): string {
  return join(getHomeDir(), ".pi", "agent", "auth.json");
}

/** Process-memory cache of auth.json; invalidated on save or when mtime changes. */
let authFileMem: { path: string; data: Record<string, unknown>; mtimeMs: number } | null | undefined;

/** Clear process-memory auth caches (used by tests that mutate auth.json). */
export function clearQoderAuthMemCache(): void {
  authFileMem = undefined;
  identityCache.clear();
}

function readAuthFileCached(): Record<string, unknown> | null {
  const authPath = getAuthFilePath();
  if (!existsSync(authPath)) {
    authFileMem = null;
    return null;
  }
  try {
    const stat = statSync(authPath);
    if (authFileMem && authFileMem.path === authPath && authFileMem.mtimeMs === stat.mtimeMs) {
      return authFileMem.data;
    }
    const data = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>;
    authFileMem = { path: authPath, data, mtimeMs: stat.mtimeMs };
    return data;
  } catch {
    authFileMem = null;
    return null;
  }
}

/** Return the PAT exposed through the environment for a provider mode. */
export function getQoderPatForMode(mode: QoderMode): string {
  for (const envName of getQoderRegionConfig(mode).patEnvNames) {
    const value = process.env[envName];
    if (value) return value;
  }
  return "";
}

export function saveCredentialsToAuthFile(providerID: string, credentials: OAuthCredentials): void {
  try {
    const authPath = getAuthFilePath();
    const dir = dirname(authPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    // Re-read from disk right before writing: another extension may have added
    // a provider between the cached read and now, and writeFileSync replaces
    // the whole file.
    let auth: Record<string, unknown>;
    try {
      auth = (JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>) ?? {};
    } catch {
      const cached = readAuthFileCached();
      auth = cached ? { ...cached } : {};
    }
    auth[providerID] = { type: "oauth", ...credentials };
    const tmp = `${authPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, authPath);
    authFileMem = { path: authPath, data: auth, mtimeMs: statSync(authPath).mtimeMs };
    const q = credentials as QoderCredentials;
    if (q.access && q.userID) {
      identityCache.set(`${providerID}:${q.access}`, q);
    }
  } catch (err) {
    console.error(`[pi-provider-qoder] Failed to write auth storage for ${providerID}:`, err);
  }
}

/** Exchange an environment PAT before pi resolves its initial model. */
export async function autoLoginQoderFromEnvironment(providerID: string, mode: QoderMode): Promise<void> {
  const pat = getQoderPatForMode(mode);
  if (!pat) return;

  // An explicitly supplied PAT is authoritative. The auth file only stores
  // the exchanged job token, so it cannot tell us whether the environment
  // token changed. Re-exchange it on startup to avoid silently using an old
  // account's credentials.
  const credentials = await credentialsFromPat(pat, mode);

  if (typeof AuthStorage?.create === "function") {
    try {
      const authStorage = AuthStorage.create();
      authStorage.set(providerID, { type: "oauth", ...credentials });
    } catch {
      saveCredentialsToAuthFile(providerID, credentials);
    }
  } else {
    saveCredentialsToAuthFile(providerID, credentials);
  }

  const qCreds = credentials as QoderCredentials;
  // Wait for the model cache before the provider is registered. This matters
  // for `pi --list-models`, which can exit before background work completes.
  await updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode);
}

/**
 * Read the Qoder identity (userID/email/name/machineID) from pi's own auth
 * store. pi persists the full OAuthCredentials there on login/refresh and keeps
 * it up to date, so there is no need to maintain a separate credentials cache.
 *
 * Note: the auth.json path/shape is a pi internal convention, not a public API.
 * This is best-effort and falls back to null so callers can use placeholders.
 */
export function getCachedCredentials(_accessToken: string, providerID = "qoder"): QoderCredentials | null {
  const auth = readAuthFileCached();
  if (!auth) return null;
  const creds = (auth[providerID] || (providerID === "qoder" ? auth.qoder : null)) as QoderCredentials | null;
  if (creds?.userID || creds?.access) {
    if (creds.access && creds.userID) {
      identityCache.set(`${providerID}:${creds.access}`, creds);
    }
    return creds;
  }
  return null;
}

/**
 * Resolve the Qoder identity (userID/email/name/machineID) for a chat request.
 * OMP (17.x) persists login credentials in its own agent.db, not in
 * ~/.pi/agent/auth.json, so the provider-side cache is frequently empty and the
 * COSY payload would fall back to uid "qoder-user" -> Qoder CN rejects it with
 * "Login expired" (105). Fetch the identity from the job token when the cache
 * misses (in-memory cached), and persist it so later requests skip the fetch.
 */
export async function resolveQoderIdentity(
  accessToken: string,
  providerID: string,
  mode: QoderMode,
): Promise<QoderCredentials> {
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
  // Preserve the stored refresh chain: this path runs when auth.json holds a
  // token without identity fields, and persisting placeholder refresh/expires
  // here would destroy the PAT entry that keeps daily re-logins unnecessary.
  const stored = readAuthFileCached()?.[providerID] as QoderCredentials | undefined;
  const creds: QoderCredentials = {
    access: accessToken,
    userID: info.userID || "qoder-user",
    email: info.email || region.userEmailFallback,
    name: info.name || region.userNameFallback,
    machineID,
    refresh: stored?.refresh || "",
    expires: stored?.expires || 0,
  };
  identityCache.set(cacheKey, creds);
  if (stored?.refresh) {
    saveCredentialsToAuthFile(providerID, creds);
  }
  return creds;
}

export async function loginQoderForMode(callbacks: OAuthLoginCallbacks, mode: QoderMode): Promise<OAuthCredentials> {
  const providerID = getQoderRegionConfig(mode).providerID;
  // 1. Try environment variables first (PAT). A PAT (pt-...) must be exchanged
  //    for a short-lived job token before it can be used — credentialsFromPat
  //    handles the exchange + identity resolution.
  const pat = getQoderPatForMode(mode);
  if (pat) {
    try {
      const creds = await credentialsFromPat(pat, mode);
      const qCreds = creds as QoderCredentials;
      // Persist the resolved identity locally so chat requests can resolve the real uid.
      // Cache models in background
      updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {});
      // Persist the resolved identity locally. OMP (17.x) stores login
      // credentials in its own agent.db, not in ~/.pi/agent/auth.json, so
      // without this the chat COSY payload would fall back to uid "qoder-user"
      // and Qoder CN rejects it with "Login expired" (105).
      saveCredentialsToAuthFile(providerID, creds);
      return creds;
    } catch {
      // Fall through to interactive login if PAT exchange fails.
    }
  }

  // 2. Interactive login (CN only supports PAT prompt here; global supports device flow fallback)
  const creds = await interactiveLogin(callbacks, mode);

  // Cache models in background.
  try {
    const qCreds = creds as QoderCredentials;
    updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {});
  } catch {}

  // Persist the resolved identity locally (see note above).
  saveCredentialsToAuthFile(providerID, creds);
  return creds;
}

/** In-flight refresh single-flight map to merge concurrent refresh requests per provider. */
const inFlightRefreshes = new Map<string, Promise<OAuthCredentials>>();

export async function refreshQoderTokenForMode(
  credentials: OAuthCredentials,
  mode: QoderMode,
): Promise<OAuthCredentials> {
  const providerID = getQoderRegionConfig(mode).providerID;
  const existing = inFlightRefreshes.get(providerID);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await executeRefreshForMode(credentials, mode);
    } finally {
      inFlightRefreshes.delete(providerID);
    }
  })();

  inFlightRefreshes.set(providerID, promise);
  return promise;
}

async function executeRefreshForMode(credentials: OAuthCredentials, mode: QoderMode): Promise<OAuthCredentials> {
  const region = getQoderRegionConfig(mode);
  const providerID = region.providerID;

  // PAT-based credentials: re-exchange the stored PAT for a fresh job token.
  if (isPatRefresh(credentials.refresh)) {
    const { pat } = decodePatRefresh(credentials.refresh);
    if (pat) {
      try {
        const refreshed = await credentialsFromPat(pat, mode);
        const qCreds = refreshed as QoderCredentials;
        updateQoderModelsCache(qCreds.access, qCreds.userID, qCreds.name, qCreds.email, mode).catch(() => {});
        return refreshed;
      } catch (error) {
        // No masking: a silently extended expiry keeps requests failing with
        // error 105 while pi believes the credentials are fresh.
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${region.loginName} credential refresh failed (PAT re-exchange): ${detail}. If this persists, the PAT may be revoked — run /login ${providerID}.`,
        );
      }
    }
    throw new Error(
      `${region.loginName} credential refresh failed: the stored refresh chain carries no PAT. Run /login ${providerID}.`,
    );
  }

  const parts = credentials.refresh.split("|");
  const refreshToken = parts[0] || "";
  const userID = parts[1] || "";
  const machineID = parts[2] || getMachineId();
  const prev = credentials as Partial<QoderCredentials>;
  const prevName = prev.name || "";
  const prevEmail = prev.email || "";

  // Route drt- (Device Refresh Token from Browser OAuth) to /deviceToken/refresh;
  // Route jrt- (Job Refresh Token) or others to /jobToken/refresh.
  const isDevice = refreshToken.startsWith("drt-");
  const refreshURL = isDevice ? getQoderDeviceRefreshURL(mode) : getQoderRefreshURL(mode);
  let lastError = "unknown error";
  try {
    const response = await fetch(refreshURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.access}`,
        Accept: "application/json",
        "User-Agent": "pi-provider-qoder-cn",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        token: string;
        refresh_token?: string;
        expires_at?: string;
        expires_in?: number;
      };

      const newAccess = data.token;
      // If server rotated the refresh token, adopt it; otherwise keep current refreshToken.
      const newRefresh = data.refresh_token || refreshToken;

      let expireMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (data.expires_at) {
        const parsed = Date.parse(data.expires_at);
        if (!Number.isNaN(parsed)) expireMs = parsed;
      } else if (data.expires_in) {
        // Ambiguous unit; the official CLI applies the same 24h threshold.
        expireMs = Date.now() + (data.expires_in > 86_400 ? data.expires_in : data.expires_in * 1000);
      }

      const refreshed = {
        ...credentials,
        refresh: `${newRefresh}|${userID}|${machineID}`,
        access: newAccess,
        expires: expireMs - 5 * 60 * 1000,
        userID,
        email: prevEmail,
        name: prevName,
        machineID,
      };

      saveCredentialsToAuthFile(providerID, refreshed);
      updateQoderModelsCache(newAccess, userID, prevName, prevEmail, mode).catch(() => {});
      return refreshed;
    }
    const errText = await response.text();
    lastError = `HTTP ${response.status} ${response.statusText}: ${errText.slice(0, 200)}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  // No masking (see above): surface the real failure instead of pretending the
  // credentials are still fresh for another hour.
  throw new Error(`${region.loginName} token refresh failed (${lastError}). Run /login ${providerID}.`);
}
