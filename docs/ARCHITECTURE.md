# Architecture

## Data Flow

1. After an official Claude Code response, `collector/claude-statusline.mjs` allowlists the 5-hour and 7-day limits, atomically saves each observed window with its own timestamp, prints the status line, and starts a detached Claude-only upload.
2. Windows Task Scheduler or a macOS LaunchAgent runs `collector/upload.mjs` at login and every 720 seconds while the signed-in computer is awake. The one-shot process asks `codex app-server --stdio` for `account/rateLimits/read`; it never sends a model prompt.
3. The shared collector merges valid local spools, uploads only sanitized quota fields to `/api/usage`, and exits. A two-minute stale-lock recovery prevents overlapping local runs.
4. The Vercel route authenticates the upload, upgrades version 1 input during rollout, and merges each version 2 window independently by `collectedAt`. Private Blob ETag retries prevent a delayed computer from rolling back a newer window.
5. `/api/dashboard` reads the latest durable snapshot, applies optional manual fallback values, and renders a profile-sized PNG. It never contacts a provider.
6. The Kindle wakes every 12 minutes, appends its battery value, downloads the PNG, displays it with `eips`, and returns to the configured wait mode.

## Managed Settings Flow

The authenticated root editor replaces one complete profile configuration in a
private Blob. The document contains only provider visibility, two normalized
artwork data URLs, the refresh interval, version, profile, and update time.
`managed=true` makes `/api/dashboard` load that document; older query-driven
URLs remain compatible and do not read it.

The Kindle separately requests `/api/device-config?profile=<profile>` using the
same optional view key as the PNG. Its cache-disabled text response contains
only `version` and `refresh_interval_seconds`. The Kindle never sources this
response as shell: it extracts one decimal value, checks the exact allowlist,
and otherwise retains its last in-memory or local fallback interval.

## Availability and Consistency

Vercel remains able to render the latest sanitized snapshot while every computer is asleep or off. The Windows and macOS processes are clients, not continuously running servers.

Codex mobile or cloud activity converges at the next successful desktop poll. Claude mobile activity converges after the next official Claude Code desktop response, because only that status-line event refreshes Claude's subscription limits. Until a desktop can observe new state, the dashboard keeps the last known unexpired value and labels delayed data rather than presenting it as live.

## Snapshot Contract

New collectors emit version 2. Each `fiveHour` or `sevenDay` window contains only `usedPercent`, `resetsAt`, and its own `collectedAt`. Vercel still accepts version 1 and assigns its provider timestamp to each supplied window during migration.

Equal timestamps are idempotent. Incoming data wins only for the same window when its timestamp is at least as new as the retained one. A timestamp more than 10 minutes ahead of Vercel receive time is rejected. A partial update cannot erase or refresh a missing sibling window or provider.

## Components

- `app/api/usage`: bounded bearer-authenticated ingest and conflict-safe Blob merge.
- `app/api/dashboard`: optional view-authenticated e-ink renderer.
- `collector/lib`: shared parsing, local state, lock, secret resolution, Codex RPC, and upload logic.
- `collector/*-windows.ps1`: reversible Windows per-user integration.
- `collector/*-macos.sh`: reversible macOS Application Support, Keychain, and LaunchAgent integration.
- `kindle-extension`: KUAL launchers, diagnostics, download, display, and low-power probe.

Gemini remains manual-only. Live Claude and Codex data takes precedence over manual fallback.
