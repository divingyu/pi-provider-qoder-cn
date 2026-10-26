# pi-provider-qoder-cn

A [pi](https://shittycodingagent.ai/) provider extension for **Qoder CN** (`qoder.com.cn`),
with a quota command and enterprise (VPC) endpoint support.

This is a focused fork of [`pi-provider-qoder`](https://github.com/simonsmh/pi-provider-qoder)
(MIT). It registers **both** providers — `qoder-cn` (Domestic) and `qoder`
(Global) — each with its own credentials, model catalog, quota and check-in
commands. Because the ids overlap with the upstream package, installing both at
once double-registers them; pi resolves that field-by-field in `settings.json`
load order (last wins), so keep this package listed last or uninstall upstream.

```bash
pi install npm:pi-provider-qoder-cn
```

## What this fork adds

| Feature | Upstream | This fork |
|---|---|---|
| Qoder CN provider (`qoder-cn`) | ✅ | ✅ |
| Qoder Global provider (`qoder`) | ✅ | ✅ (Browser OAuth + PAT with self-healing refresh) |
| `/qoder-cn.usage` & `/qoder.usage` quota commands | ❌ | ✅ |
| `/qoder-cn.claim` & `/qoder.claim` daily check-in (100 Credits) | ❌ | ✅ |
| Seamless token refresh (deviceToken/refresh for drt- & PAT exchange) | ❌ (broken 403) | ✅ |
| Enterprise (VPC) selection during `/login qoder-cn` | ❌ | ✅ |
| Current CN model catalog (`qwen3.8-max` / `qwen3.8-flash`, …) | ❌ | ✅ |
| Stable CN model ids for `enabledModels` | ❌ | ✅ |
| Capacity-queue detection (`isQueued` / `RESOURCE_LIMIT` / lane) | ❌ | ✅ (recognised, honoured, adjustable) |
| Per-turn wait budget + lane cooldown knobs | ❌ | ✅ |
| Cache ownership tag (foreign catalogs discarded, not half-read) | ❌ | ✅ |

Both `qoder` (Global) and `qoder-cn` (Domestic) providers are registered.
- To use Global: run `/login qoder` and use `/model qoder/<id>`. Commands: `/qoder.usage`, `/qoder.claim`.
- To use CN: run `/login qoder-cn` and use `/model qoder-cn/<id>`. Commands: `/qoder-cn.usage`, `/qoder-cn.claim`.

> Check with `pi list` and inspect `~/.pi/agent/extensions/`: a leftover
> `pi-provider-qoder` extension directory registers the same provider ids.
>
> **Migrating from the upstream package:** model ids change from
> `Qwen3.8-Flash` to `qwen3.8-flash`. Update `enabledModels` entries in
> `settings.json` and any session pins accordingly. The old ids keep resolving
> internally, so only the configured names need updating.

## Install

```bash
pi install npm:pi-provider-qoder-cn
```

### Daily check-in on Global: zero desktop dependency

`/qoder.claim` works out of the box on Windows: this package vendors the
official Qoder device-attestation component (`bin/runtime-info.exe` +
`bin/sgsdk.dll`, ~7.8 MB, sha256-pinned in `bin/manifest.json`) because the
global gateway hides claim campaigns from requests without device attestation.
The component is invoked offline with your account id; its output is cached in
memory for 30 minutes.

- Override the component: set `QODER_UMID_EXE` to any `runtime-info.exe`
  (e.g. a fresher copy from a newer desktop install — the same variable works
  for the CN provider with environment code 0).
- Non-Windows hosts: the vendored binary is win32-x64 only; install the Qoder
  desktop app for your platform and the resolver picks its component from the
  standard install paths automatically.
- The component is © Qoder and redistributed verbatim; it is not executed
  during `npm install`, only on demand by the claim/usage commands.

Then authenticate once — CN:

```text
/login qoder-cn
```

Global (either browser OAuth — the login dialog opens `qoder.com/device/selectAccounts`
and the extension polls for the token — or a PAT):

```text
/login qoder
```

```bash
export QODER_PERSONAL_ACCESS_TOKEN="<your global PAT>"   # or QODER_API_KEY / QODER_PAT
```

CN supports a Personal Access Token rather than browser OAuth. Create one at
<https://qoder.com.cn/account/integrations> and paste it when prompted, or export
it before starting pi:

```bash
export QODERCN_PERSONAL_ACCESS_TOKEN="<your PAT>"
```

## Commands

### `/qoder-cn.usage`

Shows the plan allowance and any purchased add-on credits as one aligned grid.
In a terminal the gauge is coloured by how much of the allowance is gone —
green under 60%, yellow to 85%, red above that, and bold red once the quota is
exceeded.

```text
Qoder CN Plan (personal_standard)
Overall     [███░░░░░░░░░░░░░░░░░░]                      12.5%  used
Plan quota  [███░░░░░░░░░░░░░░░░░░]  250 / 2000 credits  12.5%  1750 left
Add-on      [░░░░░░░░░░░░░░░░░░░░░]    0 /  700 credits     0%   700 left
User        someone · someone@example.com
Expires     never
Manage      https://qoder.com.cn/account/usage
```

Append `json` to print the untouched API payload — useful when a field you need
is not in the formatted view:

```text
/qoder-cn.usage json
```

Append `plain` for the same grid without the colour codes, e.g. when pasting it
into an issue:

```text
/qoder-cn.usage plain
```

Notes:

- The plan allowance (`Plan quota`) and top-up credits (`Add-on`) are
  independent buckets with independent expiry, so both are listed when present.
  Columns are sized to the rows that came back, so a single-bucket plan does
  not reserve space for one it does not have.
- Colour is suppressed automatically for a `NO_COLOR` environment, a dumb
  terminal, and any non-TTY output that is not the interactive UI.
- The gauge and the `%` column are derived from `used / total`, so they always
  agree with the numbers on the same row. The API's own `percentage` field is a
  0-1 fraction (94% arrives as `0.94`) and is only used — scaled by 100 — when a
  bucket comes back without numbers.
- `Add-on expiry` is only printed when a real check-in grant exists. A pool that
  is a whole stack of daily grant packs (never more packs than the validity
  window holds) is laid out as `Rolling 30d · earliest of N daily 100-credit
  packs ~DATE`. A pool that is not one (a purchased top-up, or a leftover
  remainder) prints only the expiry the campaign actually reported, `DATE ·
  latest grant`, and an account that has never claimed prints no expiry line at
  all, because with no grant there is nothing to date from, and inventing one
  would show dates the API never sent.
- `Enterprise` is the org-wide pool. It names its allowance `cap` and sends no
  `total`, so the row is keyed on any of `cap`, `used` or `remaining` carrying a
  value: a freshly refreshed cycle reports `used: 0`, and that used to drop the
  whole row and leave the view saying `Buckets none returned`.
- A `TOKEN_EXPIRE (token is not active)` refusal from the quota or check-in
  endpoint usually means a deployment mismatch rather than a dead credential:
  measured on a VPC (enterprise) account, its token served model requests and the
  instance's own quota endpoint fine, while the same token aimed at the public
  gateway was refused. The error text therefore names the endpoint it used and
  says which way to fix it, plus a `token sha256:` fingerprint so a report
  identifies the credential without revealing it.
- `Expires never` means the API reported the year-9999 sentinel, i.e. the
  allowance has no expiry date.
- `Note  plan quota is prorated` appears after a mid-cycle plan change.
- The command uses the same stored token as chat requests, refreshing it first,
  so it reports the same quota the model is actually billed against.

### `/qoder-cn.claim`

Daily check-in command to claim the 100 free Credits reward on Qoder CN personal
accounts without having to open the desktop GUI. The event refreshes daily at
**10:00 UTC+8 (Beijing time)** and grants Add-on Credits valid for 30 days.

```text
/qoder-cn.claim
```

If already claimed today, it reports the status idempotently without throwing:

```text
ℹ️ 今日 100 Credits 已经领取过，无需重复操作
- 活动名称：每天领 100 Credits
- 额度说明：100 Credits（全模型通用资源包，30 天有效）
- 下次刷新：明日 10:00 UTC+8（距刷新约 22小时10分钟）
```

Append `json` for the untouched API response:

```text
/qoder-cn.claim json
```

### Enterprise (VPC) endpoint support

Enterprises on a private (VPC) deployment can select their endpoint directly
during `/login qoder-cn` or set `QODER_VPC_ENDPOINT`.

A bare instance label `acme` expands to the standard enterprise hostnames:

| Role | Host |
|---|---|
| Gateway (chat) | `acme-gateway.vpc.qoder.com.cn` |
| OpenAPI (auth, quota) | `acme-openapi.vpc.qoder.com.cn` |
| Console | `acme.vpc.qoder.com.cn` |

Any other domain is treated as a custom deployment and serves every role from
that one origin.

Setting the endpoint also refreshes the model catalog, because an enterprise
instance may expose a different model set than the public gateway.

The choice is persisted to `~/.pi/agent/qoder-cn-settings.json`. Resolution order
at startup is:

1. `QODER_VPC_ENDPOINT` / `QODERCN_VPC_ENDPOINT`
2. `~/.pi/agent/qoder-cn-settings.json`

Only these two count as chosen by you. This extension deliberately ignores
endpoint values written by other Qoder clients — pi is one client among several,
and another client's endpoint must not silently redirect pi's traffic.

> The token and the endpoint must belong to the same instance. Pointing an
> enterprise endpoint at a public-gateway token fails authentication, which is
> why `/login` settles the endpoint before it asks for the PAT.

### Endpoint choice during `/login`

`/login qoder-cn` asks which endpoint to use **before** prompting for the PAT,
because the enterprise gateway also serves the token exchange. The list shows
the currently saved endpoint and defaults to the personal account:

```text
Choose the Qoder CN endpoint (default: personal account)
  → Personal account — public gateway (qoder.com.cn)
    Enterprise account — use a VPC endpoint
```

- **Personal account** uses the public gateway and pins that choice. If
  `QODER_VPC_ENDPOINT` / `QODERCN_VPC_ENDPOINT` is set, it still wins —
  `/login` says so and warns that a personal pick reverts on restart until the
  variable is removed.
- **Enterprise account** then prompts for the instance name or domain.
- Switching back and forth is expected; re-running `/login` presents the saved
  endpoint so you can change it.

## Models

| Model | id | Context | Thinking effort |
|---|---|---|---|
| Auto | `auto` | 200K | — |
| Qwen 3.8-Max | `qwen3.8-max` | 1M | ✅ |
| Qwen 3.8-Flash | `qwen3.8-flash` | 1M | ✅ |
| Qwen 3.7-Max | `qwen3.7-max` | 1M | — |
| Qwen 3.7-Plus | `qwen3.7-plus` | 1M | — |
| Qwen 3.7-Flash | `qwen3.7-flash` | 1M | — |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1M | ✅ |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 1M | ✅ |
| GLM-5.3 | `glm-5.3` | 1M | ✅ |
| GLM-5.3-Flash | `glm-5.3-flash` | 1M | ✅ |
| GLM 5.2 | `glm-5.2` | 1M | ✅ |
| Kimi-K3 | `kimi-k3` | 1M | ✅ |
| Kimi-K2.7-Code | `kimi-k2.7-code` | 256K | — |
| MiniMax M2.7 | `minimax-m2.7` | 200K | — |

```bash
pi --provider qoder-cn --model qwen3.8-flash
```

```text
/model qwen3.8-flash
```

The live catalog is fetched from Qoder and cached for an hour; the table above is
the offline fallback and the source of model ids.

**Ids are stable.** This fork uses lowercase slugs (`qwen3.8-flash`) rather than
the whitespace-stripped display name, so `enabledModels` entries such as
`qoder-cn/qwen3.8-flash` keep working across upgrades.

**Thinking switch.** A model whose catalog advertises no `disabled` thinking
option (`thinkingLevelMap.off === null`, e.g. GLM-5.3 / GLM-5.3-Flash on CN)
is always-thinking: sending `enable_thinking=false` is answered HTTP 400 code
1210 `该模型始终思考`, so no switch is sent at all. Note the TUI's thinking-off
toggle does not reach that path — pi-ai's `clampThinkingLevel()` promotes `off`
to the model's lowest advertised effort; the switch is omitted for requests that
carry no thinking level.

## Capacity queue and wait policy

When Qoder's gateway has no capacity it does not reject the request. It answers
HTTP 200 and puts the verdict in the first SSE frame, three JSON layers deep:

```json
{ "isQueued": true, "modelKey": "auto", "queueCount": 0, "queueType": "p3",
  "retryAfterSeconds": 30, "serviceAvailable": false, "subCode": "RESOURCE_LIMIT", "waitTime": 30 }
```

Two verdicts look alike and mean opposite things, so they get different handling
and different wording:

| Gateway says | Meaning | Default handling |
|---|---|---|
| `serviceAvailable: true` | in line; the line drains | wait per `Retry-After`, up to 3 retries |
| `serviceAvailable: false` | this lane has nothing to serve | honour `Retry-After` **once**, then stop and name the lane |

Measured against `api3.qoder.sh` on an account whose plan quota is 0
(`personal_standard`, add-on credits only), 2026-10-17/18:

- The refusal is **account-lane, not model**: `auto`, `qmodel_38max`, `efficient`
  and `ultimate` all answered `queueType:"p3"` + `RESOURCE_LIMIT`. Switching
  model inside one provider does not dodge it; switching provider does
  (`qoder-cn` answered in 2–5 s at the same moment).
- `queueCount` is `0` — there is no line to report a position in.
- **Queued attempts are not billed**: 19 chat requests refused this way left
  `addOnQuota.used` unchanged. Waiting costs time, never credits.
- The release rate is correlated with the time window, not per-attempt random:
  6 of 21 attempts served in one window, 0 of 19 in another. That is why extra
  patience is opt-in instead of a default.

### Knobs

All defaults reproduce the pre-0.2.22 behaviour; each knob is read per request.

| Env var | Default | Effect |
|---|---|---|
| `QODER_QUEUE_MAX_ATTEMPTS` | `3` | Retries for an ordinary queue (`serviceAvailable: true`). |
| `QODER_QUEUE_UNAVAILABLE_ATTEMPTS` | `1` | Retries after `serviceAvailable: false`. Raise it only when you would rather wait than switch. |
| `QODER_QUEUE_MAX_TOTAL_WAIT_MS` | `90000` | Wall-clock ceiling for queue waits **in one turn** (it is not restarted by the 105 credential self-heal). `0` means never wait. |
| `QODER_QUEUE_SINGLE_WAIT_MS` | `120000` | Ceiling for one sleep, clamped further by the total budget. |
| `QODER_QUEUE_JITTER_MS` | `2000` | Random spread added to each wait so parallel sessions do not retry in lockstep. |
| `QODER_QUEUE_LANE_COOLDOWN_MS` | `0` (off) | After a hard refusal, skip later requests on that lane for N ms instead of spending another ~31 s. The skip says so explicitly — the request was never sent. |
| `QODER_DEBUG` | off | Logs one line per queue notice (`lane`, `subCode`, attempt, waited ms) and when a foreign model cache is discarded. |

Verified live on the built bundle: default = refusal in ~31 s after 2 requests;
`QODER_QUEUE_LANE_COOLDOWN_MS=20000` = first request 2 requests/32 s, then
0 network calls and 0 ms; `QODER_QUEUE_MAX_TOTAL_WAIT_MS=0` = refusal after a
single request in 0.6 s.

Garbage values fall back to the default, out-of-range values are clamped, and a
negative value falls back rather than silently meaning "zero".

The error text is deliberately worded so pi-ai's `isRetryableAssistantError()`
does not classify it as transient: every number passes through
`formatQueueFigure`, which keeps at most two contiguous digits (a real
`queueCount` of 5204 renders as `5.2k`, because bare `520`/`503` would re-run the
whole turn against a gateway that already refused).

### Model cache ownership

The catalog is cached at `~/.pi/agent/qoder-models-cache.json` (and
`qoder-cn-models-cache.json`), a path other Qoder providers also use. Each write
is now tagged `"writer": "pi-provider-qoder-cn"`. A cache tagged by a different
implementation is discarded and re-fetched instead of being half-believed — its
model ids are not the ones this package registers. A cache with **no** tag stays
readable, because every release up to 0.2.21 wrote that shape.

## Development

```bash
npm install
npm run check      # tsc --noEmit
npm run lint       # biome
npm test           # vitest
npm run build      # esbuild -> dist/index.js
```

`src/` is TypeScript; `dist/index.js` is the build artifact that
`pi.extensions` points at. **`dist/` is committed on purpose.**

`pi install git:...` runs `npm install --omit=dev`, so devDependencies (esbuild)
are absent during install and an install-time `prepare` build would fail. The
committed bundle avoids that; `prepublishOnly` still rebuilds before every npm
publish, so the published bundle is always current. Run `npm run build` and
commit `dist/` whenever you change `src/`.

## Publishing

The tarball ships `dist/`, `LICENSE`, `README.md` and `package.json` only, as
controlled by the `files` field.

```bash
npm login                     # once, if not already authenticated
npm run check && npm run lint && npm test && npm run build
npm publish --access public
```

`prepublishOnly` re-runs check, lint, test and build, so a broken build cannot
be published. Verify the tarball before pushing:

```bash
npm pack --dry-run            # confirm exactly 4 files
```

The `pi-package` keyword makes the package eligible for the
[Pi package gallery](https://pi.dev/packages); no separate submission is needed.

### Verify an install

```bash
pi install npm:pi-provider-qoder-cn
pi --list-models | grep qoder-cn    # expect 14 models, including auto
```

Then in a session, `/qoder-cn.usage` should print the quota, and a prompt that
needs a tool (for example "run `echo hi` with bash") must execute it rather than
reply with a `<tool_call>` code block.

## Compatibility

Requires pi >= 0.86. Pi hands providers a normalized transcript: the system
prompt and tool declarations live in transcript system messages and must be read
with `getCurrentSystemPrompt()` / `getCurrentTools()`. Reading the legacy
top-level `context.systemPrompt` / `context.tools` yields empty values, which
sends a request with no tools and makes the model emit tool calls as plain text
that never execute.

## Credits

Forked from [`pi-provider-qoder`](https://github.com/simonsmh/pi-provider-qoder) by
[simonsmh](https://github.com/simonsmh), MIT licensed. The COSY request signing,
Qoder wire protocol, and provider scaffolding come from that project.

## License

[MIT](./LICENSE)
