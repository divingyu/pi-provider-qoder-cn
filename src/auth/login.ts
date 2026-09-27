import crypto from "node:crypto";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthSelectOption } from "@earendil-works/pi-ai";
import { getMachineId } from "../cosy.js";
import {
  getQoderDeviceLoginURL,
  getQoderDevicePollURL,
  getQoderRegionConfig,
  getQoderUserInfoURL,
  type QoderMode,
} from "../region.js";
import { getQoderCNEndpoints, setQoderCNEndpoint } from "../vpc.js";
import { credentialsFromPat } from "./pat.js";

type PromptFn = (p: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;

function getPrompt(callbacks: OAuthLoginCallbacks): PromptFn {
  return (callbacks as unknown as { onPrompt: PromptFn }).onPrompt;
}

/**
 * pi renders `onSelect` as a real arrow-key list, but it is absent on older
 * hosts and in tests, so callers must be able to fall back to a text prompt.
 */
type SelectFn = (p: { message: string; options: OAuthSelectOption[] }) => Promise<string | undefined>;

function getSelect(callbacks: OAuthLoginCallbacks): SelectFn | undefined {
  const fn = (callbacks as unknown as { onSelect?: SelectFn }).onSelect;
  return typeof fn === "function" ? fn : undefined;
}

/** True when the error means the login was cancelled, not that the UI is unavailable. */
function isLoginCancellation(error: unknown, callbacks: OAuthLoginCallbacks): boolean {
  if (getSignal(callbacks)?.aborted) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("cancel");
}

function getProgress(callbacks: OAuthLoginCallbacks): ((msg: string) => void) | undefined {
  return (callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress;
}

function getSignal(callbacks: OAuthLoginCallbacks): AbortSignal | undefined {
  return (callbacks as unknown as { signal?: AbortSignal }).signal;
}

export function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function parseExpiresAt(s?: string, expiresInSeconds?: number): number {
  if (s) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    const ms = Number.parseInt(s, 10);
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  if (expiresInSeconds && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1000;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1000; // default 30 days
}

/**
 * Confirm which Qoder CN endpoint to log in against, before any token is
 * requested.
 *
 * Only the CN region has an enterprise gateway, and the enterprise host also
 * serves the PAT exchange — so picking the wrong one fails authentication in a
 * way that looks like a bad token. Asking first, defaulting to the personal
 * account, keeps a personal PAT from being sent to an enterprise gateway.
 */
async function confirmCnEndpoint(callbacks: OAuthLoginCallbacks, mode: QoderMode): Promise<void> {
  if (mode !== "cn") return;

  const current = getQoderCNEndpoints();
  // Environment variables outrank everything, including the choice made here:
  // naming them keeps a "personal" pick from silently reverting on restart.
  const envNames = ["QODER_VPC_ENDPOINT", "QODERCN_VPC_ENDPOINT"].filter((name) => process.env[name]);

  const personalId = "personal";
  const enterpriseId = "enterprise";

  const options: OAuthSelectOption[] = [
    { id: personalId, label: "Personal account — public gateway (qoder.com.cn)" },
    { id: enterpriseId, label: "Enterprise account — use a VPC endpoint" },
  ];

  let message = current.isDefault
    ? "Choose the Qoder CN endpoint to log in against (default: personal account)"
    : `Choose the Qoder CN endpoint to log in against (current: ${current.raw})`;
  if (envNames.length > 0) {
    message += `\n(current value comes from ${envNames.join(" / ")}; it still wins after a restart)`;
  }

  const choice = await askEndpointChoice(callbacks, message, options);

  if (choice === personalId) {
    // Pin the personal gateway so a stored enterprise value cannot resurface.
    setQoderCNEndpoint("");
    if (envNames.length > 0) {
      getProgress(callbacks)?.(
        `Personal gateway selected. However, ${envNames.join(" / ")} takes precedence and restores the enterprise endpoint after a restart; remove the variable, then log in again.`,
      );
    }
    return;
  }

  if (choice === enterpriseId) {
    const prompt = getPrompt(callbacks);
    const raw = await prompt({
      message: "Enterprise VPC endpoint (instance name or domain)",
      placeholder: "acme",
      allowEmpty: true,
    });
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    const value = raw?.trim();
    if (!value) return; // Keep whatever was already configured.
    setQoderCNEndpoint(value);
    return;
  }

  // Cancelled or unrecognised: leave the current endpoint untouched.
}

/** Ask via `onSelect` when available, degrading to a text prompt otherwise. */
async function askEndpointChoice(
  callbacks: OAuthLoginCallbacks,
  message: string,
  options: OAuthSelectOption[],
): Promise<string | undefined> {
  const select = getSelect(callbacks);
  if (select) {
    try {
      const picked = await select({ message, options });
      if (picked) return picked;
      return undefined;
    } catch (error) {
      // pi rejects the select with "Login cancelled" when the user presses Esc;
      // swallowing that would prompt a second time. Only degrade to the text
      // fallback for hosts that cannot render a list at all.
      if (isLoginCancellation(error, callbacks)) throw error;
    }
  }

  const prompt = getPrompt(callbacks);
  const lines = options.map((option, index) => `${index + 1}. ${option.label}`);
  const raw = await prompt({
    message: `${message}\n${lines.join("\n")}\nEnter a number (Enter = 1, personal account)`,
    placeholder: "1",
    allowEmpty: true,
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

export async function interactiveLogin(callbacks: OAuthLoginCallbacks, mode: QoderMode): Promise<OAuthCredentials> {
  const region = getQoderRegionConfig(mode);
  // pi drives this via its built-in LoginDialog, which wires onPrompt/onAuth/
  // onProgress to a focused input. We must use those callbacks directly rather
  // than opening our own ctx.ui.custom surface (which would steal focus and
  // leave onPrompt unable to receive keystrokes).
  //
  // The endpoint must be settled before the PAT is exchanged: the enterprise
  // gateway also serves the token exchange, so a PAT sent to the wrong host
  // fails in a way that looks like an invalid token.
  await confirmCnEndpoint(callbacks, mode);
  const prompt = getPrompt(callbacks);
  const pat = await prompt({
    message: !region.supportsBrowserLogin
      ? "Paste a Qoder CN Personal Access Token, or leave empty to cancel"
      : "Paste a Qoder Personal Access Token (pt-...), or leave empty for browser login",
    placeholder: "pt-...",
    allowEmpty: true,
  });
  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  if (pat?.trim()) {
    return patLogin(callbacks, pat.trim(), mode);
  }

  if (!region.supportsBrowserLogin) {
    throw new Error(
      `Qoder CN browser login is not supported here. Paste a Qoder CN PAT from ${region.patManageUrl} or set QODERCN_PERSONAL_ACCESS_TOKEN.`,
    );
  }

  if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
  return runDeviceFlow(callbacks);
}

/** Prompt for a PAT (if not provided) and exchange it for full credentials. */
async function patLogin(
  callbacks: OAuthLoginCallbacks,
  providedPat: string | undefined,
  mode: QoderMode,
): Promise<OAuthCredentials> {
  const region = getQoderRegionConfig(mode);
  let pat = providedPat;
  if (!pat) {
    const prompt = getPrompt(callbacks);
    const entered = await prompt({
      message: !region.supportsBrowserLogin
        ? "Paste your Qoder CN Personal Access Token"
        : "Paste your Qoder Personal Access Token (pt-...)",
      placeholder: "pt-...",
      allowEmpty: false,
    });
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    pat = entered?.trim();
  }
  if (!pat) {
    throw new Error("No Personal Access Token provided");
  }
  getProgress(callbacks)?.("Exchanging access token...");
  let creds: OAuthCredentials;
  try {
    creds = await credentialsFromPat(pat, mode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // The registry reports a truncated or wrong-instance PAT as a bare 400,
    // which reads like a server fault; point at the two common causes.
    throw new Error(
      `${detail}. Check that the PAT is copied in full (64 characters for pt-... tokens) and was issued for the selected endpoint.`,
    );
  }
  getProgress(callbacks)?.("Login successful!");
  return creds;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
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

async function runDeviceFlow(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const nonce = crypto.randomUUID();
  const machineID = getMachineId();

  const verificationURI = getQoderDeviceLoginURL(codeChallenge, machineID, nonce);

  getProgress(callbacks)?.("Please complete login in your browser...");

  (callbacks as unknown as { onAuth: (info: { url: string; instructions: string }) => void }).onAuth({
    url: verificationURI,
    instructions: "Click to sign in with your Qoder account in the browser.",
  });

  const pollURL = getQoderDevicePollURL(nonce, codeVerifier);
  const pollInterval = 2000;
  const maxAttempts = 90; // 3 minutes

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (getSignal(callbacks)?.aborted) throw new Error("Login cancelled");
    await abortableDelay(pollInterval, getSignal(callbacks));

    try {
      const response = await fetch(pollURL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "pi-provider-qoder",
        },
        signal: getSignal(callbacks),
      });

      if (response.status === 202 || response.status === 404) {
        // Pending
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Device token poll failed: ${response.status} ${response.statusText}. Response: ${errText}`);
      }

      const tokenData = (await response.json()) as {
        token: string;
        user_id: string;
        refresh_token: string;
        expires_at?: string;
        expires_in?: number;
      };

      if (!tokenData.token) {
        throw new Error("Device token poll returned empty access token");
      }

      const expireMs = parseExpiresAt(tokenData.expires_at, tokenData.expires_in);

      // Fetch user info (best effort)
      getProgress(callbacks)?.("Fetching user profile...");
      let email = "";
      let name = "";
      try {
        const userinfoRes = await fetch(getQoderUserInfoURL("global"), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenData.token}`,
            Accept: "application/json",
            "User-Agent": "pi-provider-qoder",
          },
        });
        if (userinfoRes.ok) {
          const userinfo = (await userinfoRes.json()) as {
            email?: string;
            name?: string;
            username?: string;
          };
          email = userinfo.email || "";
          name = userinfo.name || userinfo.username || "";
        }
      } catch {}

      getProgress(callbacks)?.("Login successful!");

      return {
        refresh: `${tokenData.refresh_token}|${tokenData.user_id}|${machineID}`,
        access: tokenData.token,
        expires: expireMs - 5 * 60 * 1000, // 5 min buffer
        userID: tokenData.user_id,
        email,
        name,
        machineID,
      } as OAuthCredentials;
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err.name === "AbortError" || getSignal(callbacks)?.aborted) {
        throw new Error("Login cancelled");
      }
      throw e;
    }
  }

  throw new Error("Authorization timed out");
}
