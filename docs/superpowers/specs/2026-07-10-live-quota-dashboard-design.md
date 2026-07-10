# Live Claude Code and Codex Quota Dashboard Design

Date: 2026-07-10
Status: Approved architecture; written specification pending final review
Primary target: Kindle DP75SDI / Paperwhite 2, portrait 758x1024
Release target: v1.0.0

## Goal

Turn the existing Kindle PNG dashboard into a safe, reusable open-source
project that displays the real subscription quota windows for Claude Code and
Codex:

- the rolling 5-hour limit;
- the rolling 7-day limit;
- percentage remaining for each window; and
- the next reset time in the configured display timezone.

The Kindle must continue to download a flattened 8-bit grayscale PNG from
Vercel and refresh through the proven 12-minute RTC sleep cycle. Provider login
credentials must never be copied to the Kindle, Vercel, GitHub, or dashboard
PNG.

## Product Boundary

This feature reports Claude and Codex subscription-plan limits. It does not
report API billing balances, API organization rate limits, or estimated local
session cost as if those values were subscription quota.

An Anthropic API key and an OpenAI API key use separate API billing systems and
are not accepted as substitutes for Claude Code or ChatGPT Codex subscription
quota. The existing manual Vercel environment variables remain available as a
demo and fallback data source.

## Official Local Data Sources

### Claude Code

Claude Code provides subscription rate limits to a configured status-line
command after the first API response in a session. The input JSON contains:

- `rate_limits.five_hour.used_percentage`;
- `rate_limits.five_hour.resets_at`;
- `rate_limits.seven_day.used_percentage`; and
- `rate_limits.seven_day.resets_at`.

The collector consumes only those four fields and a collection timestamp. It
does not read, copy, or upload Claude OAuth credentials, transcript content,
prompts, model responses, repository paths, or account identity.

The status-line command writes a small normalized snapshot to a local spool
directory. Network upload is performed separately so a slow network cannot
delay Claude Code's terminal UI. The status line prints a compact quota summary
instead of becoming blank.

### Codex

The collector starts the official `codex app-server` over its stable stdio
JSONL transport, performs the required initialize handshake, and calls
`account/rateLimits/read`.

The response supplies primary and secondary `RateLimitWindow` values with:

- `usedPercent`;
- `windowDurationMins`; and
- `resetsAt`.

Windows are identified by duration rather than assumed ordering:

- `300` minutes maps to the 5-hour window;
- `10080` minutes maps to the 7-day window; and
- unknown durations are ignored and logged without their payload.

The collector does not parse Codex `auth.json`, access tokens, conversations,
or repository content. If the official app-server is unavailable or not signed
in with ChatGPT, Codex is reported as unavailable while the last valid server
snapshot remains intact.

## Normalized Snapshot

Both sources are converted locally to this versioned shape before upload:

```json
{
  "version": 1,
  "collectedAt": "2026-07-10T09:30:00.000Z",
  "providers": {
    "claude": {
      "windows": {
        "fiveHour": { "usedPercent": 17, "resetsAt": 1783678020 },
        "sevenDay": { "usedPercent": 19, "resetsAt": 1784250000 }
      }
    },
    "codex": {
      "windows": {
        "fiveHour": { "usedPercent": 4, "resetsAt": 1783678200 },
        "sevenDay": { "usedPercent": 11, "resetsAt": 1784250000 }
      }
    }
  }
}
```

Validation rules:

- `version` must be `1`;
- provider keys are limited to `claude` and `codex`;
- percentages must be finite numbers and are clamped to 0 through 100;
- reset times must be plausible Unix epoch seconds;
- unknown harmless fields are discarded, while credential-like fields such as
  tokens, cookies, prompts, transcripts, and account identity are rejected;
- request bodies larger than 8 KiB are rejected; and
- no account identifier, email, token, prompt, or transcript field is stored.

The renderer calculates `remainingPercent = 100 - usedPercent`. Progress bars
always represent remaining quota so the label, number, and visual direction
cannot disagree.

## Data Flow

1. Claude Code emits official status-line JSON after an active response.
2. The status-line collector updates a local sanitized Claude snapshot.
3. A local uploader runs at most once every five minutes while the computer is
   awake.
4. The uploader reads the Claude spool file and requests Codex rate limits from
   the official app-server.
5. The uploader sends one normalized snapshot to Vercel over HTTPS with a
   bearer ingest secret.
6. Vercel validates the body, merges valid incoming windows with the previous
   snapshot, and overwrites the private Blob with the merged result.
7. `/api/dashboard` reads the private snapshot, renders the 758x1024 dashboard,
   and converts it to opaque 8-bit grayscale.
8. The Kindle wakes every 12 minutes, supplies its battery percentage, fetches
   the PNG, draws it, disables Wi-Fi, and returns to RTC sleep.

The computer and Kindle never need a USB or network connection to each other.
The computer only needs to be awake when Claude Code or Codex usage is changing,
which is normally already true while those applications are in use.

## Vercel Storage and API

### Private snapshot

Vercel Blob stores one private object at a stable application-owned pathname.
The project receives `BLOB_READ_WRITE_TOKEN` from the connected private Blob
store. The Blob URL and token are never returned by the dashboard route.

If Blob is not configured or no valid snapshot exists, the renderer uses the
existing manual environment-variable provider as demo/fallback data. A storage
failure must not make the PNG route fail if fallback data is available.

### Ingest endpoint

`POST /api/usage` accepts the normalized snapshot only when the bearer token
matches `DASHBOARD_INGEST_TOKEN`. Authentication uses a constant-time
comparison. Invalid auth returns 401, invalid data returns 400, and storage
failure returns 503 without logging the token or request body.

The endpoint is write-only. There is no public JSON endpoint exposing the
stored quota snapshot.

### Optional dashboard privacy

The open-source project supports an optional `DASHBOARD_VIEW_TOKEN`. When it is
configured, `/api/dashboard` requires the matching `key` query parameter. This
is separate from the ingest secret. The repository default remains public demo
mode so a new deploy can be previewed without account data.

## Portrait E-Ink Layout

The 758x1024 DP75SDI layout keeps the existing battery/time header and replaces
each provider's single oversized meter with two quota rows.

### Header

- Left: horizontal Kindle battery icon plus 18px percentage.
- Right: Taipei dashboard render time at 18px.
- Bottom: one high-contrast divider.
- No device profile, sync status, refresh interval, or project label.

### Provider cards

Two equal-height cards fill the remaining canvas. Each card contains:

- a small vendor index label;
- a large provider title (`Anthropic Claude Code` or `Codex`);
- one restrained Pikachu line illustration in the title's unused right side;
- a 5-hour quota row; and
- a 7-day quota row.

Each quota row contains:

- a concise `5 HOURS` or `7 DAYS` label;
- a large remaining percentage;
- a thick bordered horizontal progress bar whose black fill is the remaining
  amount; and
- a reset label formatted in the dashboard timezone.

The 5-hour label uses `RESET HH:mm`; the 7-day label uses
`RESET MM/DD HH:mm`. Both use 24-hour time in the configured timezone.

The existing duplicated `REMAINING`, `RESET`, and `METER` metric tiles are
removed. The progress bar and percentage become the primary information, with
reset time directly attached to the same quota row.

Text and bars must use stable dimensions so missing data, three-digit values,
or longer reset dates cannot shift card height or overflow the canvas. The
Pikachu image is decorative and disappears before quota data is compressed on
smaller profiles.

### Missing and expired data

- Missing window: show `--%` and `WAITING FOR LOCAL SYNC` for that row.
- Provider unavailable: preserve the provider title and both empty rows.
- Reset timestamp passed before a new local sync: show `100%` and
  `RESET COMPLETE` until the next official snapshot arrives.
- Snapshot older than 24 hours with an unexpired window: add a small `STALE`
  marker to that provider card; do not replace the last known values.
- Demo/manual data: render normally but mark the provider internally as demo so
  tests can distinguish it from live data. No extra demo label consumes Kindle
  screen space.

## Local Collector Packaging

The repository adds a `collector/` directory containing:

- pure parsers for Claude status-line and Codex app-server payloads;
- a Claude status-line command;
- a Codex app-server client;
- a normalized snapshot merger;
- a signed HTTPS uploader;
- a Windows installer and uninstaller for a per-user Scheduled Task; and
- fixture-driven diagnostics that never print credential values.

Local configuration lives outside the repository in the user's profile and
contains only:

- the Vercel ingest URL;
- `DASHBOARD_INGEST_TOKEN`; and
- upload interval and timeout settings.

The installer must detect an existing Claude `statusLine` configuration and
back it up before changing anything. It must not silently overwrite an existing
custom status line. The first release may require an explicit confirmation to
wrap an existing command; otherwise it installs only the standalone uploader
and reports that Claude live data is pending configuration.

The uploader uses exponential backoff, a bounded timeout, and a single-instance
lock. Failed uploads retain local data and never trigger rapid retries.

## Open-Source Release Requirements

Before tagging v1.0.0, the repository must:

- include an MIT `LICENSE`;
- remove the personal Vercel production URL from defaults;
- provide a generic deploy button or documented Vercel setup;
- document private Blob creation and the two separate dashboard secrets;
- document the official Claude and Codex local prerequisites;
- include Windows install, update, uninstall, and recovery steps;
- retain manual environment variables as a no-collector demo mode;
- include screenshots or generated 758x1024 previews using fixture data;
- document supported Kindle profiles and DP75SDI-specific RTC opt-in;
- contain no real provider credentials, account identifiers, or personal quota
  snapshots; and
- explain that provider CLI and subscription behavior can change independently
  of this project.

The initial public release supports Windows plus the DP75SDI Kindle path proven
on the current device. Collector scripts and server code remain structured so
macOS/Linux installers can be added without changing the normalized snapshot
contract.

## Error Handling

- Claude status-line data absent: keep the previous local Claude snapshot.
- Codex app-server unavailable: keep the previous Codex snapshot and record a
  credential-free diagnostic status.
- Vercel ingest rejected: retain the local merged snapshot and back off.
- Blob unavailable: render manual fallback data or provider placeholders.
- Invalid or partial provider payload: update only valid windows and never
  erase another provider's last valid data.
- Kindle network failure: retain and display the last cached PNG as in the
  current extension.
- Dashboard rendering failure: return an error response; never overwrite the
  Kindle cache with an HTML error page.

## Testing and Verification

Automated tests must cover:

- Claude `five_hour` and `seven_day` parsing, missing fields, and invalid data;
- Codex duration-based 5-hour/7-day mapping independent of primary/secondary
  ordering;
- used-to-remaining conversion and reset-expired behavior;
- normalized snapshot validation and secret-field rejection;
- ingest authorization, body limit, and storage failure behavior;
- Blob storage adapter and manual fallback selection;
- collector merging without erasing a valid provider on partial failure;
- uploader timeout, backoff, and single-instance behavior;
- optional dashboard view-token behavior;
- two-window provider rendering with missing and live fixture data; and
- all existing Kindle profile, battery, grayscale PNG, shell, and RTC tests.

Release verification must include:

- `npm test` with no failures;
- `npm run build` with no errors;
- collector fixture diagnostics on Windows;
- a local and production 758x1024 preview;
- PNG dimensions, opaque 8-bit grayscale color type, nonblank pixel checks,
  and text/layout visual inspection;
- production ingest using synthetic data before real account data;
- real Claude and Codex snapshots containing only the approved fields;
- Vercel production deployment SHA verification;
- one real Kindle refresh from the production PNG; and
- a subsequent 12-minute RTC wake/refresh cycle with live quota data.

## Acceptance Criteria

- Both provider cards display independent 5-hour and 7-day remaining bars.
- Percentages and reset times match the official local provider values after
  used-to-remaining conversion.
- The 758x1024 PNG is fully visible on DP75SDI with no crop, overlap, browser
  chrome, blank frame, or KUAL overlay caused by the display pipeline.
- No provider OAuth token, API key, cookie, prompt, transcript, email, or
  account identifier leaves the computer.
- The Kindle continues its validated 12-minute RTC low-power cycle.
- A user can deploy demo mode without installing the collector or supplying
  provider credentials.
- A new user can follow the public README to deploy, configure, install,
  recover, and uninstall the project without relying on the original owner's
  Vercel project or D-drive layout.
- The repository satisfies the v1.0.0 open-source release requirements above.
