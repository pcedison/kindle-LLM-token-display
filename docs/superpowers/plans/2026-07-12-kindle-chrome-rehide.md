# Kindle Chrome Re-Hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the native Kindle Wi-Fi, battery, and clock bar from appearing over any dashboard draw.

**Architecture:** Add a Pillow-only hide for standalone drawing and retain the existing full chrome hide for the daemon, which owns cleanup and a power-button watcher. Keep `stop.sh` as the sole unconditional restoration path and do not stop the full Kindle framework.

**Tech Stack:** POSIX `sh`, Kindle LIPC, `eips`, Node.js `node:test`

## Global Constraints

- Every dashboard draw hides Pillow before `eips`.
- Standalone draw paths never pause `awesome`.
- `Stop Dashboard / Restore Kindle` remains fully reversible.
- Do not add a new daemon, timer, wake source, or framework stop.
- Preserve `kindle-extension/local/env.sh` on device.

---

### Task 1: Re-Hide Chrome Before Every Draw

**Files:**
- Modify: `tests/kindleScripts.test.mjs:392-413`
- Modify: `kindle-extension/dash.sh:122-140`
- Modify: `kindle-extension/local/chrome-control.sh:3-19`
- Modify: `kindle-extension/local/display-once.sh:10-15`

**Interfaces:**
- Produces: `hide_kindle_pillow()` for standalone draws and retains
  `hide_kindle_chrome()` for daemon-owned draws.

- [ ] **Step 1: Add a failing shell contract test**

Append this test after the existing chrome lifecycle test:

```js
test('re-hides full chrome for daemon draws and only Pillow for one-shot draws', () => {
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  const displayOnce = readFileSync(
    join(process.cwd(), 'kindle-extension', 'local', 'display-once.sh'),
    'utf8',
  );
  const showStart = dash.indexOf('show_dashboard_png()');
  const showEnd = dash.indexOf('\nrefresh_dashboard()', showStart);
  const showBody = dash.slice(showStart, showEnd);

  assert.ok(showStart >= 0 && showEnd > showStart);
  assert.ok(showBody.indexOf('hide_kindle_chrome') >= 0);
  assert.ok(showBody.indexOf('hide_kindle_chrome') < showBody.indexOf('/usr/sbin/eips'));
  assert.match(displayOnce, /local\/chrome-control\.sh/);
  assert.ok(displayOnce.indexOf('hide_kindle_pillow') >= 0);
  assert.ok(displayOnce.indexOf('hide_kindle_pillow') < displayOnce.indexOf('/usr/sbin/eips'));
  assert.doesNotMatch(displayOnce, /\bhide_kindle_chrome\b/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="pillow-only|re-hides full" tests/kindleScripts.test.mjs`

Expected: FAIL because `hide_kindle_pillow` does not exist and the one-shot path
uses the unsafe full hide.

- [ ] **Step 3: Implement the minimal shell changes**

In `kindle-extension/local/chrome-control.sh`, extract `hide_kindle_pillow()` so
it performs only `com.lab126.pillow disableEnablePillow disable`. Keep the
optional `killall -STOP awesome` exclusively in `hide_kindle_chrome()`.

In `kindle-extension/dash.sh`, add this as the first command in
`show_dashboard_png()` after `mode` is assigned:

```sh
  hide_kindle_chrome
```

In `kindle-extension/local/display-once.sh`, source the existing helper after
the optional environment file:

```sh
. "$DIR/local/chrome-control.sh"
```

Then call the function after the KUAL settle delay and before logging or drawing:

```sh
hide_kindle_pillow
```

- [ ] **Step 4: Verify focused tests and shell syntax**

Run:

```powershell
node --test --test-name-pattern="chrome|cached dashboard" tests/kindleScripts.test.mjs
& 'C:\Program Files\Git\bin\bash.exe' -n kindle-extension/dash.sh kindle-extension/local/display-once.sh
```

Expected: all selected tests pass and Bash syntax exits zero.

- [ ] **Step 5: Run release gates**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all tests pass, Next.js builds, and no whitespace errors remain.

- [ ] **Step 6: Publish and deploy device files**

Commit `dash.sh`, `display-once.sh`, tests, spec, and plan. Push
`codex/kindle-chrome-rehide`, create a PR, require Windows, macOS, Kindle shell,
and Vercel checks to pass, then merge.

After the Kindle mounts, compare and copy only:

```text
kindle-extension/dash.sh
kindle-extension/local/display-once.sh
```

Do not overwrite `kindle-extension/local/env.sh`. Safely eject, run
`Stop Dashboard / Restore Kindle`, then `Start LLM Token Dashboard`, and verify
both automatic and manual refreshes keep native chrome hidden.
