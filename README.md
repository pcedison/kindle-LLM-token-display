# Kindle LLM Token Dashboard

This project renders a Kindle-friendly PNG dashboard on Vercel. The Kindle does
not run the web app directly. It downloads `/api/dashboard` as a PNG and displays
that file with `eips`.

Production URL currently used by the Kindle:

```text
https://kindle-llm-dash-1.vercel.app/api/dashboard?profile=dp75sdi&claude=true&openai=true&gemini=false
```

## What Is Already Set Up

- Vercel/Next endpoint outputs portrait PNGs for Kindle.
- `profile=dp75sdi` outputs `758x1024`.
- Kindle scripts live under `/mnt/us/extensions/kindle-dash`.
- KUAL has Start, Refresh Now, and Stop/Restore actions.
- Kindle refresh interval is controlled locally by `REFRESH_INTERVAL_SECS`.

## Final Values To Fill In

The dashboard now reads display values from Vercel Environment Variables. These
are plain display labels. Do not put API keys in this repo.

Add these in Vercel Project Settings -> Environment Variables:

```text
CLAUDE_STATUS_VALUE
CLAUDE_RESET_LABEL
OPENAI_STATUS_VALUE
OPENAI_RESET_LABEL
GEMINI_STATUS_VALUE
GEMINI_RESET_LABEL
```

Example values:

```text
CLAUDE_STATUS_VALUE=12%
CLAUDE_RESET_LABEL=Reset 2026-08-01
OPENAI_STATUS_VALUE=$18.42
OPENAI_RESET_LABEL=Reset 2026-07-31
GEMINI_STATUS_VALUE=4.5k / 5k
GEMINI_RESET_LABEL=Window 24h
```

After changing Vercel env vars, redeploy the production deployment. The Kindle
will pick up the new values on its next refresh.

## URL Parameters

```text
profile=dp75sdi
claude=true
openai=true
gemini=false
```

Supported profiles:

| Profile | Size | Use case |
| --- | ---: | --- |
| `dp75sdi` | `758x1024` | Kindle DP75SDI / Paperwhite 2 safe portrait default |
| `kpw3` | `1072x1448` | Kindle Paperwhite 3 |
| `voyage` | `1080x1440` | Kindle Voyage |
| `basic` | `600x800` | Kindle Basic |

If the real device needs a custom size, add `w` and `h`:

```text
https://kindle-llm-dash-1.vercel.app/api/dashboard?profile=dp75sdi&w=600&h=800
```

## Kindle Local Files

When mounted on Windows:

```text
D:\extensions\kindle-dash
```

On Kindle:

```text
/mnt/us/extensions/kindle-dash
```

Important files:

```text
local/env.sh              refresh interval and dashboard URL
local/fetch-dashboard.sh  downloads the PNG from Vercel
start.sh                  starts the long-running dashboard loop
refresh-now.sh            refreshes once immediately
stop.sh                   stops dashboard and restores Kindle UI
logs/dash.log             runtime log
```

## Kindle Refresh Interval

Edit `local/env.sh`:

```sh
export REFRESH_INTERVAL_SECS=${REFRESH_INTERVAL_SECS:-720}
```

Common values:

```text
900   = 15 minutes
720   = 12 minutes
1800  = 30 minutes
3600  = 60 minutes
```

## Recovery

If the Kindle appears stuck, first run this from KUAL:

```text
Stop Dashboard / Restore Kindle
```

Or by SSH:

```sh
/mnt/us/extensions/kindle-dash/stop.sh
```

Use a long power-button reboot only if KUAL and SSH are unavailable.

## Local Development

```sh
npm test
npm run build
```
