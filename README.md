# Kindle LLM Token Dashboard

This project renders a Kindle-friendly PNG dashboard on Vercel. The Kindle does
not run the web app directly. It downloads `/api/dashboard` as a PNG and displays
that file with `eips`.

Production URL currently used by the Kindle:

```text
https://kindle-llm-dash-1.vercel.app/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false
```

## What Is Already Set Up

- Vercel/Next endpoint outputs portrait PNGs for Kindle.
- Dashboard PNGs are flattened to opaque 8-bit grayscale before delivery so
  older Kindle `eips` builds do not misread RGBA/alpha PNG data.
- `profile=dp75sdi` outputs `758x1024` for the mounted DP75SDI device.
- The top-left header shows the Kindle battery icon and percentage. The Kindle
  reads its own battery level and appends it as `battery=N` on every refresh.
- Kindle scripts live under `/mnt/us/extensions/kindle-dash`.
- KUAL has Start, Refresh Now, diagnostics, a guarded 60-second Low Power Test,
  and Stop/Restore actions.
- Kindle refresh interval is controlled locally by `REFRESH_INTERVAL_SECS`.

## Final Values To Fill In

The dashboard now reads display values from Vercel Environment Variables. These
are plain display labels. Do not put API keys in this repo.

Add these in Vercel Project Settings -> Environment Variables:

```text
CLAUDE_STATUS_VALUE
CLAUDE_RESET_LABEL
CLAUDE_PROGRESS_VALUE
OPENAI_STATUS_VALUE
OPENAI_RESET_LABEL
OPENAI_PROGRESS_VALUE
GEMINI_STATUS_VALUE
GEMINI_RESET_LABEL
GEMINI_PROGRESS_VALUE
```

Example values:

```text
CLAUDE_STATUS_VALUE=12%
CLAUDE_RESET_LABEL=Reset 2026-08-01
CLAUDE_PROGRESS_VALUE=12
OPENAI_STATUS_VALUE=$18.42
OPENAI_RESET_LABEL=Reset 2026-07-31
OPENAI_PROGRESS_VALUE=28
GEMINI_STATUS_VALUE=4.5k / 5k
GEMINI_RESET_LABEL=Window 24h
GEMINI_PROGRESS_VALUE=90
```

`*_PROGRESS_VALUE` is optional. If the display value contains a percentage such
as `96%`, the dashboard can infer the progress bar automatically. Use the
progress variable when the display value is money or text. When values are not
configured yet, the dashboard keeps the provider names visible and shows quiet
`--` / `Pending` placeholders. After changing Vercel env vars, redeploy the
production deployment. The Kindle will pick up the new values on its next
refresh.

## URL Parameters

```text
profile=dp75sdi
w=758
h=1024
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
local/get-battery-level.sh reads the Kindle battery percentage
local/display-test-frame.sh draws a 758x1024 diagnostic PNG without clearing the screen
start.sh                  starts the long-running dashboard loop
refresh-now.sh            refreshes once immediately
diagnose.sh               writes battery, Wi-Fi, power, thermal, and RTC diagnostics
low-power-test.sh         probes timed suspend and wake for 60 seconds
stop.sh                   stops dashboard and restores Kindle UI
logs/dash.log             runtime log
logs/power-diagnostics.log diagnostic report
logs/low-power-test.log   timed-suspend probe result
```

The dashboard URL may be previewed in a browser with a simulated battery value:

```text
https://kindle-llm-dash-1.vercel.app/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false&battery=82
```

The battery value is normally supplied automatically by Kindle and should not
be added manually to `local/env.sh`.

## Low-Power Probe

`DASHBOARD_USE_RTC` remains `false` by default. Do not change it until the real
device has passed the probe:

1. Mount the Kindle and copy the reviewed `kindle-extension` folder to
   `D:\extensions\kindle-dash`.
2. Safely eject the Kindle and open KUAL.
3. Run `Write Dashboard Status Log`.
4. Mount the Kindle again and inspect `logs/power-diagnostics.log`.
5. Safely eject again and run `Low Power Test (60 sec)`.
6. After the Kindle wakes, mount it and inspect `logs/low-power-test.log`.

Only a log containing `WAKE_SUCCESS` after `PROBE_START` proves that timed
sleep and wake work on this device. Until then, leave
`DASHBOARD_USE_RTC=false`; the dashboard uses the stable userspace wait mode.
If the probe reports `UNSUPPORTED`, continue using the normal mode and do not
repeat it unattended.

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

For display debugging, run these KUAL items in this order:

```text
Display Test Frame
Display Cached Dashboard
Start LLM Token Dashboard
```

The current DP75SDI launcher does not stop the Kindle framework and does not
clear the screen before drawing. Those two actions caused blank-screen failures
on this device.

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
