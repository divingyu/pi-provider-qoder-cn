import { describe, expect, it } from "vitest";
import {
  FIXED_CN_MODEL_IDS,
  isQoderCNModelId,
  LEGACY_CN_MODEL_IDS,
  prettifyQoderCNModelName,
  slugifyQoderCNModel,
  toQoderCNModelInfo,
  toQoderCNUpstreamKey,
} from "../cn-naming.js";

/**
 * The catalog key is a slot; the display name is the model.
 *
 * These tests pin that decision. Upstream has served Kimi-K2.6/2.7/K3/K3.1-Pro
 * under `kmodel_latest` and Qwen 3.6/3.8-Flash under `qfmodel`; deriving identity
 * from the key is what once showed `kimi-k3` while the endpoint answered as
 * Kimi-K3.1-Pro.
 */
describe("Qoder CN model identity", () => {
  it("derives the id from the display name, so an upstream upgrade is a new id", () => {
    // The two generations share one catalog key; they must not share one id.
    expect(toQoderCNModelInfo("kmodel_latest", "Kimi-K3").id).toBe("kimi-k3");
    expect(toQoderCNModelInfo("kmodel_latest", "Kimi-K3.1-Pro").id).toBe("kimi-k3.1-pro");
    expect(toQoderCNModelInfo("qfmodel", "Qwen3.6-Flash").id).toBe("qwen3.6-flash");
    expect(toQoderCNModelInfo("qfmodel", "Qwen3.8-Flash").id).toBe("qwen3.8-flash");
  });

  it("tracks the label too, so the picker names what the endpoint serves", () => {
    expect(toQoderCNModelInfo("kmodel_latest", "Kimi-K3.1-Pro").name).toBe("Kimi-K3.1-Pro · Qoder CN");
    expect(toQoderCNModelInfo("dfmodel", "DeepSeek-Flash").name).toBe("DeepSeek-Flash · Qoder CN");
    expect(toQoderCNModelInfo("mmodel", "MiniMax-M3.1-Flash").name).toBe("MiniMax-M3.1-Flash · Qoder CN");
  });

  it("keeps auto fixed, because routing has no model name to slug", () => {
    expect(FIXED_CN_MODEL_IDS.auto.id).toBe("auto");
    expect(toQoderCNModelInfo("auto", "Auto").id).toBe("auto");
    expect(toQoderCNModelInfo("auto", "Auto").name).toBe("Auto · Qoder CN");
  });

  it("only ever emits lowercase slug ids", () => {
    for (const info of Object.values(FIXED_CN_MODEL_IDS)) {
      expect(info.id).toBe(info.id.toLowerCase());
      expect(info.id).toMatch(/^[a-z0-9._-]+$/);
    }
    for (const display of ["Qwen 4.0 Ultra", "Kimi-K3.1-Pro", "GLM-5.3-Flash", "DeepSeek-Flash"]) {
      expect(toQoderCNModelInfo("k", display).id).toMatch(/^[a-z0-9._-]+$/);
    }
  });

  it("decorates every label with the region exactly once", () => {
    expect(prettifyQoderCNModelName("Kimi-K3.1-Pro")).toBe("Kimi-K3.1-Pro · Qoder CN");
    expect(prettifyQoderCNModelName("Auto · Qoder CN")).toBe("Auto · Qoder CN");
  });

  it("falls back to a stable slug when the display name is unusable", () => {
    expect(slugifyQoderCNModel("!!!")).toBe("qodermodel");
    expect(slugifyQoderCNModel("")).toBe("qodermodel");
    expect(slugifyQoderCNModel(undefined)).toBe("qodermodel");
  });
});

describe("toQoderCNUpstreamKey", () => {
  it("routes a retired id to the key it always used", () => {
    // Retired ids stay routable so `settings.json` and old sessions keep working;
    // the catalog's current occupant of the key answers (see LEGACY_CN_MODEL_IDS).
    expect(toQoderCNUpstreamKey("kimi-k3")).toBe("kmodel_latest");
    expect(toQoderCNUpstreamKey("kimi-k2.7-code")).toBe("kmodel");
    expect(toQoderCNUpstreamKey("minimax-m2.7")).toBe("mmodel");
    expect(toQoderCNUpstreamKey("glm-5.1")).toBe("gm51model");
  });

  it("passes a raw catalog key and a current slug through for the catalog to resolve", () => {
    expect(toQoderCNUpstreamKey("qfmodel")).toBe("qfmodel");
    expect(toQoderCNUpstreamKey("qmodel_latest")).toBe("qmodel_latest");
    // A current slug is resolved by the cached catalog, not by name guessing.
    expect(toQoderCNUpstreamKey("kimi-k3.1-pro")).toBe("kimi-k3.1-pro");
  });

  it("defaults to auto for an empty id", () => {
    expect(toQoderCNUpstreamKey("")).toBe("auto");
    expect(toQoderCNUpstreamKey(undefined)).toBe("auto");
  });

  it("never retires an id implicitly: every legacy id names a real key", () => {
    const keys = new Set(["auto", ...Object.values(LEGACY_CN_MODEL_IDS)]);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9_]+$/);
  });
});

describe("isQoderCNModelId", () => {
  const entry = { key: "qfmodel", display_name: "Qwen3.8-Flash" };

  it("matches the current display-name slug", () => {
    expect(isQoderCNModelId(entry, "qwen3.8-flash")).toBe(true);
  });

  it("matches a retired slug by its upstream key", () => {
    expect(isQoderCNModelId(entry, "qwen3.6-flash")).toBe(true);
  });

  it("matches the raw catalog key", () => {
    expect(isQoderCNModelId(entry, "qfmodel")).toBe(true);
  });

  it("does not match an unrelated id", () => {
    expect(isQoderCNModelId(entry, "kimi-k3")).toBe(false);
    expect(isQoderCNModelId(undefined, "qfmodel")).toBe(false);
  });
});
