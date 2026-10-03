import { describe, expect, it } from "vitest";
import { classify } from "../../scripts/live-fixture-recorder.js";

describe("live fixture recorder endpoint classification", () => {
  it.each([
    "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1",
    "https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1",
  ])("classifies the live %s endpoint as chat", (url) => {
    expect(classify(url)).toBe("chat");
  });

  it("classifies the device-login endpoints instead of throwing mid-login", () => {
    // Without these the recorder aborts the very first `/login qoder` capture:
    // the poll fires every 2s while the browser flow is open.
    expect(classify("https://openapi.qoder.sh/api/v1/deviceToken/poll?nonce=n&verifier=v")).toBe("devicePoll");
    expect(classify("https://openapi.qoder.sh/api/v1/deviceToken/refresh")).toBe("deviceRefresh");
    expect(classify("https://openapi.qoder.sh/api/v1/jobToken/exchange")).toBe("patExchange");
  });

  it("still refuses endpoints outside the recorded allow-list", () => {
    expect(() => classify("https://openapi.qoder.sh/api/v2/quota/usage")).toThrow(/refusing to record/);
  });
});
