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
  resetLaneCooldowns();
});
