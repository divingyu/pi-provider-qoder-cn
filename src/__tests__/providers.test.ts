import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const patEnvNames = [
  "QODER_API_KEY",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "QODER_PAT",
  "QODERCN_API_KEY",
  "QODERCN_PERSONAL_ACCESS_TOKEN",
  "QODERCN_PAT",
] as const;
const originalPats = Object.fromEntries(patEnvNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of patEnvNames) {
    const value = originalPats[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  vi.doUnmock("@earendil-works/pi-ai/compat");
  vi.resetModules();
});

function liteModel(provider: "qoder" | "qoder-cn") {
  return {
    id: "Lite",
    name: "Lite",
    api: "qoder-api",
    provider,
    baseUrl: provider === "qoder-cn" ? "https://gateway.qoder.com.cn/" : "https://api3.qoder.sh/",
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 131072,
  };
}

/** Minimal stand-in for the pi ExtensionAPI surface this package uses. */
function fakePi() {
  const providers = new Map<string, Record<string, unknown>>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => unknown }>();
  return {
    providers,
    commands,
    api: {
      registerProvider(providerID: string, config: Record<string, unknown>) {
        providers.set(providerID, config);
      },
      registerCommand(
        name: string,
        options: { description?: string; handler: (args: string, ctx: unknown) => unknown },
      ) {
        commands.set(name, options);
      },
      on: vi.fn(),
    },
  };
}

/**
 * This fork registers both providers. Note: installing the upstream
 * `pi-provider-qoder` alongside it would double-register the `qoder` id; pi
 * resolves that by settings order (last package wins), as the README notes.
 */
describe("provider registration", () => {
  it("registers both qoder and qoder-cn providers", async () => {
    for (const name of patEnvNames) delete process.env[name];
    const pi = fakePi();

    const { default: registerProviders } = await import("../index.js");
    await registerProviders(pi.api as never);

    expect([...pi.providers.keys()].sort()).toEqual(["qoder", "qoder-cn"].sort());
    expect(pi.providers.get("qoder-cn")?.baseUrl).toBe("https://gateway.qoder.com.cn/");
    expect(pi.providers.get("qoder-cn")?.api).toBe("qoder-api");
    expect(typeof pi.providers.get("qoder-cn")?.streamSimple).toBe("function");

    expect(pi.providers.get("qoder")?.baseUrl).toBe("https://api3.qoder.sh/");
    expect(pi.providers.get("qoder")?.api).toBe("qoder-api");
    expect(typeof pi.providers.get("qoder")?.streamSimple).toBe("function");
  });

  it("registers usage and claim commands for both regions", async () => {
    for (const name of patEnvNames) delete process.env[name];
    const pi = fakePi();

    const { default: registerProviders } = await import("../index.js");
    await registerProviders(pi.api as never);

    const commandNames = [...pi.commands.keys()].sort();
    expect(commandNames).toEqual(["qoder-cn.claim", "qoder-cn.usage", "qoder.claim", "qoder.usage"].sort());

    expect(typeof pi.commands.get("qoder-cn.usage")?.handler).toBe("function");
    expect(typeof pi.commands.get("qoder-cn.claim")?.handler).toBe("function");
    expect(typeof pi.commands.get("qoder.usage")?.handler).toBe("function");
    expect(typeof pi.commands.get("qoder.claim")?.handler).toBe("function");
  });

  it("polls the CN usage endpoint for the qoder-cn provider", async () => {
    for (const name of patEnvNames) delete process.env[name];
    const pi = fakePi();

    const { default: registerProviders } = await import("../index.js");
    await registerProviders(pi.api as never);

    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            userQuota: { total: 100, used: 1, remaining: 99, percentage: 1, unit: "credits" },
            addOnQuota: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "credits" },
            totalUsagePercentage: 1,
            isQuotaExceeded: false,
            expiresAt: Date.now() + 3600_000,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const credentials: OAuthCredentials = { access: "test-token", refresh: "", expires: Date.now() + 3600_000 };
    const oauth = pi.providers.get("qoder-cn")?.oauth as {
      fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
    };

    await oauth.fetchUsage(credentials);
    expect(fetchMock).toHaveBeenLastCalledWith("https://openapi.qoder.com.cn/api/v2/quota/usage", expect.any(Object));
  });

  it("polls the global usage endpoint for the qoder provider", async () => {
    for (const name of patEnvNames) delete process.env[name];
    const pi = fakePi();

    const { default: registerProviders } = await import("../index.js");
    await registerProviders(pi.api as never);

    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            userQuota: { total: 100, used: 1, remaining: 99, percentage: 1, unit: "credits" },
            addOnQuota: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "credits" },
            totalUsagePercentage: 1,
            isQuotaExceeded: false,
            expiresAt: Date.now() + 3600_000,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const credentials: OAuthCredentials = { access: "test-token", refresh: "", expires: Date.now() + 3600_000 };
    const oauth = pi.providers.get("qoder")?.oauth as {
      fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
    };

    await oauth.fetchUsage(credentials);
    expect(fetchMock).toHaveBeenLastCalledWith("https://openapi.qoder.sh/api/v2/quota/usage", expect.any(Object));
  });

  it("sends the configured VPC host when an enterprise endpoint is set", async () => {
    for (const name of patEnvNames) delete process.env[name];
    process.env.QODER_VPC_ENDPOINT = "acme";
    const pi = fakePi();

    const { default: registerProviders } = await import("../index.js");
    await registerProviders(pi.api as never);

    expect(pi.providers.get("qoder-cn")?.baseUrl).toBe("https://acme-gateway.vpc.qoder.com.cn/");

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const credentials: OAuthCredentials = { access: "test-token", refresh: "", expires: Date.now() + 3600_000 };
    const oauth = pi.providers.get("qoder-cn")?.oauth as {
      fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
    };

    await oauth.fetchUsage(credentials);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://acme-openapi.vpc.qoder.com.cn/api/v2/quota/usage",
      expect.any(Object),
    );
    delete process.env.QODER_VPC_ENDPOINT;
  });
});

describe("qoder-api registry", () => {
  it("registers qoder-api so streamSimple works", async () => {
    for (const name of patEnvNames) delete process.env[name];

    const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>("@earendil-works/pi-ai/compat");
    const registerSpy = vi.fn((...args: Parameters<typeof actual.registerApiProvider>) => {
      return actual.registerApiProvider(...args);
    });
    vi.doMock("@earendil-works/pi-ai/compat", () => ({
      ...actual,
      registerApiProvider: registerSpy,
    }));

    const { getApiProvider, streamSimple, unregisterApiProviders } = await import("@earendil-works/pi-ai/compat");
    const { default: registerProviders } = await import("../index.js");
    // Node caches node_modules ESM, so a prior test in this file may already
    // have registered qoder-api. Drop that entry before asserting the empty state.
    unregisterApiProviders("provider:qoder");
    const emptyContext = { systemPrompt: "", messages: [] };

    expect(getApiProvider("qoder-api")).toBeUndefined();
    expect(() => streamSimple(liteModel("qoder-cn") as never, emptyContext)).toThrow(
      /No API provider registered for api: qoder-api/,
    );

    const pi = fakePi();
    await registerProviders(pi.api as never);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(pi.providers.has("qoder-cn")).toBe(true);

    expect(getApiProvider("qoder-api")).toBeDefined();
    expect(() => streamSimple(liteModel("qoder-cn") as never, emptyContext)).not.toThrow(
      /No API provider registered for api: qoder-api/,
    );
  });

  it("still registers the provider when registerApiProvider is absent (OMP-style)", async () => {
    for (const name of patEnvNames) delete process.env[name];

    vi.doMock("@earendil-works/pi-ai/compat", () => ({
      // OMP bundled pi-ai/compat does not export registerApiProvider.
    }));

    const { default: registerProviders } = await import("../index.js");
    const pi = fakePi();

    await expect(registerProviders(pi.api as never)).resolves.toBeUndefined();

    expect(pi.providers.has("qoder-cn")).toBe(true);
    expect(pi.providers.get("qoder-cn")?.api).toBe("qoder-api");
    expect(typeof pi.providers.get("qoder-cn")?.streamSimple).toBe("function");
  });
});
