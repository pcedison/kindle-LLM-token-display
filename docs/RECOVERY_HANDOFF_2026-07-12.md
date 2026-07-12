# Recovery Handoff: Multi-Device Event-Driven Quota Sync

Date: 2026-07-12 (Asia/Taipei)

## Executive Status

The multi-device quota convergence release is implemented, tested, merged, and
deployed to Vercel production.

- Feature PR: <https://github.com/pcedison/kindle-LLM-token-display/pull/11>
- GitHub `main` merge SHA: `aba5c2b2a37a7fa2dea1294a2a361095b3558b4a`
- Vercel production deployment: `dpl_HKUC5pc27FSDbkFTh9Jzm7ueP2vG`
- Vercel target/state: `production` / `Ready`
- Windows collector: installed and verified on the current development PC
- Codex live path: verified end to end with both 5-hour and 7-day windows
- Claude live path: code and event trigger verified; the current PC needs one
  new Claude Code assistant response to rebuild the spool lost during the
  pre-fix installer upgrade
- Kindle runtime: no byte-content replacement required in this release
- macOS: installer behavior and real macOS CI pass; interactive enrollment on
  a personal Mac remains an acceptance step

The repository can be presented as an open-source project. The README correctly
states that each fork still needs its own Vercel, provider sign-ins, secrets,
and real-device acceptance.

## Canonical Source

Use the normal repository root and `main` as the source of truth.

```text
branch: main
expected SHA: aba5c2b2a37a7fa2dea1294a2a361095b3558b4a
remote: https://github.com/pcedison/kindle-LLM-token-display.git
```

The tracked local `main` was fast-forwarded to the merge SHA. A local
`.recovery/` directory still exists as an untracked historical development
workspace. Do not commit it, and do not treat it as the deployment source.

Quick orientation:

```powershell
git status --short --branch
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

The two SHAs should match after this handoff PR is merged. The only expected
untracked item on the original workstation is `.recovery/`.

## Product Contract

This release intentionally uses an event-driven, eventually consistent model.

1. Vercel stores sanitized snapshots and renders the PNG continuously,
   independently of whether any computer is on.
2. Windows and macOS are short-lived collectors only while those computers are
   already awake and signed in.
3. Claude subscription limits refresh only after an official Claude Code
   response supplies status-line `rate_limits` data.
4. Codex subscription limits refresh through the official app-server
   `account/rateLimits/read` method at login/resume availability and every 720
   seconds while awake.
5. iOS and cloud usage converges automatically at the next observable desktop
   event. No iOS shortcut, screenshot parsing, or manual phone sync is used.
6. Provider OAuth credentials never enter Vercel, GitHub, the Kindle, collector
   state, logs, or payloads.

No API key can substitute for the consumer subscription quota surfaces. The
user signs in through official Claude Code and Codex clients instead.

## Completed Work

### Snapshot and Vercel

- Added backward-compatible snapshot version 2.
- Added `collectedAt` to every 5-hour and 7-day window.
- Kept version 1 ingest support during rollout.
- Merge conflicts resolve independently for each provider window.
- Equal timestamps are idempotent.
- An upload more than 10 minutes ahead of server receive time is rejected.
- Private Blob ETag retries preserve newest-per-window convergence.
- Recursive credential-like field rejection and the 8 KiB body limit remain.

### Dashboard Semantics

- Unexpired values older than 30 minutes show a compact `SYNC HH:MM` marker.
- If both windows are delayed, the marker uses the oldest delayed window.
- A passed reset without a newer observation now shows:
  - `--%`
  - an empty progress bar
  - `SYNC PENDING`
- The renderer no longer claims an unobserved reset restored quota to 100%.
- Existing 758x1024 portrait geometry remains stable.

### Shared Collector

- Added `claude-event` mode; it never starts Codex.
- Added `scheduled-sync` mode; it performs the bounded Codex app-server read.
- Claude status-line output is printed before detached network work begins.
- Added a per-user single-instance lock with two-minute stale recovery.
- Fresh partially written locks are not misclassified as stale.
- Added v2 local state and per-window timestamp retention.
- Added sanitized upload backoff and last-known-good retention.
- Added Windows inline-secret and macOS Keychain secret resolution.

### Windows

- Installer remains manifest-owned and reversible.
- Task runs at user login and every 12 minutes.
- `StartWhenAvailable=true` supports missed-run catch-up after resume.
- `WakeToRun=false`; the task does not wake a sleeping computer.
- `MultipleInstancesPolicy=IgnoreNew`; overlapping runs are rejected.
- Reinstall revalidates the task action twice before updating the same GUID.
- Failed task updates restore the previous task XML.
- Reinstall now stops the owned task before replacing runtime files.
- Reinstall preserves only these safe state files:
  - `claude.json`
  - `last-upload.json`
  - `upload-backoff.json`
- Reinstall intentionally does not migrate `collector.lock`.
- Diagnostics report schedule booleans without paths, quota, URLs, or secrets.

### macOS

- Added install, diagnose, and uninstall scripts with executable Git modes.
- Runtime lives in `~/Library/Application Support/KindleLLMDashboard`.
- The ingest token lives in the current user's Keychain as the project-owned
  `KindleLLMDashboard.ingest` generic password.
- Config, manifest, and LaunchAgent contain no ingest token.
- LaunchAgent uses `RunAtLoad=true`, `StartInterval=720`, `KeepAlive=false`.
- Foreign status lines and LaunchAgents are protected by default.
- Reinstall retains the first Claude settings backup.
- Failure rollback restores settings, install root, LaunchAgent, and Keychain.
- Uninstall preserves unrelated user settings and timestamped backups.

### CI and Public Release

- Windows CI runs full tests and production build.
- macOS CI runs shell syntax, full tests, and production build.
- Ubuntu CI validates all tracked shell syntax.
- Release tests enforce executable modes for collector and Kindle scripts.
- README, architecture, security, Vercel, Windows, and macOS runbooks describe
  eventual consistency and credential boundaries.

## Verification Evidence

The last fresh local release gate after all production-code edits reported:

```text
npm test: 158 passed, 0 failed
npm run build: passed
routes: /api/dashboard and /api/usage built as dynamic routes
git diff --check: passed
```

`npm audit` reported two moderate entries and no high or critical entries. Both
trace to Next.js pinning PostCSS 8.4.31 below the patched PostCSS 8.5.10 release
for [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93).
The dashboard does not parse or embed user-supplied CSS, so the advisory's XSS
path is not exposed here. As of this verification, Next.js 16.2.10 was still
the latest stable npm release and `npm audit fix` proposed an unsafe downgrade;
do not force that downgrade. Recheck when a stable Next.js release updates its
PostCSS dependency.

PR #11 final checks:

```text
windows-test-build: passed
macos-test-build: passed
kindle-shell-syntax: passed
Vercel preview: passed
```

The first macOS CI attempt found pre-existing cross-platform test gaps. They
were fixed before merge:

- the Windows-only EPERM rename retry test now skips on non-Windows systems;
- executable mode was restored for Kindle shell entrypoints;
- a release test now prevents future mode regression.

Production PNG verification after merge:

```text
HTTP status: 200
Content-Type: image/png
Cache-Control: no-store, max-age=0, must-revalidate
dimensions: 758x1024
bit depth: 8
PNG color type: 0 (grayscale)
interlace: 0
transparent pixels: 0
pixel range: 0..255 (nonblank)
```

Visual inspection showed no title, icon, label, progress-bar, or card overflow.

## Current Windows Machine State

The installed runtime is under:

```text
%LOCALAPPDATA%\KindleLLMDashboard
```

Do not print or paste `config.json`; it contains the Vercel ingest token on
Windows.

Verified diagnostic classes:

```text
nodeAvailable=true
claudeAvailable=true
claudeAuthenticated=true
codexAvailable=true
configPresent=true
taskPresent=true
taskLoginTrigger=true
taskTwelveMinuteCadence=true
taskStartWhenAvailable=true
taskWakeDisabled=true
taskOverlapDisabled=true
```

After production deployment, an installed `scheduled-sync` run completed with:

```text
exit code: 0
snapshot version: 2
Codex provider: present
Codex fiveHour: present
Codex sevenDay: present
backoff delay: 0
collector lock after exit: absent
```

The old installer replaced its install root before state-preservation support
was added, so this workstation's Claude spool was lost once during rollout.
That did not affect Vercel's retained snapshot. One normal Claude Code assistant
response will create a new `claude.json` and trigger a Claude-only upload.

Recommended next acceptance check:

1. Send one ordinary prompt in Claude Code and wait for the assistant response.
2. Run `collector/diagnose-windows.ps1` from the repository.
3. Confirm `claudeSpoolPresent=true` and `lastUploadPresent=true`.
4. Wait for the Kindle's next 12-minute fetch or use KUAL `Refresh Dashboard
   Now` once.

## Current Kindle State

The mounted extension root was compared to tracked `kindle-extension` files by
SHA-256 without reading or printing the private URL.

```text
compared tracked files: 17
byte-identical files: 16
missing files: 0
private local/env.sh: present and preserved
menu.json: semantically identical; formatting/line endings differ only
```

The only PR #11 Kindle changes were executable Git modes, not file bytes. FAT
storage does not carry those Git index modes in the same way, and the current
device files already execute correctly. Therefore no D-drive copy was needed.

Do not overwrite `local/env.sh`; it contains the device-specific production URL
and optional view key. The existing Kindle will receive server-side rendering
changes automatically at its next 12-minute fetch.

## Pending and Unfinished Items

### Required User Acceptance

- Produce one new Claude Code response on the current Windows PC so the fresh
  Claude event path is observed against production after the rollout reset.
- Safely eject the Kindle before unplugging it.
- Confirm the next Kindle refresh shows current Claude and Codex data without
  native Kindle chrome overlay.

### Real Mac Acceptance

CI ran the macOS scripts on a real GitHub-hosted macOS runner with mocked
Keychain/launchctl side effects. A personal Mac has not yet been enrolled.
On the first Mac used for development:

```sh
./collector/install-macos.sh --ingest-url 'https://your-project.vercel.app/api/usage'
./collector/diagnose-macos.sh
```

Use the same Vercel `DASHBOARD_INGEST_TOKEN` for the same personal dashboard.
Never pass it as a command-line argument or commit it.

### Not Implemented by Design

- Direct Vercel polling of consumer Claude or ChatGPT subscriptions.
- Provider OAuth storage in Vercel.
- Immediate iOS-only usage reflection while every desktop is off.
- Linux collector packaging.
- API billing estimates as a substitute for subscription quota.
- Background services that keep a Windows PC or Mac awake.

## Known Limitations

- Claude mobile activity cannot be corrected until a desktop Claude Code
  response refreshes official status-line rate limits.
- Codex mobile activity cannot be corrected while all enrolled desktops are
  asleep or off; it converges at the next poll after one is awake.
- A stale value is deliberately visible until reset, with a sync marker.
- After reset, unknown state is deliberately displayed instead of inferred.
- Real macOS Keychain permission prompts and a personal LaunchAgent login cycle
  still need user-level acceptance on the first Mac.

## Next Session: Fast Start

1. Read this file, `README.md`, `docs/ARCHITECTURE.md`, and
   `docs/SECURITY.md`.
2. Confirm local and remote `main` SHA equality.
3. Check PR #11 and Vercel production status instead of assuming deployment.
4. Run Windows diagnostics without opening or printing config.
5. Ask whether the user has produced a new Claude Code response.
6. If yes, verify only state classes and production PNG metadata.
7. If enrolling a Mac, follow `docs/MACOS-COLLECTOR.md` and do not improvise a
   second collector implementation.

Useful non-secret commands:

```powershell
npm.cmd test
npm.cmd run build
.\collector\diagnose-windows.ps1
git status --short --branch
```

macOS:

```sh
./collector/diagnose-macos.sh
```

## Security Guardrails for the Next Agent

- Never print `config.json`, Keychain output, bearer headers, or private Kindle
  URLs.
- Never add provider OAuth, browser cookies, or consumer credentials to Vercel.
- Never log raw Claude status-line JSON or Codex app-server responses.
- Do not overwrite the Kindle's `local/env.sh` during generic runtime sync.
- Do not infer `100%` after an unobserved reset.
- Do not remove `.recovery/` or unrelated untracked diagnostics without an
  explicit cleanup request.
- Use manifest ownership checks before changing scheduled tasks, LaunchAgents,
  status lines, or uninstalling resources.

## Future Improvements

- Add a first-class metadata-only collector status endpoint for installation
  health without exposing quota values.
- Add a signed release artifact or platform package so users do not need a full
  repository clone for collector installation.
- Add an interactive personal-Mac acceptance checklist and screenshots.
- Add optional Linux packaging only if a real Linux desktop use case emerges.
- Add automated production PNG smoke testing with a dedicated non-secret demo
  deployment; do not place private view keys in GitHub Actions.
- Consider documenting ingest-token rotation across multiple enrolled devices
  with a short outage-free sequence.

## Public Release Assessment

The repository is suitable for public open-source use under its MIT license.
The implementation has bounded schemas, reversible platform installers,
cross-platform CI, documented security boundaries, Kindle recovery paths, and
production evidence. It should be described as production-capable for tested
profiles, not as a zero-setup hosted service. Every adopter remains responsible
for their own jailbreak, Vercel project, private secrets, official client
sign-ins, and device acceptance.
