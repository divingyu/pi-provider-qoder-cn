import { describe, expect, it } from "vitest";
import { formatQoderStreamError, getBeijingDailyResetCountdown, parseQoderErrorPayload } from "../protocol/errors.js";

describe("formatQoderStreamError mode routing", () => {
  const expired = '{"code":"105","message":"Login expired"}';

  it("defaults to the established CN wording", () => {
    const out = formatQoderStreamError(403, expired);
    expect(out).toContain("[Qoder CN 凭证失效]");
    expect(out).toContain("/login qoder-cn");
  });

  it("routes global 105 wording to /login qoder and keeps the detection tokens", () => {
    const out = formatQoderStreamError(403, expired, Date.now(), "global");
    expect(out).toMatch(/\/login qoder[.\n]/);
    expect(out).not.toContain("qoder-cn");
    // isCredentialExpiredError anchors must survive the English variant.
    expect(out).toContain("错误码 105");
    expect(out).toContain("凭证失效");
  });

  it("uses the global store for exhausted-credits guidance", () => {
    const out = formatQoderStreamError(403, '{"code":"113","message":"credits exhausted"}', Date.now(), "global");
    expect(out).toContain("https://qoder.com");
    expect(out).not.toContain("qoder.com.cn");
  });
});

describe("parseQoderErrorPayload", () => {
  it("parses direct JSON string", () => {
    const res = parseQoderErrorPayload('{"code":"110","message":"Billing daily count exceeded"}');
    expect(res).toEqual({ code: "110", message: "Billing daily count exceeded" });
  });

  it("parses nested JSON string inside message", () => {
    const res = parseQoderErrorPayload(
      JSON.stringify({ code: "403", message: JSON.stringify({ code: "110", message: "nested error" }) }),
    );
    expect(res).toEqual({ code: "110", message: "nested error" });
  });

  it("handles object input", () => {
    const res = parseQoderErrorPayload({ code: 117, message: "Team member Credits exhausted" });
    expect(res).toEqual({ code: "117", message: "Team member Credits exhausted" });
  });

  it("returns null for non-JSON or missing fields", () => {
    expect(parseQoderErrorPayload("<html>502</html>")).toBeNull();
    expect(parseQoderErrorPayload(null)).toBeNull();
  });
});

describe("getBeijingDailyResetCountdown", () => {
  it("calculates hours and minutes to midnight UTC+8", () => {
    // 2026-09-27 10:00:00 UTC = 18:00:00 Beijing time -> 6 hours to midnight
    const now = Date.UTC(2026, 8, 27, 10, 0, 0);
    const countdown = getBeijingDailyResetCountdown(now);
    expect(countdown).toBe("6小时0分钟");
  });

  it("formats under one hour as minutes", () => {
    // 2026-09-27 15:45:00 UTC = 23:45:00 Beijing time -> 15 minutes to midnight
    const now = Date.UTC(2026, 8, 27, 15, 45, 0);
    const countdown = getBeijingDailyResetCountdown(now);
    expect(countdown).toBe("15分钟");
  });
});

describe("formatQoderStreamError", () => {
  const now = Date.UTC(2026, 8, 27, 10, 0, 0); // 6 hours remaining

  it("formats code 110 with daily reset countdown and action advice", () => {
    const err = formatQoderStreamError(403, '{"code":"110","message":"Billing daily count exceeded"}', now);
    expect(err).toContain("[Qoder CN 额度限制]");
    expect(err).toContain("今日调用次数已达上限");
    expect(err).toContain("约 6小时0分钟后");
    expect(err).toContain("个人标准版（免费版）");
    expect(err).toContain("企业版请联系管理员");
  });

  it("formats code 117 for enterprise team member limits", () => {
    const err = formatQoderStreamError(403, '{"code":"117","message":"Team member Credits exhausted"}', now);
    expect(err).toContain("[Qoder CN 企业额度限制]");
    expect(err).toContain("企业分配给您的个人 Credits 额度已用尽");
    expect(err).toContain("联系企业管理员在 Qoder 团队管理后台为您增加成员 Credits 配额");
  });

  it("formats code 116 for enterprise admin balance exhaustion", () => {
    const err = formatQoderStreamError(403, '{"code":"116","message":"Team administrator Credits exhausted"}', now);
    expect(err).toContain("[Qoder CN 企业额度限制]");
    expect(err).toContain("企业/团队管理员的 Credits 总余额已耗尽");
    expect(err).toContain("联系企业管理员在控制台为组织账户充值或续期");
  });

  it("formats code 122 for enterprise billing group limits", () => {
    const err = formatQoderStreamError(403, '{"code":"122","message":"Billing-group Credits limit reached"}', now);
    expect(err).toContain("[Qoder CN 企业计费组限制]");
    expect(err).toContain("您所在的企业计费组已达到本期支出上限");
    expect(err).toContain("联系计费管理员或企业管理员调整该计费组的周期支出上限");
  });

  it("formats code 119 for model free tier limits", () => {
    const err = formatQoderStreamError(
      403,
      '{"code":"119","message":"Free usage limit for the selected model reached"}',
      now,
    );
    expect(err).toContain("[Qoder CN 模型限免额度已满]");
    expect(err).toContain("当前模型的免费体验额度已用完");
    expect(err).toContain("约 6小时0分钟后");
    expect(err).toContain("切换至其他付费模型");
  });

  it("formats code 113/118 for general credit exhaustion", () => {
    const err = formatQoderStreamError(403, '{"code":"113","message":"Usage quota exhausted"}', now);
    expect(err).toContain("[Qoder CN 额度耗尽]");
    expect(err).toContain("账户 Credits 余额已全部用尽");
    expect(err).toContain("购买资源包/加油包");
  });

  it("formats code 105 for credential expiry", () => {
    const err = formatQoderStreamError(401, '{"code":"105","message":"Login or access token expired"}', now);
    expect(err).toContain("[Qoder CN 凭证失效]");
    expect(err).toContain("重新运行 /login qoder-cn");
  });

  it("falls back to upstream status and raw payload for unknown errors", () => {
    const err = formatQoderStreamError(502, "<html>Bad Gateway</html>", now);
    expect(err).toBe("Upstream status 502: <html>Bad Gateway</html>");
  });
});
