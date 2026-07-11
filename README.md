# Kindle LLM Token Dashboard

[![CI](https://github.com/pcedison/kindle-LLM-token-display/actions/workflows/ci.yml/badge.svg)](https://github.com/pcedison/kindle-LLM-token-display/actions/workflows/ci.yml)

A low-power, portrait e-ink dashboard for Claude Code and Codex subscription quota windows. Vercel renders an opaque grayscale PNG; a jailbroken Kindle downloads it and draws it with `eips`. Provider credentials remain inside the official local clients.

![DP75SDI dashboard](docs/images/dashboard-dp75sdi.png)

## Release Status

The renderer, signed ingest, local collectors, and reversible Windows installer are implemented and covered by automated tests. Production deployment and real-device acceptance are environment-specific final steps; do not call a fork production-ready until those checks pass.

## Demo Mode

Deploy the repository to Vercel, set optional manual values from `.env.example`, and open:

```text
https://your-project.vercel.app/api/dashboard?profile=dp75sdi&claude=true&openai=true&gemini=false&battery=82
```

Manual values are display fixtures only. They are useful before local collection is installed, but they are not live subscription data.

## Private Live Mode

Live mode reads the official local subscription quota surfaces:

- Claude Code status-line JSON: rolling 5-hour and 7-day windows.
- Codex app-server `account/rateLimits/read`: windows mapped by duration.

An Anthropic API key or OpenAI API key does not expose these subscription-plan quotas. The collector does not open provider credential files. Claude Code sends its status-line JSON to the configured child process, and the collector requests rate-limit JSON from the Codex app-server; both inputs are normalized in memory and all unapproved fields are discarded. Only percentages and reset timestamps are uploaded through the signed `/api/usage` endpoint.

Set up private Vercel Blob, `DASHBOARD_INGEST_TOKEN`, and optional `DASHBOARD_VIEW_TOKEN` by following [Vercel setup](docs/VERCEL-SETUP.md). The data flow and schema are in [Architecture](docs/ARCHITECTURE.md), and the trust boundaries are in [Security](docs/SECURITY.md).

## Windows Collector

Prerequisites:

- Node.js 20.9 or newer.
- Official Claude Code signed in with a Claude.ai subscription.
- Official Codex CLI signed in with ChatGPT.

Install from PowerShell:

```powershell
.\collector\install-windows.ps1 -IngestUrl 'https://your-project.vercel.app/api/usage'
```

The installer prompts for the ingest token as a SecureString, stores runtime configuration under `%LOCALAPPDATA%\KindleLLMDashboard` with restricted ACLs, registers Claude's status line, and creates a per-user `Kindle LLM Quota Uploader-<GUID>` task every five minutes. The protected manifest retains that generated name across reinstalls. It refuses to replace a foreign Claude status line unless `-ReplaceExistingStatusLine` is supplied.

Diagnostics and removal:

```powershell
.\collector\diagnose-windows.ps1
.\collector\uninstall-windows.ps1
```

See [Windows collector](docs/WINDOWS-COLLECTOR.md) for installation, recovery, token rotation, and uninstall details.

## Kindle Setup

Supported profiles:

| Profile | PNG size | Device |
| --- | ---: | --- |
| `dp75sdi` | `758x1024` | Kindle Paperwhite 2 / DP75SDI |
| `kpw3` | `1072x1448` | Kindle Paperwhite 3 |
| `voyage` | `1080x1440` | Kindle Voyage |
| `basic` | `600x800` | Kindle Basic |

Copy `kindle-extension` to `<KINDLE_DRIVE>:\extensions\kindle-dash`, then edit `local/env.sh` and replace the generic dashboard hostname. Keep portrait dimensions and the 12-minute default:

```sh
export DASHBOARD_URL="https://your-project.vercel.app/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false"
export REFRESH_INTERVAL_SECS=720
```

If view protection is enabled, append `key=YOUR_VIEW_TOKEN` to the private local URL. Never commit that edited device file.

Safely eject the Kindle and use KUAL in this order:

1. `Display Test Frame`
2. `Display Cached Dashboard`
3. `Start LLM Token Dashboard`

The proven DP75SDI path keeps the Kindle framework running and does not clear the panel before `eips`. Leave `DASHBOARD_USE_RTC=false` until the 60-second probe records `WAKE_SUCCESS`. The staged RTC procedure is documented in the [DP75SDI battery and low-power design](docs/superpowers/specs/2026-07-10-kindle-battery-low-power-design.md).

`Start LLM Token Dashboard` hides Pillow and pauses the `awesome` window manager after KUAL closes so the native Wi-Fi, battery, and clock bar cannot redraw over the PNG. Press the physical power button once to exit dashboard mode; if the native sleep screen appears, press it again to return to Kindle. `Stop Dashboard / Restore Kindle`, normal daemon exit, and termination also restore system chrome without stopping the Kindle framework.

## Display Behavior

- Each provider shows independent 5-hour and 7-day remaining bars.
- Missing data displays `WAITING FOR LOCAL SYNC`.
- Data older than 24 hours is marked stale.
- An elapsed reset window displays `RESET COMPLETE` until a new official snapshot arrives.
- The Kindle supplies its own battery percentage on each request.
- PNG responses are fixed-size, opaque, 8-bit grayscale, non-interlaced, and not cached.

## Recovery

If the panel appears stuck in dashboard mode, press the physical power button once to restore native chrome; if the sleep screen appears, press it again to return to Kindle. When the stock UI is available, `Stop Dashboard / Restore Kindle` in KUAL is also safe. If needed, run `/mnt/us/extensions/kindle-dash/stop.sh` over SSH. A long power-button reboot remains the last resort when the watcher, KUAL, and SSH are unavailable.

For server or collector failures, use the runbooks in [Vercel setup](docs/VERCEL-SETUP.md) and [Windows collector](docs/WINDOWS-COLLECTOR.md). Removing the private Blob deletes the latest sanitized snapshot; it does not affect provider accounts.

## Development

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
```

The project is licensed under the [MIT License](LICENSE).
