# Multi-Device Event-Driven Quota Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vercel the continuously available Kindle dashboard backend while Windows and macOS perform short-lived, event-driven subscription quota collection only when those computers are already awake.

**Architecture:** Upgrade the sanitized quota contract to backward-compatible v2 with timestamps on each quota window, then add separate Claude event and scheduled Codex execution paths to the shared Node collector. Windows Task Scheduler and a new macOS LaunchAgent invoke the same one-shot core; Vercel merges newest-per-window data and renders delayed state honestly without holding provider credentials.

**Tech Stack:** Next.js 16, Node.js 20.9+ ESM and test runner, Vercel Blob, PowerShell 5.1+, POSIX shell on macOS, launchd, macOS Keychain, official Claude Code status line, official Codex app-server JSONL.

## Global Constraints

- Vercel never stores Claude or ChatGPT OAuth credentials.
- Collectors upload only percentages, reset timestamps, and collection timestamps.
- Claude fresh data comes only from official status-line input after a response.
- Codex uses only `account/rateLimits/read`; no model prompt is sent.
- Every collector invocation is bounded and one-shot; no computer is kept awake.
- iOS official-app and cloud usage is eventually consistent and requires no
  manual phone action.
- Windows and macOS use the same Node parsing, merge, upload, backoff, and lock logic.
- New scheduling cadence is exactly 720 seconds while the user session is awake.
- A timestamp more than 10 minutes ahead of Vercel receive time is rejected.
- Data older than 30 minutes shows a restrained sync warning.
- A passed reset without a newer observation shows `--%` and `SYNC PENDING`, not `100%`.
- New code follows test-first red-green-refactor cycles.
- Existing unrelated untracked diagnostics and generated dependency junctions remain untouched.

---

## File Structure

### Server and renderer

- `app/api/dashboard/quotaSnapshot.mjs`: v1-to-v2 normalization, per-window timestamps, per-window conflict merge.
- `app/api/dashboard/providerData.mjs`: per-window freshness and post-reset unknown display data.
- `app/api/dashboard/dashboardHandler.mjs`: compact provider sync indicator in the existing vendor line.
- `app/api/usage/route.js`: receive-time future-skew validation.
- `app/api/dashboard/quotaStore.mjs`: persist normalized v2 snapshots through existing ETag retries.

### Shared collector

- `collector/lib/collectorSecret.mjs`: resolve the project-owned ingest secret from protected config or macOS Keychain.
- `collector/lib/collectorLock.mjs`: short-lived per-user single-instance gate with stale-lock recovery.
- `collector/lib/runCollector.mjs`: testable `claude-event` and `scheduled-sync` orchestration.
- `collector/lib/triggerUpload.mjs`: hidden detached Claude event upload trigger.
- `collector/lib/claudeStatus.mjs`: timestamp each observed Claude window.
- `collector/lib/collectorConfig.mjs`: platform-specific paths and secret-source validation.
- `collector/lib/uploadClient.mjs`: emit and retain v2 snapshots.
- `collector/claude-statusline.mjs`: capture first, print immediately, then trigger upload.
- `collector/upload.mjs`: parse mode/config arguments and call `runCollector`.

### Platform integration

- `collector/install-windows.ps1`, `collector/diagnose-windows.ps1`, `collector/uninstall-windows.ps1`: 12-minute login/resume-safe task and new runtime files.
- `collector/install-macos.sh`, `collector/diagnose-macos.sh`, `collector/uninstall-macos.sh`: reversible Application Support, Keychain, Claude settings, and LaunchAgent integration.

### Tests, CI, and documentation

- `tests/quotaSnapshot.test.mjs`, `tests/providerData.test.mjs`, `tests/dashboardRoute.test.mjs`, `tests/usageIngest.test.mjs`: v2 merge and display behavior.
- `tests/collectorClaude.test.mjs`, `tests/collectorUpload.test.mjs`, `tests/collectorWindows.test.mjs`: event modes and Windows integration.
- `tests/collectorMacos.test.mjs`: macOS installer, plist, Keychain, diagnostics, and uninstall behavior.
- `.github/workflows/ci.yml`: Windows, macOS, and Kindle shell jobs.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/WINDOWS-COLLECTOR.md`, `docs/MACOS-COLLECTOR.md`, `docs/VERCEL-SETUP.md`: eventual-consistency and platform runbooks.

---

### Task 1: Version-2 Per-Window Snapshot and Honest Freshness

**Files:**
- Modify: `app/api/dashboard/quotaSnapshot.mjs`
- Modify: `app/api/dashboard/providerData.mjs`
- Modify: `app/api/dashboard/dashboardHandler.mjs`
- Modify: `app/api/usage/route.js`
- Modify: `tests/quotaSnapshot.test.mjs`
- Modify: `tests/providerData.test.mjs`
- Modify: `tests/dashboardRoute.test.mjs`
- Modify: `tests/usageIngest.test.mjs`

**Interfaces:**
- Produces: `normalizeQuotaSnapshot(input, { receivedAt } = {}) -> Version2Snapshot`.
- Produces: `mergeQuotaSnapshots(current, incoming) -> Version2Snapshot` using each window's `collectedAt`.
- Produces: window display objects with `remaining`, `progress`, `reset`, and optional `lastSync`.
- Preserves: v1 ingest compatibility and the existing 8 KiB body bound.

- [ ] **Step 1: Write failing v1 migration and per-window merge tests**

Add focused cases equivalent to:

```js
test('upgrades v1 and merges each quota window by its own timestamp', () => {
  const current = normalizeQuotaSnapshot({
    version: 2,
    collectedAt: '2026-07-12T08:10:00.000Z',
    providers: { claude: { windows: {
      fiveHour: { usedPercent: 20, resetsAt: 1783843200, collectedAt: '2026-07-12T08:10:00.000Z' },
      sevenDay: { usedPercent: 30, resetsAt: 1784250000, collectedAt: '2026-07-12T08:00:00.000Z' },
    } } },
  });
  const incoming = {
    version: 1,
    collectedAt: '2026-07-12T08:05:00.000Z',
    providers: { claude: { windows: {
      fiveHour: { usedPercent: 90, resetsAt: 1783843200 },
      sevenDay: { usedPercent: 40, resetsAt: 1784250000 },
    } } },
  };
  const merged = mergeQuotaSnapshots(current, incoming);
  assert.equal(merged.version, 2);
  assert.equal(merged.providers.claude.windows.fiveHour.usedPercent, 20);
  assert.equal(merged.providers.claude.windows.sevenDay.usedPercent, 40);
});
```

Add an ingest test with dependency time `2026-07-12T08:00:00.000Z` that rejects
a window collected at `2026-07-12T08:10:01.000Z` and accepts one collected at
exactly `2026-07-12T08:10:00.000Z`.

- [ ] **Step 2: Run the contract test and verify the expected red state**

Run: `node --test tests/quotaSnapshot.test.mjs`

Expected: FAIL because version 2 and window-level `collectedAt` are unsupported.

- [ ] **Step 3: Implement minimal v2 normalization and merge**

Use explicit provider/window allowlists and return this stable shape:

```js
function normalizeWindow(window, fallbackCollectedAt) {
  return {
    usedPercent: Math.min(Math.max(window.usedPercent, 0), 100),
    resetsAt: window.resetsAt,
    collectedAt: normalizeCollectedAt(window.collectedAt ?? fallbackCollectedAt),
  };
}

function mergeWindow(left, right) {
  if (!right) return left;
  if (!left) return right;
  return Date.parse(right.collectedAt) >= Date.parse(left.collectedAt) ? right : left;
}
```

Accept input versions 1 and 2, always return version 2, derive provider and top-level timestamps from retained windows, and enforce future skew only when `receivedAt` is supplied.

- [ ] **Step 4: Verify v2 contract green without regressing existing tests**

Run: `node --test tests/quotaSnapshot.test.mjs tests/quotaStore.test.mjs tests/usageIngest.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Write failing freshness and post-reset display tests**

Add assertions equivalent to:

```js
test('expired unobserved window becomes sync pending', () => {
  const result = getWindowDisplay({
    usedPercent: 70,
    resetsAt: 1783840000,
    collectedAt: '2026-07-12T07:00:00.000Z',
  }, { now: Date.parse('2026-07-12T08:00:00.000Z'), windowKey: 'fiveHour' });
  assert.deepEqual(result, {
    label: '5 HOURS', remaining: '--%', progress: 0, reset: 'SYNC PENDING',
  });
});
```

Add a 30-minute stale fixture whose provider vendor line includes `SYNC HH:MM`, while a fresh fixture does not.

- [ ] **Step 6: Run display tests and verify the expected red state**

Run: `node --test tests/providerData.test.mjs tests/dashboardRoute.test.mjs`

Expected: FAIL because expired rows still claim `100%` and freshness is provider-level at 24 hours.

- [ ] **Step 7: Implement per-window freshness and compact rendering**

Return `SYNC PENDING` for passed reset timestamps. For unexpired live windows older than 30 minutes, calculate `SYNC HH:MM` in the dashboard timezone. Use the oldest delayed visible window as a conservative provider-line indicator so no extra row changes fixed geometry.

- [ ] **Step 8: Verify Task 1 and commit**

Run: `node --test tests/quotaSnapshot.test.mjs tests/quotaStore.test.mjs tests/usageIngest.test.mjs tests/providerData.test.mjs tests/dashboardRoute.test.mjs`

Expected: PASS with zero failures.

```powershell
git add app/api/dashboard/quotaSnapshot.mjs app/api/dashboard/providerData.mjs app/api/dashboard/dashboardHandler.mjs app/api/usage/route.js tests/quotaSnapshot.test.mjs tests/providerData.test.mjs tests/dashboardRoute.test.mjs tests/usageIngest.test.mjs
git commit -m "Add per-window quota convergence"
```

---

### Task 2: Shared Event-Driven Collector Core

**Files:**
- Create: `collector/lib/collectorSecret.mjs`
- Create: `collector/lib/collectorLock.mjs`
- Create: `collector/lib/runCollector.mjs`
- Create: `collector/lib/triggerUpload.mjs`
- Modify: `collector/lib/claudeStatus.mjs`
- Modify: `collector/lib/collectorConfig.mjs`
- Modify: `collector/lib/paths.mjs`
- Modify: `collector/lib/uploadClient.mjs`
- Modify: `collector/claude-statusline.mjs`
- Modify: `collector/upload.mjs`
- Modify: `tests/collectorClaude.test.mjs`
- Modify: `tests/collectorState.test.mjs`
- Modify: `tests/collectorUpload.test.mjs`

**Interfaces:**
- Produces: `resolveIngestToken(config, deps) -> Promise<string>`.
- Produces: `withCollectorLock({ stateRoot, action, now, staleAfterMs })`.
- Produces: `runCollector({ mode, configPath, deps })`, where mode is `claude-event` or `scheduled-sync`.
- Produces: `triggerClaudeUpload({ configPath, spawn, execPath, uploadPath }) -> boolean`.
- Consumes: Task 1 version-2 normalization and merge functions.

- [ ] **Step 1: Write failing tests for distinct collector modes**

Add tests proving `claude-event` never calls the Codex reader and `scheduled-sync` does:

```js
test('claude event uploads saved Claude state without starting Codex', async () => {
  let codexReads = 0;
  const result = await runCollector({
    mode: 'claude-event',
    configPath: 'fixture-config.json',
    deps: {
      readCollectorConfig: async () => ({
        ingestUrl: 'https://example.test/api/usage', ingestToken: 'fixture-secret',
      }),
      resolveIngestToken: async () => 'fixture-secret',
      stateRoot: () => 'fixture-state',
      readCodexRateLimits: async () => { codexReads += 1; return {}; },
      buildMergedLocalSnapshot: async () => ({
        version: 2,
        collectedAt: '2026-07-12T08:00:00.000Z',
        providers: { claude: { windows: {
          fiveHour: {
            usedPercent: 10,
            resetsAt: 1783843200,
            collectedAt: '2026-07-12T08:00:00.000Z',
          },
        } } },
      }),
      uploadSnapshot: async () => ({ uploaded: true }),
      withCollectorLock: async ({ action }) => action(),
    },
  });
  assert.equal(codexReads, 0);
  assert.equal(result.uploaded, true);
});
```

Also test hidden detached spawn options, newest-window timestamp retention, lock cleanup, and stale-lock recovery.

- [ ] **Step 2: Run collector tests and verify the expected red state**

Run: `node --test tests/collectorClaude.test.mjs tests/collectorState.test.mjs tests/collectorUpload.test.mjs`

Expected: FAIL because the mode runner, trigger, secret resolver, and lock do not exist.

- [ ] **Step 3: Implement secret resolution and platform paths**

Keep Windows config compatible. For macOS, resolve Application Support paths and read only the project-owned Keychain item:

```js
export async function resolveIngestToken(config, { platform = process.platform, execFile = execFileAsync } = {}) {
  if (config.ingestToken) return String(config.ingestToken);
  if (platform === 'darwin' && config.ingestTokenSource === 'macos-keychain') {
    const { stdout } = await execFile('/usr/bin/security', [
      'find-generic-password', '-w', '-s', config.keychainService,
    ]);
    if (stdout.trim()) return stdout.trim();
  }
  throw new Error('Collector ingest credential is unavailable');
}
```

Do not log command output or place the resolved token back into configuration or state.

- [ ] **Step 4: Implement the single-instance gate and orchestrator**

Use exclusive file creation for a lock containing only PID and creation time. Always remove an owned lock in `finally`; replace a lock older than two minutes. `claude-event` builds from saved Claude state only, while `scheduled-sync` performs the bounded Codex query.

- [ ] **Step 5: Implement immediate non-blocking Claude trigger**

After atomic state capture and status-line output, spawn:

```js
spawn(process.execPath, [uploadPath, '--mode=claude-event', `--config=${configPath}`], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
}).unref();
```

Treat spawn failure as nonfatal because state remains queued for the scheduled runner.

- [ ] **Step 6: Verify collector green and full provider compatibility**

Run: `node --test tests/collectorClaude.test.mjs tests/collectorState.test.mjs tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit Task 2**

```powershell
git add collector/claude-statusline.mjs collector/upload.mjs collector/lib/claudeStatus.mjs collector/lib/collectorConfig.mjs collector/lib/collectorLock.mjs collector/lib/collectorSecret.mjs collector/lib/paths.mjs collector/lib/runCollector.mjs collector/lib/triggerUpload.mjs collector/lib/uploadClient.mjs tests/collectorClaude.test.mjs tests/collectorState.test.mjs tests/collectorUpload.test.mjs
git commit -m "Add event-driven collector modes"
```

---

### Task 3: Windows Login and 12-Minute One-Shot Scheduling

**Files:**
- Modify: `collector/install-windows.ps1`
- Modify: `collector/diagnose-windows.ps1`
- Modify: `collector/uninstall-windows.ps1`
- Modify: `tests/collectorWindows.test.mjs`
- Modify: `docs/WINDOWS-COLLECTOR.md`

**Interfaces:**
- Consumes: Task 2 installed runtime files and `upload.mjs --mode=scheduled-sync`.
- Produces: one manifest-owned per-user task with login trigger, 720-second repetition, start-when-available, no wake, and no overlap.

- [ ] **Step 1: Write failing task-definition and runtime-copy tests**

Require tests to observe:

```js
assert.match(install, /PT12M|720/);
assert.match(install, /LogonTrigger|AtLogOn/i);
assert.match(install, /StartWhenAvailable/i);
assert.match(install, /WakeToRun[^\r\n]*false/i);
assert.match(install, /IgnoreNew|MultipleInstances/i);
assert.match(install, /collectorLock\.mjs/);
assert.match(install, /runCollector\.mjs/);
```

Retain the existing foreign-task, foreign-status-line, rollback, reinstall, and uninstall tests.

- [ ] **Step 2: Run Windows tests and verify the expected red state**

Run: `node --test tests/collectorWindows.test.mjs`

Expected: FAIL because the current task repeats every five minutes and does not install the new core files.

- [ ] **Step 3: Implement the bounded Windows task update**

Build a manifest-owned task definition with exact triggers/settings. Its action is the installed Node executable plus:

```text
<install-root>\collector\upload.mjs --mode=scheduled-sync --config=<install-root>\config.json
```

Preserve hidden execution, user-only scope, atomic rollback, exact action ownership checks, and `WakeToRun=false`. Reinstall updates the owned task rather than creating a second task.

- [ ] **Step 4: Update diagnostics and runbook**

Diagnostics report booleans/classes for login trigger, 12-minute cadence, no-wake, and last successful upload. They must not print the task action, config contents, URL, token, quota values, or user paths.

- [ ] **Step 5: Verify and commit Task 3**

Run: `node --test tests/collectorWindows.test.mjs tests/collectorClaude.test.mjs tests/collectorUpload.test.mjs`

Expected: PASS with zero failures.

```powershell
git add collector/install-windows.ps1 collector/diagnose-windows.ps1 collector/uninstall-windows.ps1 tests/collectorWindows.test.mjs docs/WINDOWS-COLLECTOR.md
git commit -m "Make Windows quota sync event driven"
```

---

### Task 4: Reversible macOS Collector Packaging

**Files:**
- Create: `collector/install-macos.sh`
- Create: `collector/diagnose-macos.sh`
- Create: `collector/uninstall-macos.sh`
- Create: `tests/collectorMacos.test.mjs`
- Create: `docs/MACOS-COLLECTOR.md`
- Modify: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Consumes: Task 2 shared Node core and `macos-keychain` secret source.
- Produces: Application Support install, project-owned Keychain item, Claude status line, and `com.kindle-llm-dashboard.sync` LaunchAgent.

- [ ] **Step 1: Write failing macOS packaging tests**

The Node test runs scripts with a temporary HOME and fake `security`, `launchctl`, and `plutil` executables. Require:

```js
assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
assert.match(plist, /<key>StartInterval<\/key>\s*<integer>720<\/integer>/);
assert.match(plist, /<key>KeepAlive<\/key>\s*<false\/>/);
assert.doesNotMatch(plist, /ingestToken|Bearer\s|authorization/i);
```

Test install with spaces in HOME, foreign status-line refusal, Keychain command arguments, reinstall idempotency, project-owned restore, and uninstall idempotency.

- [ ] **Step 2: Run macOS tests and verify the expected red state**

Run: `node --test tests/collectorMacos.test.mjs tests/openSourceRelease.test.mjs`

Expected: FAIL because macOS scripts and documentation do not exist.

- [ ] **Step 3: Implement `install-macos.sh`**

Use `set -eu`, quote every path, read the token with silent terminal input, and save it with:

```sh
/usr/bin/security add-generic-password -U \
  -s 'KindleLLMDashboard.ingest' \
  -a "$USER" \
  -w "$ingest_token"
```

Write non-secret config and manifest with mode `600`, copy the exact shared runtime dependency set, back up Claude settings, refuse foreign status-line replacement unless explicitly requested, validate the plist with `plutil -lint`, and load it with the user launchd domain. Do not include the token in arguments, plist, manifest, backup names, or output.

- [ ] **Step 4: Implement credential-free diagnose and safe uninstall**

Diagnose returns only version/status classes. Uninstall verifies manifest ownership, unloads and removes only the exact LaunchAgent, restores Claude settings only if still project-owned, deletes the project Keychain item, and retains timestamped user backups.

- [ ] **Step 5: Verify shell syntax and macOS test behavior**

Run on the current Windows environment where Git Bash is available:

```powershell
bash -n collector/install-macos.sh
bash -n collector/diagnose-macos.sh
bash -n collector/uninstall-macos.sh
node --test tests/collectorMacos.test.mjs tests/openSourceRelease.test.mjs
```

Expected: every command exits 0.

- [ ] **Step 6: Commit Task 4**

```powershell
git add collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh tests/collectorMacos.test.mjs tests/openSourceRelease.test.mjs docs/MACOS-COLLECTOR.md
git commit -m "Add reversible macOS quota collector"
```

---

### Task 5: Cross-Platform CI and Public Documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/VERCEL-SETUP.md`
- Modify: `docs/WINDOWS-COLLECTOR.md`
- Modify: `docs/MACOS-COLLECTOR.md`
- Modify: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-4 behavior and commands.
- Produces: Windows/macOS CI gates and accurate eventual-consistency documentation.

- [ ] **Step 1: Write failing release-hygiene tests**

Require CI and docs to include macOS, 720-second cadence, Claude/Codex correction boundaries, and the macOS runbook:

```js
assert.match(workflow, /macos-latest/);
assert.ok(existsSync(new URL('../docs/MACOS-COLLECTOR.md', import.meta.url)));
assert.match(readme, /mobile.*next.*desktop/i);
assert.match(readme, /does not require.*remain.*on/i);
```

- [ ] **Step 2: Run release tests and verify the expected red state**

Run: `node --test tests/openSourceRelease.test.mjs`

Expected: FAIL until CI and public docs describe the new platform and consistency model.

- [ ] **Step 3: Add macOS CI**

Add a `macos-test-build` job using `macos-latest`, Node 20.x, `npm ci`, `npm test`, `npm run build`, and `bash -n` for all macOS scripts. Keep the Windows and Kindle syntax jobs.

- [ ] **Step 4: Update public documentation**

Document that Vercel remains available while computers are off, provider OAuth remains local, Codex mobile usage corrects at the next desktop poll, Claude mobile usage corrects after the next desktop response, and delayed rows show sync state. Include exact install/diagnose/uninstall commands without real URLs or secrets.

- [ ] **Step 5: Verify release hygiene and commit Task 5**

Run: `node --test tests/openSourceRelease.test.mjs`

Expected: PASS with zero failures.

```powershell
git add .github/workflows/ci.yml README.md docs/ARCHITECTURE.md docs/SECURITY.md docs/VERCEL-SETUP.md docs/WINDOWS-COLLECTOR.md docs/MACOS-COLLECTOR.md tests/openSourceRelease.test.mjs
git commit -m "Document multi-device quota convergence"
```

---

### Task 6: Full Verification, Windows Rollout, PR, Merge, and Vercel Smoke

**Files:**
- Update only if generated fixture output changes intentionally: `docs/images/dashboard-dp75sdi.png`
- Do not modify: `kindle-extension/**` unless a verified implementation diff requires it.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified branch, updated Windows installation, merged PR, and production deployment evidence.

- [ ] **Step 1: Run fresh complete local verification**

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all tests pass, Next.js lists `/api/dashboard` and `/api/usage`, and diff check exits 0.

- [ ] **Step 2: Run focused platform checks**

```powershell
node --test tests/collectorClaude.test.mjs tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs tests/collectorWindows.test.mjs tests/collectorMacos.test.mjs
bash -n collector/install-macos.sh
bash -n collector/diagnose-macos.sh
bash -n collector/uninstall-macos.sh
```

Expected: all commands exit 0 with no secret-bearing output.

- [ ] **Step 3: Reinstall and diagnose the Windows collector safely**

Use the existing protected local configuration and installer rollback path. Verify the manifest-owned task reports login trigger, 720-second cadence, start-when-available, no wake, and a successful one-shot run. Never print the stored ingest token or full config.

- [ ] **Step 4: Verify production-shaped PNG locally**

Run the fixture preview helper and inspect 758x1024 output metadata and pixels. Confirm fresh data adds no permanent clutter, stale data has a bounded sync marker, and post-reset unknown data has an empty bar.

- [ ] **Step 5: Push, create PR, and wait for checks**

```powershell
git push github codex/multidevice-event-sync
gh pr create --repo pcedison/kindle-LLM-token-display --base main --head codex/multidevice-event-sync --title "Add multi-device event-driven quota sync" --body-file "$env:TEMP\kindle-llm-multidevice-pr.md"
gh pr checks --repo pcedison/kindle-LLM-token-display --watch
```

Create the body before those commands and remove it afterward:

```powershell
@'
## Summary
- migrate live quota storage to backward-compatible per-window timestamps
- upload Claude status-line events immediately and poll Codex every 12 minutes while awake
- add reversible Windows and macOS integrations without cloud provider credentials

## Security
- Vercel receives only sanitized quota percentages, reset times, and collection times
- provider OAuth, prompts, transcripts, account identity, and repository data remain local

## Verification
- npm test
- npm run build
- focused Windows and macOS collector tests
- 758x1024 opaque grayscale PNG inspection
'@ | Set-Content -LiteralPath "$env:TEMP\kindle-llm-multidevice-pr.md" -Encoding utf8
```

- [ ] **Step 6: Review the PR diff and merge**

Verify the PR contains only intentional tracked changes, all checks are green, and no secrets or unrelated untracked files are present. Merge with the repository's existing merge strategy and delete the remote feature branch only after merge succeeds.

- [ ] **Step 7: Verify GitHub main and Vercel production**

Fetch `github/main`, record its merge SHA, and confirm the Vercel production deployment is Ready for that commit. Request the production DP75SDI URL and verify HTTP 200, `Cache-Control: no-store`, 758x1024 opaque 8-bit grayscale PNG, and nonblank pixels.

- [ ] **Step 8: Confirm Kindle delivery scope**

Compare tracked `kindle-extension` files with the mounted Kindle if available. If no tracked Kindle file changed, do not copy or rewrite D-drive files. The refreshed Vercel PNG reaches the existing Kindle installation automatically on its next 12-minute fetch.

- [ ] **Step 9: Record rollout evidence and final commit if documentation changed**

If rollout documentation needs new non-secret evidence, update the recovery handoff with commit SHA, PR, CI, deployment, Windows task class, and Kindle-copy decision, then rerun documentation tests and commit that single update before the final push.

---

## Plan Completion Gate

Before declaring completion:

- Every production behavior added in Tasks 1-5 has a test that was observed failing first.
- Full tests and build were rerun after the last tracked edit.
- Windows collector installation was verified without revealing secrets.
- macOS CI passed; lack of an interactive Mac is reported as the remaining real-device validation gap when applicable.
- GitHub PR checks passed and the PR merged into `main`.
- Vercel production serves the merged SHA and valid DP75SDI PNG.
- Kindle file-copy status is stated explicitly.
