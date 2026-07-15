# Live Quota Dashboard Recovery Handoff

Last updated: 2026-07-11, Asia/Taipei
Repository: `pcedison/kindle-LLM-token-display`
Production URL: intentionally not tracked; obtain it from the Vercel project.

## Executive Status

The interrupted source work was recovered without evidence of corruption. Tasks 1
through 7 are implemented in the recovery clone and the final independent review
is approved. The current release candidate passes 140 tests, a Next.js production
build, shell and PowerShell syntax checks, a local production HTTP PNG smoke test,
and a two-platform pull-request CI definition.

GitHub publication, prior PR merges, the private Vercel Blob rollout, real
Windows collector installation, signed live upload, direct production PNG smoke,
mounted-Kindle script synchronization, and the PR #9 Task Scheduler fixes are
complete. The remaining external acceptance is the unplugged Kindle refresh and
recovery cycle; do not call the deployment stable v1 until that physical check
passes.

## Canonical Paths And Branches

- Main checkout: `<WORKSPACE>\kindle-llm-dash`, branch `main`, HEAD
  `c48ba55` when recovery began.
- Original feature worktree: `<WORKSPACE>\kindle-llm-dash-live-quota`,
  branch `codex/live-quota-v1`, HEAD `de48e16` when the app closed.
- Active recovery clone: `<WORKSPACE>\kindle-llm-dash\.recovery\live-quota`,
  branch `codex/live-quota-recovery`, baseline HEAD `1fb2c5d` before the
  public-readiness follow-up.
- GitHub feature branch observed before publication: `codex/live-quota-v1`, HEAD
  `eefe204`; published snapshot HEAD is now `78a04b7`.
- GitHub `main` after PR #5: `6ee48d9` before the public-readiness follow-up.
- True whole-feature base: `c48ba55`; implementation-plan checkpoint: `eefe204`.

Use the recovery clone for all continuation work. It now has a real local
`node_modules` tree and is the only location verified at the latest release
candidate. Do not use the stale cross-root dependency junctions.

## Interruption Audit

The Windows Codex app exited unexpectedly during the earlier review cycle. No
Windows diagnostic was available that proves the external cause. Repository
evidence supports the following conclusions:

1. The original feature worktree remained intact at `de48e16`.
2. The reviewer process disappeared, so only review/session state was lost.
3. The first recovery install hit npm cache permission failures and left partial
   dependency directories.
4. A diagnostic cross-root `node_modules` junction caused one invalid Turbopack
   failure because Next.js rejects dependencies outside the project root.
5. The source suite passed in the original worktree, and later passed in the
   recovery clone after a real dependency tree was copied into that clone.
6. No tracked source file, commit object, or generated Kindle PNG was found
   corrupted.

The app-exit root cause remains unknown. The source recovery is complete; the
remaining junction backup directories are untracked diagnostic leftovers only.

## Completed Work

### Task 1: Normalized dual-window quota contract

Completed and reviewed in `9c8590d` and `ef0292a`.

- Supports Claude and Codex 5-hour and 7-day windows.
- Preserves fractional percentages.
- Validates reset epochs within the shared 2020-2100 boundary.
- Rejects credential-like fields recursively.
- Preserves legacy/manual 5-hour fallbacks.

### Task 2: Signed ingest and private snapshot storage

Completed and reviewed in `b2df8ef` and `24c477e`.

- Exact bearer authentication for `/api/usage`.
- 8192-byte declared and streamed body limits with early termination.
- Credential-free error responses.
- Private Vercel Blob storage with a stable pathname.
- Dashboard view authorization runs before storage access.
- Partial provider updates preserve the other provider and existing windows.

The exact accepted 8192-byte boundary plus oversized declared, buffered, and
streamed bodies are covered.

### Task 3: DP75SDI portrait dashboard

Completed and independently approved in `de1fc46` and `de48e16`.

- Exact 758x1024 opaque 8-bit grayscale PNG for DP75SDI/Paperwhite 2.
- Battery header, large Anthropic Claude Code and Codex titles.
- Separate 5 HOURS and 7 DAYS rows with fixed progress geometry.
- Fractional, 100%, missing, stale, and reset-complete states.
- Valid Basic 600x800 three-provider layout and KPW3/Voyage profiles.
- Compact layouts hide Pikachu before shrinking quota bars.
- Preview failures redact URLs and query credentials.

### Task 4: Claude status-line collector

Completed and approved in `6f03301`, `5bb98e5`, `f915fe7`, and `fecb030`.

- Reads only official Claude rate-limit fields.
- Keeps a bounded sanitized snapshot.
- Atomically replaces state and syncs the file and containing directory.
- Preserves an existing valid window when a status update is partial.
- Tests use isolated state roots and never write real `LOCALAPPDATA`.

### Task 5: Codex app-server collector and uploader

Completed and approved in `e6a5051`, `bb633d8`, and `e7fb5d9`; final runtime
fixes are in `dbb15c4`, `c44bc27`, `104fe9c`, and `3d7f351`.

- Uses official `codex app-server --stdio` JSONL exchange.
- Maps windows by duration and prefers the Codex limit identifier.
- Carries split JSONL chunks across reads.
- Handles spawn errors, drains stderr, suppresses stdin teardown errors, and
  deterministically terminates timed-out children.
- Uploads only normalized bounded JSON over HTTPS.
- Keeps request abort active while a response body stalls.
- Uses server-side ETag CAS and provider timestamps instead of a reclaimable
  filesystem lock; delayed old uploads cannot roll back Blob state.
- Serializes same-process local state writes and monotonically merges the current
  `last-upload.json` before replacement.
- Never writes the ingest token to local state.

### Task 6: Reversible Windows collector installation

Implemented in `b095b9b`, hardened in `468ce2e`, and completed by the installed
runtime dependency fix in `dbb15c4` plus final ownership changes in `c44bc27`
and `104fe9c`.

- Parses under Windows PowerShell 5.1.
- Prompts for secrets as `SecureString` and keeps them out of the scheduled-task
  command line.
- Protects config and manifest ACLs; cleanup fails closed if protection fails.
- Registers one random `Kindle LLM Quota Uploader-<GUID>` 5-minute per-user
  scheduled task and retains its exact identity in a protected schema-2 manifest.
- Performs staged reinstall and rollback for task, install tree, and Claude
  settings.
- Refuses to overwrite a foreign Claude status-line command.
- Never force-replaces a task; validates its action before rollback, after `/End`,
  and immediately before deletion.
- Restores only the original Claude `statusLine`; unrelated settings changed
  after installation are preserved.
- Finds `.cmd` command shims and emits redacted diagnostics.
- Copies `app/api/dashboard/quotaSnapshot.mjs`, required by the installed
  collector's relative imports.

The final independent reviewer approved the GUID ownership model and reversible
settings behavior after behavioral PowerShell harness tests. Real Task Scheduler
service acceptance remains part of Task 8.

### Task 7: Open-source release surface

Completed in `c3b8b73`.

- MIT license.
- Public README with architecture, setup, security, Windows collector, Kindle,
  RTC recovery, and preview links.
- Generic public defaults with no owner-specific deployment or identity.
- `.env.example` for private live mode and dual-window manual fallback.
- Security, architecture, Vercel, and Windows runbooks.
- Tracked 758x1024 grayscale DP75SDI fixture preview.
- Release-hygiene tests prevent personal URL/default regressions.
- Pull-request and `main` CI on Windows and Ubuntu verifies tests, production
  build, and every tracked Kindle shell script.
- The project and Next configuration consistently use ESM; the earlier Node
  module-reparse warning is removed.
- Windows Kindle-script tests resolve the installed Git Bash directly instead of
  accidentally invoking the Windows WSL compatibility stub.
- CI test fixtures remain on the checkout drive, and Windows PowerShell 5.1
  harnesses discard an inherited PowerShell 7 module path before startup.

## Verification Evidence

Fresh verification in the active recovery clone on 2026-07-11:

- `npm.cmd test`: 133 passed, 0 failed, 0 cancelled.
- `npm.cmd run build`: exit 0.
- Build routes: static `/`; dynamic `/api/dashboard` and `/api/usage`.
- Every tracked shell script: 13/13 passed `bash -n` using Git for Windows Bash.
- Every tracked PowerShell script: 3/3 parsed with Windows PowerShell; behavioral
  collector checks are also included in the test suite.
- `git diff --check`: exit 0.
- Tracked fixture: 758x1024, 8-bit grayscale, PNG color type 0.
- Local `next start` HTTP smoke: status 200, `image/png`, `no-store`, 758x1024,
  one-channel 8-bit grayscale.

## Final Review History

The first whole-release review found ten important issues: incorrect environment
names, Kindle certificate bypass and xtrace leakage, Blob cache/CAS behavior,
provider freshness, reinstall backup loss, task ownership, Windows command-shim
launching, local-state durability, release hygiene, and imprecise privacy text.
They were fixed in `c44bc27` and covered by regression tests.

The second review found four remaining issues: generic first-create Blob conflict
handling, lock-file reclaim TOCTOU, scheduled-task ownership TOCTOU, and uninstall
overwriting later Claude settings. They were fixed in `104fe9c` by narrowing Blob
conflicts, removing the unnecessary uploader lock, introducing manifest-owned
GUID tasks with repeated action validation, and restoring only `statusLine`.

The final reviewer then reproduced a delayed older quota overwriting newer data
after a CAS retry. `3d7f351` made provider timestamps monotonic on both server and
local state and added the exact delayed-upload regression. The same review raised
schema-1 migration conditionally; it is not an active blocker because the remote
branch never contained an installer and the local machine has neither the old
fixed task nor a GUID uploader task. Final re-review result: `APPROVED`, focused
tests 59/59 and full tests 130/130 at that review point. The later public-readiness
follow-up adds three release/edge tests, bringing the fresh full suite to 133/133.
The deliberate ESM migration changes `next.config.js` to `next.config.mjs` and
removes the former `MODULE_TYPELESS_PACKAGE_JSON` warning.

## Git And Review State

Latest local release-candidate commits, newest first:

```text
3d7f351 Prevent stale quota rollback
104fe9c Resolve final release race conditions
c44bc27 Fix release security and durability findings
de4887a Update recovery release handoff
dbb15c4 Fix installed collector runtime dependencies
c3b8b73 Prepare open-source v1 release
468ce2e Fix Windows installer rollback safety
b095b9b Add reversible Windows collector install
e7fb5d9 Mark Codex uploader review complete
bb633d8 Fix Codex quota uploader review findings
e6a5051 Add Codex quota uploader
fecb030 Mark Claude collector review complete
5bb98e5 Fix Claude quota collector durability
6f03301 Add Claude quota status collector
```

Do not commit these untracked diagnostics:

- `node_modules.junction.backup/`
- `node_modules.partial.junction.20260710115202/`

The shell Git remote cannot reach `github.com:443` and GitHub CLI config is not
readable in this sandbox. Publication therefore used the connected GitHub App's
Git Data API. All 63 changed blobs matched their local Git blob SHA, and remote
tree `ec20195b7fd25dc2cf61a3702cc94b07bebabb24` exactly matched the reviewed
local tree. Remote snapshot `78a04b7` was merged through
[PR #4](https://github.com/pcedison/kindle-LLM-token-display/pull/4) using squash.
The deployment/device handoff was merged through
[PR #5](https://github.com/pcedison/kindle-LLM-token-display/pull/5); the resulting
baseline `main` is `6ee48d9`. The local granular commits remain the audit trail.

## Production Configuration Contract

The Vercel project must contain these secret/config values. Never write their
values into Git, screenshots, issue text, command history, or this handoff.

- `BLOB_READ_WRITE_TOKEN`
- `DASHBOARD_INGEST_TOKEN`
- `DASHBOARD_VIEW_TOKEN` (optional, but recommended for a private device URL)

The GitHub status on merge commit `6ee48d9` reports the Vercel deployment as
successful. This proves the integrated production build completed, but not that
private Blob and all three values above are configured correctly. Direct endpoint
verification remains pending because shell/web egress is blocked and the requested
Chrome extension connection was unavailable. Do not infer secret presence from a
green deployment check.

Manual fixture variables remain optional and are not substitutes for live
subscription quota. Provider API keys are intentionally not used: OpenAI and
Anthropic API billing endpoints do not expose the user's Codex/Claude subscription
5-hour and weekly limits.

## Windows Collector Acceptance

After production deployment is verified, install from an ordinary PowerShell
session in the recovery clone:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\collector\install-windows.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\collector\diagnose-windows.ps1
```

The installer should prompt privately for the production ingest URL/token. The
diagnostic may report existence, task state, and versions only. It must not print
the URL query, bearer token, Claude payload, Codex payload, or stored snapshot.

Then trigger one collection cycle and confirm only a successful status and
fresh timestamp. Do not paste raw collector config or state into a task.

Current machine evidence: Task Scheduler has neither the old fixed uploader task
nor any schema-2 GUID uploader task, so the real collector is not installed. A
`%LOCALAPPDATA%\KindleLLMDashboard` directory is visible to the sandbox, but its
contents and manifest are not readable under the sandbox identity. Before running
the installer as the actual Windows user, inspect that directory. If it has no
valid owned manifest, rename the whole directory to a timestamped quarantine
folder instead of deleting individual unknown files; the installer intentionally
fails closed when an install root exists without a manifest.

## Mounted Kindle State

At the latest synchronized audit, `D:` was mounted and
`<KINDLE_DRIVE>:\extensions\kindle-dash` existed.

- Matching files: `diagnose.sh`, `local/dashboard-utils.sh`,
  `local/display-once.sh`, `local/display-test-frame.sh`,
  `local/get-battery-level.sh`, `low-power-test.sh`, `refresh-now.sh`,
  `start.sh`, `stop.sh`, `test-frame.png`, and `wait-for-wifi.sh`.
- `dash.sh`, `local/fetch-dashboard.sh`, and `menu.json` were synchronized and
  then matched the reviewed repository SHA. Backup folder:
  `backups/pre-live-quota-20260711-101003`.
- `local/env.sh` intentionally differs because it owns the private deployment
  URL. Preserve that file and update only the URL/view key when production auth
  is confirmed; never replace it with the public placeholder file.
- Every other repository-managed Kindle file now matches the reviewed source.
  Physical eject, KUAL start, Wi-Fi fetch, and 13-minute refresh acceptance have
  not yet been run after this synchronization.

The 2026-07-11 session successfully wrote and re-read the mounted Kindle. Future
sessions must still verify hashes after every copy rather than assuming device
state from repository state.

## 2026-07-11 Native Chrome Overlay Fix

### Symptom and root cause

After `Start LLM Token Dashboard`, the rendered 758x1024 dashboard was correct,
but a black native Kindle strip containing Wi-Fi, battery, and the stock clock
appeared over the upper-right corner. This was not part of the Vercel PNG. The
device log recorded successful full `eips` updates, and the mounted device
reported `Kindle 5.12.2.2 (379151 038)` in
`<KINDLE_DRIVE>:\system\version.txt`.

The cause is the stock window stack redrawing after `eips`: Pillow owns the
status bar, while firmware 5.7.2 and newer can still have the `awesome` window
manager repaint the clock after Pillow is hidden. The implementation follows
the reversible normal-framework strategy used by KOReader for this firmware
family. It does not stop `framework`, `lab126_gui`, or `webreader`.

### Implemented behavior

- `local/chrome-control.sh` disables Pillow and sends `SIGSTOP` to `awesome`
  when dashboard mode starts. Its restore path always sends `SIGCONT` and
  re-enables Pillow, even if local settings changed after a failed run.
- `dash.sh` waits for KUAL to close, hides native chrome, then draws the PNG.
  An `EXIT` cleanup trap restores native chrome and clears
  `preventScreenSaver`; HUP/INT/TERM exit through that cleanup.
- `local/power-button-exit.sh` watches the official `powerd` events. Physical
  button sources `goingToScreenSaver 2` and `outOfScreenSaver 1` terminate the
  daemon; RTC wake events do not match. This provides a non-reboot escape: one
  power-button press exits dashboard mode, and a second press is needed only if
  the native sleep screen appears.
- `stop.sh` independently restores `awesome` and Pillow, so SSH/KUAL recovery
  remains idempotent. It intentionally does not source mutable `local/env.sh`,
  so a malformed user configuration cannot block recovery.
- Independent review found and fixed a stale-PID/process-leak risk in the first
  watcher draft. The final watcher never signals a stored dashboard PID; it
  invokes idempotent `stop.sh`, records the `lipc-wait-event` child separately,
  validates command lines through `/proc` before parent-side cleanup, and uses
  bounded forced termination rather than an unbounded wait.
- A second review found that the legacy relative `./dash.sh` launch was not
  guaranteed to match the Stop fallback. `start.sh` now launches an absolute
  path, and both Start and Stop use `logs/dash.pid` plus command-line and cwd
  ownership validation before signaling. The relative form is accepted only as
  a cwd-constrained migration path for the already-installed older launcher.
- Final independent re-review reported no remaining Critical or Important
  findings.
- Public defaults enable `HIDE_KINDLE_CHROME`,
  `FREEZE_KINDLE_WINDOW_MANAGER`, and `POWER_BUTTON_RESTORES_KINDLE` while
  retaining the full Kindle framework.

### Verification and mounted-device state

- The two new lifecycle tests were observed failing before implementation.
- `npm.cmd test`: 138/138 passed.
- `npm.cmd run build`: successful Next.js production build.
- All repository and copied device shell scripts passed `sh -n`.
- Updated on `<KINDLE_DRIVE>:\extensions\kindle-dash`: `dash.sh`, `start.sh`,
  `stop.sh`, `local/dashboard-utils.sh`, `local/chrome-control.sh`, and
  `local/power-button-exit.sh`.
- `local/env.sh` was edited in place only to add the three chrome controls.
  Its private dashboard URL, 720-second interval, and validated
  `DASHBOARD_USE_RTC=true` value were preserved.
- Backup:
  `<KINDLE_DRIVE>:\extensions\kindle-dash\backups\pre-chrome-overlay-20260711-143000`.
- SHA-256 comparison confirmed all six copied runtime files exactly matched
  the reviewed local working tree.

Physical acceptance remains pending: safely eject, run Start, confirm the
stock black strip does not return through a refresh/suspend cycle, then press
the power button once and again to verify dashboard exit and native UI restore.
If the watcher does not fire, SSH `stop.sh` or a reboot restores process signal
state; do not describe this hotfix as device-accepted until that test is
recorded.

## 2026-07-11 Live Collector Production Rollout

### Provider clients and authentication

- Node.js 24 and Claude Code 2.1.207 were present. Claude reported an active
  subscription/OAuth-style login; no identity or credential value was recorded.
- The Codex desktop package exposed a bundled executable on `PATH`, but Windows
  denied direct command-line execution of that packaged file. The official
  Codex CLI 0.144.1 was installed separately and reused the existing ChatGPT
  login. A direct `account/rateLimits/read` probe returned both approved window
  shapes without printing their values.
- No Anthropic or OpenAI API key was added. Subscription 5-hour and 7-day quota
  windows come only from the signed-in official clients.

### Vercel and storage

- The local checkout was linked to the existing Vercel project with the official
  CLI. A private Blob store was created and connected to Production, Preview,
  and Development.
- A random production `DASHBOARD_INGEST_TOKEN` was generated in memory, shared
  only with Vercel and the ACL-protected Windows config, and then cleared.
  `DASHBOARD_VIEW_TOKEN` remains intentionally unset, so the current Kindle URL
  does not need a private query key.
- Six manual Claude/Codex fixture variables were removed from Production after
  the first real upload; Preview retains them for demo/testing use.
- An invalid ingest bearer returned 401. The live dashboard returned 200,
  `image/png`, and `Cache-Control: no-store`; the downloaded file was exactly
  758x1024, opaque 8-bit grayscale, and non-interlaced.

### Real installer failures and fixes

The first real install exposed two Windows behaviors that the mocked harnesses
did not reproduce:

1. A normal missing-task `schtasks /Query` writes to the PowerShell error stream.
   With global `ErrorActionPreference = Stop`, installation terminated before
   it could inspect the expected nonzero exit code.
2. The `/TR` command string was split at the space in `C:\Program Files`, so
   Task Scheduler received `Files\nodejs\node.exe ...` instead of the Node
   executable and separate arguments.

The fix temporarily relaxes the error preference only around native task
queries/creation while still requiring exact exit codes. Task registration now
uses a Task Scheduler COM definition serialized to temporary XML and passed to
non-forcing `schtasks /Create /XML`. Its action stores the executable and
arguments separately, uses an interactive-token principal, ignores overlapping
runs, and repeats every five minutes with `PT5M`; the omitted duration means
indefinite repetition. The temporary XML contains no ingest token and is removed
in `finally`.

Two Windows PowerShell regressions were observed failing before implementation
and passing afterward. Final verification is 16/16 focused Windows collector
tests, 140/140 full tests, a successful Next.js production build, and a real
Task Scheduler query proving exact executable/argument matches, indefinite
five-minute repetition, an enabled task, a successful automatic last run, and a
future next run.

### Installed live state

- The stale test-only local collector directory was moved intact to a timestamped
  quarantine before installation.
- The protected config and manifest, Claude status-line integration,
  manifest-owned GUID task, Claude spool, and successful last-upload marker all
  exist.
- A manual first cycle and the subsequent scheduled cycle succeeded. Production
  now renders live Claude Code and Codex 5-hour and 7-day windows from private
  Blob. Only normalized percentages, reset epochs, provider timestamps, and the
  global collection time were uploaded.
- Fix commit `d0984a1` plus rollout handoff commit `5331eef` were published on
  `codex/windows-live-collector`. PR #9 passed Windows test/build, Kindle shell
  syntax, and Vercel checks, then squash-merged as
  `d3fc282a33ec26ea89b2f82efff5e352ab018090`.
- The merge commit's Vercel status is successful. Production deployment
  `dpl_BBfzu7TMP3ima6cx1eYhkCx1Vsmq` is Ready and owns the canonical production
  alias.

## Task 8: Pending External Rollout

1. [x] Publish the exact reviewed snapshot to `codex/live-quota-v1`.
2. [x] Open PR #4 against `main`, verify the Vercel check, and merge the fixed
   head SHA.
3. [x] Confirm the initial release merge and PR #9 merge commits have successful
   Vercel deployment status.
4. [x] Configure private Blob and the required production ingest value without
   exposing it, then directly verify the production URL. View protection remains
   an intentional optional follow-up.
5. [x] POST a real normalized snapshot, verify the production PNG, and confirm
   a wrong ingest bearer returns 401. View auth is not applicable while the
   optional view token is unset.
6. [x] Quarantine the stale local collector directory, then install, diagnose,
   and observe an automatic successful run of the real Windows collector.
7. [x] Synchronize reviewed Kindle scripts while preserving private `env.sh`.
   No view key is currently required because view protection is intentionally
   unset.
8. [ ] On Kindle, run Display Test Frame, Cached Dashboard, live refresh, and a full
   13-minute cycle (initial refresh plus one 12-minute scheduled refresh).
9. [ ] Confirm the device remains responsive, battery percentage changes correctly,
   no native Kindle UI overlays the image, and Stop Dashboard restores the UI.

The official Vercel CLI is now installed, authenticated, and linked to the
production project. It created/connected private Blob, managed environment names
without reading secret values, and completed production redeploys.

## Not Yet Complete

- Physical eject, native-chrome acceptance, and one complete 13-minute Kindle
  cycle (initial draw plus one 12-minute refresh).
- Optional dashboard view protection and matching private Kindle URL.
- Public v1.0.0 tag/release.

## Later Optimizations

- Add a redacted collector health timestamp to diagnostics.
- Add a signed local dry-run mode that prints normalized field names only.
- Add a cross-process Windows stress harness for simultaneous manual uploader
  launches; server-side CAS already prevents dashboard rollback.
- Test real sleep/wake behavior across additional Kindle firmware revisions.
- Tag and publish v1 only after a second device completes the runbook.

## Next Agent Startup

```powershell
Set-Location '<WORKSPACE>\kindle-llm-dash\.recovery\live-quota'
git status --short --branch
git log --oneline --decorate -15
npm.cmd test
npm.cmd run build
```

Then read, in order:

1. `docs/RECOVERY_HANDOFF_2026-07-10.md`
2. `README.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SECURITY.md`
5. `docs/WINDOWS-COLLECTOR.md`

Do not replay the historical task sequence unless fresh evidence finds a
regression. Use `PROJECT_STATUS.md` and `docs/SCOPE-RESET.md` for current work.
Before each push or merge, record local commit, GitHub branch/PR SHA, check
status, and Vercel production SHA separately.

## Release Decision

The source is independently approved, merged to GitHub `main`, licensed under
MIT, documented, and accepted by the merge-commit Vercel build. The reviewed
Kindle scripts are synchronized. It is suitable to publish as an open-source beta
or release candidate. It must not yet be described as a stable production v1 or
a completed real-device live-quota installation until the unplugged 13-minute
Kindle cycle plus native-UI recovery are recorded.
