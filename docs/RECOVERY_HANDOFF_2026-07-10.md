# Live Quota Dashboard Recovery Handoff

Last updated: 2026-07-11, Asia/Taipei
Repository: `pcedison/kindle-LLM-token-display`
Production URL: intentionally not tracked; obtain it from the Vercel project.

## Executive Status

The interrupted source work was recovered without evidence of corruption. Tasks 1
through 7 are implemented in the recovery clone and the final independent review
is approved. The current release candidate passes 133 tests, a Next.js production
build, shell and PowerShell syntax checks, a local production HTTP PNG smoke test,
and a two-platform pull-request CI definition.

GitHub publication, PR merge, the merge-commit Vercel build, and mounted-Kindle
script synchronization are complete. Remaining external work is private Vercel
Blob/secret configuration, a direct production PNG smoke test, real Windows
collector installation, and an unplugged 13-minute device acceptance cycle. These
steps must not be described as complete until their evidence is recorded below.

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

- `docs/superpowers/*-red.txt`
- `docs/superpowers/task-*-review.diff`
- `docs/superpowers/task-5-review.md`
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

## Task 8: Pending External Rollout

1. [x] Publish the exact reviewed snapshot to `codex/live-quota-v1`.
2. [x] Open PR #4 against `main`, verify the Vercel check, and merge the fixed
   head SHA.
3. [x] Confirm the merge commit has a successful Vercel deployment status.
4. [ ] Configure private Blob and the three production values without exposing
   them, then directly verify the production URL.
5. [ ] POST one synthetic normalized snapshot and verify a protected production
   PNG plus 401 responses for invalid view and ingest credentials.
6. [ ] Inspect/quarantine the stale local collector directory if needed, then
   install and diagnose the real Windows collector.
7. [x] Synchronize reviewed Kindle scripts while preserving private `env.sh`;
   [ ] add the final view key only after production auth is verified.
8. [ ] On Kindle, run Display Test Frame, Cached Dashboard, live refresh, and a full
   13-minute cycle (initial refresh plus one 12-minute scheduled refresh).
9. [ ] Confirm the device remains responsive, battery percentage changes correctly,
   no native Kindle UI overlays the image, and Stop Dashboard restores the UI.

The Vercel CLI bootstrap attempt in this sandbox could not reach the npm registry
and failed with an access/network error. This is an execution-environment blocker,
not a project build failure. Use the connected browser session or a normal local
terminal for Vercel-only operations if the CLI remains unavailable.

## Not Yet Complete

- Direct production endpoint response and deployed-source confirmation beyond the
  successful merge-commit Vercel status.
- Private Blob/token configuration and synthetic production ingest/auth checks.
- Real Claude/Codex collector installation and first successful upload.
- Final Kindle private view-key update, physical eject, and 13-minute acceptance.
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
3. `docs/superpowers/specs/2026-07-10-live-quota-dashboard-design.md`
4. `docs/superpowers/plans/2026-07-10-live-quota-dashboard.md`
5. `docs/SECURITY.md`
6. `docs/WINDOWS-COLLECTOR.md`

Do not redo Tasks 1-7 unless fresh evidence finds a regression. Resume at the
first unchecked Task 8 item. Before each push or merge, record local commit,
GitHub branch/PR SHA, check status, and Vercel production SHA separately.

## Release Decision

The source is independently approved, merged to GitHub `main`, licensed under
MIT, documented, and accepted by the merge-commit Vercel build. The reviewed
Kindle scripts are synchronized. It is suitable to publish as an open-source beta
or release candidate. It must not yet be described as a stable production v1 or
a completed real-device live-quota installation until private Vercel
configuration, direct production/auth smoke, collector installation, and the
unplugged 13-minute Kindle cycle are recorded.
