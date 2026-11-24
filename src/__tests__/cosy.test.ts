import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthHeaders,
  getGatewayIdentity,
  QODER_CLI_CLIENT_TYPE,
  QODER_CLIENT_TYPE,
  QODER_GATEWAY_COSY_VERSION,
  readQoderAppVersion,
} from "../cosy.js";

const home = () => process.env.HOME || process.env.USERPROFILE || homedir();
const statusFile = (dir: string) => join(home(), dir, ".qoder-app-status.json");
const writeStatus = (dir: string, content: string) => {
  mkdirSync(join(home(), dir), { recursive: true });
  writeFileSync(statusFile(dir), content, "utf8");
};

const creds = {
  userID: "user-1",
  authToken: "token-1",
  name: "Test",
  email: "test@example.com",
  machineID: "machine-1",
};
const payloadOf = (headers: Record<string, string>) =>
  JSON.parse(
    Buffer.from(headers.Authorization.slice("Bearer COSY.".length).split(".")[0], "base64").toString("utf8"),
  ) as {
    cosyVersion: string;
    ideVersion: string;
  };

afterEach(() => {
  rmSync(join(home(), ".qoder-cn"), { recursive: true, force: true });
  rmSync(join(home(), ".qoder"), { recursive: true, force: true });
  delete process.env.QODERCN_COSY_VERSION;
});

describe("COSY client identity", () => {
  it("presents as the desktop app (qoderapp) at Cosy-Version >= 1.1.70", () => {
    // The gateway trims the catalog by identity: the CLI identity never receives
    // app-group models (HungerG / hmodel) and a version below 1.1.70 drops Fast.
    const headers = buildAuthHeaders(null, "https://gateway.qoder.com.cn/algo/api/v2/model/list", creds);
    expect(headers["Cosy-Clienttype"]).toBe("qoderapp");
    expect(headers["Cosy-Version"]).toBe(QODER_GATEWAY_COSY_VERSION);
    expect(QODER_CLIENT_TYPE).toBe("qoderapp");
    expect(Number(QODER_GATEWAY_COSY_VERSION.split(".")[2])).toBeGreaterThanOrEqual(70);

    expect(headers.Authorization.startsWith("Bearer COSY.")).toBe(true);
    expect(payloadOf(headers).cosyVersion).toBe(QODER_GATEWAY_COSY_VERSION);
  });

  it("accepts an explicit identity (the legacy CLI one stays available)", () => {
    const headers = buildAuthHeaders(null, "https://gateway.qoder.com.cn/algo/api/v2/model/list", creds, {
      clientType: QODER_CLI_CLIENT_TYPE,
      cosyVersion: "1.1.38",
      ideVersion: "",
    });
    expect(headers["Cosy-Clienttype"]).toBe("5");
    expect(headers["Cosy-Version"]).toBe("1.1.38");
    expect(payloadOf(headers)).toMatchObject({ cosyVersion: "1.1.38", ideVersion: "" });
  });

  it("reports the installed desktop client version as ideVersion", () => {
    writeStatus(".qoder-cn", JSON.stringify({ version: "0.5.17", product: "qodercn" }));
    expect(readQoderAppVersion()).toBe("0.5.17");
    expect(getGatewayIdentity().ideVersion).toBe("0.5.17");
    const headers = buildAuthHeaders(null, "https://gateway.qoder.com.cn/algo/api/v2/model/list", creds);
    expect(payloadOf(headers).ideVersion).toBe("0.5.17");
  });

  it("falls back to the global client's version, then to an empty string", () => {
    expect(readQoderAppVersion()).toBe("");
    writeStatus(".qoder", JSON.stringify({ version: "0.5.7" }));
    expect(readQoderAppVersion()).toBe("0.5.7");
  });

  it("ignores a malformed or non-numeric client version", () => {
    writeStatus(".qoder-cn", "{ not json");
    expect(readQoderAppVersion()).toBe("");
    writeStatus(".qoder-cn", JSON.stringify({ version: "latest; DROP" }));
    expect(readQoderAppVersion()).toBe("");
    writeStatus(".qoder-cn", JSON.stringify({ version: 5 }));
    expect(readQoderAppVersion()).toBe("");
  });

  it("lets QODERCN_COSY_VERSION override the Cosy-Version, validated", () => {
    process.env.QODERCN_COSY_VERSION = "1.2.0";
    expect(getGatewayIdentity().cosyVersion).toBe("1.2.0");
    process.env.QODERCN_COSY_VERSION = "not-a-version";
    expect(getGatewayIdentity().cosyVersion).toBe(QODER_GATEWAY_COSY_VERSION);
  });

  it("matches the legacy full-string Cosy signature for a known body Buffer", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") // aes key source
      .mockReturnValueOnce("11111111-2222-3333-4444-555555555555") // requestId
      .mockReturnValueOnce("99999999-8888-7777-6666-555555555555"); // X-Request-Id

    const body = Buffer.from('{"hello":"world","n":1}', "utf8");
    const url = "https://api3.qoder.sh/algo/api/v1/chat";
    const headers = buildAuthHeaders(body, url, {
      userID: "user-1",
      authToken: "token-1",
      name: "Test",
      email: "test@example.com",
      machineID: "machine-1",
    });

    const auth = headers.Authorization;
    const match = auth.match(/^Bearer COSY\.([^.]+)\.([0-9a-f]+)$/);
    expect(match).toBeTruthy();
    const payloadB64 = match?.[1] ?? "";
    const sig = match?.[2] ?? "";
    const cosyKey = headers["Cosy-Key"];
    const timestamp = headers["Cosy-Date"];
    const sigPath = headers["Cosy-Sigpath"];

    const legacyInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${body.toString("utf8")}\n${sigPath}`;
    const legacySig = crypto.createHash("md5").update(legacyInput).digest("hex");
    expect(sig).toBe(legacySig);

    const legacyBodyHash = crypto.createHash("md5").update(body).digest("hex");
    expect(headers["Cosy-Bodyhash"]).toBe(legacyBodyHash);
    expect(headers["Cosy-Bodylength"]).toBe(String(body.length));

    vi.restoreAllMocks();
  });
});
