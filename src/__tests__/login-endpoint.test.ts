import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// NOTE: dynamic imports do NOT rebuild module state — the endpoint cache in
// vpc.ts persists across tests in this file, so every test that depends on the
// active endpoint sets it explicitly (or pins "").
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

beforeEach(() => {
  for (const name of VPC_ENV_NAMES) delete process.env[name];
  originalSettings = snapshot(SETTINGS_PATH);
  originalAuth = snapshot(AUTH_PATH);
  rmSync(SETTINGS_PATH, { force: true });
  rmSync(AUTH_PATH, { force: true });
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

/** Minimal callbacks: a select that answers, and a prompt that returns PAT. */
function callbacksWith(answers: { select?: string; prompts?: string[] }) {
  const seenPrompts: string[] = [];
  const queue = [...(answers.prompts ?? [])];
  return {
    seenPrompts,
    onAuth: () => undefined,
    onDeviceCode: () => undefined,
    onProgress: () => undefined,
    onSelect: async (p: { message: string; options: { id: string; label: string }[] }) => {
      seenPrompts.push(`select:${p.message}`);
      return answers.select;
    },
    onPrompt: async (p: { message: string }) => {
      seenPrompts.push(p.message);
      return queue.shift() ?? "";
    },
  };
}

describe("interactiveLogin endpoint confirmation", () => {
  it("asks which endpoint to use before requesting the PAT", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith({ select: "personal", prompts: ["pt-abc"] });

    await interactiveLogin(cb as never, "cn");

    // The endpoint question must come first — the PAT exchange targets whichever
    // gateway was chosen, so asking afterwards is too late.
    expect(cb.seenPrompts[0]).toContain("Choose the Qoder CN endpoint");
  });

  it("defaults to the personal gateway and pins it in settings", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith({ select: "personal", prompts: ["pt-abc"] });

    await interactiveLogin(cb as never, "cn");

    const saved = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    expect(saved.vpc_endpoint).toBe("");
    const { getQoderCNEndpoints } = await loadVpc();
    expect(getQoderCNEndpoints().isDefault).toBe(true);
  });

  it("applies the chosen enterprise endpoint before the PAT exchange", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith({ select: "enterprise", prompts: ["acme", "pt-abc"] });

    await interactiveLogin(cb as never, "cn");

    const { getQoderCNEndpoints, QODER_VPC_SUFFIX } = await loadVpc();
    expect(getQoderCNEndpoints().baseUrl).toBe(`https://acme-gateway.${QODER_VPC_SUFFIX}/`);
    // The enterprise instance prompt must precede the PAT prompt.
    expect(cb.seenPrompts.findIndex((m) => m.includes("Enterprise VPC endpoint"))).toBeLessThan(
      cb.seenPrompts.findIndex((m) => m.includes("Personal Access Token")),
    );
  });

  it("offers a stored endpoint as an inherited option and applies it on request", async () => {
    mkdirSync(join(testHome(), ".pi", "agent"), { recursive: true });
    writeFileSync(AUTH_PATH, JSON.stringify({ "qoder-cn": { vpc_endpoint: "contoso" } }), "utf8");

    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith({ select: "enterprise-inherited", prompts: ["pt-abc"] });

    await interactiveLogin(cb as never, "cn");

    const { getQoderCNEndpoints, QODER_VPC_SUFFIX } = await loadVpc();
    expect(getQoderCNEndpoints().baseUrl).toBe(`https://contoso-gateway.${QODER_VPC_SUFFIX}/`);
  });

  it("does not ask about endpoints for the global region", async () => {
    const { interactiveLogin } = await loadLogin();
    const cb = callbacksWith({ select: "personal", prompts: ["pt-abc", "pt-abc"] });

    // Global only supports the device flow here, but the endpoint question must
    // not appear regardless.
    await interactiveLogin(cb as never, "global").catch(() => undefined);

    expect(cb.seenPrompts.some((m) => m.includes("Choose the Qoder CN endpoint"))).toBe(false);
  });

  it("falls back to a text prompt when the host has no onSelect", async () => {
    const { interactiveLogin } = await loadLogin();
    const { resolveQoderCNEndpoints } = await loadVpc();
    expect(resolveQoderCNEndpoints).toBeTypeOf("function");

    const seenPrompts: string[] = [];
    const cb = {
      seenPrompts,
      onAuth: () => undefined,
      onDeviceCode: () => undefined,
      onProgress: () => undefined,
      onPrompt: async (p: { message: string }) => {
        seenPrompts.push(p.message);
        // First prompt is the endpoint list, second is the PAT.
        return seenPrompts.length === 1 ? "1" : "pt-abc";
      },
    };

    await interactiveLogin(cb as never, "cn");

    expect(seenPrompts[0]).toContain("Choose the Qoder CN endpoint");
    const saved = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    expect(saved.vpc_endpoint).toBe("");
  });

  it("rethrows a cancelled select instead of prompting a second time", async () => {
    const { interactiveLogin } = await loadLogin();
    const prompts: string[] = [];
    const cb = {
      onAuth: () => undefined,
      onDeviceCode: () => undefined,
      onProgress: () => undefined,
      onSelect: async () => {
        // pi rejects the select with this exact error when the user presses Esc.
        throw new Error("Login cancelled");
      },
      onPrompt: async (p: { message: string }) => {
        prompts.push(p.message);
        return "pt-abc";
      },
    };

    await expect(interactiveLogin(cb as never, "cn")).rejects.toThrow("Login cancelled");
    // The fallback text prompt must not appear after an explicit cancel.
    expect(prompts).toHaveLength(0);
  });

  it("warns that an environment endpoint overrides the personal choice", async () => {
    process.env.QODER_VPC_ENDPOINT = "envinst";

    const { interactiveLogin } = await loadLogin();
    const selectMessages: string[] = [];
    const progress: string[] = [];
    const cb = {
      onAuth: () => undefined,
      onDeviceCode: () => undefined,
      onProgress: (m: string) => progress.push(m),
      onSelect: async (p: { message: string }) => {
        selectMessages.push(p.message);
        return "personal";
      },
      onPrompt: async () => "pt-abc",
    };

    await interactiveLogin(cb as never, "cn");

    // The dialog names the variable as the real source, and the personal pick
    // warns that the environment overrides it on restart.
    expect(selectMessages[0]).toContain("QODER_VPC_ENDPOINT");
    expect(progress.some((m) => m.includes("QODER_VPC_ENDPOINT"))).toBe(true);
    // The pin is still written, so removing the variable later keeps personal.
    const saved = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    expect(saved.vpc_endpoint).toBe("");
  });
});
