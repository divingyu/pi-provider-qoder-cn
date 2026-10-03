export type RecorderStage = "patExchange" | "devicePoll" | "deviceRefresh" | "userinfo" | "modelList" | "chat";

export function classify(url: string): RecorderStage {
  if (url.includes("/jobToken/exchange")) return "patExchange";
  // The global device-login endpoints: without these the recorder throws mid
  // login (the poll is hit every 2s), so a first-time `/login qoder` session
  // could never be captured. Recorded shapes settle the outstanding question
  // about expires_in units and the refresh endpoint's bearer contract.
  if (url.includes("/deviceToken/poll")) return "devicePoll";
  if (url.includes("/deviceToken/refresh")) return "deviceRefresh";
  if (url.includes("/userinfo")) return "userinfo";
  if (url.includes("/model/list")) return "modelList";
  if (url.includes("/chat") || url.includes("/agent_chat_generation")) return "chat";
  throw new Error(`[live] refusing to record unexpected endpoint: ${new URL(url).pathname}`);
}
