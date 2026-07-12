# Multi-Device Event-Driven Quota Sync Design

Date: 2026-07-12
Status: Approved design; written specification pending user review
Target clients: Windows and macOS
Display target: Kindle DP75SDI / Paperwhite 2, portrait 758x1024

## Goal

Make Vercel the continuously available storage and rendering service without
requiring a Windows computer to remain powered on. Windows and macOS computers
act only as short-lived, trusted collectors while the user is already using an
official Claude Code or Codex client.

The design must support one personal Claude subscription and one personal
ChatGPT subscription used across multiple computers plus iOS official apps or
cloud sessions. It must not place provider OAuth credentials in Vercel, GitHub,
the Kindle, or the dashboard payload.

## Confirmed Product Contract

- Vercel remains available while every computer is asleep or powered off.
- The Kindle continues fetching a Vercel-rendered PNG every 12 minutes.
- No computer is treated as a continuously running server.
- Windows and macOS collectors upload only normalized quota percentages,
  reset timestamps, and collection timestamps.
- iOS usage is eventually consistent. It is reflected after an official
  desktop collector can next observe that provider's current limits.
- No iOS shortcut, screenshot parsing, browser extension, or manual sync step
  is required.
- No consumer subscription OAuth token, browser cookie, API key, prompt,
  transcript, repository path, account identifier, or email leaves a computer.

The dashboard cannot promise real-time mobile usage under these constraints.
It must expose delayed state honestly instead of presenting stale data as live.

## Non-Goals

- Poll personal Claude or ChatGPT subscriptions directly from Vercel.
- Store or refresh provider OAuth credentials in cloud infrastructure.
- Infer subscription quota from API billing or local token estimates.
- Keep a Windows computer, Mac, NAS, or other bridge device permanently awake.
- Add Linux packaging in this iteration.
- Read private provider credential files, browser sessions, or app databases.
- Guarantee immediate reflection of iOS-only usage.

## Official Data Sources

### Claude Code

Claude Code supplies `rate_limits.five_hour` and `rate_limits.seven_day` to a
configured status-line command after an official response. Each available
window includes `used_percentage` and `resets_at`.

The status-line adapter is the only source of fresh Claude subscription quota.
Login, wake, or a timer may retry an already captured Claude snapshot, but may
not claim that retrying refreshed the provider data. Mobile Claude usage is
therefore corrected after the next Claude Code response on any enrolled
computer.

### Codex

The collector starts the official `codex app-server` over stdio, performs the
initialize handshake, and calls `account/rateLimits/read`. Windows are mapped
by `windowDurationMins`: 300 minutes is the 5-hour window and 10080 minutes is
the 7-day window.

Codex can be refreshed without sending a model prompt. An enrolled computer
queries it at user login, after wake when the operating system resumes missed
work, and every 720 seconds while that computer is awake. Mobile or cloud Codex
usage is therefore corrected on the next successful desktop poll.

## Architecture

```text
Claude status line -----> provider-only one-shot upload --+
                                                         |
Windows scheduler ------> full one-shot collector --------+--> POST /api/usage
macOS LaunchAgent ------> full one-shot collector --------+          |
                                                                    v
                                                           private Vercel Blob
                                                                    |
Kindle every 12 minutes <---------- 758x1024 PNG <----- /api/dashboard
```

Vercel is the durable source of the latest sanitized snapshot. A collector is
never a server and does not listen on a port. Every collector process is
bounded, one-shot, and safe to terminate when its host sleeps or shuts down.

## Shared Collector Core

The existing Node.js collector remains the only implementation of provider
parsing, normalization, merge preparation, upload, timeout, backoff, and local
state. Windows and macOS packaging call this same core.

The core gains two explicit execution paths:

1. `claude-event`: read the newly written Claude state and upload Claude only.
   It must not start Codex or wait for another provider.
2. `scheduled-sync`: reuse valid local Claude state, query Codex, merge the
   available providers, and upload the result.

Both paths use a shared per-user single-instance gate. Repeated status-line
events may coalesce into one upload. A network failure leaves sanitized state
pending for a later scheduled retry.

## Claude Event Path

1. Read the status-line JSON from stdin.
2. Read only the two official quota windows and discard every other input
   field. Credential-like fields remain forbidden in normalized state.
3. Atomically merge available windows into local `claude.json`.
4. Print the compact status line immediately.
5. Signal a detached, hidden one-shot `claude-event` uploader.

Network activity must not delay status-line output. The detached uploader uses
the normal lock and backoff rules, exits after one bounded attempt, and never
sends a Claude prompt. If process creation is unavailable, the saved state is
left for the next scheduled sync.

## Codex Scheduled Path

1. Acquire the per-user single-instance gate.
2. Load the protected local collector configuration.
3. Query `account/rateLimits/read` with a bounded timeout.
4. Merge valid Codex windows with valid local Claude and pending upload state.
5. Upload the normalized snapshot once and exit.

Codex failure must not erase Claude data or a prior valid Codex window. Unknown
rate-limit durations are ignored without logging their raw payloads.

## Cross-Device Snapshot Contract

The current version-1 snapshot has only provider-level `collectedAt`. That is
insufficient when one provider returns only one of its two windows: preserving
an older missing window under a newer provider timestamp can falsely mark the
old window as fresh.

This iteration introduces a backward-compatible version-2 normalized shape:

```json
{
  "version": 2,
  "collectedAt": "2026-07-12T08:00:00.000Z",
  "providers": {
    "claude": {
      "windows": {
        "fiveHour": {
          "usedPercent": 17,
          "resetsAt": 1783843200,
          "collectedAt": "2026-07-12T08:00:00.000Z"
        },
        "sevenDay": {
          "usedPercent": 31,
          "resetsAt": 1784250000,
          "collectedAt": "2026-07-12T07:58:00.000Z"
        }
      }
    }
  }
}
```

Rules:

- New collectors emit version 2.
- Vercel accepts version 1 during rollout and upgrades each v1 window using
  its provider timestamp.
- Vercel stores version 2 after the first successful merge.
- Each provider window is merged independently by its own `collectedAt`.
- Equal timestamps are idempotent; a retry cannot duplicate or regress data.
- A collection timestamp more than 10 minutes ahead of Vercel's receive time
  is rejected to prevent a clock-skewed computer from permanently winning
  later merges.
- The top-level `collectedAt` is derived from the newest retained window.
- Unknown harmless fields are discarded and sensitive field names are rejected
  recursively before persistence.

No device identifier is needed in the payload. Every enrolled computer for the
same dashboard may use the same ingest secret. Losing a computer requires
rotating that secret on Vercel and reinstalling or updating the remaining
collectors.

## Windows Packaging

The existing reversible installer is extended rather than replaced.

- Install under `%LOCALAPPDATA%\KindleLLMDashboard`.
- Keep the ingest secret in the existing current-user and SYSTEM ACL-protected
  configuration.
- Preserve and validate the owned manifest and timestamped Claude settings
  backup.
- Register the Claude status-line command with a hidden detached event upload.
- Register a per-user Scheduled Task that runs at login and every 720 seconds
  while the user session is available.
- Configure missed work to run when available after resume.
- Set the task not to wake a sleeping computer.
- Keep task overlap disabled; a second invocation exits cleanly.
- Keep installation, diagnostics, and removal non-interactive except for the
  secure ingest-token prompt and explicit status-line replacement approval.

Uninstall removes only the exact manifest-owned task, files, and status-line
change. It restores the prior Claude setting only when the current setting is
still owned by this project.

## macOS Packaging

Add reversible per-user shell installers with the same ownership rules.

- Install under `~/Library/Application Support/KindleLLMDashboard`.
- Store the Vercel ingest secret as a generic password in the user's macOS
  Keychain; never place it in a plist, command argument, or log.
- Store non-secret configuration and the ownership manifest with user-only
  permissions.
- Back up `~/.claude/settings.json` before registering the status line.
- Refuse to replace an unrelated status line without an explicit flag.
- Register `~/Library/LaunchAgents/com.kindle-llm-dashboard.sync.plist` with
  `RunAtLoad`, `StartInterval=720`, and `KeepAlive=false`.
- Do not request wake-from-sleep behavior.
- Retrieve the ingest secret from Keychain in memory for each one-shot upload.
- Provide install, diagnose, and uninstall commands with credential-free
  output.

The LaunchAgent starts only in the signed-in user's session. Sleep, logout, or
shutdown stops collection and does not affect the Vercel dashboard.

## Vercel Responsibilities

`POST /api/usage` remains the only write surface. It authenticates the local
collector, accepts v1 or v2 during migration, enforces the bounded schema, and
performs conflict-safe per-window merges in private Blob storage.

`/api/dashboard` remains a renderer, not a provider collector. It never receives
provider credentials and never attempts provider login.

Vercel Hobby Cron is not required. Kindle requests do not trigger provider
queries; they only read the latest sanitized snapshot and render a PNG.

## Freshness and Display Semantics

Freshness is evaluated per quota window from its own collection timestamp.

- Before reset, the last known value remains visible.
- An unexpired value older than 30 minutes receives a restrained
  `LAST SYNC HH:MM` indication in the configured dashboard timezone.
- If a known reset time passes without a post-reset provider observation, the
  row becomes unknown (`--%`, empty bar, `SYNC PENDING`). It must not claim
  `100%`, because unobserved mobile usage may already have occurred.
- The next valid desktop observation removes the pending state automatically.
- Claude and Codex may display different freshness without making the other
  provider appear current.

The normal fresh layout receives no new permanent labels. Freshness warnings
must fit the existing fixed row dimensions and remain legible in 758x1024
grayscale output.

## Failure Handling

- Claude status-line input absent or partial: retain prior valid windows.
- Detached upload cannot start: keep local state for the scheduled runner.
- Collector already running: coalesce or exit successfully without overlap.
- Computer sleeps mid-run: leave atomic state intact and retry after resume.
- Network or Vercel failure: retain pending state and use exponential backoff.
- Backoff applies to network uploads, not local capture of a newer Claude
  status-line value.
- Codex app-server unavailable or signed out: retain prior Codex data and
  upload any fresher Claude data.
- Keychain or protected-config access fails: fail closed and print only a
  credential-free diagnostic class.
- Clock more than 10 minutes ahead of Vercel: reject the affected upload and
  report a local clock diagnostic without including quota values.
- Concurrent computers: Blob conflict retries and per-window timestamps prevent
  stale rollback.
- Invalid server response: never replace a local last-known-good snapshot.

## Security Boundaries

- Provider credentials remain managed by the official provider clients.
- The collector does not open Claude, Codex, browser, or system credential
  stores. The only exception is reading its own Vercel ingest secret from the
  project-owned macOS Keychain item or Windows protected config.
- The Vercel ingest secret authenticates sanitized uploads only. It does not
  grant Claude or OpenAI access.
- Request bodies remain bounded and recursively reject credential-like keys.
- Logs contain state classes, versions, timestamps, and booleans only. They do
  not contain quota payloads, identities, URLs with secrets, or raw stderr.
- Installers never accept secrets in command-line arguments.
- Repository fixtures contain synthetic data only.

## Documentation and User Experience

README and runbooks must explain:

- Vercel is always available but does not independently read subscriptions.
- Computers need to be on only while being used normally.
- Codex mobile usage corrects on the next desktop poll.
- Claude mobile usage corrects after the next desktop Claude response.
- Freshness warnings are expected consistency signals, not Kindle failures.
- Every Windows and macOS computer used for development should install the
  collector and sign in through official clients.
- How to enroll, diagnose, rotate the ingest secret, and safely uninstall each
  platform.

No Kindle-side file change is required for collector enrollment. A server-side
freshness-layout change reaches the Kindle through the existing production PNG.

## Testing

### Shared Node tests

- Claude event capture returns status-line output without waiting for upload.
- Claude event upload never starts Codex.
- Repeated events coalesce and leave the newest state pending.
- Scheduled sync queries Codex and merges reusable Claude state.
- v1 snapshots upgrade to v2 without data loss.
- Per-window timestamps merge independently across simulated computers.
- Delayed older uploads and future-skewed timestamps cannot roll data back.
- Missing provider windows do not make preserved windows appear fresh.
- Post-reset unobserved rows render `SYNC PENDING`, not `100%`.
- Timeout, backoff, sleep interruption, and partial-provider paths retain state.
- Sensitive fields are rejected before request, disk write, or log output.

### Windows tests

- Installer creates the owned login/repeating task with a 720-second cadence,
  no wake request, no overlapping instance, and hidden process execution.
- Existing foreign status lines and tasks remain protected.
- Reinstall is idempotent and rollback restores prior project state.
- Diagnose and uninstall disclose no secret or account data.

### macOS tests

- Installer syntax and path handling work with spaces in Application Support.
- LaunchAgent plist validates and has `RunAtLoad`, `StartInterval=720`, and
  `KeepAlive=false`.
- Keychain secret lookup is never serialized into plist, manifest, or logs.
- Foreign status lines are protected and project-owned settings are reversible.
- Reinstall and uninstall are idempotent.

GitHub Actions must run shared tests and build checks on Windows and macOS.
macOS packaging tests use a temporary HOME and mock `security`/`launchctl`
where destructive integration is unnecessary.

### Release verification

- Full Node test suite passes.
- Next.js production build passes.
- Windows focused collector tests pass on the current computer.
- macOS CI passes; a real Mac enrollment remains an explicit acceptance step
  if no interactive Mac is available during implementation.
- Local and production dashboard PNGs are 758x1024, nonblank, opaque 8-bit
  grayscale, non-interlaced, and visually free of overflow.
- A synthetic multi-device race proves newest-per-window convergence in the
  production ingest path.
- The production URL remains reachable while the Windows collector is stopped.
- The mounted Kindle needs no collector-related file replacement unless a
  later implementation diff changes `kindle-extension`.

## Acceptance Criteria

- Windows and macOS installations use the same collector logic and official
  provider surfaces.
- Claude updates after each desktop Claude response without blocking its UI.
- Codex updates at login/resume availability and every 12 minutes while awake.
- No computer must remain awake solely for the dashboard.
- Vercel continues rendering the last sanitized state while all computers are
  off.
- Mobile usage converges automatically at the next observable desktop event.
- Stale or post-reset unknown data is never presented as guaranteed live quota.
- A stale computer cannot overwrite a newer provider window.
- No provider credential or personal content reaches Vercel, GitHub, Kindle,
  local logs, or installer arguments.
- Windows and macOS integrations are diagnosable, reversible, and documented.
- The existing Kindle 12-minute refresh and recovery behavior remains intact.

## Official References

- Claude Code status-line quota fields:
  <https://code.claude.com/docs/en/statusline>
- Claude Code usage-limit behavior:
  <https://code.claude.com/docs/en/errors>
- Codex app-server authentication and rate-limit RPC:
  <https://developers.openai.com/codex/app-server/>
- Codex subscription versus API-key authentication:
  <https://developers.openai.com/codex/auth/>
- Vercel Cron limits (not required by this design):
  <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- Apple Shortcuts on-screen and API capabilities considered but rejected for
  this product contract:
  <https://support.apple.com/guide/shortcuts/apd350ce757a/ios>
