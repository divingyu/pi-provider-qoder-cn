import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// claim.ts spawns the desktop UMID component via execFile; mock it so tests
// are deterministic and never depend on a real Qoder desktop installation.
const mockSpawnSync = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => mockSpawnSync(...(args as [])) };
});

const mockGetCachedCredentials = vi.fn();
vi.mock("../auth/oauth.js", () => ({
  getCachedCredentials: (...args: unknown[]) => mockGetCachedCredentials(...args),
}));

import {
  claimQoderCampaign,
  fetchCheckinGrantInfo,
  fetchQoderCampaigns,
  formatCountdownBeijing,
  formatDateTime,
  getCheckinCachePath,
  msUntilBeijing10AM,
  type QoderCampaignsResponse,
  type QoderClaimResponse,
  runClaimCommand,
} from "../commands/claim.js";

beforeEach(() => {
  // Deterministically disable desktop UMID resolution unless a test opts in.
  process.env.QODER_UMID_EXE = "Z:\\definitely-not-here\\runtime-info.exe";
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockGetCachedCredentials.mockReset();
  mockSpawnSync.mockReset();
  // Default every test to "no desktop UMID component" so identity resolution
  // deterministically returns null; the risk-identity test overrides this and
  // points at an existing file while mocking the spawn itself.
  process.env.QODER_UMID_EXE = "Z:\\definitely-not-here\\runtime-info.exe";
  try {
    rmSync(getCheckinCachePath("cn"), { force: true });
  } catch {}
});

describe("msUntilBeijing10AM and formatCountdownBeijing", () => {
  it("counts down to today 10:00 AM when before 10:00", () => {
    // 09:30 AM Beijing time (01:30 UTC)
    const before10 = Date.UTC(2026, 8, 30, 1, 30);
    const ms = msUntilBeijing10AM(before10);
    expect(ms).toBe(30 * 60_000);
    expect(formatCountdownBeijing(ms)).toBe("30分钟");
  });

  it("counts down to tomorrow 10:00 AM when at or after 10:00", () => {
    // 10:00 AM Beijing time (02:00 UTC)
    const at10 = Date.UTC(2026, 8, 30, 2, 0);
    const ms = msUntilBeijing10AM(at10);
    expect(ms).toBe(24 * 3600_000);
    expect(formatCountdownBeijing(ms)).toBe("24小时0分钟");

    // 11:15 AM Beijing time (03:15 UTC)
    const after10 = Date.UTC(2026, 8, 30, 3, 15);
    const msAfter = msUntilBeijing10AM(after10);
    expect(msAfter).toBe(22 * 3600_000 + 45 * 60_000);
    expect(formatCountdownBeijing(msAfter)).toBe("22小时45分钟");
  });
});

describe("formatDateTime", () => {
  it("formats ISO string into Beijing time", () => {
    const formatted = formatDateTime("2026-10-03T03:31:47Z");
    // 03:31:47 UTC is 11:31:47 Beijing
    expect(formatted).toContain("2026");
    expect(formatted).toContain("11:31:47");
  });

  it("handles empty or invalid gracefully", () => {
    expect(formatDateTime(undefined)).toBe("n/a");
    expect(formatDateTime("invalid-date")).toBe("invalid-date");
  });
});

describe("fetchQoderCampaigns and claimQoderCampaign API client", () => {
  const mockCampaigns: QoderCampaignsResponse = {
    uid: "test-uid",
    showCampaign: true,
    claimable: true,
    campaigns: [
      {
        campaignId: "camp-123",
        campaignKey: "act-test",
        actionType: "CLAIM_BENEFIT",
        claimStatus: "UNCLAIMED",
        benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
      },
    ],
  };

  it("sends Cosy-ClientType 10 and Bearer auth to fetch campaigns", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockCampaigns), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchQoderCampaigns("token-abc", "machine-xyz", "cn");
    expect(res).toEqual(mockCampaigns);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sash/api/v1/me/campaigns");
    expect(init.headers["Authorization"]).toBe("Bearer token-abc");
    expect(init.headers["Cosy-ClientType"]).toBe("10");
    expect(init.headers["Cosy-MachineId"]).toBe("machine-xyz");
  });

  it("throws descriptive error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));

    await expect(fetchQoderCampaigns("bad-token", "mach", "cn")).rejects.toThrow(
      /Failed to query Qoder campaigns \(401\)/,
    );
  });

  it("claims benefit with POST request", async () => {
    const mockClaimRes: QoderClaimResponse = {
      grantId: "grant-789",
      status: "CLAIMED",
      benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockClaimRes), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await claimQoderCampaign("token-abc", "machine-xyz", "camp-123", "cn");
    expect(res).toEqual(mockClaimRes);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sash/api/v1/me/campaigns/camp-123/claim");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer token-abc");
    expect(init.headers["Cosy-ClientType"]).toBe("10");
  });
});

describe("runClaimCommand", () => {
  it("warns if no credentials are found", async () => {
    mockGetCachedCredentials.mockReturnValue(null);

    const notify = vi.fn();
    const ctx = {
      ui: { notify },
      modelRegistry: { getApiKeyForProvider: vi.fn().mockResolvedValue(undefined) },
    } as any;

    await runClaimCommand("cn", "", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("未找到 qoder-cn 登录凭据"), "warning");
  });

  it("explains the attestation-missing case when the UMID component is unavailable (global)", async () => {
    mockGetCachedCredentials.mockReturnValue({
      access: "token-ok",
      machineID: "mach-1",
      userID: "uid-global-1",
    });
    // Deterministically resolve identity to null: the stubbed component does
    // not exist, so the runClaimCommand cannot attach device attestation and
    // the global gateway hides claim campaigns.
    process.env.QODER_UMID_EXE = "Z:\\definitely-not-here\\runtime-info.exe";
    const campaigns: QoderCampaignsResponse = {
      uid: "u",
      showCampaign: true,
      claimable: false,
      campaigns: [
        {
          campaignId: "c-banner",
          campaignKey: "act-20260901-493",
          actionType: "VIEW_DETAILS",
          claimStatus: "CLAIMED",
          startAt: 1788247200,
          endAt: 1793462340,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(campaigns), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notify = vi.fn();
    const ctx = { ui: { notify } } as any;
    await runClaimCommand("global", "", ctx);
    const msg = String(notify.mock.calls[0][0]);
    // The accurate cause: the gateway hides claim campaigns without device
    // attestation. Never blame credentials or suggest re-login.
    expect(msg).toMatch(/device attestation|runtime-info\.exe|QODER_UMID_EXE/);
    expect(msg).not.toMatch(/re-login/i);
    // And the request itself must still have gone out bearer-authed.
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer token-ok");
    expect(init.headers["Cosy-ClientType"]).toBe("10");
    expect(init.headers["Cosy-MachineToken"]).toBeUndefined();
    delete process.env.QODER_UMID_EXE;
  });

  it("sends desktop risk-identity headers when the UMID component resolves (claimable flow)", async () => {
    // Point the candidate path at an existing file (existsSync gate), then mock
    // the spawn itself to return the UMID JSON — cross-platform and offline.
    process.env.QODER_UMID_EXE = join(process.cwd(), "package.json");
    mockSpawnSync.mockImplementation(() => ({
      status: 0,
      stdout: JSON.stringify({ machineToken: "tok-123", machineCode: "code-123", machineType: "type-123" }),
      stderr: "",
    }));
    mockGetCachedCredentials.mockReturnValue({
      access: "token-ok",
      machineID: "mach-1",
      userID: "uid-global-2",
    });

    const campaigns: QoderCampaignsResponse = {
      campaigns: [
        {
          campaignId: "c-live",
          campaignKey: "act-20260930-894",
          actionType: "CLAIM_BENEFIT",
          claimStatus: "CLAIMABLE",
          benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
        },
      ],
    };
    const claimRes: QoderClaimResponse = {
      grantId: "g-1",
      status: "CLAIMED",
      expiresAt: "2026-11-02T03:31:47Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(campaigns), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(claimRes), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notify = vi.fn();
    const ctx = { ui: { notify } } as any;
    await runClaimCommand("global", "", ctx);
    // The CLAIMABLE status (global enum) must be treated as claimable.
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Successfully claimed 100 Credits"), "info");
    // Risk-identity headers mirror the desktop client's YBr builder.
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["Cosy-MachineToken"]).toBe("tok-123");
    expect(init.headers["Cosy-MachineCode"]).toBe("code-123");
    expect(init.headers["Cosy-MachineType"]).toBe("type-123");
    expect(init.headers["Cosy-MachineOS"]).toBeTruthy();
    expect(init.headers["Cosy-MachineHostname"]).toBeTruthy();
    // The UMID component must have been invoked with the global environment
    // code (3) and the account id on stdin, mirroring the desktop client.
    const [exe, args, opts] = mockSpawnSync.mock.calls[0] as [string, string[], { input: string }];
    // The exe path is whatever QODER_UMID_EXE points at (the test stubs an
    // existing file); the protocol is what matters: env 3 = global, account
    // id fed via stdin exactly like the desktop client.
    expect(args[0]).toBe("3");
    expect(args[1]).toBe("--account-stdin");
    expect(JSON.parse(opts.input)).toEqual({ account: "uid-global-2" });
    delete process.env.QODER_UMID_EXE;
  });

  it("informs user when today's credits are already claimed", async () => {
    mockGetCachedCredentials.mockReturnValue({ access: "token-ok", machineID: "mach-1" });

    const campaigns: QoderCampaignsResponse = {
      uid: "uid-1",
      campaigns: [
        {
          campaignId: "c-1",
          actionType: "CLAIM_BENEFIT",
          claimStatus: "CLAIMED",
          benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
          placements: [{ content: { zh: { title: "每天领 100 Credits" } } }],
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(campaigns), { status: 200 })));

    const notify = vi.fn();
    const ctx = { ui: { notify } } as any;

    await runClaimCommand("cn", "", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("今日 100 Credits 已经领取过"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("明日 10:00 UTC+8"), "info");
  });

  it("claims benefit and displays success details when unclaimed", async () => {
    mockGetCachedCredentials.mockReturnValue({ access: "token-ok", machineID: "mach-1" });

    const campaigns: QoderCampaignsResponse = {
      uid: "uid-1",
      campaigns: [
        {
          campaignId: "c-unclaimed",
          actionType: "CLAIM_BENEFIT",
          claimStatus: "UNCLAIMED",
          benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
        },
      ],
    };

    const claimRes: QoderClaimResponse = {
      grantId: "grant-new-001",
      status: "CLAIMED",
      benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
      expiresAt: "2026-11-03T02:00:00Z",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(campaigns), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(claimRes), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notify = vi.fn();
    const ctx = { ui: { notify } } as any;

    await runClaimCommand("cn", "", ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("成功领取今日 100 Credits"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("grant-new-001"), "info");
  });

  it("returns raw JSON when 'json' argument is passed", async () => {
    mockGetCachedCredentials.mockReturnValue({ access: "token-ok", machineID: "mach-1" });

    const campaigns: QoderCampaignsResponse = {
      uid: "uid-1",
      campaigns: [
        {
          campaignId: "c-1",
          actionType: "CLAIM_BENEFIT",
          claimStatus: "CLAIMED",
          benefit: { kind: "CREDITS", amount: 100 },
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(campaigns), { status: 200 })));

    const notify = vi.fn();
    const ctx = { ui: { notify } } as any;

    await runClaimCommand("cn", "json", ctx);
    const calledArg = notify.mock.calls[0][0];
    const parsed = JSON.parse(calledArg);
    expect(parsed.campaignId).toBe("c-1");
    expect(parsed.claimStatus).toBe("CLAIMED");
  });
});

describe("fetchCheckinGrantInfo", () => {
  it("fetches grant info and expiry for claimed campaign", async () => {
    const campaigns: QoderCampaignsResponse = {
      campaigns: [
        {
          campaignId: "c-99",
          actionType: "CLAIM_BENEFIT",
          claimStatus: "CLAIMED",
          benefit: { kind: "CREDITS", amount: 100, validity: { days: 30 } },
        },
      ],
    };

    const claimRes: QoderClaimResponse = {
      grantId: "g-99",
      status: "CLAIMED",
      expiresAt: "2026-11-02T03:31:47Z",
      claimedAt: "2026-10-03T03:31:47Z",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(campaigns), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(claimRes), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const info = await fetchCheckinGrantInfo("tok", "mach", "cn");
    expect(info).not.toBeNull();
    expect(info?.claimed).toBe(true);
    expect(info?.amount).toBe(100);
    expect(info?.expiresAt).toBe("2026-11-02T03:31:47Z");
  });

  it("returns unclaimed status when benefit is unclaimed", async () => {
    const campaigns: QoderCampaignsResponse = {
      campaigns: [
        {
          campaignId: "c-100",
          actionType: "CLAIM_BENEFIT",
          claimStatus: "UNCLAIMED",
          benefit: { kind: "CREDITS", amount: 100 },
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(campaigns), { status: 200 })));

    const info = await fetchCheckinGrantInfo("tok", "mach", "cn");
    expect(info?.claimed).toBe(false);
    expect(info?.amount).toBe(100);
  });
});
