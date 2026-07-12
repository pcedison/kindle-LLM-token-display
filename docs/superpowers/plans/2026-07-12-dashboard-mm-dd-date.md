# Dashboard MM/DD Date Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the dashboard header as `MM/DD / HH:mm` in Taipei time.

**Architecture:** Export one deterministic timestamp formatter from the existing dashboard handler and keep rendering geometry unchanged. Build the output from named `Intl.DateTimeFormat().formatToParts()` values so locale ordering cannot alter the result.

**Tech Stack:** Node.js ESM, Next.js 16, `node:test`, `Intl.DateTimeFormat`

## Global Constraints

- The output is exactly `MM/DD / HH:mm`.
- The time zone remains `Asia/Taipei`.
- The clock remains 24-hour.
- Header typography and geometry do not change.
- Provider reset labels do not change.

---

### Task 1: Deterministic Dashboard Timestamp

**Files:**
- Create: `tests/dashboardTimestamp.test.mjs`
- Modify: `app/api/dashboard/dashboardHandler.mjs:20-31,304`

**Interfaces:**
- Consumes: a timestamp accepted by `new Date(now)`.
- Produces: `formatDashboardTimestamp(now): string` returning `MM/DD / HH:mm`.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('dashboard timestamp renders month before day in Taipei time', async () => {
  const dashboard = await import('../app/api/dashboard/dashboardHandler.mjs');
  assert.equal(typeof dashboard.formatDashboardTimestamp, 'function');
  assert.equal(
    dashboard.formatDashboardTimestamp(Date.parse('2026-07-12T02:50:00.000Z')),
    '07/12 / 10:50',
  );
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/dashboardTimestamp.test.mjs`

Expected: FAIL because `formatDashboardTimestamp` is not exported.

- [ ] **Step 3: Implement the explicit formatter**

```js
export function formatDashboardTimestamp(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(
    parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]),
  );
  return `${values.month}/${values.day} / ${values.hour}:${values.minute}`;
}
```

Replace the existing `todayLabel(now)` render call with
`formatDashboardTimestamp(now)` and remove `todayLabel`.

- [ ] **Step 4: Verify GREEN and release gates**

Run:

```powershell
node --test tests/dashboardTimestamp.test.mjs
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: the focused test passes, all tests pass, Next.js builds both dynamic
API routes, and `git diff --check` exits zero.

- [ ] **Step 5: Render and inspect the DP75SDI output**

Deploy the branch preview, fetch
`/api/dashboard?profile=dp75sdi&claude=true&openai=true&gemini=false&battery=99`,
and visually confirm the top-right label reads `MM/DD / HH:mm` without overlap.

- [ ] **Step 6: Publish**

```powershell
git add tests/dashboardTimestamp.test.mjs app/api/dashboard/dashboardHandler.mjs
git commit -m "Render dashboard dates as MM/DD"
git push -u origin codex/dashboard-mm-dd-date
```

Create a pull request to `main`, require Windows, macOS, Kindle shell, and
Vercel checks to pass, merge it, then confirm the production alias is Ready.
