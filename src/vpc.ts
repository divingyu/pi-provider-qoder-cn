/**
 * Qoder CN enterprise (VPC) endpoint resolution.
 *
 * Qoder CN is served either from the public gateway
 * (`gateway.qoder.com.cn`) or from a per-tenant enterprise instance whose
 * hostnames carry the `<instance>-gateway` / `<instance>-openapi` prefixes
 * under the `vpc.qoder.com.cn` suffix.
 *
 * The instance name is resolved, in order, from:
 *   1. `QODER_VPC_ENDPOINT` / `QODERCN_VPC_ENDPOINT`
 *   2. `~/.pi/agent/qoder-cn-settings.json` (`vpc_endpoint`)
 *   3. `~/.pi/agent/auth.json` under the `qoder-cn` key
 *   4. `~/.qoder-cn/settings.json` (`vpcInstanceName`) — the Qoder IDE's own file
 *
 * The settings file is also where `/qoder-endpoint <domain>` writes, so the
 * choice survives restarts. Only the CN region resolves to a VPC; global
 * always uses the official `qoder.sh` hosts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Suffix shared by every Qoder CN enterprise hostname. */
export const QODER_VPC_SUFFIX = "vpc.qoder.com.cn";

/** Official CN hosts, treated as "no VPC configured" rather than as a tenant. */
const OFFICIAL_HOSTS = new Set(["gateway.qoder.com.cn", "openapi.qoder.com.cn", "qoder.com.cn"]);

/**
 * The public Qoder CN deployment. Single source of truth: `region.ts` reuses it
 * for the static model catalog, and `resolveQoderCNEndpoints` returns it when no
 * enterprise instance is configured.
 */
export const QODER_CN_OFFICIAL = Object.freeze({
  baseUrl: "https://gateway.qoder.com.cn/",
  openApiUrl: "https://openapi.qoder.com.cn",
  centerUrl: "https://gateway.qoder.com.cn",
  manageUrl: "https://qoder.com.cn",
});

/** `vpc_endpoint` accept only a bare instance label, never a URL or a path. */
const INSTANCE_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

export interface QoderCNEndpoints {
  /** The configured value, normalized. Empty when the official gateway is used. */
  raw: string;
  /** Enterprise instance label when one is configured. */
  instance?: string;
  baseUrl: string;
  openApiUrl: string;
  centerUrl: string;
  manageUrl: string;
  /** True when no enterprise instance is configured. */
  isDefault: boolean;
}

/** Prefer `HOME` so tests can isolate the settings file (Node 26 caches `homedir()`). */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function piAgentDir(): string {
  return join(getHomeDir(), ".pi", "agent");
}

function settingsFilePath(): string {
  return join(piAgentDir(), "qoder-cn-settings.json");
}

/**
 * Accept either a bare instance (`acme`), a full VPC host
 * (`acme-gateway.vpc.qoder.com.cn`), or a custom enterprise domain.
 * Returns a validated instance label, or undefined when the value is unusable.
 */
export function parseQoderVpcInstance(raw: unknown): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return undefined;

  let host = value;
  if (host.startsWith("https://")) host = host.slice(8);
  else if (host.startsWith("http://")) host = host.slice(7);
  host = host.replace(/\/.*$/, "").toLowerCase();

  if (host.endsWith(`.${QODER_VPC_SUFFIX}`)) {
    host = host.slice(0, host.length - QODER_VPC_SUFFIX.length - 1);
  }
  if (host.endsWith("-gateway")) host = host.slice(0, -"-gateway".length);
  if (host.endsWith("-openapi")) host = host.slice(0, -"-openapi".length);

  return INSTANCE_NAME_RE.test(host) ? host : undefined;
}

function readVpcEndpointFromSettings(): string | undefined {
  try {
    const path = settingsFilePath();
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const value = parsed?.vpc_endpoint ?? parsed?.vpcEndpoint ?? parsed?.vpcInstanceName;
    if (value !== undefined && value !== "") return String(value);
  } catch {
    // Unreadable or malformed settings fall through to the next source.
  }
  return undefined;
}

function readVpcEndpointFromAuth(): string | undefined {
  try {
    const path = join(piAgentDir(), "auth.json");
    if (!existsSync(path)) return undefined;
    const auth = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown> | undefined>;
    const entry = auth?.["qoder-cn"];
    const value = entry?.vpc_endpoint ?? entry?.vpcInstance;
    if (value !== undefined && value !== "") return String(value);
  } catch {
    // Missing auth.json just means "no VPC configured".
  }
  return undefined;
}

function readVpcEndpointFromQoderIde(): string | undefined {
  try {
    const path = join(getHomeDir(), ".qoder-cn", "settings.json");
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const value = parsed?.vpc_endpoint ?? parsed?.vpcEndpoint ?? parsed?.vpcInstanceName;
    if (value !== undefined && value !== "") return String(value);
  } catch {
    // The Qoder IDE need not be installed.
  }
  return undefined;
}

/** Resolve the configured instance from env, then the three settings sources. */
export function readQoderVpcEndpoint(): string {
  const fromEnv = process.env.QODER_VPC_ENDPOINT || process.env.QODERCN_VPC_ENDPOINT;
  if (fromEnv) return fromEnv;
  return readVpcEndpointFromSettings() ?? readVpcEndpointFromAuth() ?? readVpcEndpointFromQoderIde() ?? "";
}

/** True when the value means "use the official gateway". */
function isResetValue(value: string): boolean {
  const lowered = value.toLowerCase();
  return !value || lowered === "official" || lowered === "default" || lowered === "none" || lowered === "clear";
}

/**
 * Map a configured endpoint onto the four Qoder CN base URLs.
 *
 * A bare instance or a `*.vpc.qoder.com.cn` host expands to the standard
 * enterprise hostnames; any other domain is treated as an opaque custom
 * deployment and serves every endpoint from one origin.
 */
export function resolveQoderCNEndpoints(rawInput: unknown): QoderCNEndpoints {
  const value = String(rawInput ?? "").trim();
  const official: QoderCNEndpoints = { raw: "", ...QODER_CN_OFFICIAL, isDefault: true };

  if (isResetValue(value)) return official;

  let host = value;
  if (host.startsWith("https://")) host = host.slice(8);
  else if (host.startsWith("http://")) host = host.slice(7);
  host = host.replace(/\/.*$/, "").trim().toLowerCase();

  // An official hostname is the default gateway spelled out.
  if (OFFICIAL_HOSTS.has(host)) return official;

  // Bare instance label, or a host under the VPC suffix.
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
        isDefault: false,
      };
    }
  }

  // Any other enterprise domain: one origin serves gateway, API and console.
  const baseOrigin = `https://${host}`;
  return {
    raw: host,
    baseUrl: `${baseOrigin}/`,
    openApiUrl: baseOrigin,
    centerUrl: baseOrigin,
    manageUrl: baseOrigin,
    isDefault: false,
  };
}

let cachedEndpoints: QoderCNEndpoints | null = null;

/** Resolve the CN endpoints once per process, after which `/qoder-endpoint` updates the cache. */
export function getQoderCNEndpoints(): QoderCNEndpoints {
  if (!cachedEndpoints) cachedEndpoints = resolveQoderCNEndpoints(readQoderVpcEndpoint());
  return cachedEndpoints;
}

/** Persist `vpc_endpoint` so the choice survives a restart. */
export function saveQoderVpcEndpoint(raw: string): void {
  try {
    const dir = piAgentDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(settingsFilePath(), JSON.stringify({ vpc_endpoint: raw || "" }, null, 2), "utf8");
  } catch (error) {
    console.error("[pi-provider-qoder-cn] Failed to save qoder-cn-settings.json:", error);
  }
}

/** Set the CN endpoint (empty resets to the official gateway) and persist it. */
export function setQoderCNEndpoint(raw: unknown): QoderCNEndpoints {
  cachedEndpoints = resolveQoderCNEndpoints(raw);
  saveQoderVpcEndpoint(cachedEndpoints.raw);
  return cachedEndpoints;
}

/** Drop the memoized endpoint so the next read re-resolves from disk. */
export function resetQoderCNEndpointCache(): void {
  cachedEndpoints = null;
}
