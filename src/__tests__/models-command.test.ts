import { afterEach, describe, expect, it, vi } from "vitest";
import { clearQoderModelsMemCache } from "../catalog.js";
import { formatCatalogDiff, refreshCatalog } from "../commands/models.js";

afterEach(() => {
  vi.unstubAllGlobals();
  clearQoderModelsMemCache();
});

/** One catalog entry, in the shape `/algo/api/v2/model/list` returns. */
function entry(key: string, displayName: string) {
  return { key, enable: true, display_name: displayName };
}

function stubCatalog(chat: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ chat }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("formatCatalogDiff", () => {
  it("reports a clean no-change refresh", () => {
    const lines = formatCatalogDiff({ added: [], renamed: [], removed: [], total: 3 }, "cn");
    expect(lines.join("\n")).toContain("No change");
    expect(lines.join("\n")).toContain("3 offered");
  });

  it("names new, renamed and retired models", () => {
    const lines = formatCatalogDiff(
      {
        added: [{ id: "kimi-k4", name: "Kimi-K4 · Qoder CN" }],
        renamed: [{ id: "kimi-k3.1-pro", from: "Kimi-K3 · Qoder CN", to: "Kimi-K3.1-Pro · Qoder CN" }],
        removed: [{ id: "kimi-k2.7-code", name: "Kimi-K2.7-Code · Qoder CN" }],
        total: 4,
      },
      "cn",
    ).join("\n");

    expect(lines).toContain("New (1)");
    expect(lines).toContain("+ kimi-k4");
    expect(lines).toContain("Renamed upstream (1)");
    expect(lines).toContain("Kimi-K3 · Qoder CN -> Kimi-K3.1-Pro · Qoder CN");
    expect(lines).toContain("Gone (1)");
    expect(lines).toContain("- kimi-k2.7-code");
  });

  it("renders without escape codes when colour is off", () => {
    const plain = formatCatalogDiff(
      { added: [{ id: "a", name: "A" }], renamed: [], removed: [], total: 1 },
      "cn",
      false,
    );
    expect(plain.join("\n")).not.toContain("\x1b");
  });
});

describe("refreshCatalog", () => {
  it("reports a renamed generation instead of hiding it", async () => {
    // First refresh: the slot holds Kimi-K3.
    stubCatalog([entry("kmodel_latest", "Kimi-K3")]);
    const first = await refreshCatalog("cn", "token", {});
    expect(first?.added.map((m) => m.id)).toEqual(["kimi-k3"]);
    expect(first?.removed).toEqual([]);

    // Upstream upgrades the same slot to K3.1-Pro: one new id, one retired id.
    stubCatalog([entry("kmodel_latest", "Kimi-K3.1-Pro")]);
    const second = await refreshCatalog("cn", "token", {});

    expect(second?.added.map((m) => m.id)).toEqual(["kimi-k3.1-pro"]);
    expect(second?.removed.map((m) => m.id)).toEqual(["kimi-k3"]);
    expect(second?.total).toBe(1);
  });

  it("drops a model the catalog stops returning", async () => {
    stubCatalog([entry("qfmodel", "Qwen3.8-Flash"), entry("kmodel", "Kimi-K3")]);
    await refreshCatalog("cn", "token", {});

    stubCatalog([entry("qfmodel", "Qwen3.8-Flash")]);
    const diff = await refreshCatalog("cn", "token", {});

    expect(diff?.removed.map((m) => m.id)).toEqual(["kimi-k3"]);
    expect(diff?.total).toBe(1);
  });

  it("calls the re-register hook only when the refresh succeeded", async () => {
    const hook = vi.fn();
    stubCatalog([entry("qfmodel", "Qwen3.8-Flash")]);
    await refreshCatalog("cn", "token", {}, hook);
    expect(hook).toHaveBeenCalledTimes(1);

    hook.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const failed = await refreshCatalog("cn", "token", {}, hook);
    expect(failed).toBeNull();
    expect(hook).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(refreshCatalog("cn", "token", {})).resolves.toBeNull();
  });

  it("keeps the live label when a slot is upgraded, so the picker matches the endpoint", async () => {
    stubCatalog([entry("gmodel", "GLM-5.3")]);
    await refreshCatalog("cn", "token", {});
    stubCatalog([entry("gmodel", "GLM-5.4")]);
    const diff = await refreshCatalog("cn", "token", {});
    expect(diff?.added[0]).toEqual({ id: "glm-5.4", name: "GLM-5.4 · Qoder CN" });
    expect(diff?.removed.map((m) => m.id)).toEqual(["glm-5.3"]);
  });
});
