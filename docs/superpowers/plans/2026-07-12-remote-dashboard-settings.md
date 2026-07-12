# Remote Dashboard Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated Vercel editor that remotely controls provider visibility, separate Claude/Codex artwork, and an allowlisted Kindle refresh interval after one device upgrade.

**Architecture:** One bounded private Blob JSON document per Kindle profile is the atomic source of managed settings. Admin-only endpoints read and replace it, the dashboard consumes it when `managed=true`, and a minimal view-protected endpoint exposes only the numeric refresh interval. The Kindle validates that value without sourcing remote shell and preserves local and cached fallbacks.

**Tech Stack:** Next.js 16 App Router, React, Node.js 20 test runner, `@vercel/blob`, BusyBox-compatible POSIX shell, Vercel.

## Global Constraints

- Profiles are exactly `dp75sdi`, `kpw3`, `voyage`, and `basic`.
- `DASHBOARD_ADMIN_TOKEN` is required for admin GET/PUT, sent only as a Bearer header, held only in page memory, and never written to URLs, storage, Kindle files, responses, or logs.
- Existing optional `DASHBOARD_VIEW_TOKEN` protects both managed PNG and device-config reads.
- Allowed refresh seconds are exactly `10,20,30,40,50,60,120,180,240,300,360,420,480,540,600,660,720,780,840,900`; default is `720`.
- Claude and Codex images are independent exact `104 x 96` white-background PNGs, contain-fitted without crop/stretch, and at most 100 KiB decoded each.
- Browser source uploads accept only PNG, JPEG, or WebP up to 5 MiB. SVG and remote URLs are rejected.
- Missing images independently fall back to `public/pikachu-line.png`.
- Existing dashboard URLs without `managed=true` remain backward compatible.
- Remote configuration is never sourced as shell. Invalid or unavailable values retain the last in-memory interval or local `REFRESH_INTERVAL_SECS` fallback.
- RTC opt-in, chrome restoration, power-button exit, framework behavior, and full/partial refresh policy remain unchanged.
- Every production behavior follows failing-test, minimal-implementation, passing-test order.

---

## File Map

- `app/api/config/dashboardConfig.mjs`: schema, defaults, normalization, PNG validation.
- `app/api/config/dashboardConfigStore.mjs`: profile-scoped private Blob reads/writes.
- `app/api/config/configHandler.mjs` and `route.js`: authenticated admin API.
- `app/api/device-config/deviceConfigHandler.mjs` and `route.js`: minimal Kindle runtime API.
- `app/configClient.mjs`: browser upload validation, contain-fit math, conversion, labels, URLs.
- `app/page.js` and `app/globals.css`: authenticated configuration editor.
- `app/api/dashboard/dashboardHandler.mjs`: managed visibility and provider-specific artwork.
- `kindle-extension/local/fetch-remote-config.sh`: strict remote interval fetcher.
- `kindle-extension/dash.sh` and `local/env.sh`: runtime integration and local fallback.
- New focused tests plus existing dashboard, Kindle, security, and release regression tests.

### Task 1: Configuration Domain Contract

**Files:**
- Create: `app/api/config/dashboardConfig.mjs`
- Create: `tests/dashboardConfig.test.mjs`

**Interfaces:**
- Produces: `ALLOWED_REFRESH_INTERVALS`, `normalizeDashboardConfig(input, { profile, now })`, `publicDashboardConfig(config)`, `validateNormalizedPngDataUrl(value)`.

- [ ] **Step 1: Write failing tests**

Test every exact interval, default 720, invalid values 59/61/901/shell text, profile and provider allowlists, unknown-field removal, null images, exact PNG signature/IHDR dimensions, and 100 KiB decoded limit.

```js
for (const refreshIntervalSeconds of EXPECTED_INTERVALS) {
  const config = normalizeDashboardConfig(
    { refreshIntervalSeconds },
    { profile: 'dp75sdi', now: () => FIXED_NOW },
  );
  assert.equal(config.refreshIntervalSeconds, refreshIntervalSeconds);
}
assert.throws(
  () => normalizeDashboardConfig({ refreshIntervalSeconds: 59 }, { profile: 'dp75sdi' }),
  /refresh interval/i,
);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/dashboardConfig.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal schema**

Use frozen constants and construct a new normalized object. Decode only `data:image/png;base64,...`, verify the eight-byte PNG signature, read width/height from IHDR offsets 16/20, enforce exact dimensions and decoded size, then canonicalize the base64.

```js
export const ALLOWED_REFRESH_INTERVALS = Object.freeze([
  10, 20, 30, 40, 50, 60, 120, 180, 240, 300,
  360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
]);
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/dashboardConfig.test.mjs`

Expected: PASS.

```powershell
git add app/api/config/dashboardConfig.mjs tests/dashboardConfig.test.mjs
git commit -m "Add managed dashboard config schema"
```

### Task 2: Private Store and Authenticated Admin API

**Files:**
- Create: `app/api/config/dashboardConfigStore.mjs`
- Create: `app/api/config/configHandler.mjs`
- Create: `app/api/config/route.js`
- Create: `tests/dashboardConfigStore.test.mjs`
- Create: `tests/configRoute.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task 1 schema and existing `authorizeBearer()`.
- Produces: `createDashboardConfigStore({ token, blob })`, `readDashboardConfig(profile)`, `writeDashboardConfig(profile, input)`, `createConfigHandler(dependencies)`.

- [ ] **Step 1: Write store tests and verify RED**

Use fake `get`/`put` adapters. Assert `dashboard-config/dp75sdi.json`, private/no-cache read, deterministic overwrite write, JSON content type, defaults on missing Blob, and write failure without a Blob token.

Run: `node --test tests/dashboardConfigStore.test.mjs`

Expected: FAIL because the store does not exist.

- [ ] **Step 2: Implement the store and verify GREEN**

Read with `{ access: 'private', token, useCache: false }`. Write the complete normalized JSON with `{ access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', token }`.

Run: `node --test tests/dashboardConfigStore.test.mjs`

Expected: PASS.

- [ ] **Step 3: Write admin API tests and verify RED**

Assert 503 when admin token is unconfigured, 401 missing/wrong Bearer before storage, 400 malformed JSON/config, 200 GET defaults, 200 PUT normalized saved content, generic 500 storage errors, and no-store JSON responses that never echo secret sentinels.

Run: `node --test tests/configRoute.test.mjs`

Expected: FAIL because the handler does not exist.

- [ ] **Step 4: Implement the handler and route**

Check configured token, exact Bearer auth, profile, then storage in that order. Parse PUT with `request.json()` and return only `publicDashboardConfig(saved)`. Export one handler as both GET and PUT from a Node.js force-dynamic route.

- [ ] **Step 5: Verify GREEN, add env placeholder, and commit**

Run: `node --test tests/configRoute.test.mjs tests/dashboardConfigStore.test.mjs`

Expected: PASS.

Add `DASHBOARD_ADMIN_TOKEN=GENERATE_A_SEPARATE_LONG_RANDOM_SECRET` to `.env.example`.

```powershell
git add app/api/config tests/configRoute.test.mjs tests/dashboardConfigStore.test.mjs .env.example
git commit -m "Add authenticated dashboard config API"
```

### Task 3: Managed Rendering and Device Endpoint

**Files:**
- Create: `app/api/device-config/deviceConfigHandler.mjs`
- Create: `app/api/device-config/route.js`
- Create: `tests/deviceConfigRoute.test.mjs`
- Modify: `app/api/dashboard/dashboardHandler.mjs`
- Modify: `tests/dashboardRoute.test.mjs`

**Interfaces:**
- Consumes: `readDashboardConfig(profile)`.
- Produces: `createDeviceConfigHandler(dependencies)` and managed rendering.

- [ ] **Step 1: Write device endpoint tests and verify RED**

Assert view auth occurs before reads, public access without configured view token, valid profile handling, no-store text response exactly `version=1\nrefresh_interval_seconds=720\n`, and omission of artwork/provider fields.

Run: `node --test tests/deviceConfigRoute.test.mjs`

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 2: Implement endpoint and verify GREEN**

Authorize through `authorizeDashboardView`, resolve the existing profile, read normalized config, and construct only the two documented lines.

Run: `node --test tests/deviceConfigRoute.test.mjs`

Expected: PASS.

- [ ] **Step 3: Write managed renderer tests and verify RED**

Inject config reads. Assert unmanaged query behavior stays unchanged, managed visibility ignores conflicting query flags, Claude/OpenAI render distinct PNG data URLs, and either null image independently invokes the default resolver. Compare artwork-region pixels rather than checking status only.

Run: `node --test tests/dashboardRoute.test.mjs`

Expected: FAIL because managed settings are ignored.

- [ ] **Step 4: Implement managed rendering**

Read config only for `managed=true`; use stored visibility; pass an artwork map into card rendering; use `artwork[provider.queryKey] || defaultArtworkSrc`. Keep unmanaged branches unchanged.

- [ ] **Step 5: Verify regressions and commit**

Run: `node --test tests/deviceConfigRoute.test.mjs tests/dashboardRoute.test.mjs tests/kindlePng.test.mjs tests/layoutModel.test.mjs`

Expected: PASS.

```powershell
git add app/api/device-config app/api/dashboard/dashboardHandler.mjs tests/deviceConfigRoute.test.mjs tests/dashboardRoute.test.mjs
git commit -m "Render remotely managed dashboard settings"
```

### Task 4: Browser Conversion and Settings Editor

**Files:**
- Create: `app/configClient.mjs`
- Create: `tests/configClient.test.mjs`
- Modify: `app/page.js`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `validateUploadFile(file)`, `calculateContainRect(width, height)`, `normalizeArtworkFile(file, adapters)`, `formatRefreshOption(seconds)`, `buildManagedUrls({ origin, profile, viewToken })`.

- [ ] **Step 1: Write helper tests and verify RED**

Test landscape/portrait/square/exact contain rectangles, allowed MIME and 5 MiB boundaries, interval labels, managed URLs with encoded optional view key but no admin token, and injected canvas calls that fill white before centered draw and export PNG.

Run: `node --test tests/configClient.test.mjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement helpers and verify GREEN**

Use `Math.min(104 / width, 96 / height)`, never exceed the canvas after rounding, center the result, fill `#fff`, then export `image/png`.

Run: `node --test tests/configClient.test.mjs`

Expected: PASS.

- [ ] **Step 3: Implement the root editor**

Keep the token only in React state. Locked state shows profile, password input, Unlock. Unlocked state shows provider checkboxes, separate file controls and exact previews, Restore Default actions, exact interval select, unsaved/saving/saved states, managed URLs, and complete PNG preview. GET/PUT use the Bearer header. Lock clears token and config. Fix the existing mojibake introduction.

- [ ] **Step 4: Verify build and commit**

Run: `node --test tests/configClient.test.mjs tests/configRoute.test.mjs`

Run: `npm.cmd run build`

Expected: tests and build PASS; root and all four API routes are emitted.

```powershell
git add app/page.js app/globals.css app/configClient.mjs tests/configClient.test.mjs
git commit -m "Add remote dashboard settings editor"
```

### Task 5: Kindle Remote Interval Runtime

**Files:**
- Create: `kindle-extension/local/fetch-remote-config.sh`
- Modify: `kindle-extension/dash.sh`
- Modify: `kindle-extension/local/env.sh`
- Modify: `tests/kindleScripts.test.mjs`
- Modify: `tests/kindleSecurity.test.mjs`

**Interfaces:**
- Consumes: Task 3 two-line endpoint.
- Produces: one validated interval on helper stdout and `refresh_interval_secs` in daemon memory.

- [ ] **Step 1: Write shell tests and verify RED**

Fake wget responses for every allowed value, network failure, empty/duplicate lines, shell metacharacters, 59/61/901, and a private URL sentinel. Assert only one allowlisted decimal reaches stdout, invalid cases fail without secret logging, daemon fetches before each PNG, preserves prior value, sleeps with it, and removes unconditional `sleep 5` cadence delay.

Run: `node --test tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs`

Expected: FAIL because helper/integration are absent.

- [ ] **Step 2: Implement strict helper**

Disable xtrace, fetch atomically to `/tmp`, require exactly one `refresh_interval_seconds=<digits>` line, and use this exact shell allowlist:

```sh
case "$value" in
  10|20|30|40|50|60|120|180|240|300|360|420|480|540|600|660|720|780|840|900)
    printf '%s\n' "$value" ;;
  *) exit 1 ;;
esac
```

- [ ] **Step 3: Integrate daemon interval**

Initialize from local 720 fallback, attempt remote fetch before each PNG, replace only on success, pass the in-memory value to `sleep_until_next_refresh`, and remove only the old unconditional five-second delay. Add explicit `REMOTE_CONFIG_URL` to `env.sh`; do not rewrite private URLs at runtime.

- [ ] **Step 4: Verify security regressions and commit**

Run: `node --test tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs tests/openSourceRelease.test.mjs`

Expected: PASS with no sentinel output.

```powershell
git add kindle-extension/dash.sh kindle-extension/local/env.sh kindle-extension/local/fetch-remote-config.sh tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs
git commit -m "Apply remote Kindle refresh intervals"
```

### Task 6: Documentation, Release, Deployment, and Migration

**Files:**
- Modify: `README.md`
- Modify: `docs/VERCEL-SETUP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Produces: public setup/migration contract, release evidence, deployed feature, one-time device upgrade.

- [ ] **Step 1: Write release assertions and verify RED**

Require docs to name the admin token, exact high-power range, 1-15 minute range, separate artwork normalization, three token roles, one-time managed migration, and no-USB behavior after migration.

Run: `node --test tests/openSourceRelease.test.mjs`

Expected: FAIL on missing new documentation.

- [ ] **Step 2: Update docs and verify GREEN**

Document Vercel variable/redeploy steps, root unlock/save flow, private Blob, stable managed URLs, image limits, warnings, fallback, rollback, and migration without publishing real secrets.

Run: `node --test tests/openSourceRelease.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run full release gate**

Run `npm.cmd test`, `npm.cmd run build`, and `git diff --check` separately.

Expected: zero test failures, build exit 0, no diff errors.

- [ ] **Step 4: Generate and inspect managed preview**

Verify HTTP 200, PNG/no-store, `758 x 1024`, 8-bit grayscale, color type 0, interlace 0, nonblank output, distinct artwork, and no overlap.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md docs/VERCEL-SETUP.md docs/ARCHITECTURE.md docs/SECURITY.md tests/openSourceRelease.test.mjs
git commit -m "Document remote Kindle dashboard management"
```

- [ ] **Step 6: Push, PR, checks, merge, and production verification**

Push the feature branch, open a ready PR to `main`, wait for Windows/macOS/shell/Vercel checks, fix failures test-first, merge only when green, fast-forward local main, verify local/remote SHA equality, then confirm Vercel production uses the merge SHA. Smoke-test auth, managed PNG metadata, device-config no-store text, and the root page without printing tokens or private URLs.

- [ ] **Step 7: Perform one-time mounted Kindle migration**

When `D:` is verified as the Kindle, compare tracked files, copy changed runtime files, preserve private `local/env.sh`, patch only its dashboard and remote-config URLs to stable managed production endpoints while retaining the optional view key, compare copied files, safely eject, start the dashboard, and prove one later web setting change arrives without USB.
