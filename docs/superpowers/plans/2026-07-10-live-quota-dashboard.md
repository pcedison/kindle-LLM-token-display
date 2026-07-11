# Live Claude Code and Codex Quota Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a secure v1.0.0 dashboard that collects official Claude Code and Codex subscription rate-limit windows locally, uploads only sanitized percentages and reset timestamps, and renders two remaining-quota bars per provider on a 758x1024 Kindle PNG.

**Architecture:** Pure modules normalize and merge a versioned quota snapshot. A signed Node.js Vercel endpoint persists the merged snapshot in private Vercel Blob storage, while the PNG endpoint reads it with manual environment values as fallback. A local Node.js collector receives Claude status-line JSON, queries Codex through the official app-server JSONL protocol, and uploads the sanitized snapshot on a Windows Scheduled Task.

**Tech Stack:** Next.js 16, React, `next/og` ImageResponse, Node.js 20.9+ ESM, Node test runner, `@vercel/blob`, PowerShell 5.1+, official Claude Code CLI 2.1.196+, official Codex CLI app-server, KUAL/eips Kindle scripts.

## Global Constraints

- Target canvas is exactly 758x1024 for profile `dp75sdi`.
- Final PNG must remain opaque 8-bit grayscale and non-interlaced.
- Kindle refresh stays at 720 seconds with RTC enabled only on the proven local device configuration.
- Kindle framework remains running and display clear remains disabled.
- Persist only provider key, used percentage, reset epoch, schema version, and collection timestamp.
- Never read or upload OAuth tokens, API keys, cookies, prompts, transcripts, repository paths, email, organization id, or account id.
- Black progress fill always means quota remaining, calculated as `100 - usedPercent`.
- Five-hour reset labels use `RESET HH:mm`; weekly reset labels use `RESET MM/DD HH:mm` in `Asia/Taipei` by default.
- Manual environment values remain a working no-collector fallback.
- All repository scripts and examples contain placeholders only, never real secrets or personal endpoints.
- Project and collector runtime require Node.js 20.9.0 or newer, matching Next.js 16 and private Vercel Blob SDK requirements.
- Every code task follows red-green TDD and stages only files owned by that task.

---

### Task 1: Normalized Quota Contract and Provider View Data

**Files:**
- Create: `app/api/dashboard/quotaSnapshot.mjs`
- Modify: `app/api/dashboard/providerData.mjs`
- Create: `tests/quotaSnapshot.test.mjs`
- Modify: `tests/providerData.test.mjs`

**Interfaces:**
- Produces: `normalizeQuotaSnapshot(input)`, `mergeQuotaSnapshots(current, incoming)`, `getWindowDisplay(window, options)`, and `getProviderCards({ env, snapshot, now, timeZone })`.
- Consumes later: Tasks 2 and 3 use the normalized snapshot and provider-card shape.

- [ ] **Step 1: Add failing normalization tests**

```js
test('normalizes only approved Claude and Codex quota fields', () => {
  const snapshot = normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: { windows: { fiveHour: { usedPercent: 17, resetsAt: 1783678020 } } },
      codex: { windows: { sevenDay: { usedPercent: 19, resetsAt: 1784250000 } } },
    },
  });
  assert.equal(snapshot.providers.claude.windows.fiveHour.usedPercent, 17);
  assert.equal(snapshot.providers.codex.windows.sevenDay.resetsAt, 1784250000);
});

test('rejects credential-like fields anywhere in an ingest snapshot', () => {
  assert.throws(() => normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: { claude: { authToken: 'not-allowed' } },
  }), /sensitive field/i);
});
```

- [ ] **Step 2: Run tests and confirm the missing-module failure**

Run: `node --test tests/quotaSnapshot.test.mjs tests/providerData.test.mjs`

Expected: FAIL because `quotaSnapshot.mjs` and the new provider interface do not exist.

- [ ] **Step 3: Implement strict normalization and merge behavior**

Implement the following public contract:

```js
export function normalizeQuotaSnapshot(input) {
  assertNoSensitiveFields(input);
  if (input?.version !== 1) throw new TypeError('Unsupported snapshot version');
  const collectedAt = new Date(input.collectedAt);
  if (Number.isNaN(collectedAt.getTime())) throw new TypeError('Invalid collectedAt');
  return {
    version: 1,
    collectedAt: collectedAt.toISOString(),
    providers: normalizeProviders(input.providers),
  };
}

export function mergeQuotaSnapshots(current, incoming) {
  const left = current ? normalizeQuotaSnapshot(current) : emptySnapshot(incoming.collectedAt);
  const right = normalizeQuotaSnapshot(incoming);
  return mergeOnlyPresentWindows(left, right);
}
```

Sensitive-key matching is case-insensitive and rejects keys containing
`token`, `secret`, `cookie`, `authorization`, `email`, `accountId`, `orgId`,
`prompt`, or `transcript`. Percentages are clamped to 0-100. Reset epochs must
be integers between 2020-01-01 and 2100-01-01.

- [ ] **Step 4: Replace the provider model with two stable windows**

Each returned provider card has this shape:

```js
{
  queryKey: 'claude',
  defaultVisible: true,
  displayName: 'Anthropic Claude Code',
  vendorLabel: 'ANTHROPIC',
  source: 'live' | 'manual' | 'missing',
  stale: false,
  windows: {
    fiveHour: { label: '5 HOURS', remaining: '83%', progress: 83, reset: 'RESET 18:07' },
    sevenDay: { label: '7 DAYS', remaining: '81%', progress: 81, reset: 'RESET 07/17 07:00' },
  },
}
```

`getWindowDisplay` returns `100% / RESET COMPLETE` after a reset epoch passes,
and `--% / WAITING FOR LOCAL SYNC` when a window is missing. New manual env
names are `*_FIVE_HOUR_REMAINING`, `*_FIVE_HOUR_RESET_LABEL`,
`*_SEVEN_DAY_REMAINING`, and `*_SEVEN_DAY_RESET_LABEL`. Legacy
`*_STATUS_VALUE` and `*_RESET_LABEL` populate only the five-hour row.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/quotaSnapshot.test.mjs tests/providerData.test.mjs`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 6: Commit the contract**

```powershell
git add app/api/dashboard/quotaSnapshot.mjs app/api/dashboard/providerData.mjs tests/quotaSnapshot.test.mjs tests/providerData.test.mjs
git commit -m "Add dual-window quota data contract"
```

---

### Task 2: Signed Ingest, Optional View Auth, and Private Blob Store

**Files:**
- Create: `app/api/dashboard/requestAuth.mjs`
- Create: `app/api/dashboard/quotaStore.mjs`
- Create: `app/api/usage/route.js`
- Create: `tests/requestAuth.test.mjs`
- Create: `tests/quotaStore.test.mjs`
- Create: `tests/usageIngest.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `normalizeQuotaSnapshot` and `mergeQuotaSnapshots` from Task 1.
- Produces: `authorizeBearer`, `authorizeDashboardView`, `readQuotaSnapshot`, `writeMergedQuotaSnapshot`, and `handleUsageIngest`.
- Consumed later: Task 3 loads live data and protects the PNG route; Task 5 uploads to `/api/usage`.

- [ ] **Step 1: Write failing authentication and storage tests**

```js
test('accepts only an exact bearer ingest token', () => {
  assert.equal(authorizeBearer('Bearer abc', 'abc'), true);
  assert.equal(authorizeBearer('Bearer ab', 'abc'), false);
  assert.equal(authorizeBearer(undefined, 'abc'), false);
});

test('dashboard remains public when no view token is configured', () => {
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard'), undefined), true);
});

test('merges a partial provider update without erasing the other provider', async () => {
  const store = createMemoryQuotaStore(existingSnapshot);
  const merged = await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });
  assert.ok(merged.providers.codex.windows.fiveHour);
});
```

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `node --test tests/requestAuth.test.mjs tests/quotaStore.test.mjs tests/usageIngest.test.mjs`

Expected: FAIL because the modules and route handler do not exist.

- [ ] **Step 3: Install and wrap the Blob SDK**

Run: `npm install @vercel/blob@latest`

Implement a storage adapter that calls private Blob `get()` and `put()` only
when `BLOB_READ_WRITE_TOKEN` exists. The production pathname is
`usage/latest.json`; `put` uses `access: 'private'`, `allowOverwrite: true`,
`addRandomSuffix: false`, and `contentType: 'application/json'`. Missing
configuration or object returns `null` rather than throwing into the renderer.
Set `package.json` `engines.node` to `>=20.9.0` so incompatible installs fail
before deployment.

- [ ] **Step 4: Implement constant-time request authorization**

```js
export function safeTokenEqual(actual, expected) {
  if (!actual || !expected) return false;
  const left = createHash('sha256').update(String(actual)).digest();
  const right = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(left, right);
}

export function authorizeDashboardView(url, expected) {
  return !expected || safeTokenEqual(url.searchParams.get('key'), expected);
}
```

- [ ] **Step 5: Implement the write-only ingest route**

`POST /api/usage` runs on the Node.js runtime, rejects a declared or actual
body above 8192 bytes, checks `Authorization: Bearer ...`, parses JSON,
normalizes and merges it with the previous Blob snapshot, then returns only:

```json
{ "ok": true, "collectedAt": "2026-07-10T09:30:00.000Z" }
```

The route exports `handleUsageIngest(request, dependencies)` for direct Node
tests. Logs contain status and exception class only, never auth headers or body.

- [ ] **Step 6: Verify focused and full tests**

Run: `node --test tests/requestAuth.test.mjs tests/quotaStore.test.mjs tests/usageIngest.test.mjs`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit server persistence**

```powershell
git add app/api/dashboard/requestAuth.mjs app/api/dashboard/quotaStore.mjs app/api/usage/route.js tests/requestAuth.test.mjs tests/quotaStore.test.mjs tests/usageIngest.test.mjs package.json package-lock.json
git commit -m "Add secure live quota ingest"
```

---

### Task 3: Portrait Dual-Window E-Ink Dashboard

**Files:**
- Modify: `app/api/dashboard/route.js`
- Create: `app/api/dashboard/layoutModel.mjs`
- Create: `tests/layoutModel.test.mjs`
- Modify: `tests/kindlePng.test.mjs`
- Create: `scripts/save-dashboard-preview.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: provider cards from Task 1, Blob reader and view auth from Task 2.
- Produces: a two-card 758x1024 PNG and a local preview command.

- [ ] **Step 1: Write failing layout-model tests**

```js
test('dp75sdi two-provider layout allocates two equal non-overlapping cards', () => {
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });
  assert.equal(layout.header.height, 58);
  assert.equal(layout.cards.length, 2);
  assert.ok(layout.cards[0].bottom < layout.cards[1].top);
  assert.ok(layout.cards[1].bottom <= 1002);
});

test('quota rows have fixed tracks for three-digit and missing labels', () => {
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });
  assert.equal(layout.cards[0].quotaRows.length, 2);
  assert.ok(layout.cards[0].quotaRows.every((row) => row.barHeight >= 24));
});
```

- [ ] **Step 2: Run the layout test and confirm failure**

Run: `node --test tests/layoutModel.test.mjs`

Expected: FAIL because `layoutModel.mjs` does not exist.

- [ ] **Step 3: Implement fixed geometry and replace card rendering**

For 758x1024 use 22px outer padding, a 58px header, 16px header gap, 14px
card gap, and two equal cards filling the remaining inner height. Each card
uses 22px padding, a 96px title zone, and two equal quota rows. Each row renders
the label/reset line, a large percentage, and a 28px bordered bar. Remove
`renderMetricTile` and the old single `renderProgressBar`.

The title remains at least 48px for `Anthropic Claude Code` and 64px for
`Codex`. Pikachu is at most 104x96 and sits in the right side of the title zone.
It is hidden for compact profiles before any text or bar is reduced.

- [ ] **Step 4: Load live data and enforce optional view auth**

Switch the dashboard route runtime from `edge` to `nodejs`. At request start:

```js
const url = new URL(request.url);
if (!authorizeDashboardView(url, process.env.DASHBOARD_VIEW_TOKEN)) {
  return new Response('Unauthorized', { status: 401 });
}
const snapshot = await readQuotaSnapshot();
const cards = getProviderCards({ snapshot, env: process.env, now: Date.now() });
```

Keep `Cache-Control: no-store`, profile sizing, battery parsing, and final
`makeOpaqueGrayscalePng` unchanged.

- [ ] **Step 5: Add deterministic preview generation**

`scripts/save-dashboard-preview.mjs` fetches a supplied dashboard URL, writes
`artifacts/dashboard-dp75sdi.png`, verifies HTTP 200, and fails unless the PNG
signature is present. Local fixture values are supplied through the local
server environment, never through production account data. The script never
writes URL query values or secrets to output. Add `artifacts/` to `.gitignore`.

- [ ] **Step 6: Run tests, build, and visual verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: Next.js build exits 0 and lists `/api/dashboard` plus `/api/usage`.

Run a local server and generate the preview. Verify with PNG parsing that it is
758x1024, bit depth 8, color type 0, and has nonwhite pixels in both card
halves. Open the preview and inspect title fit, both bars, reset labels,
battery/time header, card boundaries, and Pikachu placement.

- [ ] **Step 7: Commit the dashboard redesign**

```powershell
git add app/api/dashboard/route.js app/api/dashboard/layoutModel.mjs tests/layoutModel.test.mjs tests/kindlePng.test.mjs scripts/save-dashboard-preview.mjs .gitignore
git commit -m "Redesign dashboard for dual quota windows"
```

---

### Task 4: Claude Status-Line Collector

**Files:**
- Create: `collector/lib/paths.mjs`
- Create: `collector/lib/claudeStatus.mjs`
- Create: `collector/lib/localState.mjs`
- Create: `collector/claude-statusline.mjs`
- Create: `tests/collectorClaude.test.mjs`
- Create: `tests/collectorState.test.mjs`

**Interfaces:**
- Produces: `parseClaudeStatus(input)`, `formatClaudeStatusLine(snapshot)`, `readJsonState(name)`, and `writeJsonStateAtomic(name, value)`.
- Consumed later: Task 5 merges the Claude spool snapshot into uploads.

`parseClaudeStatus` reads only `rate_limits.five_hour.used_percentage`,
`rate_limits.five_hour.resets_at`, `rate_limits.seven_day.used_percentage`, and
`rate_limits.seven_day.resets_at` from the official status-line payload.

- [ ] **Step 1: Write failing official-field parser tests**

```js
test('extracts only Claude five-hour and seven-day rate limit fields', () => {
  const result = parseClaudeStatus({
    rate_limits: {
      five_hour: { used_percentage: 4, resets_at: 1783678020 },
      seven_day: { used_percentage: 11, resets_at: 1784250000 },
    },
    email: 'must-not-copy@example.test',
    transcript_path: 'must-not-copy.jsonl',
  });
  assert.deepEqual(Object.keys(result.windows), ['fiveHour', 'sevenDay']);
  assert.equal(JSON.stringify(result).includes('email'), false);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/collectorClaude.test.mjs tests/collectorState.test.mjs`

Expected: FAIL because collector modules do not exist.

- [ ] **Step 3: Implement sanitized parsing and atomic local spool writes**

The executable reads all stdin, parses JSON, writes only this provider payload
to `claude.json`, and exits 0 when rate limits are absent:

```json
{
  "collectedAt": "2026-07-10T09:30:00.000Z",
  "windows": {
    "fiveHour": { "usedPercent": 4, "resetsAt": 1783678020 },
    "sevenDay": { "usedPercent": 11, "resetsAt": 1784250000 }
  }
}
```

Atomic writes use a sibling temporary file followed by rename. On Windows the
state root is `%LOCALAPPDATA%\KindleLLMDashboard\state`; other platforms use
`$XDG_STATE_HOME/kindle-llm-dashboard` or `~/.local/state/kindle-llm-dashboard`.

- [ ] **Step 4: Keep the Claude terminal status line useful**

On valid input print `Claude quota | 5h 96% | 7d 89%`, using remaining values.
On absent rate-limit data print `Claude quota | waiting for first response`.
Never print reset payloads, paths, identity, or errors containing input data.

- [ ] **Step 5: Verify and commit Claude collection**

Run: `node --test tests/collectorClaude.test.mjs tests/collectorState.test.mjs`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all tests PASS.

```powershell
git add collector/lib/paths.mjs collector/lib/claudeStatus.mjs collector/lib/localState.mjs collector/claude-statusline.mjs tests/collectorClaude.test.mjs tests/collectorState.test.mjs
git commit -m "Add Claude quota status collector"
```

---

### Task 5: Codex App-Server Client and Signed Uploader

**Files:**
- Create: `collector/lib/codexRateLimits.mjs`
- Create: `collector/lib/collectorConfig.mjs`
- Create: `collector/lib/uploadClient.mjs`
- Create: `collector/upload.mjs`
- Create: `collector/config.example.json`
- Create: `tests/collectorCodex.test.mjs`
- Create: `tests/collectorUpload.test.mjs`

**Interfaces:**
- Consumes: local state functions from Task 4 and normalized snapshot contract from Task 1.
- Produces: `mapCodexRateLimits(result)`, `readCodexRateLimits(options)`, `buildMergedLocalSnapshot(options)`, and `uploadSnapshot(options)`.
- Consumed later: Task 6 installs and schedules `collector/upload.mjs`.

- [ ] **Step 1: Write failing duration-mapping and upload tests**

```js
test('maps Codex windows by duration instead of primary order', () => {
  const result = mapCodexRateLimits({
    rateLimits: {
      primary: { usedPercent: 19, windowDurationMins: 10080, resetsAt: 1784250000 },
      secondary: { usedPercent: 17, windowDurationMins: 300, resetsAt: 1783678020 },
    },
  });
  assert.equal(result.windows.fiveHour.usedPercent, 17);
  assert.equal(result.windows.sevenDay.usedPercent, 19);
});

test('uploads only the normalized snapshot with bearer auth', async () => {
  const requests = [];
  await uploadSnapshot({ snapshot, config, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  }});
  assert.equal(requests[0].init.headers.Authorization, 'Bearer local-secret');
  assert.equal(requests[0].init.body.includes('local-secret'), false);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs`

Expected: FAIL because the Codex and uploader modules do not exist.

- [ ] **Step 3: Implement the official app-server handshake**

Spawn the configured Codex command with `app-server --stdio`. Send newline
delimited JSON in this order:

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"kindle_llm_token_dashboard","title":"Kindle LLM Token Dashboard","version":"1.0.0"}}}
{"method":"initialized","params":{}}
{"method":"account/rateLimits/read","id":2}
```

Read JSONL until response id 2, enforce a 15-second timeout, map a `codex`
entry from `rateLimitsByLimitId` when present and otherwise use `rateLimits`,
then terminate the child. Stderr is reduced to a credential-free error class.

- [ ] **Step 4: Implement local merge, lock, and backoff**

The uploader reads `claude.json`, queries Codex, merges either valid provider
with `last-upload.json`, and writes no network request if neither provider is
available. Acquire `upload.lock` with exclusive creation. Backoff state starts
at five minutes and doubles to a maximum of 60 minutes; success clears it.

- [ ] **Step 5: Implement bounded signed HTTPS upload**

Config contains `ingestUrl`, `ingestToken`, optional `codexCommand`,
`timeoutMs`, and `timeZone`. Reject non-HTTPS production URLs and missing
tokens. Use `AbortSignal.timeout`, set `Content-Type: application/json`, and
never include config or snapshot content in error messages.

- [ ] **Step 6: Verify and commit the uploader**

Run: `node --test tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all tests PASS.

```powershell
git add collector/lib/codexRateLimits.mjs collector/lib/collectorConfig.mjs collector/lib/uploadClient.mjs collector/upload.mjs collector/config.example.json tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs
git commit -m "Add Codex quota uploader"
```

---

### Task 6: Reversible Windows Installation

**Files:**
- Create: `collector/install-windows.ps1`
- Create: `collector/uninstall-windows.ps1`
- Create: `collector/diagnose-windows.ps1`
- Create: `tests/collectorWindows.test.mjs`

**Interfaces:**
- Consumes: collector entrypoints from Tasks 4 and 5.
- Produces: a per-user install under `%LOCALAPPDATA%\KindleLLMDashboard`, a Claude status-line registration, and Scheduled Task `Kindle LLM Quota Uploader`.

- [ ] **Step 1: Write failing static safety tests**

Tests assert that installer scripts:

- never embed `DASHBOARD_INGEST_TOKEN` values in a task command line;
- use a user-profile install directory;
- back up Claude settings before mutation;
- refuse to overwrite a foreign `statusLine` unless
  `-ReplaceExistingStatusLine` is supplied;
- create a five-minute task; and
- uninstall only the named task and files owned by this project.

- [ ] **Step 2: Run the safety test and confirm failure**

Run: `node --test tests/collectorWindows.test.mjs`

Expected: FAIL because PowerShell installer files do not exist.

- [ ] **Step 3: Implement install with explicit configuration**

The installer accepts `-IngestUrl`, optional `-CodexCommand`, and
`-ReplaceExistingStatusLine`. It prompts for the ingest token with
`Read-Host -AsSecureString`, copies collector files, writes protected per-user
`config.json`, and registers the task through Windows `schtasks.exe` without
putting the token in `/TR`.

It parses `%USERPROFILE%\.claude\settings.json` as JSON. If no status line is
present, it registers the installed `claude-statusline.mjs`. If another command
is present, it creates a timestamped backup and stops unless replacement was
explicitly authorized.

The installer restricts `config.json` ACLs to the current user and SYSTEM. The
scheduled-task command contains only executable and script paths; the ingest
token is read from that protected file at runtime.

- [ ] **Step 4: Implement diagnostics and safe uninstall**

Diagnostics report booleans and versions only: Node available, Claude command
available, Claude auth logged in, Codex command available, config present,
spool present, task present, and last upload status. They never print identity,
token, snapshot values, or paths containing user content.

Uninstall removes the task, restores the backed-up Claude setting only when the
current command still matches this project, and removes the installed app while
leaving timestamped backups for manual recovery.

- [ ] **Step 5: Verify PowerShell and test suite**

Run PowerShell parser validation on all three scripts and then:

Run: `node --test tests/collectorWindows.test.mjs`

Expected: all focused tests PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit Windows integration**

```powershell
git add collector/install-windows.ps1 collector/uninstall-windows.ps1 collector/diagnose-windows.ps1 tests/collectorWindows.test.mjs
git commit -m "Add reversible Windows collector install"
```

---

### Task 7: Open-Source v1.0 Documentation and Defaults

**Files:**
- Create: `LICENSE`
- Rewrite: `README.md`
- Modify: `.env.example`
- Modify: `kindle-extension/local/env.sh`
- Modify: `kindle-extension/local/fetch-dashboard.sh`
- Create: `docs/SECURITY.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/WINDOWS-COLLECTOR.md`
- Create: `docs/VERCEL-SETUP.md`
- Create: `docs/images/dashboard-dp75sdi.png`
- Create: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Documents all interfaces produced by Tasks 1-6.
- Removes personal deployment defaults without changing the currently mounted Kindle until Task 8 installs its private production URL.

- [ ] **Step 1: Write failing release-hygiene tests**

Tests scan deployable defaults, examples, and user-facing documentation while
excluding historical `docs/superpowers/` design records. They require:

- MIT license text;
- no owner-specific Vercel hostname in runtime defaults or README examples;
- no personal email or account identifier;
- no credential-like example value;
- README links to Vercel, collector, security, recovery, and DP75SDI RTC docs;
- `.env.example` contains Blob, ingest, optional view-token, and dual-window
  manual fallback names; and
- Kindle `env.sh` uses a generic placeholder URL.

Both Kindle URL fallbacks (`env.sh` and `fetch-dashboard.sh`) must use the same
generic placeholder. The tracked preview is generated entirely from fixtures.

- [ ] **Step 2: Run release test and confirm failure**

Run: `node --test tests/openSourceRelease.test.mjs`

Expected: FAIL for the missing license and personal URL default.

- [ ] **Step 3: Add MIT license and generic deployment documentation**

Use `Copyright (c) 2026 pcedison`. Document demo mode first, private Blob and
signed live mode second, Windows installation third, and Kindle setup last.
Clearly state that provider API keys do not expose subscription-plan quotas.

- [ ] **Step 4: Document security and recovery boundaries**

Document the exact allowlisted snapshot schema, the fact that OAuth remains in
official local clients, secret rotation, optional dashboard view protection,
collector uninstall, Vercel Blob removal, KUAL Stop/Restore, and forced reboot
only as the final device recovery action.

- [ ] **Step 5: Verify release files and commit**

Run: `node --test tests/openSourceRelease.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

```powershell
git add LICENSE README.md .env.example kindle-extension/local/env.sh kindle-extension/local/fetch-dashboard.sh docs/SECURITY.md docs/ARCHITECTURE.md docs/WINDOWS-COLLECTOR.md docs/VERCEL-SETUP.md docs/images/dashboard-dp75sdi.png tests/openSourceRelease.test.mjs
git commit -m "Prepare open-source v1 release"
```

---

### Task 8: Production Deployment, Real Collector, and Kindle Acceptance

**Files:**
- Modify locally only: `%LOCALAPPDATA%\KindleLLMDashboard\config.json`
- Modify device only: `<KINDLE_DRIVE>:\extensions\kindle-dash\local\env.sh`
- Preserve device backup under: `<KINDLE_DRIVE>:\extensions\kindle-dash\backups\`
- Generate ignored artifact: `artifacts/dashboard-dp75sdi.png`

**Interfaces:**
- Consumes all prior tasks.
- Produces the merged PR, Vercel production deployment, real sanitized snapshot, and real Kindle verification evidence.

- [ ] **Step 1: Run complete local verification before publication**

Run: `npm test`

Expected: zero failures.

Run: `npm run build`

Expected: exit 0.

Run PowerShell syntax checks for every collector and Kindle shell syntax checks
for every `.sh` file. Generate and inspect the 758x1024 fixture preview. Verify
opaque grayscale metadata and nonblank pixels in header, Claude card, and
Codex card.

- [ ] **Step 2: Push branch and open a ready PR**

Push `codex/live-quota-v1`, create a PR to `main`, include test/build/preview
evidence, wait for Vercel and GitHub checks, and merge only when all required
checks pass. Pull the merge commit back to local `main` without discarding any
unrelated user changes.

- [ ] **Step 3: Configure production storage and secrets**

In the signed-in Vercel project create a private Blob store. Generate separate
random ingest and view secrets locally. Add `DASHBOARD_INGEST_TOKEN` and
`DASHBOARD_VIEW_TOKEN` to Production, Preview, and Development without showing
their values. Confirm `BLOB_READ_WRITE_TOKEN` is connected automatically.
Redeploy the merged production commit.

- [ ] **Step 4: Synthetic production smoke test**

POST a fixture snapshot through `/api/usage`, request the protected dashboard,
and verify HTTP status, content type, 758x1024 dimensions, 8-bit grayscale,
nonblank pixels, and visible 5-hour/7-day values. Confirm an unauthenticated
dashboard request returns 401 and an invalid ingest token returns 401.

- [ ] **Step 5: Install and verify the real local collector**

Install or locate the official Codex CLI app-server, preserving the official
shared login. Run the reversible Windows installer, configure the production
ingest endpoint, and register the Claude status line. Trigger one normal Claude
response so official status-line rate limits are emitted, run the uploader,
and verify the production PNG changes to real values.

Inspect the normalized local and server snapshots structurally. Report only
whether each approved field exists; never print actual credentials, identity,
or full request headers.

- [ ] **Step 6: Back up and update the mounted Kindle URL**

Create a timestamped backup of device `local/env.sh`. Update only the production
dashboard URL to include the optional view key, preserve
`REFRESH_INTERVAL_SECS=720`, `DASHBOARD_USE_RTC=true`,
`CLEAR_BEFORE_DISPLAY=false`, and `STOP_KINDLE_UI=false`, and preserve LF line
endings. Verify deployed scripts still match the merged Git blobs.

- [ ] **Step 7: Real-device acceptance cycle**

Safely eject, stop and restart the dashboard through KUAL, and verify the first
live dual-window frame fills the screen. Leave the Kindle unplugged and
untouched for at least 13 minutes, reconnect, and require logs proving RTC
sleep, wake, successful protected PNG download, and second full display exit 0.

- [ ] **Step 8: Release readiness report**

Report branch, commits, PR, merge SHA, production deployment SHA, production
smoke checks, collector status, Kindle evidence, and any remaining limitation.
Create tag/release `v1.0.0` only after every acceptance criterion is proven and
the tracked repository contains no secrets or personal deployment values.
