# Remote Dashboard Settings and Provider Artwork

Date: 2026-07-12 (Asia/Taipei)

## Goal

Turn the existing root configuration page into the control surface for a
managed Kindle dashboard. After one Kindle extension upgrade, an administrator
can change provider visibility, upload distinct Claude Code and Codex artwork,
and choose the Kindle refresh interval without reconnecting the Kindle over
USB or editing `local/env.sh` again.

The managed path must preserve the current low-risk display behavior: Vercel
renders an opaque grayscale PNG, the Kindle downloads it atomically, cached
images remain usable during network failures, and provider credentials never
leave their official local clients.

## Confirmed Product Decisions

- Use one private Vercel Blob JSON document per supported Kindle profile.
- Protect all configuration reads and writes in the browser with a new
  `DASHBOARD_ADMIN_TOKEN`.
- Keep the administrator token in page memory only. Do not put it in a URL,
  local storage, logs, rendered HTML, or Kindle files.
- Continue using `DASHBOARD_VIEW_TOKEN` for optional Kindle/dashboard read
  protection.
- Claude Code and Codex each have an independent uploaded image.
- The browser converts supported source images to a white-background,
  `104 x 96` PNG while preserving aspect ratio, centering the result, and never
  cropping or stretching it.
- If no custom image is saved, the existing Pikachu line drawing remains the
  default.
- Refresh choices are exactly 10, 20, 30, 40, and 50 seconds, followed by every
  whole minute from 1 through 15. The default remains 12 minutes.
- Intervals below one minute are allowed but visibly labeled as high-power test
  settings.
- A saved setting reaches an installed Kindle at its next connection. Changing
  away from an old 12-minute setting can therefore take up to the old interval
  before the new cadence begins.

## Approaches Considered

### 1. Atomic private configuration document (selected)

Store provider visibility, the refresh interval, and two normalized PNG data
URLs in one bounded private Blob JSON document. This makes Save atomic: the
renderer cannot observe a new setting with an old image or the reverse. The
images are tiny after normalization, so a separate image store adds no useful
scale benefit for this personal-device dashboard.

### 2. Separate configuration and image blobs

This reduces JSON size and would suit a large multi-tenant image service, but
requires multi-object version coordination and additional private reads during
every render. It is unnecessary for the supported profile-scoped setup.

### 3. URL-only configuration

Encoding settings and public image URLs in `DASHBOARD_URL` avoids storage but
requires another USB edit whenever a setting changes. It does not satisfy the
confirmed remote-management requirement.

## Managed Configuration Model

Each supported profile has one well-known configuration key:

```text
dashboard-config/dp75sdi.json
dashboard-config/kpw3.json
dashboard-config/voyage.json
dashboard-config/basic.json
```

The normalized document has this logical shape:

```json
{
  "version": 1,
  "profile": "dp75sdi",
  "refreshIntervalSeconds": 720,
  "providers": {
    "claude": { "visible": true, "imageDataUrl": null },
    "openai": { "visible": true, "imageDataUrl": null },
    "gemini": { "visible": false }
  },
  "updatedAt": "2026-07-12T12:00:00.000Z"
}
```

Only supported profile names, provider keys, allowed refresh values, booleans,
and bounded normalized PNG data URLs are accepted. Unknown fields are
discarded or rejected at the API boundary. A missing document resolves to the
existing defaults and does not create a Blob merely because it was read.

The normalized Claude and Codex PNGs are exactly `104 x 96`, have a white
background, and are capped at 100 KiB each after data-URL decoding. The server
validates PNG signature, dimensions, decoded size, and data-URL media type; it
does not trust the browser conversion alone.

## HTTP Interfaces

### Administrator configuration API

`GET /api/config?profile=dp75sdi` returns the normalized managed configuration.

`PUT /api/config?profile=dp75sdi` validates and atomically stores the complete
normalized configuration.

Both operations require:

```text
Authorization: Bearer <DASHBOARD_ADMIN_TOKEN>
```

If `DASHBOARD_ADMIN_TOKEN` is absent, administrative writes are disabled and
the page explains that Vercel must be configured first. Authentication failure
returns a generic response and never reveals whether a candidate token is a
prefix or near match.

### Kindle runtime configuration API

`GET /api/device-config?profile=dp75sdi&key=<optional-view-token>` returns a
small, cache-disabled text response containing only the current numeric refresh
interval and configuration version. It uses the same optional view-token rule
as the dashboard image.

The response is deliberately not executable shell. The Kindle script extracts
only a decimal value, verifies it against the exact allowlist, and ignores all
other content. This prevents a compromised response from becoming a shell
configuration injection path.

### Managed dashboard rendering

`GET /api/dashboard?profile=dp75sdi&managed=true&key=<optional-view-token>`
loads the corresponding private configuration before rendering.

In managed mode:

- stored provider visibility controls which cards render;
- Claude and Codex use their own saved artwork or the default artwork;
- profile dimensions still come from the validated profile parameter;
- query-string provider flags do not override managed settings.

Existing URLs without `managed=true` retain their current query-driven behavior
for backward compatibility and public forks already installed on devices.

## Configuration Page Experience

The existing deployment root remains the only configuration page. It gains the
following workflow:

1. Enter the administrator token and select a Kindle profile.
2. Unlock and load that profile's saved configuration.
3. Choose visible providers.
4. Upload separate Claude Code and Codex source images.
5. Preview each normalized `104 x 96` result and optionally restore the default.
6. Select a refresh interval from the exact supported list.
7. Preview the complete dashboard PNG.
8. Save and apply the configuration.

Accepted source formats are PNG, JPEG, and WebP, up to 5 MiB. Browser image
decoding failures, unsupported formats, and oversized files produce inline
errors without changing the last valid preview. Conversion uses a `104 x 96`
canvas filled white first, then draws the source centered with a contain fit.

The page must clearly distinguish three states: unsaved changes, saving, and
saved successfully. It must not claim the Kindle has already contacted Vercel;
success means only that the server configuration is durable. The generated
managed Dashboard URL and one-time Kindle upgrade instructions remain visible.

## Kindle Runtime Changes

The one-time extension upgrade adds a remote configuration URL derived from the
stable managed Dashboard URL. On startup and before each dashboard download,
the extension attempts to fetch the device configuration.

If the returned refresh value is on the exact allowlist, it becomes the
in-memory interval for the next sleep. The private `local/env.sh` remains the
fallback and continues to contain the stable managed Dashboard URL. Remote
values are not sourced as shell and do not overwrite `local/env.sh`.

Failure behavior is conservative:

- remote configuration timeout or HTTP failure keeps the last valid in-memory
  interval;
- a fresh process with no valid remote value uses `REFRESH_INTERVAL_SECS` from
  `local/env.sh`, normally 720 seconds;
- dashboard download failure keeps and redraws the last valid cached PNG under
  the existing rules;
- malformed or unsupported refresh values are logged as a class of failure but
  not echoed with private URLs;
- the power-button restore, chrome hiding, Kindle framework, and RTC opt-in
  behavior remain unchanged.

The hard-coded five-second delay between rendering and interval sleep is
removed from cadence accounting. The selected interval is the wait after a
completed refresh; network and e-ink drawing time are naturally additional.

## Power and E-Ink Behavior

The feature permits 10-50 second intervals because this is an explicit product
requirement, but the UI marks them as high-power test modes. Frequent network
requests and screen updates will materially reduce battery life and may make
the device feel warm. The 12-minute default remains the recommended continuous
display setting.

This release does not silently enable RTC suspend or alter the proven full vs.
partial refresh policy. Those behaviors are device-sensitive and remain under
the existing `local/env.sh` controls.

## Security and Privacy

- `DASHBOARD_ADMIN_TOKEN` is independent from ingest and view tokens.
- The configuration page sends it only in the Authorization header.
- Administrative API responses are `Cache-Control: no-store`.
- Private Blob access always occurs server-side with
  `BLOB_READ_WRITE_TOKEN`.
- Uploaded images are treated as untrusted binary input, normalized in the
  browser, then independently bounded and validated by the server.
- SVG and remote image URLs are not accepted, preventing script-bearing image
  uploads and server-side request forgery.
- Kindle responses never contain the administrator token or Blob token.
- Logs and diagnostics report only status classes, profile, configuration
  version, and interval; they do not print private dashboard URLs.

## Compatibility and Migration

The server deployment is backward compatible with every existing query-based
Dashboard URL. Remote management begins only after the one-time Kindle update
changes the device URL to include `managed=true` and installs the runtime
configuration fetch helper.

During the one-time D-drive copy:

- preserve the existing private `local/env.sh` until its hostname, profile, and
  optional view key have been migrated into the stable managed URL;
- never replace unrelated KUAL extensions;
- compare tracked runtime files after copying;
- safely eject before device acceptance.

After this migration, future provider, image, and interval changes require no
USB connection.

## Test Strategy and Acceptance Criteria

Automated tests are written before each production behavior.

### Configuration domain

- accepts every documented refresh interval and rejects all others;
- validates profile and provider visibility;
- accepts only bounded `104 x 96` PNG data URLs;
- supplies defaults for missing configuration;
- preserves atomic reads and writes through the private Blob adapter.

### HTTP and authentication

- admin GET and PUT reject absent or incorrect bearer tokens;
- admin GET and PUT use no-store responses and never expose secrets;
- device configuration follows view-token protection and emits only validated
  runtime fields;
- managed dashboard settings override provider query flags;
- unmanaged dashboard URLs remain backward compatible.

### Rendering

- Claude and Codex can render two visibly distinct uploaded images;
- either provider independently falls back to the default image;
- generated output remains fixed-size, opaque, grayscale, non-interlaced, and
  nonblank for all supported profiles;
- card geometry, text, bars, and artwork remain within bounds.

### Browser helpers and build

- contain-fit calculations preserve aspect ratio and center the image;
- source validation rejects unsupported or oversized files;
- URL and interval labels are generated correctly;
- the Next.js production build completes without client/server boundary errors.

### Kindle shell

- every allowed interval is accepted;
- malformed, injected, or out-of-range responses are ignored;
- network failure preserves the prior or local fallback interval;
- the selected interval reaches the sleep call without the old extra delay;
- private URLs remain absent from normal and xtrace logs;
- existing display, chrome restoration, and cached-image tests remain green.

### Release gate

- full `npm test` passes;
- `npm run build` passes;
- `git diff --check` passes;
- local preview shows distinct Claude/Codex artwork and the selected cadence;
- Vercel preview/production APIs pass metadata smoke tests;
- the mounted DP75SDI receives the one-time runtime update with private settings
  preserved;
- real-device acceptance confirms a web change is observed without a second USB
  connection.

## Out of Scope

- Arbitrary artwork placement, cropping, rotation, filters, or multiple images
  per provider.
- SVG, animated images, remote image URLs, or public image hosting.
- More than one managed configuration for the same profile in one deployment.
- Changing provider OAuth, quota collection cadence, RTC suspend, or collector
  scheduling from this page.
- Claiming low-power operation when a user deliberately selects a sub-minute
  refresh interval.
