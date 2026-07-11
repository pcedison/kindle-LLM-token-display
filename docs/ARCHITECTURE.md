# Architecture

## Data Flow

1. Claude Code sends status-line JSON to `collector/claude-statusline.mjs` after an official response.
2. The collector allowlists the two quota windows and atomically writes sanitized local state.
3. `collector/upload.mjs` asks `codex app-server --stdio` for `account/rateLimits/read`.
4. The uploader merges valid local providers and sends a signed normalized snapshot to `/api/usage` every five minutes.
5. The Node.js Vercel route bypasses the Blob cache, merges the update, and uses
   ETag conditional writes with bounded conflict retries.
6. `/api/dashboard` reads the latest snapshot, applies optional manual fallback values, and renders a profile-sized PNG.
7. The Kindle wakes every 12 minutes, appends its battery value, downloads the PNG, displays it with `eips`, and returns to the configured wait mode.

## Components

- `app/api/usage`: bounded bearer-authenticated ingest.
- `app/api/dashboard`: optional view-authenticated e-ink renderer.
- `collector`: local-only Claude/Codex adapters and uploader.
- `collector/*-windows.ps1`: reversible per-user integration.
- `kindle-extension`: KUAL launchers, diagnostics, download, display, and low-power probe.

Gemini is manual-only in v1. Live Claude and Codex data always takes precedence
over manual fallback. Provider windows are merged independently, so a partial
update does not erase valid data from another window or provider. Each provider
also carries its own `collectedAt`; retaining an older provider during a partial
collection therefore cannot make that provider appear fresh merely because a
different provider uploaded successfully.
