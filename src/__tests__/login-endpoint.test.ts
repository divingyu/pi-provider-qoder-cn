import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testHome = () => process.env.HOME || process.env.USERPROFILE || homedir();
const SETTINGS_PATH = join(testHome(), ".pi", "agent", "qoder-cn-settings.json");
const AUTH_PATH = join(testHome(), ".pi", "agent", "auth.json");

let originalSettings: string | undefined;
let originalAuth: string | undefined;

const snapshot = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

// Import after each reset so the endpoint cache is rebuilt from the fixtures.
// NOTE: dynamic imports do NOT rebuild module state - the endpoint cache in
// vpc.ts persists across tests in this file, so every test resets it in
// beforeEach and (when it depends on the active endpoint) sets it explicitly.
const loadLogin = () => import("../auth/login.js");
const loadVpc = () => import("../vpc.js");

vi.mock("../auth/pat.js", () => ({
  credentialsFromPat: vi.fn().mockResolvedValue({
    access: "mock-access-token",
    refresh: "pat|pt-mock|jrt-mock|uid|mid",
    expires: Date.now() + 3600000,
    userID: "mock-user-123",
    email: "test@example.com",
    name: "Test User",
    machineID: "mock-machine-id",
    type: "oauth",
  }),
  isPatRefresh: vi.fn().mockReturnValue(false),
  decodePatRefresh: vi.fn(),
}));

const VPC_ENV_NAMES = ["QODER_VPC_ENDPOINT", "QODERCN_VPC_ENDPOINT"] as const;
const originalVpcEnv: Record<string, string | undefined> = Object.fromEntries(
  VPC_ENV_NAMES.map((name) => [name, process.env[name]]),
);

beforeEach(async () => {
  for (const name of VPC_ENV_NAMES) delete process.env[name];
  originalSettings = snapshot(SETTINGS_PATH);
  originalAuth = snapshot(AUTH_PATH);
  rmSync(SETTINGS_PATH, { force: true });
  rmSync(AUTH_PATH, { force: true });
  // Rebuild the in-memory endpoint cache from the (now absent) settings file.
  (await loadVpc()).resetQoderCNEndpointCache();
});

afterEach(() => {
  rmSync(SETTINGS_PATH, { force: true });
  rmSync(AUTH_PATH, { force: true });
  if (originalSettings !== undefined) writeFileSync(SETTINGS_PATH, originalSettings, "utf8");
  if (originalAuth !== undefined) writeFileSync(AUTH_PATH, originalAuth, "utf8");
  for (const name of VPC_ENV_NAMES) {
    const value = originalVpcEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** Minimal callbacks: a prompt whose answers come from a queue. */
function callbacksWith(answers: string[]) {
  const seenPrompts: { message: string; placeholder?: string }[] = [];
  const seenProgress: string[] = [];
  const queue = [...answers];
  return {
    seenPrompts,
    seenProgress,
    onAuth: () => undefined,
    onDeviceCode: () => undefined,
    onProgress: (msg: string) => seenProgress.push(msg),
    onSelect: async () => {
      throw new Error("the endpoint flow must not use a select list");
    },
    onPrompt: async (p: { message: string; placeholder?: string }) => {
      seenPrompts.push({ message: p.message, placeholder: p.placeholder });
      return queue.shift() ?? "";
    },
  };
}

const readSettings = () => JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { vpc_endpoint?: string };

describe("interactiveLogin endpoint confirmation (single prompt, Enter = keep current)", () => {
  it("asks the endpoint question first, then the PAT", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(cb.seenPrompts[0].message).toContain("Qoder CN endpoint");
    expect(cb.seenPrompts[0].message).toContain("Enter = personal account");
    expect(cb.seenPrompts[1].message).toContain("Personal Access Token");
  });

  it("empty input on a fresh install stays personal and writes no endpoint", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    // Nothing to pin: no settings file is created for the default endpoint.
    expect(existsSync(SETTINGS_PATH)).toBe(false);
    expect(cb.seenProgress.join(" ")).not.toContain("Personal gateway selected");
  });

  it("a bare instance name selects the enterprise endpoint and normalizes it", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["czlh", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(readSettings().vpc_endpoint).toBe("czlh.vpc.qoder.com.cn");
  });

  it("a full vpc domain is stored as-is (already normalized)", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["corp.vpc.qoder.com.cn", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(readSettings().vpc_endpoint).toBe("corp.vpc.qoder.com.cn");
  });

  it("Enter keeps a stored enterprise endpoint instead of forcing a retyp", async () => {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ vpc_endpoint: "czlh.vpc.qoder.com.cn" }), "utf8");
    (await loadVpc()).resetQoderCNEndpointCache();
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    // The prompt surfaces the stored endpoint; empty input leaves it untouched.
    expect(cb.seenPrompts[0].message).toContain("current: czlh.vpc.qoder.com.cn");
    expect(cb.seenPrompts[0].message).toContain("Enter = keep enterprise");
    expect(cb.seenPrompts[0].placeholder).toBe("czlh.vpc.qoder.com.cn");
    expect(readSettings().vpc_endpoint).toBe("czlh.vpc.qoder.com.cn");
  });

  it("the personal keyword resets a stored enterprise endpoint", async () => {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ vpc_endpoint: "czlh.vpc.qoder.com.cn" }), "utf8");
    (await loadVpc()).resetQoderCNEndpointCache();
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["personal", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(readSettings().vpc_endpoint).toBe("");
  });

  it("the '-' keyword also resets to the personal gateway", async () => {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ vpc_endpoint: "czlh.vpc.qoder.com.cn" }), "utf8");
    (await loadVpc()).resetQoderCNEndpointCache();
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["-", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(readSettings().vpc_endpoint).toBe("");
  });

  it("an official public hostname input means personal", async () => {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ vpc_endpoint: "czlh.vpc.qoder.com.cn" }), "utf8");
    (await loadVpc()).resetQoderCNEndpointCache();
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["gateway.qoder.com.cn", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(readSettings().vpc_endpoint).toBe("");
  });

  it("invalid input is re-asked in place and then accepted", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["!!!", "czlh", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(cb.seenPrompts).toHaveLength(3);
    expect(cb.seenPrompts[1].message).toContain("did not look like an endpoint");
    expect(readSettings().vpc_endpoint).toBe("czlh.vpc.qoder.com.cn");
  });

  it("warns that an environment endpoint overrides the personal choice", async () => {
    process.env.QODER_VPC_ENDPOINT = "czlh.vpc.qoder.com.cn";
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["personal", "pt-abc"]);

    await interactiveLogin(cb as never, "cn");

    expect(cb.seenPrompts[0].message).toContain("QODER_VPC_ENDPOINT");
    expect(cb.seenProgress.join(" ")).toContain("takes precedence");
    // The reset is still recorded; the env var wins only after a restart.
    expect(readSettings().vpc_endpoint).toBe("");
  });

  it("does not ask about endpoints for the global region", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith(["pt-abc"]);

    await interactiveLogin(cb as never, "global");

    expect(cb.seenPrompts).toHaveLength(1);
    expect(cb.seenPrompts[0].message).toContain("Personal Access Token");
  });
});
