import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";
import { resetLaneCooldowns } from "../protocol/queue-policy.js";

/**
 * Give every test file its own HOME.
 *
 * The provider stores credentials and the model catalog under
 * `~/.pi/agent/*.json`, and several suites write those paths. Vitest runs test
 * files in parallel, so a shared HOME let one file truncate a file another was
 * reading (an intermittent failure in the stream suite). A per-file HOME also
 * keeps the suite from touching the real `~/.pi` of whoever runs it.
 */
const home = mkdtempSync(join(tmpdir(), "pi-provider-qoder-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
mkdirSync(join(home, ".pi", "agent"), { recursive: true });

/**
 * Pin the queue policy to the built-in defaults.
 *
 * `readQueuePolicy()` reads `process.env` at call time so one session can retune
 * the retry budget without a rebuild. Left alone, a developer who exports
 * `QODER_QUEUE_MAX_ATTEMPTS` (to try it out) would silently change what the
 * retry-count tests assert — the suite would be measuring their shell, not the
 * code. The lane cooldown is process-global module state, so it is cleared
 * before each test too.
 */
const QUEUE_ENV = [
  "QODER_QUEUE_UNAVAILABLE_ATTEMPTS",
  "QODER_QUEUE_MAX_ATTEMPTS",
  "QODER_QUEUE_MAX_TOTAL_WAIT_MS",
  "QODER_QUEUE_SINGLE_WAIT_MS",
  "QODER_QUEUE_JITTER_MS",
  "QODER_QUEUE_LANE_COOLDOWN_MS",
];

beforeEach(() => {
  for (const name of QUEUE_ENV) delete process.env[name];
  // Zero the jitter for the whole suite, on purpose.
  //
  // The queue fixtures set `retry_after_ms: 1` precisely so each wait is ~1ms and
  // the retry COUNT is what is under test. The policy default adds
  // `random() * 2000ms` to every wait (queue-policy.ts:60), which silently
  // defeats that intent: three waits reach ~6s and blow vitest's 5s default, and
  // a timed-out queue test does not cancel its retry loop (these fixtures pass no
  // abort signal). The orphan loop keeps calling the *global* fetch that the next
  // test has already installed (stream.ts resolves `fetch` at call time), so the
  // next test's mock is the one that gets the extra attempts - which is how an
  // assertion of 2 calls came to see 3, and why the failures moved between tests
  // depending on host speed. Pinning the jitter at 0 removes the timeout, the
  // orphan loop, and the cross-test contamination at the source; the counts were
  // never clock-dependent (stream.ts:655 gates on a plain counter).
  process.env.QODER_QUEUE_JITTER_MS = "0";
  resetLaneCooldowns();
});
