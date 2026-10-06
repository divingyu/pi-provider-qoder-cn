import { describe, expect, it } from "vitest";
import {
  formatQueueFigure,
  formatWaitMinutes,
  isQueueEnvelope,
  MAX_QUEUE_RETRIES,
  parseQueueNotice,
  sleep,
} from "../protocol/queue.js";

/**
 * Payloads are copied verbatim from real gateway responses, including the
 * triple JSON encoding. Keeping them byte-accurate is what makes the parser
 * trustworthy: the nesting is the whole difficulty.
 */
function queueEnvelope(inner: Record<string, unknown>) {
  return {
    statusCodeValue: 403,
    body: JSON.stringify({
      code: "403",
      message: JSON.stringify({ code: "10605", message: JSON.stringify(inner) }),
    }),
  };
}

describe("parseQueueNotice", () => {
  it("reads the queue notice out of the deeply nested gateway body", () => {
    const notice = parseQueueNotice(
      queueEnvelope({
        isQueued: true,
        modelKey: "qfmodel",
        queueCount: 6228,
        queueType: "p3",
        retryAfterSeconds: 30,
        serviceAvailable: true,
        waitTime: 193,
      }),
    );

    expect(notice).toEqual({ retryAfterMs: 30_000, waitTimeSeconds: 193, queueCount: 6228, serviceAvailable: true });
  });

  it("returns null for a normal streaming envelope", () => {
    expect(parseQueueNotice({ statusCodeValue: 200, body: '{"choices":[{"delta":{"content":"hi"}}]' })).toBeNull();
  });

  it("returns null for a non-queue 403 so real errors are still reported", () => {
    const envelope = {
      statusCodeValue: 403,
      body: JSON.stringify({ code: "403", message: JSON.stringify({ code: "10403", message: "not authorized" }) }),
    };

    expect(parseQueueNotice(envelope)).toBeNull();
    expect(isQueueEnvelope(envelope)).toBe(false);
  });

  it("falls back to a sane wait when the gateway omits retryAfterSeconds", () => {
    const notice = parseQueueNotice(queueEnvelope({ isQueued: true, queueCount: 12 }));

    expect(notice?.retryAfterMs).toBe(30_000);
    expect(notice?.waitTimeSeconds).toBe(0);
  });

  it("caps an absurd wait so a session cannot hang", () => {
    const notice = parseQueueNotice(queueEnvelope({ isQueued: true, retryAfterSeconds: 999_999 }));

    expect(notice?.retryAfterMs).toBe(120_000);
  });

  it("ignores non-JSON noise and malformed bodies", () => {
    expect(parseQueueNotice({ statusCodeValue: 403, body: "<html>502</html>" })).toBeNull();
    expect(parseQueueNotice(undefined)).toBeNull();
    expect(parseQueueNotice("nope")).toBeNull();
  });

  it("finds the notice no matter which level it is nested at", () => {
    // Flattened by one level on purpose: the gateway has changed this before.
    const notice = parseQueueNotice({
      statusCodeValue: 403,
      body: JSON.stringify({ code: "10605", message: JSON.stringify({ isQueued: true, retryAfterSeconds: 5 }) }),
    });

    expect(notice?.retryAfterMs).toBe(5_000);
  });
});

describe("queue retry policy", () => {
  it("retries a bounded number of times", () => {
    expect(MAX_QUEUE_RETRIES).toBeGreaterThan(0);
    expect(MAX_QUEUE_RETRIES).toBeLessThanOrEqual(5);
  });

  it("sleep resolves after the delay", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });

  it("sleep rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toThrow(/queue/i);
  });

  it("sleep rejects when the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/queue/i);
  });
});

describe("parseQueueNotice serviceAvailable", () => {
  it("只在网关真给了布尔值时上报（真机 saturated 时段是 false + queueCount:0）", () => {
    const down = parseQueueNotice(
      queueEnvelope({
        isQueued: true,
        queueCount: 0,
        queueType: "p3",
        retryAfterSeconds: 30,
        serviceAvailable: false,
        waitTime: 30,
      }),
    );
    expect(down?.serviceAvailable).toBe(false);

    const up = parseQueueNotice(
      queueEnvelope({ isQueued: true, queueCount: 6228, retryAfterSeconds: 30, serviceAvailable: true, waitTime: 193 }),
    );
    expect(up?.serviceAvailable).toBe(true);

    // 缺失绝不能被当成“不可服务”，否则正常排队会被误判为硬失败
    const omitted = parseQueueNotice(queueEnvelope({ isQueued: true, queueCount: 12 }));
    expect(omitted?.serviceAvailable).toBeUndefined();
  });
});

describe("queue 数字格式化：不能把硬失败写成可重试文案", () => {
  // pi-ai 的 isRetryableAssistantError() 对 errorMessage 做子串匹配，包含 "429"/"500"/"502"/
  // "503"/"520"/"524"。直接把队列真实数字（如 5204、503s）内插进去，会把“请切 provider”
  // 误分类成瞬时错误，导致再多烧一轮完整的排队等待。所以文案里的数字最多 2 位连续。
  const TRANSIENT = /(429|500|502|503|520|524)/;

  it("formatQueueFigure 最多留两位连续数字", () => {
    expect(formatQueueFigure(0)).toBe("0");
    expect(formatQueueFigure(42)).toBe("42");
    expect(formatQueueFigure(520)).toBe("0.5k");
    expect(formatQueueFigure(5204)).toBe("5.2k");
    expect(formatQueueFigure(6228)).toBe("6.2k");
    expect(formatQueueFigure(1_520_000)).toBe("1.5M");
  });

  it("formatWaitMinutes 不产生连续 3 位", () => {
    expect(formatWaitMinutes(30)).toBe("1"); // 30s 四舍五入到 1 分钟
    expect(formatWaitMinutes(20)).toBe("1");
    expect(formatWaitMinutes(0)).toBe("<1");
    expect(formatWaitMinutes(503)).toBe("8");
    expect(formatWaitMinutes(60 * 200)).toBe("99");
  });

  it("最坏入参的完整文案也不命中可重试子串", () => {
    const message =
      `Qoder 上游暂不可服务（网关报 serviceAvailable:false；队列位置 ${formatQueueFigure(5204)}，` +
      `预计 ${formatWaitMinutes(503)} 分钟内放行）。已按 Retry-After 等待并重试 1 次，仍未放行。` +
      `这不是凭证或额度问题，请用 /model 切换其他 Provider，或稍后重试。`;
    expect(message).not.toMatch(TRANSIENT);
    // 对照：直接内插真实数字就会命中
    expect(`队列位置 5204，预计 503s`).toMatch(TRANSIENT);
  });

  it("英文容量文案改用分钟，同样不命中", () => {
    const message =
      `Qoder is at capacity: the request stayed queued after 4 attempts ` +
      `(~${formatWaitMinutes(503)} min wait reported). Try again shortly.`;
    expect(message).not.toMatch(TRANSIENT);
  });
});
