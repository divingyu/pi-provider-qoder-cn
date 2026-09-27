import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getQoderCNEndpoints,
  parseQoderVpcInstance,
  QODER_CN_OFFICIAL,
  QODER_VPC_SUFFIX,
  readInheritedVpcEndpoint,
  readQoderVpcEndpoint,
  resetQoderCNEndpointCache,
  resolveQoderCNEndpoints,
  setQoderCNEndpoint,
} from "../vpc.js";

function testHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

const SETTINGS_PATH = join(testHome(), ".pi", "agent", "qoder-cn-settings.json");
const AUTH_PATH = join(testHome(), ".pi", "agent", "auth.json");
const IDE_PATH = join(testHome(), ".qoder-cn", "settings.json");

const ENV_NAMES = ["QODER_VPC_ENDPOINT", "QODERCN_VPC_ENDPOINT"] as const;
const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
let originalSettings: string | undefined;
let originalAuth: string | undefined;
let originalIde: string | undefined;

function snapshot(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
  originalSettings = snapshot(SETTINGS_PATH);
  originalAuth = snapshot(AUTH_PATH);
  originalIde = snapshot(IDE_PATH);
  rmSync(SETTINGS_PATH, { force: true });
  rmSync(AUTH_PATH, { force: true });
  rmSync(IDE_PATH, { force: true });
  resetQoderCNEndpointCache();
});

afterEach(() => {
  for (const path of [SETTINGS_PATH, AUTH_PATH, IDE_PATH]) rmSync(path, { force: true });
  if (originalSettings !== undefined) writeFileSync(SETTINGS_PATH, originalSettings, "utf8");
  if (originalAuth !== undefined) writeFileSync(AUTH_PATH, originalAuth, "utf8");
  if (originalIde !== undefined) writeFileSync(IDE_PATH, originalIde, "utf8");
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetQoderCNEndpointCache();
});

describe("parseQoderVpcInstance", () => {
  it("accepts a bare instance label", () => {
    expect(parseQoderVpcInstance("acme")).toBe("acme");
    expect(parseQoderVpcInstance("acme-corp-1")).toBe("acme-corp-1");
  });

  it("strips the VPC suffix and the -gateway/-openapi role prefixes", () => {
    expect(parseQoderVpcInstance(`acme.${QODER_VPC_SUFFIX}`)).toBe("acme");
    expect(parseQoderVpcInstance(`acme-gateway.${QODER_VPC_SUFFIX}`)).toBe("acme");
    expect(parseQoderVpcInstance(`acme-openapi.${QODER_VPC_SUFFIX}`)).toBe("acme");
  });

  it("accepts a full URL and ignores its path", () => {
    expect(parseQoderVpcInstance("https://acme-gateway.vpc.qoder.com.cn/some/path")).toBe("acme");
  });

  it("rejects values that are not a usable instance label", () => {
    expect(parseQoderVpcInstance("")).toBeUndefined();
    expect(parseQoderVpcInstance("   ")).toBeUndefined();
    expect(parseQoderVpcInstance("-leading")).toBeUndefined();
    expect(parseQoderVpcInstance("has_underscore")).toBeUndefined();
  });

  it("rejects an unparseable host with dots that is not a VPC host", () => {
    // A custom enterprise domain is handled by resolveQoderCNEndpoints, not here.
    expect(parseQoderVpcInstance("enterprise.example.com")).toBeUndefined();
  });
});

describe("resolveQoderCNEndpoints", () => {
  it("returns the official gateway when nothing is configured", () => {
    const endpoints = resolveQoderCNEndpoints("");
    expect(endpoints).toMatchObject({ raw: "", isDefault: true, ...QODER_CN_OFFICIAL });
  });

  it.each(["official", "default", "none", "clear", "DEFAULT"])("treats %s as a reset", (value) => {
    expect(resolveQoderCNEndpoints(value).isDefault).toBe(true);
  });

  it("treats an official hostname as the default gateway", () => {
    expect(resolveQoderCNEndpoints("gateway.qoder.com.cn").isDefault).toBe(true);
    expect(resolveQoderCNEndpoints("https://openapi.qoder.com.cn").isDefault).toBe(true);
  });

  it("expands a bare instance into the four role-specific hosts", () => {
    const endpoints = resolveQoderCNEndpoints("acme");
    expect(endpoints.isDefault).toBe(false);
    expect(endpoints.raw).toBe(`acme.${QODER_VPC_SUFFIX}`);
    expect(endpoints.baseUrl).toBe(`https://acme-gateway.${QODER_VPC_SUFFIX}/`);
    expect(endpoints.openApiUrl).toBe(`https://acme-openapi.${QODER_VPC_SUFFIX}`);
    expect(endpoints.centerUrl).toBe(`https://acme-gateway.${QODER_VPC_SUFFIX}`);
    expect(endpoints.manageUrl).toBe(`https://acme.${QODER_VPC_SUFFIX}`);
  });

  it("sends every role to one origin for a custom enterprise domain", () => {
    const endpoints = resolveQoderCNEndpoints("https://enterprise.example.com");
    expect(endpoints.isDefault).toBe(false);
    expect(endpoints.raw).toBe("enterprise.example.com");
    expect(endpoints.baseUrl).toBe("https://enterprise.example.com/");
    expect(endpoints.openApiUrl).toBe("https://enterprise.example.com");
    expect(endpoints.centerUrl).toBe("https://enterprise.example.com");
    expect(endpoints.manageUrl).toBe("https://enterprise.example.com");
  });
});

describe("VPC endpoint settings", () => {
  it("prefers the environment variable over the settings file", () => {
    mkdirSync(join(testHome(), ".pi", "agent"), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify({ vpc_endpoint: "from-file" }), "utf8");
    process.env.QODER_VPC_ENDPOINT = "from-env";
    expect(readQoderVpcEndpoint()).toBe("from-env");
  });

  it("reads the settings file when the environment is unset", () => {
    mkdirSync(join(testHome(), ".pi", "agent"), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify({ vpc_endpoint: "from-file" }), "utf8");
    expect(readQoderVpcEndpoint()).toBe("from-file");
  });

  it("does not apply an endpoint it did not write", () => {
    // Another Qoder client's endpoint must never silently redirect pi's
    // traffic: it is offered during login, not applied on its own.
    mkdirSync(join(testHome(), ".pi", "agent"), { recursive: true });
    writeFileSync(AUTH_PATH, JSON.stringify({ "qoder-cn": { vpc_endpoint: "from-auth" } }), "utf8");
    mkdirSync(join(testHome(), ".qoder-cn"), { recursive: true });
    writeFileSync(IDE_PATH, JSON.stringify({ vpcInstanceName: "from-ide" }), "utf8");

    expect(readQoderVpcEndpoint()).toBe("");
    expect(getQoderCNEndpoints().isDefault).toBe(true);
  });

  it("surfaces a stored endpoint as an inherited suggestion", () => {
    mkdirSync(join(testHome(), ".pi", "agent"), { recursive: true });
    writeFileSync(AUTH_PATH, JSON.stringify({ "qoder-cn": { vpc_endpoint: "from-auth" } }), "utf8");

    expect(readInheritedVpcEndpoint()).toEqual({ value: "from-auth", source: "stored credential" });
  });

  it("reports no inherited suggestion when none is stored", () => {
    expect(readInheritedVpcEndpoint()).toBeUndefined();
  });

  it("falls back to the official gateway when nothing is configured", () => {
    expect(readQoderVpcEndpoint()).toBe("");
    expect(getQoderCNEndpoints().isDefault).toBe(true);
  });

  it("persists the endpoint and resolves it on the next read", () => {
    const resolved = setQoderCNEndpoint("acme");
    expect(resolved.baseUrl).toBe(`https://acme-gateway.${QODER_VPC_SUFFIX}/`);

    const saved = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    expect(saved.vpc_endpoint).toBe(`acme.${QODER_VPC_SUFFIX}`);

    // A fresh resolve (as after a restart) reads the persisted value.
    resetQoderCNEndpointCache();
    expect(getQoderCNEndpoints().baseUrl).toBe(`https://acme-gateway.${QODER_VPC_SUFFIX}/`);
  });

  it("persists a reset so the official gateway survives a restart", () => {
    setQoderCNEndpoint("acme");
    setQoderCNEndpoint("");
    expect(JSON.parse(readFileSync(SETTINGS_PATH, "utf8")).vpc_endpoint).toBe("");

    resetQoderCNEndpointCache();
    expect(getQoderCNEndpoints().isDefault).toBe(true);
  });
});
