import { describe, expect, it } from "vitest";
import {
  isQoderCNModelId,
  prettifyQoderCNModelName,
  QODER_CN_FRIENDLY_MODELS,
  slugifyQoderCNModel,
  toQoderCNModelInfo,
  toQoderCNUpstreamKey,
} from "../cn-naming.js";

/**
 * These ids are persisted in `settings.json` (`enabledModels`) and referenced by
 * existing session files. Changing any of them silently disables the model for
 * every existing user, so they are pinned as a compatibility contract.
 */
const PINNED_IDS: Readonly<Record<string, string>> = {
  auto: "auto",
  qmodel_38max: "qwen3.8-max",
  qfmodel: "qwen3.8-flash",
  qmodel_latest: "qwen3.7-max",
  qmodel: "qwen3.7-plus",
  q37fmodel: "qwen3.7-flash",
  dmodel: "deepseek-v4-pro",
  dfmodel: "deepseek-v4-flash",
  gmodel: "glm-5.3",
  gfmodel: "glm-5.3-flash",
  gm51model: "glm-5.2",
  kmodel_latest: "kimi-k3",
  kmodel: "kimi-k2.7-code",
  mmodel: "minimax-m2.7",
};

describe("Qoder CN friendly ids", () => {
  it("keeps every pinned model id stable", () => {
    for (const [upstreamKey, expectedId] of Object.entries(PINNED_IDS)) {
      expect(QODER_CN_FRIENDLY_MODELS[upstreamKey]?.id, upstreamKey).toBe(expectedId);
    }
  });

  it("uses only lowercase slug ids, never a raw upstream key", () => {
    for (const [upstreamKey, info] of Object.entries(QODER_CN_FRIENDLY_MODELS)) {
      expect(info.id).toBe(info.id.toLowerCase());
      expect(info.id).toMatch(/^[a-z0-9._-]+$/);
      if (upstreamKey !== "auto") expect(info.id).not.toBe(upstreamKey);
    }
  });

  it("decorates every label with the region", () => {
    for (const info of Object.values(QODER_CN_FRIENDLY_MODELS)) {
      expect(info.name).toContain("Qoder CN");
    }
  });

  it("resolves the curated table ahead of the display name", () => {
    // The CN catalog has shipped Kimi-K2.6/2.7/2.8 under the same `kmodel` key;
    // the curated id must win so the id does not drift with the display name.
    expect(toQoderCNModelInfo("kmodel", "Kimi-K2.8-Preview").id).toBe("kimi-k2.7-code");
    expect(toQoderCNModelInfo("qfmodel", "Qwen3.6-Flash").id).toBe("qwen3.8-flash");
  });

  it("slugifies a newly launched model that is not in the table", () => {
    expect(toQoderCNModelInfo("brandnew", "Qwen 4.0 Ultra").id).toBe("qwen-4.0-ultra");
    expect(toQoderCNModelInfo("brandnew", "Qwen 4.0 Ultra").name).toContain("Qoder CN");
  });

  it("falls back to a stable slug when the display name is unusable", () => {
    expect(slugifyQoderCNModel("!!!")).toBe("qodermodel");
    expect(slugifyQoderCNModel("")).toBe("qodermodel");
    expect(slugifyQoderCNModel(undefined)).toBe("qodermodel");
  });
});

describe("toQoderCNUpstreamKey", () => {
  it("maps a friendly slug back to the key sent upstream", () => {
    expect(toQoderCNUpstreamKey("qwen3.8-flash")).toBe("qfmodel");
    expect(toQoderCNUpstreamKey("qwen3.8-max")).toBe("qmodel_38max");
    expect(toQoderCNUpstreamKey("kimi-k2.7-code")).toBe("kmodel");
  });

  it("maps legacy aliases the catalog shipped under other keys", () => {
    expect(toQoderCNUpstreamKey("qwen3.6-flash")).toBe("qfmodel");
    expect(toQoderCNUpstreamKey("kimi-k2.6")).toBe("kmodel");
    expect(toQoderCNUpstreamKey("glm-5.1")).toBe("gm51model");
    expect(toQoderCNUpstreamKey("minimax-m3")).toBe("mmodel");
  });

  it("passes a raw upstream key through unchanged", () => {
    expect(toQoderCNUpstreamKey("qfmodel")).toBe("qfmodel");
    expect(toQoderCNUpstreamKey("qmodel_latest")).toBe("qmodel_latest");
  });

  it("defaults to auto for an empty id", () => {
    expect(toQoderCNUpstreamKey("")).toBe("auto");
    expect(toQoderCNUpstreamKey(undefined)).toBe("auto");
  });
});

describe("prettifyQoderCNModelName", () => {
  it("inserts a space after Qwen version numbers", () => {
    expect(prettifyQoderCNModelName("Qwen3.8-Max")).toBe("Qwen 3.8-Max · Qoder CN");
  });

  it("re-spaces a DeepSeek name written without a separator", () => {
    // The rule keys off `V<digit>` immediately following `DeepSeek`; it splits a
    // run-together name into words, while the catalog's hyphenated spelling
    // (`DeepSeek-V4-Pro`) already reads correctly and passes through unchanged.
    expect(prettifyQoderCNModelName("DeepSeekV4-Pro")).toBe("DeepSeek V4 Pro · Qoder CN");
    expect(prettifyQoderCNModelName("DeepSeek-V4-Pro")).toBe("DeepSeek-V4-Pro · Qoder CN");
  });

  it("does not double-suffix a label that already names the region", () => {
    expect(prettifyQoderCNModelName("Auto · Qoder CN")).toBe("Auto · Qoder CN");
  });
});

describe("isQoderCNModelId", () => {
  const entry = { key: "qfmodel", display_name: "Qwen3.8-Flash" };

  it("matches the curated slug", () => {
    expect(isQoderCNModelId(entry, "qwen3.8-flash")).toBe(true);
  });

  it("matches the raw upstream key", () => {
    expect(isQoderCNModelId(entry, "qfmodel")).toBe(true);
  });

  it("matches the upstream whitespace-stripped display name", () => {
    expect(isQoderCNModelId(entry, "Qwen3.8-Flash")).toBe(true);
    expect(isQoderCNModelId({ key: "qmodel", display_name: "Qwen 3.7 Plus" }, "qwen3.7plus")).toBe(true);
  });

  it("does not match an unrelated id or a missing entry", () => {
    expect(isQoderCNModelId(entry, "qwen3.7-max")).toBe(false);
    expect(isQoderCNModelId(undefined, "qwen3.8-flash")).toBe(false);
  });
});
