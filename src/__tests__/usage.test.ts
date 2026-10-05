import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQoderUsageForMode } from "../auth/usage.js";
import type { QoderQuotaUsage } from "../commands/usage.js";
import {
  estimateRollingAddOnExpiry,
  fetchQoderQuota,
  formatAmount,
  formatDailyResetCountdown,
  formatPercent,
  formatQoderUsage,
  formatResetTime,
  normalizePercent,
  shouldColorize,
  usageBar,
  usageColor,
} from "../commands/usage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Year 9999, the sentinel Qoder sends for a plan that does not reset. */
const NEVER_EXPIRES = 253402214400000;

/** The TUI strips SGR codes before measuring width; tests assert the same property. */
function stripAnsi(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\x1b") {
      while (i < text.length && text[i] !== "m") i++;
      continue;
    }
    out += text[i];
  }
  return out;
}

describe("usageBar", () => {
  it("fills proportionally to the percentage", () => {
    expect(usageBar(0, { width: 10 })).toBe("[░░░░░░░░░░]");
    expect(usageBar(50, { width: 10 })).toBe("[█████░░░░░]");
    expect(usageBar(100, { width: 10 })).toBe("[██████████]");
  });

  it("clamps values outside 0-100", () => {
    expect(usageBar(-10, { width: 10 })).toBe("[░░░░░░░░░░]");
    expect(usageBar(250, { width: 10 })).toBe("[██████████]");
  });

  it("renders unknown rather than empty when the percentage is absent", () => {
    expect(usageBar(undefined, { width: 4 })).toBe("[????]");
    expect(usageBar(Number.NaN, { width: 3 })).toBe("[???]");
  });

  it("defaults to the 20-cell bar the grid reserves", () => {
    expect(usageBar(0)).toBe(`[${"░".repeat(20)}]`);
  });

  it("colours the filled run by threshold and the remainder dim", () => {
    const bar = usageBar(50, { width: 4, color: true });
    expect(bar).toContain("\x1b[32m██\x1b[0m");
    expect(bar).toContain("\x1b[2m░░\x1b[0m");
  });

  it("keeps the visible bar identical whether or not colour is on", () => {
    for (const percent of [0, 25, 60, 85, 100, undefined]) {
      expect(stripAnsi(usageBar(percent, { width: 8, color: true }))).toBe(usageBar(percent, { width: 8 }));
    }
  });
});

describe("usageColor", () => {
  it("escalates with usage", () => {
    expect(usageColor(0)).toBe("\x1b[32m");
    expect(usageColor(59.9)).toBe("\x1b[32m");
    expect(usageColor(60)).toBe("\x1b[33m");
    expect(usageColor(85)).toBe("\x1b[31m\x1b[1m");
    expect(usageColor(100)).toBe("\x1b[31m\x1b[1m");
  });

  it("stays unstyled when there is nothing to grade and goes red when the quota is gone", () => {
    expect(usageColor(undefined)).toBeUndefined();
    expect(usageColor(Number.NaN)).toBeUndefined();
    expect(usageColor(0, true)).toBe("\x1b[31m\x1b[1m");
  });
});

describe("shouldColorize", () => {
  const env = { PATH: "/bin" };

  it("colours a UI and a TTY, and never a pipe", () => {
    expect(shouldColorize("", { hasUI: true, env })).toBe(true);
    expect(shouldColorize("", { hasUI: false, isTTY: true, env })).toBe(true);
    expect(shouldColorize("", { hasUI: false, isTTY: false, env })).toBe(false);
  });

  it("honours NO_COLOR, a dumb terminal and the plain argument", () => {
    expect(shouldColorize("", { hasUI: true, env: { NO_COLOR: "1" } })).toBe(false);
    expect(shouldColorize("", { hasUI: true, env: { TERM: "dumb" } })).toBe(false);
    expect(shouldColorize("", { hasUI: true, env: { FORCE_COLOR: "0" } })).toBe(false);
    expect(shouldColorize("Plain", { hasUI: true, env })).toBe(false);
    expect(shouldColorize("no-color", { hasUI: true, env })).toBe(false);
  });
});

describe("formatAmount / formatPercent", () => {
  it("drops float noise but keeps meaningful decimals", () => {
    expect(formatAmount(12.5, "credits")).toBe("12.5 credits");
    expect(formatAmount(12.500000001, "credits")).toBe("12.5 credits");
    expect(formatAmount(700)).toBe("700");
  });

  it("reports missing amounts as unknown", () => {
    expect(formatAmount(undefined, "credits")).toBe("?");
    expect(formatAmount(Number.NaN)).toBe("?");
  });

  it("rounds percentages to one decimal", () => {
    expect(formatPercent(12.3456)).toBe(12.3);
    expect(formatPercent(undefined)).toBeUndefined();
  });

  it("scales the API's 0-1 fractions to 0-100 and leaves real percentages alone", () => {
    expect(normalizePercent(0.94)).toBe(94);
    expect(normalizePercent(0)).toBe(0);
    expect(normalizePercent(1)).toBe(100);
    expect(normalizePercent(12.5)).toBe(12.5);
    expect(normalizePercent(undefined)).toBeUndefined();
    expect(normalizePercent(Number.NaN)).toBeUndefined();
  });
});

describe("formatResetTime", () => {
  it("renders the year-9999 sentinel as never", () => {
    expect(formatResetTime(NEVER_EXPIRES)).toBe("never");
  });

  it("calculates daily reset countdown correctly", () => {
    // 10:00:00 UTC = 18:00:00 Beijing time -> in 6h 0m
    const now = Date.UTC(2026, 8, 27, 10, 0, 0);
    expect(formatDailyResetCountdown(now)).toBe("00:00 UTC+8 (in 6h 0m)");
  });

  it("renders an absolute date plus a relative countdown", () => {
    const now = Date.UTC(2026, 8, 26, 0, 0, 0);
    const threeDays = now + 3 * 86_400_000;
    expect(formatResetTime(threeDays, now)).toBe("2026-09-29 (in 3d 0h)");
  });

  it("renders hours and minutes when under a day", () => {
    const now = Date.UTC(2026, 8, 26, 0, 0, 0);
    expect(formatResetTime(now + 5 * 3_600_000 + 30 * 60_000, now)).toBe("2026-09-26 (in 5h 30m)");
    expect(formatResetTime(now + 45 * 60_000, now)).toBe("2026-09-26 (in 45m)");
  });

  it("reports an elapsed timestamp as expired and a missing one as n/a", () => {
    const now = Date.UTC(2026, 8, 26, 0, 0, 0);
    expect(formatResetTime(now - 1000, now)).toBe("expired");
    expect(formatResetTime(undefined)).toBe("n/a");
    expect(formatResetTime(0)).toBe("n/a");
  });

  it("accepts a seconds-precision timestamp", () => {
    const now = Date.UTC(2026, 8, 26, 0, 0, 0);
    expect(formatResetTime((now + 3 * 86_400_000) / 1000, now)).toBe("2026-09-29 (in 3d 0h)");
  });
});

describe("formatQoderUsage alignment", () => {
  /** The gauge glyphs are what a reader scans for, so the tests spell them out. */
  const bar = (filled: number, width = 20) => `${"█".repeat(filled)}${"░".repeat(width - filled)}`;

  const twoBuckets: QoderQuotaUsage = {
    userType: "personal_standard",
    totalUsagePercentage: 12.5,
    expiresAt: NEVER_EXPIRES,
    userQuota: { total: 2000, used: 250, remaining: 1750, percentage: 12.5, unit: "credits" },
    addOnQuota: { total: 700, used: 0, remaining: 700, percentage: 0, unit: "credits" },
    upgradeUrl: "https://qoder.com.cn/account/usage",
  };

  const addOnOnly: QoderQuotaUsage = {
    userType: "personal_standard",
    totalUsagePercentage: 0,
    expiresAt: NEVER_EXPIRES,
    userQuota: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "credits" },
    addOnQuota: { total: 800, used: 0, remaining: 800, percentage: 0, unit: "credits" },
    upgradeUrl: "https://qoder.com.cn/account/usage",
  };

  it("puts every bar, number and note on one grid", () => {
    const fixedNow = Date.UTC(2026, 8, 27, 10, 0, 0);
    expect(formatQoderUsage(twoBuckets, "cn", fixedNow).lines).toEqual([
      "Qoder CN Plan (personal_standard)",
      `Overall      [${bar(3)}]                      12.5%  used`,
      `Plan quota   [${bar(3)}]  250 / 2000 credits  12.5%  1750 left`,
      `Add-on       [${bar(0)}]    0 /  700 credits     0%   700 left`,
      "Daily reset  00:00 UTC+8 (in 6h 0m)",
      "Expires      never",
      "Manage       https://qoder.com.cn/account/usage",
    ]);
  });

  it("shrinks the grid to the rows it actually rendered", () => {
    const fixedNow = Date.UTC(2026, 8, 27, 10, 0, 0);
    expect(formatQoderUsage(addOnOnly, "cn", fixedNow).lines).toEqual([
      "Qoder CN Plan (personal_standard)",
      `Overall      [${bar(0)}]                   0%  used`,
      `Add-on       [${bar(0)}]  0 / 800 credits  0%  800 left`,
      "Daily reset  00:00 UTC+8 (in 6h 0m)",
      "Expires      never",
      "Manage       https://qoder.com.cn/account/usage",
    ]);
  });

  it("keeps the layout identical when colour is on", () => {
    const plain = formatQoderUsage(twoBuckets, "cn", Date.now(), { color: false }).lines;
    const colored = formatQoderUsage(twoBuckets, "cn", Date.now(), { color: true }).lines;
    expect(colored.map(stripAnsi)).toEqual(plain);
    // 12.5% is still room to breathe, so the gauge is green and the title is bold.
    expect(colored[0]).toBe(`\x1b[1m${plain[0]}\x1b[0m`);
    expect(colored[1]).toContain(`\x1b[32m${"\u2588".repeat(3)}\x1b[0m`);
    expect(colored[1]).not.toContain("\x1b[31m");
  });

  it("turns the gauge red and names the state once the quota is gone", () => {
    const lines = formatQoderUsage(
      {
        ...twoBuckets,
        isQuotaExceeded: true,
        totalUsagePercentage: 100,
        userQuota: { total: 2000, used: 2000, remaining: 0, percentage: 100, unit: "credits" },
        addOnQuota: undefined,
      },
      "cn",
      Date.now(),
      { color: true },
    ).lines;
    expect(lines.some((line) => line.includes("\x1b[31m\x1b[1m"))).toBe(true);
    expect(stripAnsi(lines.join("\n"))).toMatch(/Status\s+quota exceeded/);
  });

  it("derives a percentage the API omitted and drops columns for buckets it did not send", () => {
    expect(
      formatQoderUsage({ userType: "x", userQuota: { total: 700, used: 175, remaining: 525, unit: "credits" } }, "cn")
        .lines[2],
    ).toBe(`Plan quota  [${bar(5)}]  175 / 700 credits  25%  525 left`);
    expect(formatQoderUsage({ userType: "pro", totalUsagePercentage: 0 }, "cn").lines[2]).toBe(
      "Buckets  none returned",
    );
  });

  it("keeps the bar honest when the live API reports a 0-1 fraction", () => {
    // Captured from GET openapi.qoder.com.cn/api/v2/quota/usage: a 1500/1600
    // add-on arrives with percentage 0.94, which used to render as "0.9%" with
    // an empty bar and a permanently green gauge.
    const live: QoderQuotaUsage = {
      userType: "personal_standard",
      usageType: "credits",
      totalUsagePercentage: 0.94,
      isQuotaExceeded: false,
      expiresAt: NEVER_EXPIRES,
      userQuota: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "credits" },
      addOnQuota: { total: 1600, used: 1500, remaining: 100, percentage: 0.94, unit: "credits" },
    };
    const output = formatQoderUsage(live, "cn", Date.UTC(2026, 8, 27, 10, 0, 0)).lines.join("\n");
    expect(output).toContain("1500 / 1600 credits");
    expect(output).toContain("93.8%");
    expect(output).toContain("94%");
    expect(output).not.toContain("0.9%");
    // 94% consumed fills nearly the whole gauge.
    expect(output).toContain(bar(19));
  });
});

describe("formatQoderUsage", () => {
  /** The shape returned by the live CN endpoint for a healthy personal plan. */
  const personalPlan: QoderQuotaUsage = {
    userId: "user-1",
    userType: "personal_standard",
    usageType: "credits",
    totalUsagePercentage: 0,
    isQuotaExceeded: false,
    expiresAt: NEVER_EXPIRES,
    upgradeUrl: "https://qoder.com.cn/account/usage",
    userQuota: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "credits" },
    addOnQuota: {
      total: 700,
      used: 0,
      remaining: 700,
      percentage: 0,
      unit: "credits",
      detailUrl: "https://qoder.com.cn/addon",
    },
    isPlanQuotaProrated: false,
  };

  it("titles the view for the CN region and includes the user type", () => {
    const view = formatQoderUsage(personalPlan, "cn");
    expect(view.title).toBe("Qoder CN Plan");
    expect(view.lines[0]).toBe("Qoder CN Plan (personal_standard)");
  });

  it("shows only the buckets that carry an allowance", () => {
    const output = formatQoderUsage(personalPlan, "cn").lines.join("\n");
    expect(output).toContain("Add-on");
    expect(output).not.toContain("Plan quota");
  });

  it("shows both buckets when both carry an allowance", () => {
    const output = formatQoderUsage(
      {
        ...personalPlan,
        userQuota: { total: 2000, used: 500, remaining: 1500, percentage: 25, unit: "credits" },
      },
      "cn",
    ).lines.join("\n");
    expect(output).toContain("500 / 2000 credits");
    expect(output).toContain("Add-on");
  });

  it("prefers the add-on detail URL for Manage, then the upgrade URL, then the console", () => {
    expect(formatQoderUsage(personalPlan, "cn").lines.join("\n")).toMatch(/Manage\s+https:\/\/qoder\.com\.cn\/addon/);
    expect(
      formatQoderUsage({ ...personalPlan, addOnQuota: { total: 1, used: 0, remaining: 1 } }, "cn").lines.join("\n"),
    ).toMatch(/Manage\s+https:\/\/qoder\.com\.cn\/account\/usage/);
    expect(formatQoderUsage({ userId: "u" }, "cn").lines.join("\n")).toMatch(/Manage\s+https:\/\/qoder\.com\.cn/);
  });

  it("flags an exceeded quota and a prorated plan", () => {
    const output = formatQoderUsage(
      { ...personalPlan, isQuotaExceeded: true, isPlanQuotaProrated: true },
      "cn",
    ).lines.join("\n");
    expect(output).toMatch(/Status\s+quota exceeded/);
    expect(output).toMatch(/Note\s+plan quota is prorated/);
  });

  it("notes when no buckets were returned", () => {
    expect(formatQoderUsage({ userId: "u" }, "cn").lines.join("\n")).toMatch(/Buckets\s+none returned/);
  });

  it("renders a year-9999 expiry as never", () => {
    expect(formatQoderUsage(personalPlan, "cn").lines.join("\n")).toMatch(/Expires\s+never/);
  });

  it("titles the view for the global region", () => {
    expect(formatQoderUsage(personalPlan, "global").title).toBe("Qoder AI Plan");
  });
});

describe("fetchQoderQuota", () => {
  it("names the recovery step when the token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid token", { status: 401, statusText: "Unauthorized" })),
    );
    await expect(fetchQoderQuota("bad-token", "cn")).rejects.toThrow(/Re-login with \/login qoder-cn/);
  });

  it("surfaces a non-JSON error body so a proxy block is diagnosable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>blocked</html>", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(fetchQoderQuota("token", "cn")).rejects.toThrow(/502 Bad Gateway[\s\S]*<html>blocked<\/html>/);
  });

  it("rejects a 200 response that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(fetchQoderQuota("token", "cn")).rejects.toThrow(/not JSON/);
  });

  it("targets the CN usage endpoint with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: "u" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchQoderQuota("secret-token", "cn");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openapi.qoder.com.cn/api/v2/quota/usage");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret-token" });
  });
});

describe("formatQoderUsage enterprise payloads", () => {
  it("renders the org resource package when personal buckets are absent", () => {
    const enterprise: QoderQuotaUsage = {
      userType: "enterprise",
      usageType: "credits",
      totalUsagePercentage: 0,
      isQuotaExceeded: false,
      expiresAt: 1792857600000,
      orgResourcePackage: {
        used: 742,
        remaining: 2258,
        percentage: 0.25,
        unit: "credits",
        cap: 3000,
      },
    };

    const lines = formatQoderUsage(enterprise, "cn").lines;
    const joined = lines.join("\n");
    expect(lines[0]).toContain("Qoder CN Plan (enterprise)");
    // The overall gauge must come from the org package, not the meaningless 0%.
    expect(lines[1]).toContain("24.7%");
    expect(joined).toContain("Enterprise");
    expect(joined).toContain("742 / 3000 credits");
    expect(joined).toContain("2258 left");
    expect(joined).not.toContain("none returned");
    expect(joined).toContain("Expires");
    expect(joined).not.toContain("Resets");
  });

  it("treats the reported org percentage as a fraction, not a percent", () => {
    const enterprise: QoderQuotaUsage = {
      userType: "enterprise",
      orgResourcePackage: { used: 742, remaining: 2258, percentage: 0.25, unit: "credits", cap: 3000 },
    };

    const joined = formatQoderUsage(enterprise, "cn").lines.join("\n");
    // 0.25 rendered as a percent would be a 20x underestimate of the bar.
    expect(joined).toContain("24.7%");
    expect(joined).not.toContain("0.3%");
  });
});

describe("formatQoderUsage user identity", () => {
  const personal: QoderQuotaUsage = {
    userType: "personal",
    totalUsagePercentage: 12.5,
    userQuota: { total: 2000, used: 250, remaining: 1750, percentage: 12.5, unit: "credits" },
  };

  it("renders the stored identity as a User note", () => {
    const lines = formatQoderUsage(personal, "cn", Date.now(), {
      user: { name: "alice", email: "alice@example.com" },
    }).lines;
    const joined = lines.join("\n");
    expect(joined).toContain("User");
    expect(joined).toContain("alice \u00b7 alice@example.com");
  });

  it("falls back to the email alone when no name is stored", () => {
    const lines = formatQoderUsage(personal, "cn", Date.now(), {
      user: { email: "alice@example.com" },
    }).lines;
    expect(lines.join("\n")).toContain("alice@example.com");
  });

  it("omits the User note when no identity is provided", () => {
    const joined = formatQoderUsage(personal, "cn").lines.join("\n");
    expect(joined).not.toContain("User ");
  });
});

describe("estimateRollingAddOnExpiry", () => {
  it("returns null when no add-on quota exists or remaining is zero", () => {
    expect(estimateRollingAddOnExpiry(undefined)).toBeNull();
    expect(estimateRollingAddOnExpiry({ total: 0, used: 0, remaining: 0 })).toBeNull();
    expect(estimateRollingAddOnExpiry({ total: 1000, used: 1000, remaining: 0 })).toBeNull();
  });

  it("calculates earliest active pack when multiple packs are partially consumed", () => {
    // 14 packs (1400 total), 353 used -> 3 packs fully consumed, pack 4 (index 3) is active
    // 10 days before today's pack
    const now = Date.parse("2026-10-03T03:31:47Z");
    const latestExpiry = Date.parse("2026-11-02T03:31:47Z");
    const res = estimateRollingAddOnExpiry({ total: 1400, used: 353, remaining: 1047 }, latestExpiry, now);

    expect(res).not.toBeNull();
    expect(res?.totalPacks).toBe(14);
    expect(res?.consumedPacks).toBe(3);
    expect(res?.earliestRemaining).toBe(47); // 100 - (353 % 100)
    expect(res?.earliestDate).toBe("2026-10-23");
    expect(res?.daysRemaining).toBe(20);
  });

  it("handles single pack or untouched packs", () => {
    const now = Date.parse("2026-10-03T03:31:47Z");
    const latestExpiry = Date.parse("2026-11-02T03:31:47Z");
    const res = estimateRollingAddOnExpiry({ total: 100, used: 0, remaining: 100 }, latestExpiry, now);

    expect(res?.totalPacks).toBe(1);
    expect(res?.consumedPacks).toBe(0);
    expect(res?.earliestDate).toBe("2026-11-02");
    expect(res?.daysRemaining).toBe(30);
  });
});

describe("formatQoderUsage checkin and rolling expiry display", () => {
  const standardWithAddon: QoderQuotaUsage = {
    userType: "personal_standard",
    totalUsagePercentage: 0.252,
    addOnQuota: {
      total: 1400,
      used: 353,
      remaining: 1047,
      percentage: 0.252,
      unit: "credits",
    },
  };

  it("displays claimed checkin details and rolling expiry", () => {
    const fixedNow = Date.parse("2026-10-03T03:31:47Z");
    const joined = formatQoderUsage(standardWithAddon, "cn", fixedNow, {
      checkin: {
        claimed: true,
        amount: 100,
        expiresAt: "2026-11-02T03:31:47Z",
      },
    }).lines.join("\n");

    expect(joined).toContain("Today checkin");
    expect(joined).toMatch(/100 Credits claimed \(expires 2026-11-02/);
    expect(joined).toContain("Add-on expiry");
    expect(joined).toContain("Rolling 30d (earliest active pack ~2026-10-23");
    expect(joined).toContain("~47 credits");
  });

  it("displays unclaimed prompt when checkin is available", () => {
    const joined = formatQoderUsage(standardWithAddon, "cn", Date.now(), {
      checkin: {
        claimed: false,
        amount: 100,
      },
    }).lines.join("\n");

    expect(joined).toContain("Today checkin");
    expect(joined).toContain("100 Credits available (run /qoder-cn.claim)");
  });
});

describe("fetchQoderUsageForMode", () => {
  const credentials = { access: "jt-test" } as unknown as Parameters<typeof fetchQoderUsageForMode>[0];

  function stubJson(payload: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("counts the add-on credits a zeroed plan bucket would hide", async () => {
    // Captured from the live CN endpoint: the plan bucket is all zeros while
    // 100 spendable credits sit in the add-on, and expiresAt is the year-9999
    // sentinel. The provider surface used to report "0.00 credits remaining"
    // and a reset date in 8000 years for exactly this payload.
    const fetchMock = stubJson({
      userType: "personal_standard",
      totalUsagePercentage: 0.94,
      expiresAt: NEVER_EXPIRES,
      userQuota: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "credits" },
      addOnQuota: { total: 1600, used: 1500, remaining: 100, percentage: 0.94, unit: "credits" },
    });

    const usage = await fetchQoderUsageForMode(credentials, "cn");

    expect(usage.summary).toBe("100 credits remaining");
    expect(usage.usageBuckets?.map((bucket) => bucket.id)).toEqual(["add-on-quota"]);
    expect(usage.usageBuckets?.[0]).toMatchObject({ usedDisplay: "1500.00", limitDisplay: "1600.00" });
    expect(usage.resetAt).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openapi.qoder.com.cn/api/v2/quota/usage");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer jt-test" });
  });

  it("reports the enterprise pool and a real expiry date", async () => {
    const expiresAt = Date.UTC(2026, 9, 31);
    stubJson({ orgResourcePackage: { cap: 5000, used: 400, remaining: 4600, unit: "credits" }, expiresAt });

    const usage = await fetchQoderUsageForMode(credentials, "cn");

    expect(usage.summary).toBe("4600 credits remaining");
    expect(usage.usageBuckets?.[0]).toMatchObject({
      id: "org-resource-package",
      limitDisplay: "5000.00",
      resetAt: new Date(expiresAt).toISOString(),
    });
  });

  it("totals every bucket that carries credits", async () => {
    stubJson({
      userQuota: { total: 2000, used: 500, remaining: 1500, unit: "credits" },
      addOnQuota: { total: 300, used: 100, remaining: 200, unit: "credits" },
    });

    const usage = await fetchQoderUsageForMode(credentials, "cn");

    expect(usage.summary).toBe("1700 credits remaining");
    expect(usage.usageBuckets?.map((bucket) => bucket.id)).toEqual(["user-quota", "add-on-quota"]);
  });

  it("tolerates buckets sent without numbers instead of throwing", async () => {
    stubJson({ userQuota: { total: 100, unit: "credits" } });

    const usage = await fetchQoderUsageForMode(credentials, "cn");

    expect(usage.usageBuckets?.[0]).toMatchObject({ usedDisplay: "0.00", limitDisplay: "100.00" });
    expect(usage.summary).toBe("0 credits remaining");
  });

  it("surfaces a rejected credential with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401, statusText: "Unauthorized" })),
    );

    await expect(fetchQoderUsageForMode(credentials, "cn")).rejects.toThrow(/401 Unauthorized/);
  });
});
