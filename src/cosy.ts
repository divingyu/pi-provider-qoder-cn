import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const qoderRSAPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

// COSY client identity. The gateway trims the model catalog by client identity:
// a CLI identity (clienttype "5") never receives the `app`-group models that the
// desktop picker shows (e.g. the limited-time free HungerG / `hmodel`), and a
// Cosy-Version below 1.1.70 also drops the Fast tier. Measured 2026-11-24 against
// the live CN gateway: clienttype=qoderapp + Cosy-Version 1.1.71 returns chat 14 +
// app 15 including hmodel and fast; the old "5"/1.1.38 identity returned 13/13
// with neither.
/** Lowest Cosy-Version that includes the Fast tier and the app-only catalog. */
export const QODER_GATEWAY_COSY_VERSION = "1.1.71";
export const QODER_OPENAPI_COSY_VERSION = "1.0.1";
/** Desktop-app client type: the identity Qoder CN's own client reports. */
export const QODER_CLIENT_TYPE = "qoderapp";
/** Legacy CLI client type, kept for callers that must still present as the CLI. */
export const QODER_CLI_CLIENT_TYPE = "5";

/** The identity one signed request presents to the gateway. */
export interface CosyIdentity {
  clientType: string;
  cosyVersion: string;
  ideVersion: string;
}

/**
 * Version of the locally installed Qoder desktop client, or "" when none.
 *
 * The desktop app snapshots its own state (including its version) to
 * `~/.qoder-cn/.qoder-app-status.json` and `~/.qoder/.qoder-app-status.json`.
 * Reading it keeps `ideVersion` truthful as the client auto-updates; the gateway
 * also accepts an empty string, so a machine without the client is unaffected.
 */
export function readQoderAppVersion(): string {
  const home = getHomeDir();
  for (const dir of [".qoder-cn", ".qoder"]) {
    try {
      const raw = readFileSync(join(home, dir, ".qoder-app-status.json"), "utf8");
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === "string" && /^\d+(\.\d+){1,3}$/.test(version.trim())) return version.trim();
    } catch {}
  }
  return "";
}

/**
 * Identity for gateway (/algo) requests: model catalog and chat.
 *
 * `QODERCN_COSY_VERSION` overrides the Cosy-Version for a session, so a newer
 * catalog gate can be followed without waiting for a release.
 */
export function getGatewayIdentity(): CosyIdentity {
  const override = process.env.QODERCN_COSY_VERSION?.trim();
  return {
    clientType: QODER_CLIENT_TYPE,
    cosyVersion: override && /^\d+(\.\d+){1,3}$/.test(override) ? override : QODER_GATEWAY_COSY_VERSION,
    ideVersion: readQoderAppVersion(),
  };
}
const QoderDataPolicy = "disagree";
const QoderLoginVersion = "v2";
const QoderMachineOS =
  process.platform === "win32"
    ? process.arch === "arm64"
      ? "aarch64_windows"
      : "x86_64_windows"
    : process.arch === "arm64"
      ? "aarch64_linux"
      : "x86_64_linux";
const QoderMachineTypeMagic = "5";

interface UserInfo {
  uid: string;
  security_oauth_token: string;
  name: string;
  aid: string;
  email: string;
}

interface CosyPayload {
  version: string;
  requestId: string;
  info: string;
  cosyVersion: string;
  ideVersion: string;
}

export interface CosyCredentials {
  userID: string;
  authToken: string;
  name: string;
  email: string;
  machineID?: string;
}

function rsaEncryptBase64(data: Buffer | string): string {
  const key = {
    key: qoderRSAPublicKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  };
  const encrypted = crypto.publicEncrypt(key, typeof data === "string" ? Buffer.from(data) : data);
  return encrypted.toString("base64");
}

function aesEncryptCBCBase64(plaintext: string, keyStr: string): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(keyStr), Buffer.from(keyStr));
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function computeSigPath(urlStr: string): string {
  const parsed = new URL(urlStr);
  let sigPath = parsed.pathname;
  if (sigPath.startsWith("/algo")) {
    sigPath = sigPath.substring("/algo".length);
  }
  return sigPath;
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function getMachineId(): string {
  const home = getHomeDir();
  const paths = [join(home, ".qoder", ".auth", "machine_id"), join(home, ".pi", "agent", "qoder-machine-id")];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const val = readFileSync(p, "utf8").trim();
        if (val) return val;
      } catch {}
    }
  }
  const newId = crypto.randomUUID();
  try {
    const savePath = paths[1];
    mkdirSync(dirname(savePath), { recursive: true });
    writeFileSync(savePath, newId, "utf8");
  } catch {}
  return newId;
}

export function buildAuthHeaders(
  body: Buffer | string | null,
  requestURL: string,
  creds: CosyCredentials,
  identity: CosyIdentity = getGatewayIdentity(),
): Record<string, string> {
  if (!creds.userID) {
    throw new Error("cosy: user id is empty");
  }
  if (!creds.authToken) {
    throw new Error("cosy: auth token is empty");
  }

  const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const userInfo: UserInfo = {
    uid: creds.userID,
    security_oauth_token: creds.authToken,
    name: creds.name || "",
    aid: "",
    email: creds.email || "",
  };

  const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey);
  const cosyKey = rsaEncryptBase64(aesKey);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestId = crypto.randomUUID();

  const cosyPayload: CosyPayload = {
    version: "v1",
    requestId,
    info: infoB64,
    cosyVersion: identity.cosyVersion,
    ideVersion: identity.ideVersion,
  };

  const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString("base64");
  const sigPath = computeSigPath(requestURL);

  // Feed MD5 in the same byte order as the legacy template string:
  // payloadB64 + "\n" + cosyKey + "\n" + timestamp + "\n" + bodyBytes + "\n" + sigPath
  // without concatenating the full body into a string.
  const bodyBytes = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
  const sig = crypto
    .createHash("md5")
    .update(payloadB64)
    .update("\n")
    .update(cosyKey)
    .update("\n")
    .update(timestamp)
    .update("\n")
    .update(bodyBytes)
    .update("\n")
    .update(sigPath)
    .digest("hex");

  const bodyHash = crypto.createHash("md5").update(bodyBytes).digest("hex");
  const bodyLen = bodyBytes.length.toString();

  const machineID = creds.machineID || getMachineId();

  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userID,
    "Cosy-Date": timestamp,
    "Cosy-Version": identity.cosyVersion,
    "Cosy-Machineid": machineID,
    "Cosy-Machinetoken": machineID,
    "Cosy-Machinetype": QoderMachineTypeMagic,
    "Cosy-Machineos": QoderMachineOS,
    "Cosy-Clienttype": identity.clientType,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLen,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QoderDataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QoderLoginVersion,
    "X-Request-Id": crypto.randomUUID(),
  };
}
