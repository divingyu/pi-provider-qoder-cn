/**
 * Live causal probe — isolate the de-duplication key behind 103 "Duplicate request".
 *
 * Requires real Qoder credentials; run: npx tsx scripts/probe-103-dedupe.ts [modelId] [waitMs]
 *
 * A byte-identical BODY replay alone is accepted (the gateway just queues again),
 * but stream.ts used to replay body AND headers AND signature, because
 * buildAuthHeaders() was called once outside the retry loop. This probe compares
 * the combinations around one queue wait to find the real de-duplication key:
 *
 *   A  fresh body   + fresh headers     (registers the queue entry)
 *   B  same body    + same headers      (== production queue retry)
 *   C  fresh body   + same headers      (isolates header/signature replay)
 *   D  same body    + fresh headers     (isolates body/request_id replay)
 *
 * Usage: npx tsx scripts/probe-103-dedupe.ts [modelId] [waitMs]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCachedModelConfig } from "../src/catalog.js";
import { buildAuthHeaders, getMachineId } from "../src/cosy.js";
import { qoderEncodeBody } from "../src/protocol/encoding.js";
import { getQoderChatURL, getQoderRegionConfig } from "../src/region.js";
import { parseQueueNotice } from "../src/protocol/queue.js";

const MODE = "global" as const;
const MODEL_ID = process.argv[2] || "Qwen3.8-Flash";
const WAIT_MS = Number(process.argv[3] || 30_000);

const authPath =
  process.env.PI_AUTH_FILE || path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), ".pi", "agent", "auth.json");
const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
const cred = auth.qoder;
if (!cred?.access) throw new Error("no qoder global credentials");
const entry = getCachedModelConfig(MODEL_ID, MODE);
if (!entry || !entry.key) throw new Error(`no catalog entry for ${MODEL_ID}`);
// Typed const alias: closures below would lose the narrowing above.
const modelConfig: NonNullable<typeof entry> = entry;
const region = getQoderRegionConfig(MODE);
const chatURL = getQoderChatURL(MODE);
const machineID = cred.machineID || getMachineId();

function buildBody(tag: string, ids?: { record: string; session: string }) {
  const prompt = `只回复 OK（probe d ${tag}）`;
  const record = ids?.record ?? crypto.createHash("sha256").update(`d-${tag}-${Date.now()}`).digest("hex").slice(0, 16);
  const session = ids?.session ?? `probe-d-${crypto.randomUUID().slice(0, 8)}`;
  return {
    session,
    record,
    encoded: qoderEncodeBody(
      Buffer.from(
        JSON.stringify({
          request_id: crypto.randomUUID(),
          request_set_id: record,
          chat_record_id: record,
          session_id: session,
          stream: true,
          chat_task: "FREE_INPUT",
          is_reply: true,
          is_retry: false,
          source: 1,
          version: "3",
          session_type: "qodercli",
          agent_id: "agent_common",
          task_id: "common",
          code_language: "",
          chat_prompt: "",
          image_urls: null,
          aliyun_user_type: "",
          system: "",
          messages: [{ role: "user", content: prompt }],
          tools: [],
          parameters: { max_tokens: 32, enable_thinking: false },
          chat_context: {
            chatPrompt: "",
            imageUrls: null,
            extra: { context: [], modelConfig: { key: modelConfig.key, is_reasoning: false }, originalContent: prompt },
            features: [],
            text: prompt,
          },
          model_config: modelConfig,
          business: {
            product: "cli",
            version: "1.0.0",
            type: "agent",
            stage: "start",
            id: crypto.randomUUID(),
            name: prompt.slice(0, 30),
            begin_at: Date.now(),
          },
        }),
      ),
    ) as Buffer,
  };
}

function headersFor(encoded: Buffer): Record<string, string> {
  return buildAuthHeaders(encoded, chatURL, {
    userID: cred.userID,
    authToken: cred.access,
    name: cred.name || region.userNameFallback,
    email: cred.email || region.userEmailFallback,
    machineID,
  });
}

async function post(label: string, encoded: Buffer, headers: Record<string, string>) {
  const t0 = Date.now();
  const res = await fetch(chatURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "Accept-Encoding": "identity",
      "X-Model-Key": String(modelConfig.key),
      "X-Model-Source": String(modelConfig.source || "system"),
      ...headers,
    },
    body: encoded as unknown as BodyInit,
  });
  let line = "";
  try {
    const reader = res.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 20_000;
      while (!buf.includes("\n") && Date.now() < deadline) {
        const r = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (r.done) break;
        buf += dec.decode(r.value as Uint8Array, { stream: true });
      }
      line = buf.split("\n")[0] ?? "";
      await reader.cancel().catch(() => {});
    }
  } catch (e) {
    line += ` READ_ERROR ${e instanceof Error ? e.message : String(e)}`;
  }
  const el = Date.now() - t0;
  let queue: ReturnType<typeof parseQueueNotice> = null;
  try {
    queue = parseQueueNotice(JSON.parse(line.startsWith("data:") ? line.slice(5).trim() : line));
  } catch {
    /* not an envelope */
  }
  // Full envelope, un-escaped one level, so we can see statusCodeValue too.
  let flat = line;
  try {
    const env = JSON.parse(line.startsWith("data:") ? line.slice(5).trim() : line);
    flat = `${env.statusCodeValue ?? "?"}/${JSON.parse(env.body).message ?? env.body}`;
  } catch {
    /* keep raw */
  }
  console.log(`\n### ${label} :: HTTP ${res.status} :: ${el}ms\n    ${flat.replace(/\s+/g, " ").slice(0, 300)}`);
  const out = { status: res.status, el, queued: !!queue, dup: /Duplicate request|"103"/.test(line), line };
  console.log(`    => queued=${out.queued} duplicate=${out.dup}`);
  return out;
}

console.log(`model=${MODEL_ID} key=${modelConfig.key} wait=${WAIT_MS}ms`);

const a1 = buildBody("1");
const h1 = headersFor(a1.encoded);
const rA = await post("A fresh body + fresh headers", a1.encoded, h1);

console.log(`\n--- waiting ${WAIT_MS}ms ---`);
await new Promise((r) => setTimeout(r, WAIT_MS));

const rB = await post("B SAME body + SAME headers (production queue retry)", a1.encoded, h1);

const a2 = buildBody("1", { record: a1.record, session: a1.session });
const rC = await post("C fresh body(request_id/ids) + SAME headers", a2.encoded, h1);

const rD = await post("D SAME body + fresh headers", a1.encoded, headersFor(a1.encoded));

const a3 = buildBody("2");
const rE = await post("E fresh body + fresh headers (control)", a3.encoded, headersFor(a3.encoded));

console.log("\n=== SUMMARY ===");
for (const [k, v] of Object.entries({ A: rA, B: rB, C: rC, D: rD, E: rE })) {
  console.log(`${k}: http=${v.status} ${v.el}ms queued=${v.queued} duplicate=${v.dup}`);
}
