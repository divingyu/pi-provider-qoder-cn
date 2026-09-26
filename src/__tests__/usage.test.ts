import { afterEach, describe, expect, it, vi } from "vitest";
import type { QoderQuotaUsage } from "../commands/usage.js";
import {
  fetchQoderQuota,
  formatAmount,
  formatPercent,
  formatQoderUsage,
  formatResetTime,
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
});

describe("formatResetTime", () => {
  it("renders the year-9999 sentinel as never", () => {
    expect(formatResetTime(NEVER_EXPIRES)).toBe("never");
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
    expect(formatQoderUsage(twoBuckets, "cn").lines).toEqual([
      "Qoder CN Plan (personal_standard)",
      `Overall     [${bar(3)}]                      12.5%  used`,
      `Plan quota  [${bar(3)}]  250 / 2000 credits  12.5%  1750 left`,
      `Add-on      [${bar(0)}]    0 /  700 credits     0%   700 left`,
      "Resets      never",
      "Manage      https://qoder.com.cn/account/usage",
    ]);
  });

  it("shrinks the grid to the rows it actually rendered", () => {
    expect(formatQoderUsage(addOnOnly, "cn").lines).toEqual([
      "Qoder CN Plan (personal_standard)",
      `Overall  [${bar(0)}]                   0%  used`,
      `Add-on   [${bar(0)}]  0 / 800 credits  0%  800 left`,
      "Resets   never",
      "Manage   https://qoder.com.cn/account/usage",
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
    expect(formatQoderUsage(personalPlan, "cn").lines.join("\n")).toMatch(/Resets\s+never/);
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
