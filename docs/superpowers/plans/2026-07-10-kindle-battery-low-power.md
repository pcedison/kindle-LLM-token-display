# Kindle Battery Indicator and Low-Power Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the DP75SDI's real battery level in the dashboard header and add a safe, opt-in path to verify timed suspend before enabling low-power 12-minute refreshes.

**Architecture:** The Kindle reads its own battery level and appends it to the existing Vercel image URL. A pure server helper validates display data, while small POSIX shell utilities own battery parsing, query-string construction, RTC capability probing, and suspend fallback behavior. Low-power mode remains disabled until a KUAL probe records a successful timed wake on the physical device.

**Tech Stack:** Next.js 16 Edge route, React `ImageResponse`, Node test runner, POSIX `sh`, Kindle KUAL/LIPC/eips, Vercel.

## Global Constraints

- Target output is an opaque 8-bit grayscale PNG at exactly 758x1024 for `profile=dp75sdi`.
- Keep the Kindle framework running; do not create `DONT_START_FRAMEWORK`.
- Do not clear the display before drawing and do not force the front light off.
- Battery values must be integers from 0 through 100; missing or invalid values render as `--%`.
- Low-power mode defaults to disabled and can be enabled only after the physical 60-second probe records a successful wake.
- Any RTC or suspend failure falls back to the full configured userspace sleep and must not produce a rapid retry loop.

---

### Task 1: Server Battery Status and Header

**Files:**
- Create: `app/api/dashboard/batteryStatus.mjs`
- Create: `tests/batteryStatus.test.mjs`
- Modify: `app/api/dashboard/route.js`

**Interfaces:**
- Produces: `parseBatteryLevel(value) -> number | undefined`
- Produces: `getBatteryStatus(searchParams) -> { level, label, fillPercent, available }`
- Consumed by: `GET(request)` in `route.js`

- [ ] **Step 1: Write the failing battery status tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBatteryStatus, parseBatteryLevel } from '../app/api/dashboard/batteryStatus.mjs';

test('accepts Kindle battery percentages from zero through one hundred', () => {
  assert.equal(parseBatteryLevel('0'), 0);
  assert.equal(parseBatteryLevel('82'), 82);
  assert.equal(parseBatteryLevel('100'), 100);
  assert.equal(parseBatteryLevel('82%'), 82);
});

test('rejects missing malformed and out-of-range battery values', () => {
  for (const value of [undefined, '', '-1', '101', 'battery 82', 'NaN']) {
    assert.equal(parseBatteryLevel(value), undefined);
  }
});

test('builds render data and a quiet unavailable fallback', () => {
  assert.deepEqual(getBatteryStatus(new URLSearchParams({ battery: '37' })), {
    level: 37,
    label: '37%',
    fillPercent: 37,
    available: true,
  });
  assert.deepEqual(getBatteryStatus(new URLSearchParams()), {
    level: undefined,
    label: '--%',
    fillPercent: 0,
    available: false,
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --test tests/batteryStatus.test.mjs`

Expected: FAIL because `app/api/dashboard/batteryStatus.mjs` does not exist.

- [ ] **Step 3: Implement the pure battery model**

```js
function getParam(searchParams, key) {
  if (!searchParams) return undefined;
  if (typeof searchParams.get === 'function') return searchParams.get(key) ?? undefined;
  return searchParams[key];
}

export function parseBatteryLevel(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!/^\d{1,3}%?$/.test(normalized)) return undefined;
  const level = Number.parseInt(normalized, 10);
  return level >= 0 && level <= 100 ? level : undefined;
}

export function getBatteryStatus(searchParams) {
  const level = parseBatteryLevel(getParam(searchParams, 'battery'));
  return {
    level,
    label: level === undefined ? '--%' : `${level}%`,
    fillPercent: level ?? 0,
    available: level !== undefined,
  };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test tests/batteryStatus.test.mjs`

Expected: 3 passing tests.

- [ ] **Step 5: Render the battery in the existing header**

Import `getBatteryStatus`, resolve it from `searchParams`, and add a `renderBatteryIndicator` helper. The helper renders a 42x20 outline, a 4x10 terminal, proportional black fill using `${battery.fillPercent}%`, and an 18px bold label. Change the header from `justifyContent: 'flex-end'` to `justifyContent: 'space-between'`, place the indicator on the left, and keep `todayLabel()` on the right.

- [ ] **Step 6: Run all server tests**

Run: `npm test`

Expected: all previous tests plus the 3 battery tests pass.

- [ ] **Step 7: Commit the server unit**

```powershell
git add app/api/dashboard/batteryStatus.mjs app/api/dashboard/route.js tests/batteryStatus.test.mjs
git commit -m "Add Kindle battery status to dashboard"
```

---

### Task 2: Kindle Battery Reader and URL Construction

**Files:**
- Create: `kindle-extension/local/dashboard-utils.sh`
- Create: `kindle-extension/local/get-battery-level.sh`
- Create: `tests/kindleScripts.test.mjs`
- Modify: `kindle-extension/local/fetch-dashboard.sh`

**Interfaces:**
- Produces shell function: `normalize_battery_level RAW -> stdout integer, status 0 | no output, status 1`
- Produces shell function: `append_query_param URL KEY VALUE -> stdout URL`
- Produces executable: `get-battery-level.sh -> stdout integer or empty`
- Consumed by: `fetch-dashboard.sh`

- [ ] **Step 1: Write failing shell behavior tests**

Use Node `spawnSync` with `bash.exe -lc` on Windows and `sh -c` elsewhere. Source `dashboard-utils.sh`, then assert:

```js
assert.equal(runShell("normalize_battery_level '72%'"), '72');
assert.equal(runShell("normalize_battery_level ' 0 '"), '0');
assert.equal(runShell("normalize_battery_level '100'"), '100');
assert.equal(runShell("normalize_battery_level '-5%'", { allowFailure: true }).status, 1);
assert.equal(runShell("normalize_battery_level '101%'", { allowFailure: true }).status, 1);
assert.equal(
  runShell("append_query_param 'https://example.test/api' battery 72"),
  'https://example.test/api?battery=72',
);
assert.equal(
  runShell("append_query_param 'https://example.test/api?profile=dp75sdi' battery 72"),
  'https://example.test/api?profile=dp75sdi&battery=72',
);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/kindleScripts.test.mjs`

Expected: FAIL because `dashboard-utils.sh` is missing.

- [ ] **Step 3: Implement the POSIX shell utilities**

```sh
normalize_battery_level() {
  value=$(printf '%s' "$1" | tr -d '[:space:]%')
  case "$value" in ''|*[!0-9]*) return 1 ;; esac
  [ "$value" -ge 0 ] 2>/dev/null || return 1
  [ "$value" -le 100 ] 2>/dev/null || return 1
  printf '%s\n' "$value"
}

append_query_param() {
  case "$1" in *\?*) separator='&' ;; *) separator='?' ;; esac
  printf '%s%s%s=%s\n' "$1" "$separator" "$2" "$3"
}
```

- [ ] **Step 4: Implement the battery source fallback order**

`get-battery-level.sh` sources the utilities, accepts an optional raw argument for field diagnostics, then tries `gasgauge-info -c`, known readable `battery_capacity`/`capacity` sysfs files, `lipc-get-prop com.lab126.powerd battLevel`, and finally the `Battery Level:` line from `powerd_test -s`. Every source passes through `normalize_battery_level`; failure produces no output and a nonzero status.

- [ ] **Step 5: Forward battery data in the fetch URL**

In `fetch-dashboard.sh`, source `dashboard-utils.sh`, run `get-battery-level.sh`, and build `FETCH_URL` with `append_query_param` only when a valid value exists. Log `battery=<value>` or `battery=unknown`, and use `FETCH_URL` for every HTTP client without printing credentials or headers.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/kindleScripts.test.mjs`

Expected: all shell behavior tests pass.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit the Kindle battery unit**

```powershell
git add kindle-extension/local/dashboard-utils.sh kindle-extension/local/get-battery-level.sh kindle-extension/local/fetch-dashboard.sh tests/kindleScripts.test.mjs
git update-index --chmod=+x kindle-extension/local/get-battery-level.sh
git commit -m "Forward Kindle battery level to dashboard"
```

---

### Task 3: Diagnostics and 60-Second Low-Power Probe

**Files:**
- Modify: `kindle-extension/local/dashboard-utils.sh`
- Create: `kindle-extension/diagnose.sh`
- Create: `kindle-extension/low-power-test.sh`
- Modify: `tests/kindleScripts.test.mjs`
- Modify: `kindle-extension/menu.json`

**Interfaces:**
- Produces shell function: `find_duration_rtc_path -> writable path or status 1`
- Produces shell function: `suspend_for_seconds DURATION -> status`
- Produces log: `logs/power-diagnostics.log`
- Produces log: `logs/low-power-test.log` containing `WAKE_SUCCESS` only after resume

- [ ] **Step 1: Write failing RTC utility tests**

Create temporary writable files for `RTC_WAKE_PATH` and `POWER_STATE_PATH`, then assert that `find_duration_rtc_path` selects the override and `suspend_for_seconds 60` writes `60` to the RTC file and `mem` to the power-state file. Also assert that a missing RTC override returns status 1.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/kindleScripts.test.mjs`

Expected: FAIL because the RTC functions are not defined.

- [ ] **Step 3: Implement RTC discovery and suspend primitives**

```sh
find_duration_rtc_path() {
  if [ -n "${RTC_WAKE_PATH:-}" ] && [ -w "$RTC_WAKE_PATH" ]; then
    printf '%s\n' "$RTC_WAKE_PATH"
    return 0
  fi
  for candidate in /sys/devices/platform/mxc_rtc.0/wakeup_enable /sys/devices/platform/*rtc*/wakeup_enable; do
    [ -w "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

suspend_for_seconds() {
  duration=$1
  rtc_path=$(find_duration_rtc_path) || return 1
  power_state=${POWER_STATE_PATH:-/sys/power/state}
  printf '%s' "$duration" >"$rtc_path" || return 1
  printf 'mem\n' >"$power_state" || return 1
}
```

- [ ] **Step 4: Implement bounded diagnostics**

`diagnose.sh` writes a timestamped report containing battery level, `powerd_test -s`, Wi-Fi `cmState`, readable thermal zones, configured/default RTC candidates, `/sys/power/state`, and daemon PID state. It must not dump environment variables, URLs, cookies, or authorization data. Keep only the newest 300 lines.

- [ ] **Step 5: Implement the isolated 60-second probe**

`low-power-test.sh` stops the dashboard daemon, records `PROBE_START`, runs diagnostics, requires a writable duration RTC path, calls `sync`, invokes `suspend_for_seconds 60`, and records `WAKE_SUCCESS` only after control returns. On any pre-suspend error it records `UNSUPPORTED` and exits without enabling `DASHBOARD_USE_RTC`.

- [ ] **Step 6: Add KUAL actions**

Add `Low Power Test (60 sec)` pointing to `./low-power-test.sh`. Keep `Write Dashboard Status Log` pointing to the now-present `./diagnose.sh`.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test tests/kindleScripts.test.mjs`

Expected: battery, URL, RTC discovery, and suspend-file tests pass without suspending the workstation.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit diagnostics and probe**

```powershell
git add kindle-extension/local/dashboard-utils.sh kindle-extension/diagnose.sh kindle-extension/low-power-test.sh kindle-extension/menu.json tests/kindleScripts.test.mjs
git update-index --chmod=+x kindle-extension/diagnose.sh kindle-extension/low-power-test.sh
git commit -m "Add safe Kindle low-power probe"
```

---

### Task 4: Opt-In RTC Refresh Loop With Safe Fallback

**Files:**
- Modify: `kindle-extension/dash.sh`
- Modify: `kindle-extension/local/env.sh`
- Modify: `kindle-extension/stop.sh`
- Create: `kindle-extension/wait-for-wifi.sh`
- Modify: `tests/kindleScripts.test.mjs`

**Interfaces:**
- Consumes: `suspend_for_seconds` and `find_duration_rtc_path`
- Produces: low-power loop selected only by `DASHBOARD_USE_RTC=true`
- Preserves: userspace `sleep "$duration"` fallback

- [ ] **Step 1: Add a failing static behavior test**

Read `env.sh` and `dash.sh` as text and assert that RTC defaults to `false`, the RTC branch calls `suspend_for_seconds`, Wi-Fi is disabled before suspend, and the failure branch calls the full-duration userspace sleep.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/kindleScripts.test.mjs`

Expected: FAIL because the dashboard loop does not use the shared suspend primitive or Wi-Fi shutdown.

- [ ] **Step 3: Integrate opt-in suspend**

Source `dashboard-utils.sh` in `dash.sh`. In `sleep_until_next_refresh`, when `DASHBOARD_USE_RTC=true`, require a discovered RTC path, disable Wi-Fi, call `sync`, and invoke `suspend_for_seconds "$duration"`. If discovery or suspend returns nonzero, log the reason and call `sleep "$duration"`. Keep the existing userspace branch unchanged when RTC mode is false.

- [ ] **Step 4: Add reliable Wi-Fi wake behavior**

Create `wait-for-wifi.sh` to enable `com.lab126.wifid`, wait up to 30 seconds for `cmState=CONNECTED`, and use one short ping fallback only when LIPC state is unavailable. Return nonzero after the bounded timeout.

- [ ] **Step 5: Preserve recovery behavior**

Keep `DASHBOARD_USE_RTC=false` in `env.sh`. In `stop.sh`, stop the daemon, restore `preventScreenSaver=0`, request Wi-Fi enabled, start the framework, and clear only as part of explicit user-selected recovery.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all tests pass and the static safety assertions confirm low-power mode is opt-in with a full-duration fallback.

- [ ] **Step 7: Commit the opt-in loop**

```powershell
git add kindle-extension/dash.sh kindle-extension/local/env.sh kindle-extension/stop.sh kindle-extension/wait-for-wifi.sh tests/kindleScripts.test.mjs
git update-index --chmod=+x kindle-extension/wait-for-wifi.sh
git commit -m "Add opt-in RTC refresh loop"
```

---

### Task 5: Documentation, Preview, Build, and Deployment Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-10-kindle-battery-low-power.md` checkbox states

**Interfaces:**
- Documents: battery query flow, KUAL probe sequence, recovery, and the physical-device gate for RTC mode

- [ ] **Step 1: Update the runbook**

Document that `battery` is supplied by the Kindle automatically, that mock browser previews may use `battery=82`, and that the device sequence is Diagnostics -> Low Power Test -> remount and inspect `logs/low-power-test.log` -> enable RTC only after `WAKE_SUCCESS`.

- [ ] **Step 2: Run the complete automated verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 3: Generate and inspect the local PNG**

Start the app on an unused localhost port and request:

```text
/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false&battery=82
```

Save the response, verify dimensions are 758x1024, PNG color type is grayscale 0 with 8-bit depth, and inspect the rendered image for header overlap, clipped text, and card movement.

- [ ] **Step 4: Commit the verified implementation documentation**

```powershell
git add README.md docs/superpowers/plans/2026-07-10-kindle-battery-low-power.md
git commit -m "Document Kindle battery and power testing"
```

- [ ] **Step 5: Push, review, merge, and verify production**

Push `codex/battery-low-power`, create a ready PR, confirm checks, merge to `main`, and verify the Vercel production URL returns a 758x1024 opaque grayscale PNG with `battery=82`. Do not enable RTC mode remotely.

- [ ] **Step 6: Physical-device handoff**

Ask the user to mount the Kindle. Copy only the reviewed extension files, safely eject, run `Write Dashboard Status Log`, remount and inspect it, then repeat for `Low Power Test (60 sec)`. Set `DASHBOARD_USE_RTC=true` only after the log contains a post-suspend `WAKE_SUCCESS` marker and the user confirms the dashboard remained recoverable.
