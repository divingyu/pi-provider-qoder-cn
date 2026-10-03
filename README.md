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
