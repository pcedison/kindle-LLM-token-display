# Kindle Battery Indicator and Low-Power Refresh Design

Date: 2026-07-10
Status: Approved for implementation
Target device: Kindle DP75SDI / Paperwhite 2, portrait 758x1024

## Goal

Add the Kindle's real battery level to the dashboard and reduce unnecessary
heat and battery drain without reintroducing the blank-screen, oversized-image,
or frozen-UI failures previously seen on this device.

## Current Findings

The dashboard refresh interval is 720 seconds, but the current launcher sets
`com.lab126.powerd preventScreenSaver` to `1` for the lifetime of the daemon.
`DASHBOARD_USE_RTC` is also disabled, so the daemon waits with a userspace
`sleep`. The Kindle therefore remains awake between refreshes even though the
e-ink panel itself does not need power to retain an image.

The current display pipeline is known to work when it:

- keeps the Kindle framework running;
- does not clear the display before drawing;
- downloads an opaque 8-bit grayscale 758x1024 PNG; and
- draws that PNG with `eips`.

Those constraints must remain unchanged during the battery-indicator work.

## Battery Indicator

The top header becomes a two-sided status row:

- Left: a small horizontal battery outline, proportional black fill, and an
  18px bold percentage label such as `82%`.
- Right: the existing Taipei date and time at 18px.
- The existing full-width divider remains below both items.

The icon must be monochrome, high contrast, and legible after grayscale PNG
conversion. The fill width represents the exact percentage rather than a
fixed set of decorative states. Values are clamped to 0 through 100. When a
valid reading is unavailable, the icon remains outlined and the label is
`--%`; the server never invents a device value.

## Battery Data Flow

At the start of every refresh, the Kindle reads its local battery level. The
reader tries compatible sources in this order:

1. `gasgauge-info -c`
2. a known Kindle battery capacity sysfs file, when present
3. a compatible `powerd` battery property, when available

Only the first integer from a valid 0-100 reading is accepted. The fetch script
appends it to the existing dashboard URL as `battery=<percent>`. Vercel parses,
validates, and renders the value into the PNG. The value is not a secret and is
not persisted by the application.

The URL builder must preserve all existing query parameters and work whether
the configured URL already contains `?` parameters or not.

## Low-Power Strategy

Power changes are staged because this DP75SDI has already shown device-specific
display failures.

### Stage 1: Instrumented Current Mode

The first installed version keeps the current proven display behavior. It adds:

- battery level in the request and dashboard;
- battery, Wi-Fi, powerd, thermal-zone, and RTC capability information in a
  bounded diagnostic log;
- a KUAL action that writes the diagnostic report; and
- a separate 60-second low-power probe action.

### Stage 2: Low-Power Probe

The probe runs separately from the dashboard daemon. It must:

1. stop any active dashboard loop;
2. discover a supported duration-based RTC wake control without modifying the
   root filesystem;
3. write a start marker and current power data to the log;
4. schedule a 60-second wake and request suspend;
5. write a wake-success marker after execution resumes; and
6. leave a clear failure reason and restore a usable state if scheduling or
   suspend is unsupported.

Running the probe must not permanently enable low-power mode. A user can always
restore the Kindle UI with the existing Stop action or a reboot.

### Stage 3: 12-Minute Low-Power Refresh

Only after the real device log proves that suspend and timed wake both work will
`DASHBOARD_USE_RTC` be enabled on that Kindle. Each cycle then becomes:

1. wake;
2. enable and wait for Wi-Fi;
3. read battery level;
4. download and display the dashboard;
5. disable Wi-Fi;
6. schedule the next 720-second RTC wake; and
7. enter suspend while the e-ink image remains visible.

If any RTC operation fails, the daemon must log the failure and fall back to a
full 720-second userspace sleep. It must never enter a rapid retry loop.

The implementation will not stop the Kindle framework, create
`DONT_START_FRAMEWORK`, clear the screen, or force the front light off. Those
are separate, higher-risk choices and are outside this change.

## Components

### Vercel

- A small pure helper parses the `battery` query parameter.
- The image route renders the battery status in the header.
- Existing profile sizing, provider cards, grayscale conversion, and no-cache
  headers remain unchanged.

### Kindle Extension

- A battery reader returns only a validated integer or an empty result.
- The fetch script appends the battery value to the request URL.
- A diagnostics script records capabilities and current state without exposing
  credentials.
- A low-power probe tests timed suspend independently from normal operation.
- KUAL receives entries for diagnostics and the 60-second probe.

## Error Handling

- Missing battery reading: render `--%` and continue refreshing.
- Invalid query value: treat as unavailable; never render values outside
  0-100.
- Network failure: retain and display the last valid cached PNG, as today.
- Missing RTC capability: record `unsupported`; do not suspend.
- Suspend command failure: wait the normal interval in userspace.
- Failed timed wake: the power button and existing Stop/Restore action remain
  recovery paths; low-power mode is not enabled until the probe succeeds.

## Testing

Automated tests must cover:

- valid, missing, malformed, negative, and over-100 battery query values;
- battery fill width and fallback label data;
- URL construction with and without existing query parameters;
- shell battery parsing for percentage and plain-number outputs;
- normal power fallback when no RTC path exists; and
- all existing provider, profile, and grayscale PNG tests.

Verification must include:

- `npm test`;
- `npm run build`;
- a local 758x1024 PNG preview with a known battery value;
- confirmation that the PNG remains opaque 8-bit grayscale;
- production URL smoke tests after merge and Vercel deployment; and
- the real-device 60-second low-power probe before enabling Stage 3.

## Acceptance Criteria

- The top-left header shows the real Kindle battery icon and percentage after a
  device refresh.
- The top-right date and time remain readable and unchanged in purpose.
- Provider cards do not move outside the 758x1024 canvas or overlap the header.
- A missing battery reading does not prevent dashboard download or display.
- The low-power probe cannot silently enable a permanent suspend loop.
- Twelve-minute RTC mode is enabled only after a successful timed wake is
  captured in the device log.
- Stop/Restore and power-button recovery remain available.
