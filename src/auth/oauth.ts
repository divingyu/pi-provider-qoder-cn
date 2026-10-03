import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { updateQoderModelsCache } from "../catalog.js";
import { getMachineId } from "../cosy.js";
import { getQoderDeviceRefreshURL, getQoderRefreshURL, getQoderRegionConfig, type QoderMode } from "../region.js";
import { resolveTokenExpiryMs } from "./expiry.js";
import { interactiveLogin } from "./login.js";
import { credentialsFromPat, decodePatRefresh, fetchUserInfo, isPatRefresh } from "./pat.js";

export interface QoderCredentials extends OAuthCredentials {
  userID: string;
  email: string;
  name: string;
  machineID: string;
}

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
    // Atomic publish via tmp + rename, but Windows rename can transiently fail
    // (EPERM/EBUSY from AV or indexers). A lost write here means a freshly
    // rotated one-shot refresh chain is dead on disk and the next refresh
    // fails -> forced re-login, so retry, fall back to a direct write, and
    // always clean up the temp file.
    const tmp = `${authPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
    let published = false;
    for (let attempt = 0; attempt < 3 && !published; attempt++) {
      try {
        renameSync(tmp, authPath);
        published = true;
      } catch (err) {
        if (attempt === 2) {
          console.error(`[pi-provider-qoder] rename failed for ${authPath}, falling back to direct write:`, err);
          writeFileSync(authPath, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
          published = true;
        } else {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
        }
      }
    }
    rmSync(tmp, { force: true });
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
  saveCredentialsToAuthFile(providerID, credentials);

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
  // Only write back when the disk token IS the token being identified and the
  // identity actually resolved. A concurrent request holding a superseded
  // access token must not overwrite a fresher on-disk credential with
  // placeholders (dead access + "qoder-user" uid recreates the 105 loop).
  if (stored?.refresh && info.userID && (!stored.access || stored.access === accessToken)) {
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
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  const providerID = getQoderRegionConfig(mode).providerID;
  const existing = inFlightRefreshes.get(providerID);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await executeRefreshForMode(credentials, mode, signal);
    } finally {
      inFlightRefreshes.delete(providerID);
    }
  })();

  inFlightRefreshes.set(providerID, promise);
  return promise;
}

async function executeRefreshForMode(
  credentials: OAuthCredentials,
  mode: QoderMode,
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  const region = getQoderRegionConfig(mode);
  const providerID = region.providerID;

  // PAT-based credentials: re-exchange the stored PAT for a fresh job token.
  if (isPatRefresh(credentials.refresh)) {
    const { pat } = decodePatRefresh(credentials.refresh);
    if (pat) {
      try {
        const refreshed = await credentialsFromPat(pat, mode);
        const qCreds = refreshed as QoderCredentials;
        // Persist like the token-refresh branch does: pi's proactive refresh
        // path may not write back on every host, and a stale auth.json access
        // token makes the claim/usage fallbacks read a dead value.
        saveCredentialsToAuthFile(providerID, refreshed);
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
  if (!refreshToken) {
    // Entries written by <=0.2.10 could carry an empty placeholder chain. A
    // refresh POST with an empty token always 400s; say what actually helps.
    throw new Error(
      `${region.loginName} credential has no stored refresh chain (written by an older version). Run /login ${providerID} once.`,
    );
  }
  const userID = parts[1] || "";
  const machineID = parts[2] || getMachineId();
  const prev = credentials as Partial<QoderCredentials>;
  const prevName = prev.name || "";
  const prevEmail = prev.email || "";

  // Route by the stored chain's prefix. A `pat|` chain never reaches here — the
  // PAT branch above short-circuits to re-exchange — so this is the OAuth path:
  // "drt-" is the device-flow refresh token (deviceToken/refresh), anything
  // else is a job token's chain (jobToken/refresh).
  const isDevice = refreshToken.startsWith("drt-");
  const refreshURL = isDevice ? getQoderDeviceRefreshURL(mode) : getQoderRefreshURL(mode);
  const body = JSON.stringify({ refresh_token: refreshToken });

  // The 105 self-heal refreshes *after* the server already rejected this
  // access token, so an Authorization header built from it may itself be
  // expired. Which contract deviceToken/refresh enforces is undocumented and
  // unrecorded by fixtures, and a forced re-login is not an acceptable answer:
  // probe with Bearer first (the proactive path refreshes while valid), and on
  // 401/403 retry without it.
  const failures: string[] = [];
  for (const withAuth of [true, false]) {
    let response: Response;
    try {
      response = await fetch(refreshURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(withAuth ? { Authorization: `Bearer ${credentials.access}` } : {}),
          Accept: "application/json",
          "User-Agent": "pi-provider-qoder-cn",
        },
        body,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
      break;
    }

    if (response.ok) {
      const data = (await response.json()) as {
        token?: string;
        access_token?: string;
        refresh_token?: string;
        expires_at?: string;
        expires_in?: number;
      };

      // Validate before persisting. An unvalidated `access: undefined` would
      // land on disk with a future `expires`: pi would believe the credential
      // is fresh forever (never re-refreshing), getApiKey would return
      // undefined, and pi's whole-file auth validation would reject auth.json
      // for *every* provider in it.
      const newAccess = typeof data.token === "string" && data.token ? data.token : data.access_token;
      if (typeof newAccess !== "string" || !newAccess) {
        throw new Error("token refresh response carried no access token");
      }
      // If the server rotated the refresh token, adopt it; otherwise keep current.
      const newRefresh = data.refresh_token || refreshToken;
      const expireMs = resolveTokenExpiryMs(data.expires_at, data.expires_in);

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
    failures.push(`${response.status} ${response.statusText}: ${errText.slice(0, 120)}`);
    // Only an auth rejection justifies dropping the Bearer and retrying;
    // other statuses will not improve with a second request shape.
    if ((response.status !== 401 && response.status !== 403) || !withAuth) break;
  }

  // No masking (see above): surface the real failure instead of pretending the
  // credentials are still fresh for another hour.
  throw new Error(`${region.loginName} token refresh failed (${failures.join(" | ")}). Run /login ${providerID}.`);
}
