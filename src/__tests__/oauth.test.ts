import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoLoginQoderFromEnvironment,
  clearQoderAuthMemCache,
  getCachedCredentials,
  getQoderPatForMode,
  type QoderCredentials,
  refreshQoderTokenForMode,
} from "../auth/oauth.js";
import { credentialsFromPat, decodePatRefresh, isPatRefresh } from "../auth/pat.js";
import { updateQoderModelsCache } from "../catalog.js";
import { loadLiveFixture } from "./live-fixture.js";

const AUTH_FILE = join(process.env.HOME || process.env.USERPROFILE || homedir(), ".pi", "agent", "auth.json");

const PAT_ENV_NAMES = [
  "QODER_API_KEY",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "QODER_PAT",
  "QODERCN_API_KEY",
  "QODERCN_PERSONAL_ACCESS_TOKEN",
  "QODERCN_PAT",
] as const;

function clearPatEnv(): void {
  for (const name of PAT_ENV_NAMES) {
    delete process.env[name];
  }
}

vi.mock("../auth/pat.js", () => ({
  credentialsFromPat: vi.fn().mockResolvedValue({
    access: "mock-access-token",
    refresh: "mock-refresh-token",
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

vi.mock("../catalog.js", () => ({
  updateQoderModelsCache: vi.fn().mockResolvedValue(undefined),
  getCachedModels: vi.fn().mockReturnValue([]),
  isCacheStale: vi.fn().mockReturnValue(true),
  staticModels: [],
  staticCnModels: [],
}));

describe("oauth autoLoginQoderFromEnvironment", () => {
  const originalEnv = process.env;
  let originalAuth: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    clearPatEnv();
    clearQoderAuthMemCache();
    originalAuth = existsSync(AUTH_FILE) ? readFileSync(AUTH_FILE, "utf8") : undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (originalAuth === undefined) rmSync(AUTH_FILE, { force: true });
    else writeFileSync(AUTH_FILE, originalAuth, "utf8");
    clearQoderAuthMemCache();
  });

  it("extracts PAT correctly from env for global and CN mode", () => {
    process.env.QODER_PERSONAL_ACCESS_TOKEN = "pt-global-123";
    expect(getQoderPatForMode("global")).toBe("pt-global-123");

    process.env.QODERCN_PERSONAL_ACCESS_TOKEN = "pt-cn-456";
    expect(getQoderPatForMode("cn")).toBe("pt-cn-456");
  });

  it("does nothing if no PAT in environment", async () => {
    await autoLoginQoderFromEnvironment("qoder-test-provider", "global");
    expect(getCachedCredentials("mock-token", "qoder-test-provider")).toBeNull();
  });

  it("re-exchanges an environment PAT even when cached credentials exist", async () => {
    process.env.QODER_PERSONAL_ACCESS_TOKEN = "pt-global-new-account";
    const auth = existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, "utf8")) : {};
    auth["qoder-test-provider"] = {
      type: "oauth",
      access: "old-access-token",
      refresh: "old-refresh-token",
      expires: Date.now() + 3600000,
      userID: "old-user",
    };
    writeFileSync(AUTH_FILE, JSON.stringify(auth), "utf8");

    await autoLoginQoderFromEnvironment("qoder-test-provider", "global");

    expect(credentialsFromPat).toHaveBeenCalledWith("pt-global-new-account", "global");
    expect(updateQoderModelsCache).toHaveBeenCalledWith(
      "mock-access-token",
      "mock-user-123",
      "Test User",
      "test@example.com",
      "global",
    );
  });

  it("passes a recorded-format identity into the model catalog refresh", async () => {
    const identity = loadLiveFixture("global").interactions.userinfo.response.body as {
      id: string;
      email: string;
      name: string;
    };
    vi.mocked(credentialsFromPat).mockResolvedValueOnce({
      access: "<redacted:job-token>",
      refresh: "<redacted:refresh-token>",
      expires: Date.now() + 3600000,
      userID: identity.id,
      email: identity.email,
      name: identity.name,
      machineID: "<redacted:machine-id>",
      type: "oauth",
    } as never);
    clearPatEnv();
    process.env.QODER_PAT = "test-only-pat";

    await autoLoginQoderFromEnvironment("qoder-fixture-provider", "global");

    expect(updateQoderModelsCache).toHaveBeenCalledWith(
      "<redacted:job-token>",
      identity.id,
      identity.name,
      identity.email,
      "global",
    );
  });
});

describe("refreshQoderTokenForMode", () => {
  it("throws instead of masking when the PAT re-exchange fails", async () => {
    clearQoderAuthMemCache();
    const creds = {
      access: "jt-expired",
      refresh: "pat|pt-stored|jrt-stored|user-1|machine-1",
      expires: Date.now() - 1000,
      userID: "user-1",
      email: "u@example.com",
      name: "U",
      machineID: "machine-1",
    } as QoderCredentials;

    vi.mocked(isPatRefresh).mockReturnValue(true);
    vi.mocked(decodePatRefresh).mockReturnValue({
      pat: "pt-stored",
      jobRefreshToken: "jrt-stored",
      userID: "user-1",
      machineID: "machine-1",
    });
    vi.mocked(credentialsFromPat).mockRejectedValueOnce(new Error("exchange 503"));

    // Before 0.2.9 a failed refresh silently extended the local expiry, which
    // kept every request failing with error 105 for another hour.
    await expect(refreshQoderTokenForMode(creds, "cn")).rejects.toThrow(/PAT re-exchange/);
  });

  it("self-heals by re-exchanging the stored PAT on success", async () => {
    clearQoderAuthMemCache();
    const creds = {
      access: "jt-expired",
      refresh: "pat|pt-stored|jrt-stored|user-1|machine-1",
      expires: Date.now() - 1000,
      userID: "user-1",
      email: "u@example.com",
      name: "U",
      machineID: "machine-1",
    } as QoderCredentials;

    vi.mocked(isPatRefresh).mockReturnValue(true);
    vi.mocked(decodePatRefresh).mockReturnValue({
      pat: "pt-stored",
      jobRefreshToken: "jrt-stored",
      userID: "user-1",
      machineID: "machine-1",
    });

    const refreshed = await refreshQoderTokenForMode(creds, "cn");
    expect(refreshed.access).toBe("mock-access-token");
    expect(refreshed.userID).toBe("mock-user-123");
  });

  it("routes drt- tokens to deviceToken/refresh for global mode", async () => {
    clearQoderAuthMemCache();
    const creds = {
      access: "old-access",
      refresh: "drt-device-refresh-123|user-global|machine-global",
      expires: Date.now() - 1000,
      userID: "user-global",
      email: "global@example.com",
      name: "Global User",
      machineID: "machine-global",
    } as QoderCredentials;

    vi.mocked(isPatRefresh).mockReturnValue(false);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "new-access-token",
          refresh_token: "drt-rotated-456",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshQoderTokenForMode(creds, "global");
    expect(refreshed.access).toBe("new-access-token");
    expect(refreshed.refresh).toContain("drt-rotated-456");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/deviceToken/refresh");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "drt-device-refresh-123" });
  });

  it("merges concurrent in-flight refresh calls via single-flight", async () => {
    clearQoderAuthMemCache();
    const creds = {
      access: "old-access",
      refresh: "drt-device-refresh-789|user-global|machine-global",
      expires: Date.now() - 1000,
      userID: "user-global",
      email: "global@example.com",
      name: "Global User",
      machineID: "machine-global",
    } as QoderCredentials;

    vi.mocked(isPatRefresh).mockReturnValue(false);

    const fetchMock = vi.fn().mockImplementation(async () => {
      // Simulate network latency
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          token: "merged-access-token",
          refresh_token: "drt-merged-000",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Call twice in parallel
    const [res1, res2] = await Promise.all([
      refreshQoderTokenForMode(creds, "global"),
      refreshQoderTokenForMode(creds, "global"),
    ]);

    expect(res1.access).toBe("merged-access-token");
    expect(res2.access).toBe("merged-access-token");
    // Crucial: only 1 network request was made!
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("refresh fallback and response hardening", () => {
  it("falls back to a bearer-less retry when the server rejects the expired access token", async () => {
    clearQoderAuthMemCache();
    const creds = {
      access: "expired-access",
      refresh: "drt-devicetoken|user-global|machine-global",
      expires: Date.now() - 1000,
      userID: "user-global",
      email: "g@example.com",
      name: "G",
      machineID: "machine-global",
    } as QoderCredentials;
    vi.mocked(isPatRefresh).mockReturnValue(false);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired bearer", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "fresh-access", expires_in: 3600 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshQoderTokenForMode(creds, "global");
    expect(refreshed.access).toBe("fresh-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second attempt must drop Authorization; server field name `token` honored.
    const second = fetchMock.mock.calls[1][1] as { headers: Record<string, string> };
    expect(second.headers.Authorization).toBeUndefined();
  });

  it("never persists a refresh response without an access token", async () => {
    clearQoderAuthMemCache();
    const creds = {
      access: "a",
      refresh: "jrt-x|u|m",
      expires: 0,
      userID: "u",
      email: "e",
      name: "n",
      machineID: "m",
    } as QoderCredentials;
    vi.mocked(isPatRefresh).mockReturnValue(false);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })),
    );

    // Must throw (not write access:undefined + future expires to auth.json,
    // which would poison every provider entry for pi's validator).
    await expect(refreshQoderTokenForMode(creds, "global")).rejects.toThrow(/no access token/);
  });

  it("rejects an empty refresh chain with a re-login hint instead of a doomed POST", async () => {
    clearQoderAuthMemCache();
    const creds = { access: "a", refresh: "|u|m", expires: 0 } as OAuthCredentials;
    vi.mocked(isPatRefresh).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshQoderTokenForMode(creds, "cn")).rejects.toThrow(/no stored refresh chain/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
