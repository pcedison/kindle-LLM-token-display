# Kindle Chrome Re-Hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the native Kindle Wi-Fi, battery, and clock bar from appearing over any dashboard draw.

**Architecture:** Reuse the existing reversible `hide_kindle_chrome` shell function immediately before both daemon and one-shot `eips` rendering. Keep `stop.sh` as the sole unconditional restoration path and do not stop the full Kindle framework.

**Tech Stack:** POSIX `sh`, Kindle LIPC, `eips`, Node.js `node:test`

## Global Constraints

- Every dashboard draw hides Pillow before `eips`.
- `Stop Dashboard / Restore Kindle` remains fully reversible.
- Do not add a new daemon, timer, wake source, or framework stop.
- Preserve `kindle-extension/local/env.sh` on device.

---

### Task 1: Re-Hide Chrome Before Every Draw

**Files:**
- Modify: `tests/kindleScripts.test.mjs:392-413`
- Modify: `kindle-extension/dash.sh:122-140`
- Modify: `kindle-extension/local/display-once.sh:10-15`

**Interfaces:**
- Consumes: `hide_kindle_chrome()` from `kindle-extension/local/chrome-control.sh`.
- Produces: daemon and one-shot draw paths that disable Pillow before `eips`.

- [ ] **Step 1: Add a failing shell contract test**

Append this test after the existing chrome lifecycle test:

```js
test('re-hides Kindle chrome before daemon and one-shot dashboard draws', () => {
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
  assert.ok(displayOnce.indexOf('hide_kindle_chrome') >= 0);
  assert.ok(displayOnce.indexOf('hide_kindle_chrome') < displayOnce.indexOf('/usr/sbin/eips'));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="re-hides Kindle chrome" tests/kindleScripts.test.mjs`

Expected: FAIL because neither draw path currently hides chrome before `eips`.

- [ ] **Step 3: Implement the minimal shell changes**

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
hide_kindle_chrome
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
