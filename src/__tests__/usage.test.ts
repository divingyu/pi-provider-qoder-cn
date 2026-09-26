import { afterEach, describe, expect, it, vi } from "vitest";
import type { QoderQuotaUsage } from "../commands/usage.js";
import {
  fetchQoderQuota,
  formatAmount,
  formatBucketLine,
  formatPercent,
  formatQoderUsage,
  formatResetTime,
  usageBar,
} from "../commands/usage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Year 9999, the sentinel Qoder sends for a plan that does not reset. */
const NEVER_EXPIRES = 253402214400000;

describe("usageBar", () => {
  it("fills proportionally to the percentage", () => {
    expect(usageBar(0, 10)).toBe("[----------]");
    expect(usageBar(50, 10)).toBe("[#####-----]");
    expect(usageBar(100, 10)).toBe("[##########]");
  });

  it("clamps values outside 0-100", () => {
    expect(usageBar(-10, 10)).toBe("[----------]");
    expect(usageBar(250, 10)).toBe("[##########]");
  });

  it("renders unknown rather than empty when the percentage is absent", () => {
    expect(usageBar(undefined, 4)).toBe("[????]");
    expect(usageBar(Number.NaN, 3)).toBe("[???]");
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

describe("formatBucketLine", () => {
  it("renders used, limit and remaining with the API percentage", () => {
    const line = formatBucketLine("Plan quota", {
      used: 0,
      total: 700,
      remaining: 700,
      percentage: 0,
      unit: "credits",
    });
    expect(line).toContain("Plan quota: 0 credits / 700 credits used (0%)");
    expect(line).toContain("700 credits left");
  });

  it("derives the percentage when the API omits it", () => {
    const line = formatBucketLine("Add-on quota", { used: 175, total: 700, remaining: 525, unit: "credits" });
    expect(line).toContain("(25%)");
  });

  it("defaults the unit to credits", () => {
    expect(formatBucketLine("Plan quota", { used: 1, total: 2, remaining: 1 })).toContain("1 credits / 2 credits");
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
    expect(output).toContain("Add-on quota");
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
    expect(output).toContain("Plan quota: 500 credits / 2000 credits used (25%)");
    expect(output).toContain("Add-on quota");
  });

  it("prefers the add-on detail URL for Manage, then the upgrade URL, then the console", () => {
    expect(formatQoderUsage(personalPlan, "cn").lines.join("\n")).toContain("Manage: https://qoder.com.cn/addon");
    expect(
      formatQoderUsage({ ...personalPlan, addOnQuota: { total: 1, used: 0, remaining: 1 } }, "cn").lines.join("\n"),
    ).toContain("Manage: https://qoder.com.cn/account/usage");
    expect(formatQoderUsage({ userId: "u" }, "cn").lines.join("\n")).toContain("Manage: https://qoder.com.cn");
  });

  it("flags an exceeded quota and a prorated plan", () => {
    const output = formatQoderUsage(
      { ...personalPlan, isQuotaExceeded: true, isPlanQuotaProrated: true },
      "cn",
    ).lines.join("\n");
    expect(output).toContain("! quota exceeded");
    expect(output).toContain("(plan quota is prorated)");
  });

  it("notes when no buckets were returned", () => {
    expect(formatQoderUsage({ userId: "u" }, "cn").lines.join("\n")).toContain("No quota buckets returned.");
  });

  it("renders a year-9999 expiry as never", () => {
    expect(formatQoderUsage(personalPlan, "cn").lines.join("\n")).toContain("Resets: never");
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
