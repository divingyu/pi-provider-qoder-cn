import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearQoderModelsMemCache,
  getCachedModelConfig,
  getCachedModels,
  isCacheStale,
  QODER_CACHE_WRITER,
  updateQoderModelsCache,
} from "../catalog.js";
import { loadLiveFixture, responseFromFixture } from "./live-fixture.js";

function testHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

const CACHE_PATHS = {
  global: join(testHome(), ".pi", "agent", "qoder-models-cache.json"),
  cn: join(testHome(), ".pi", "agent", "qoder-cn-models-cache.json"),
};
let originalCaches: Record<keyof typeof CACHE_PATHS, string | undefined>;

beforeEach(() => {
  clearQoderModelsMemCache();
  originalCaches = {
    global: existsSync(CACHE_PATHS.global) ? readFileSync(CACHE_PATHS.global, "utf8") : undefined,
    cn: existsSync(CACHE_PATHS.cn) ? readFileSync(CACHE_PATHS.cn, "utf8") : undefined,
  };
  for (const path of Object.values(CACHE_PATHS)) rmSync(path, { force: true });
  clearQoderModelsMemCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const region of Object.keys(CACHE_PATHS) as Array<keyof typeof CACHE_PATHS>) {
    const path = CACHE_PATHS[region];
    const original = originalCaches[region];
    if (original === undefined) rmSync(path, { force: true });
    else writeFileSync(path, original, "utf8");
  }
  clearQoderModelsMemCache();
});

describe("Qoder model cache", () => {
  it.each([
    ["global", ["Lite", "GLM5.2"]],
    // CN uses the fork's lowercase slug scheme, not the whitespace-stripped
    // display name, so `enabledModels` entries keep working across upgrades.
    ["cn", ["qwen3.7-plus"]],
  ] as const)("maps the %s recorded-format catalog to friendly picker ids", async (region, expectedIds) => {
    const interaction = loadLiveFixture(region).interactions.modelList;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromFixture(interaction)));

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", region);

    const cache = JSON.parse(readFileSync(CACHE_PATHS[region], "utf8"));
    expect(cache.models.map((model: { id: string }) => model.id)).toEqual(expectedIds);
    const catalog = interaction.response.body as { chat: Array<{ key: string; display_name: string }> };
    for (const entry of catalog.chat) {
      if (region === "cn") {
        // The raw upstream key is stored alongside the friendly id so a request
        // resolves no matter which id scheme hands back a model.
        expect(cache.configs[entry.key]?.key).toBe(entry.key);
        expect(getCachedModelConfig(entry.key, region)?.key).toBe(entry.key);
        continue;
      }
      const friendlyId = entry.display_name.replace(/\s+/g, "");
      expect(cache.configs[friendlyId]?.key).toBe(entry.key);
      expect(cache.configs[entry.key]).toBeUndefined();
      expect(getCachedModelConfig(friendlyId, region)?.key).toBe(entry.key);
      expect(getCachedModelConfig(entry.key, region)).toBeNull();
    }
  });

  it("takes the CN id from the display name, so an upgrade lands as a new id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [
              { key: "qmodel_38max", enable: true, display_name: "Qwen3.8-Max" },
              { key: "qfmodel", enable: true, display_name: "Qwen3.8-Flash" },
              { key: "kmodel", enable: true, display_name: "Kimi-K2.8-Preview" },
            ],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "cn");

    const cache = JSON.parse(readFileSync(CACHE_PATHS.cn, "utf8"));
    expect(cache.models.map((model: { id: string }) => model.id)).toEqual([
      "qwen3.8-max",
      "qwen3.8-flash",
      // The catalog key `kmodel` currently holds Kimi-K2.8-Preview; the id must
      // follow the model, not the slot it occupies.
      "kimi-k2.8-preview",
    ]);
    // Every id scheme resolves back to the upstream key sent in requests.
    expect(getCachedModelConfig("qwen3.8-flash", "cn")?.key).toBe("qfmodel");
    expect(getCachedModelConfig("qfmodel", "cn")?.key).toBe("qfmodel");
    expect(getCachedModelConfig("Qwen3.8-Flash", "cn")?.key).toBe("qfmodel");
    // The retired id still resolves to the key it always routed to.
    expect(getCachedModelConfig("kimi-k2.7-code", "cn")?.key).toBe("kmodel");
  });

  it("does not register raw live-catalog keys as public model ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [
              { key: "lite", enable: true, display_name: "Lite" },
              { key: "qfmodel", enable: true, display_name: "Qwen3.8-Flash" },
            ],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");

    expect(getCachedModels("global").map((model) => model.id)).toEqual(["Lite", "Qwen3.8-Flash"]);
    expect(getCachedModelConfig("Lite", "global")?.key).toBe("lite");
    expect(getCachedModelConfig("Qwen3.8-Flash", "global")?.key).toBe("qfmodel");
    expect(getCachedModelConfig("lite", "global")).toBeNull();
    expect(getCachedModelConfig("qfmodel", "global")).toBeNull();
  });

  it("omits catalog entries without a friendly display name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [
              { key: "q37fmodel", enable: true },
              { key: "qfmodel", enable: true, display_name: "Qwen3.8-Flash" },
            ],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");

    expect(getCachedModels("global").map((model) => model.id)).toEqual(["Qwen3.8-Flash"]);
    expect(getCachedModelConfig("q37fmodel", "global")).toBeNull();
  });

  it("keeps only enabled service models without adding auto as a fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [
              { key: "auto", enable: false, display_name: "Auto" },
              { key: "ultimate", enable: true, display_name: "Ultimate", is_reasoning: true },
              { key: "lite", enable: true, display_name: "Lite" },
              { key: "performance", enable: false, display_name: "Performance" },
            ],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");

    const cache = JSON.parse(readFileSync(CACHE_PATHS.global, "utf8"));
    expect(cache.models.map((model: { id: string }) => model.id)).toEqual(["Ultimate", "Lite"]);
    expect(cache.models.some((model: { id: string }) => model.id === "auto")).toBe(false);
  });

  it("keeps the Cantus model returned by the current catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chat: [{ key: "cmodel", enable: true, display_name: "Cantus" }] }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");

    const cache = JSON.parse(readFileSync(CACHE_PATHS.global, "utf8"));
    expect(cache.models.map((model: { id: string }) => model.id)).toEqual(["Cantus"]);
  });

  it("filters auto from a legacy fallback cache when the service did not enable it", () => {
    writeFileSync(
      CACHE_PATHS.global,
      JSON.stringify({
        updatedAt: Date.now(),
        models: [{ id: "auto" }, { id: "ultimate" }],
        configs: { ultimate: { key: "ultimate", enable: true } },
      }),
      "utf8",
    );
    clearQoderModelsMemCache();

    expect(getCachedModels("global").map((model) => model.id)).toEqual(["Ultimate"]);
  });

  it("keeps auto when an upstream-written CN cache enables it", () => {
    // The upstream package writes the catalog under display-name ids and
    // capitalizes `Auto`. Reading that cache must not mistake it for the legacy
    // synthesized fallback and drop the model.
    writeFileSync(
      CACHE_PATHS.cn,
      JSON.stringify({
        updatedAt: Date.now(),
        models: [
          { id: "Auto", name: "Auto" },
          { id: "Qwen3.8-Flash", name: "Qwen3.8-Flash" },
        ],
        configs: {
          Auto: { key: "auto", enable: true, display_name: "Auto" },
          "Qwen3.8-Flash": { key: "qfmodel", enable: true, display_name: "Qwen3.8-Flash" },
        },
      }),
      "utf8",
    );
    clearQoderModelsMemCache();

    expect(getCachedModels("cn").map((model) => model.id)).toEqual(["auto", "qwen3.8-flash"]);
  });

  it("re-keys an upstream-written CN cache onto friendly slugs", () => {
    writeFileSync(
      CACHE_PATHS.cn,
      JSON.stringify({
        updatedAt: Date.now(),
        models: [{ id: "MiniMax-M2.7", name: "MiniMax-M2.7" }],
        configs: { "MiniMax-M2.7": { key: "mmodel", enable: true, display_name: "MiniMax-M2.7" } },
      }),
      "utf8",
    );
    clearQoderModelsMemCache();

    expect(getCachedModels("cn").map((model) => model.id)).toEqual(["minimax-m2.7"]);
    expect(getCachedModelConfig("minimax-m2.7", "cn")?.key).toBe("mmodel");
    expect(getCachedModelConfig("MiniMax-M2.7", "cn")?.key).toBe("mmodel");
  });

  it("records a 1M context window when the catalog omits context_config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [{ key: "lite", enable: true, display_name: "Lite", max_input_tokens: 180000 }],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");

    const cache = JSON.parse(readFileSync(CACHE_PATHS.global, "utf8"));
    expect(cache.models[0].contextWindow).toBe(1_000_000);
  });

  it("records the advertised context_config max, even when it is below 1M", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [
              {
                key: "gm51model",
                enable: true,
                display_name: "GLM 5.2",
                context_config: { default: { token_count: 200000, is_default: true } },
              },
            ],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");

    const cache = JSON.parse(readFileSync(CACHE_PATHS.global, "utf8"));
    expect(cache.models[0].contextWindow).toBe(200000);
  });

  it("serves getCachedModelConfig from memory after the cache file is removed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat: [{ key: "lite", enable: true, display_name: "Lite" }],
          }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");
    expect(getCachedModelConfig("Lite", "global")?.key).toBe("lite");

    // Hot-path mem cache must keep serving without touching disk again.
    rmSync(CACHE_PATHS.global, { force: true });
    expect(existsSync(CACHE_PATHS.global)).toBe(false);
    expect(getCachedModelConfig("Lite", "global")?.key).toBe("lite");
    expect(getCachedModels("global").map((m) => m.id)).toEqual(["Lite"]);
  });

  it("stamps its own writer tag on every cache it writes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chat: [{ key: "lite", enable: true, display_name: "Lite" }] }),
      }),
    );

    await updateQoderModelsCache("access-token", "user-id", "Test User", "test@example.com", "global");
    expect(JSON.parse(readFileSync(CACHE_PATHS.global, "utf8")).writer).toBe(QODER_CACHE_WRITER);
  });

  it("serves a cache with no writer tag (legacy layout stays readable)", () => {
    // Every release up to 0.2.21 wrote no `writer`, and other Qoder providers
    // write the same file name without one. Their `configs[key].display_name`
    // layout is compatible with ours, so refusing an untagged file would throw
    // away a working catalog on the strength of a missing label.
    writeFileSync(
      CACHE_PATHS.global,
      JSON.stringify({
        updatedAt: Date.now(),
        models: [{ id: "Auto", name: "Auto", api: "qoder-api", provider: "qoder", reasoning: true }],
        configs: { auto: { key: "auto", display_name: "Auto", enable: true, source: "system" } },
      }),
      "utf8",
    );
    clearQoderModelsMemCache();

    expect(getCachedModels("global").map((m) => m.id)).toContain("Auto");
    expect(getCachedModelConfig("Auto", "global")?.key).toBe("auto");
  });

  it("ignores a cache another implementation claims, and falls back to statics", () => {
    // A file that says it belongs to a different writer is not ours to serve:
    // its ids are not the ones this package registers, and trusting it is how
    // "Unknown Qoder model id" appears with nothing the user did wrong.
    writeFileSync(
      CACHE_PATHS.global,
      JSON.stringify({
        updatedAt: Date.now(),
        writer: "some-other-qoder-provider",
        models: [{ id: "weird-id", name: "Weird", api: "qoder-api", provider: "qoder", reasoning: false }],
        configs: { "weird-id": { key: "weird-id", display_name: "Weird", enable: true } },
      }),
      "utf8",
    );
    clearQoderModelsMemCache();

    expect(getCachedModels("global").map((m) => m.id)).not.toContain("weird-id");
    expect(getCachedModels("global").length).toBeGreaterThan(0); // static catalog still serves
    expect(getCachedModelConfig("weird-id", "global")).toBeNull();
    // ...and the catalog is reported stale, so the next refresh rewrites it.
    expect(isCacheStale("global")).toBe(true);
  });

  it("keeps raw upstream keys out of the global id space even via a stale cache", () => {
    // Invariant: `getCachedModelConfig` must not start accepting upstream keys
    // as global ids. A CN key reaching the international gateway is a wrong-end
    // request, not a fallback.
    writeFileSync(
      CACHE_PATHS.global,
      JSON.stringify({
        updatedAt: Date.now(),
        writer: QODER_CACHE_WRITER,
        models: [{ id: "Auto", name: "Auto", api: "qoder-api", provider: "qoder", reasoning: true }],
        configs: {
          auto: { key: "auto", display_name: "Auto", enable: true },
          qmodel_38max: { key: "qmodel_38max", display_name: "Qwen3.8-Max", enable: true },
        },
      }),
      "utf8",
    );
    clearQoderModelsMemCache();

    expect(getCachedModelConfig("Auto", "global")?.key).toBe("auto");
    expect(getCachedModelConfig("auto", "global")).toBeNull();
    expect(getCachedModelConfig("qmodel_38max", "global")).toBeNull();
  });
});
