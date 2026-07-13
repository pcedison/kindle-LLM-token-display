# Collector and Installer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate stale-lock ownership races, require an exact upload acknowledgement before persisting success, enforce Node 20.9+, and restore exact Windows pre-install state on failure.

**Architecture:** PR 6 replaces the reused canonical lock pathname with unique ownership claims and a heartbeat lease. PR 7 validates the server's bounded JSON acknowledgement before any success-state write. PR 8 adds installer preflight gates and a Windows rollback that distinguishes prior absence from an empty document.

**Tech Stack:** Node.js ESM and standard library, Web Fetch/Streams, PowerShell, Task Scheduler test harness, Node test runner.

## Global Constraints

- Every repository PR runs the exact fixed gate in `2026-07-13-project-hardening-master.md`; the shorter commands below are additional focused gates, not replacements.

- No new runtime dependency.
- At most one collector action runs; a new owner is never deleted through a reused pathname.
- A valid collector action may take roughly 120 seconds for Codex plus 120 seconds for upload; the lease must not expire during a supported run.
- Only HTTP 200, `application/json`, body <=4096 bytes, exact keys `ok` and `collectedAt`, `ok:true`, and canonical non-too-future UTC timestamp count as upload success.
- Failed acknowledgement never updates `last-upload.json`; it updates only the existing backoff path.
- Errors never include response body, URL, Bearer token, or credential value.
- Installer version checks occur before prompt, backup, manifest/task replacement, settings write, or install-root mutation.
- Windows rollback removes only the current installer-owned status line, preserves concurrent unrelated settings, and restores prior file/directory absence when ownership is provable.
- Destructive Task Scheduler failure injection runs only in the existing fake harness or a disposable Windows VM/account.

---

## PR 6 — Collector Ownership Claims

### Task 1: Add a Deterministic Lock Filesystem Seam

**Files:**
- Modify: `collector/lib/collectorLock.mjs:1-25`
- Modify: `tests/collectorState.test.mjs:108-160`

**Interfaces:**
- Consumes: state root, action, time source.
- Produces: unchanged public result contract plus injected `fs`, `makeClaimId`, `isProcessAlive`, `setIntervalFn`, and `clearIntervalFn` test seams.

- [ ] **Step 1: Add the dependency object without changing behavior**

Use imports:

```js
import { randomUUID } from 'node:crypto';
import {
  mkdir, open, readFile, readdir, rm, stat, utimes,
} from 'node:fs/promises';

const lockFileSystem = { mkdir, open, readFile, readdir, rm, stat, utimes };

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}
```

Extend the signature:

```js
export async function withCollectorLock({
  stateRoot,
  action,
  now = Date.now,
  staleAfterMs = 2 * 60 * 1000,
  fs = lockFileSystem,
  makeClaimId = randomUUID,
  isProcessAlive = processIsAlive,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
```

Route existing operations through `fs` while leaving the canonical algorithm unchanged in this first commit.

- [ ] **Step 2: Verify current tests remain green**

```powershell
node --test tests/collectorState.test.mjs tests/collectorClaude.test.mjs
```

Expected: existing lock behavior passes; no production behavior change yet.

- [ ] **Step 3: Commit the seam**

```powershell
git add collector/lib/collectorLock.mjs tests/collectorState.test.mjs
git commit -m "Inject collector lock filesystem operations"
```

### Task 2: Add Unique-Claim Race and Lease Tests

**Files:**
- Modify: `tests/collectorState.test.mjs`

**Interfaces:**
- Consumes: injected FS and claim IDs.
- Produces: deterministic concurrency, stale cleanup, heartbeat, legacy migration, and cleanup tests.

- [ ] **Step 1: Add the deterministic stale-cleanup and simultaneous tests**

Extend the test imports with `stat` and `utimes`, define `realFs`, and add:

```js
const realFs = { mkdir, open, readFile, readdir, rm, stat, utimes };

test('collector lock preserves a fresh claim created during stale cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-claim-race-'));
  const claimRoot = join(root, 'collector.lock.d');
  await mkdir(claimRoot, { recursive: true });
  const stalePath = join(claimRoot, 'stale.json');
  const freshPath = join(claimRoot, 'fresh.json');
  await writeFile(stalePath, JSON.stringify({ pid: 7001, claimId: 'stale', createdAt: '2026-07-12T07:00:00.000Z' }));
  let injected = false;
  const fs = {
    ...realFs,
    async rm(path, options) {
      if (path === stalePath && !injected) {
        injected = true;
        await writeFile(freshPath, JSON.stringify({ pid: 7002, claimId: 'fresh', createdAt: '2026-07-12T08:00:00.000Z' }));
      }
      return rm(path, options);
    },
  };
  let actions = 0;
  const result = await withCollectorLock({
    stateRoot: root,
    now: () => Date.parse('2026-07-12T08:00:30.000Z'),
    staleAfterMs: 120000,
    fs,
    makeClaimId: () => 'candidate',
    isProcessAlive: async (pid) => pid === 7002,
    action: async () => { actions += 1; },
  });
  assert.deepEqual(result, { skipped: true, reason: 'locked' });
  assert.equal(actions, 0);
  assert.equal(JSON.parse(await readFile(freshPath, 'utf8')).claimId, 'fresh');
  await rm(root, { recursive: true, force: true });
});

test('simultaneous collector claimants execute at most one action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-simultaneous-'));
  let scans = 0;
  let releaseScans;
  const scansReady = new Promise((resolve) => { releaseScans = resolve; });
  const fs = {
    ...realFs,
    async readdir(path) {
      if (path.endsWith('collector.lock.d')) {
        scans += 1;
        if (scans === 2) releaseScans();
        await scansReady;
      }
      return readdir(path);
    },
  };
  let actions = 0;
  const contender = (id) => withCollectorLock({
    stateRoot: root,
    fs,
    makeClaimId: () => id,
    action: async () => { actions += 1; return id; },
  });
  const results = await Promise.all([contender('claim-a'), contender('claim-b')]);
  assert.ok(actions <= 1);
  assert.ok(results.every((value) => value === 'claim-a' || value === 'claim-b' || value?.skipped));
  await rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Add remaining lease, cleanup, malformed, and legacy cases**

Using the same `realFs` and temp-root pattern, add tests named:

```text
collector lock removes a stale unique claim and runs
fresh malformed collector claims remain blocking
owned collector claim is removed when action throws
collector heartbeat keeps a supported long action fresh
fresh legacy collector.lock blocks new claims
stale legacy collector.lock is ignored but never unlinked
```

Implement them with this exact clock/timer/liveness contract:

```js
test('collector heartbeat and live-process proof prevent stale reclaim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-heartbeat-'));
  let clock = Date.parse('2026-07-12T08:00:00.000Z');
  let heartbeat;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = withCollectorLock({
    stateRoot: root,
    now: () => clock,
    staleAfterMs: 10_000,
    makeClaimId: () => 'owner-a',
    setIntervalFn: (callback) => { heartbeat = callback; return { unref() {} }; },
    clearIntervalFn: () => {},
    isProcessAlive: async () => true,
    action: () => held,
  });
  while (!heartbeat) await new Promise((resolve) => setImmediate(resolve));
  clock += 20_000;
  await heartbeat();
  const second = await withCollectorLock({
    stateRoot: root,
    now: () => clock,
    staleAfterMs: 10_000,
    makeClaimId: () => 'owner-b',
    isProcessAlive: async () => true,
    action: async () => 'must-not-run',
  });
  assert.deepEqual(second, { skipped: true, reason: 'locked' });
  release('finished');
  assert.equal(await first, 'finished');
  await rm(root, { recursive: true, force: true });
});

test('heartbeat between stale inspection and confirmation preserves the live claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-revival-race-'));
  const claimRoot = join(root, 'collector.lock.d');
  const ownerPath = join(claimRoot, 'owner.json');
  await mkdir(claimRoot, { recursive: true });
  await writeFile(ownerPath, JSON.stringify({ pid: 7001, claimId: 'owner', createdAt: '2026-07-12T07:00:00.000Z' }));
  let checks = 0;
  const result = await withCollectorLock({
    stateRoot: root,
    now: () => Date.parse('2026-07-12T08:00:00.000Z'),
    staleAfterMs: 10_000,
    makeClaimId: () => 'candidate',
    isProcessAlive: async () => {
      checks += 1;
      if (checks === 1) await utimes(ownerPath, new Date(), new Date());
      return false;
    },
    action: async () => 'must-not-run',
  });
  assert.deepEqual(result, { skipped: true, reason: 'locked' });
  assert.equal((await readFile(ownerPath, 'utf8')).includes('"claimId":"owner"'), true);
  await rm(root, { recursive: true, force: true });
});
```

Add the remaining cases as executable tests, not prose placeholders:

```js
test('collector lock removes a stale unique claim and runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-stale-claim-'));
  try {
    const claimRoot = join(root, 'collector.lock.d');
    await mkdir(claimRoot, { recursive: true });
    await writeFile(join(claimRoot, 'stale.json'), JSON.stringify({
      pid: 7001,
      claimId: 'stale',
      createdAt: '2026-07-12T07:00:00.000Z',
    }));
    const queried = [];
    const result = await withCollectorLock({
      stateRoot: root,
      now: () => Date.parse('2026-07-12T08:00:00.000Z'),
      staleAfterMs: 10_000,
      makeClaimId: () => 'candidate',
      isProcessAlive: async (pid) => { queried.push(pid); return false; },
      action: async () => 'recovered',
    });
    assert.equal(result, 'recovered');
    assert.deepEqual(queried, [7001, 7001]);
    assert.deepEqual(await readdir(claimRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed collector claims remain blocking and byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-malformed-'));
  try {
    const claimRoot = join(root, 'collector.lock.d');
    const claimPath = join(claimRoot, 'malformed.json');
    const malformed = '{"pid":';
    await mkdir(claimRoot, { recursive: true });
    await writeFile(claimPath, malformed);
    await utimes(claimPath, new Date('2026-07-12T07:00:00.000Z'), new Date('2026-07-12T07:00:00.000Z'));
    let actions = 0;
    const result = await withCollectorLock({
      stateRoot: root,
      now: () => Date.parse('2026-07-12T08:00:00.000Z'),
      staleAfterMs: 10_000,
      makeClaimId: () => 'candidate',
      isProcessAlive: async () => false,
      action: async () => { actions += 1; },
    });
    assert.deepEqual(result, { skipped: true, reason: 'locked' });
    assert.equal(actions, 0);
    assert.equal(await readFile(claimPath, 'utf8'), malformed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owned collector claim is removed when action throws', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-action-error-'));
  try {
    await assert.rejects(withCollectorLock({
      stateRoot: root,
      makeClaimId: () => 'owned-error',
      action: async () => { throw new Error('fixture action failed'); },
    }), /fixture action failed/);
    assert.deepEqual(await readdir(join(root, 'collector.lock.d')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const fixture of [
  {
    name: 'fresh legacy collector.lock blocks new claims',
    createdAt: '2026-07-12T07:59:55.000Z',
    expected: { skipped: true, reason: 'locked' },
    actionCalls: 0,
  },
  {
    name: 'stale legacy collector.lock is ignored but never unlinked',
    createdAt: '2026-07-12T07:00:00.000Z',
    expected: 'ran',
    actionCalls: 1,
  },
]) {
  test(fixture.name, async () => {
    const root = await mkdtemp(join(tmpdir(), 'collector-legacy-'));
    const legacyPath = join(root, 'collector.lock');
    const legacyBytes = JSON.stringify({ pid: 7001, createdAt: fixture.createdAt });
    try {
      await writeFile(legacyPath, legacyBytes);
      let actions = 0;
      const result = await withCollectorLock({
        stateRoot: root,
        now: () => Date.parse('2026-07-12T08:00:00.000Z'),
        staleAfterMs: 10_000,
        makeClaimId: () => 'candidate',
        isProcessAlive: async () => false,
        action: async () => { actions += 1; return 'ran'; },
      });
      assert.deepEqual(result, fixture.expected);
      assert.equal(actions, fixture.actionCalls);
      assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
```

- [ ] **Step 3: Run the key race test and verify RED**

```powershell
node --test --test-name-pattern="fresh claim created during stale cleanup|simultaneous collector claimants" tests/collectorState.test.mjs
```

Expected: current implementation reuses `collector.lock`, cannot represent unique claims, and fails the replacement/race contract.

### Task 3: Replace the Canonical Lock with Unique Claims

**Files:**
- Modify: `collector/lib/collectorLock.mjs`
- Modify: `docs/ARCHITECTURE.md:5-8`

**Interfaces:**
- Consumes: unique UUID claims under `collector.lock.d` and a legacy `collector.lock` only for migration blocking.
- Produces: `{ skipped:true, reason:'locked' }` or the action result.

In this behavior commit, change the production default `staleAfterMs` from two minutes to ten minutes; the preceding seam-only commit intentionally retains two minutes.

- [ ] **Step 1: Implement claim parsing and freshness**

```js
async function inspectClaim(path, expectedClaimId, { fs, nowMs, staleAfterMs }) {
  try {
    const [text, metadata] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)]);
    const record = JSON.parse(text);
    if (
      !record
      || Object.keys(record).sort().join(',') !== 'claimId,createdAt,pid'
      || record.claimId !== expectedClaimId
      || !Number.isSafeInteger(record.pid)
      || record.pid < 1
      || !Number.isFinite(Date.parse(record.createdAt))
      || new Date(Date.parse(record.createdAt)).toISOString() !== record.createdAt
    ) return { state: 'blocked' };
    const freshnessTimestamp = Math.max(Date.parse(record.createdAt), Number(metadata.mtimeMs));
    return {
      state: nowMs - freshnessTimestamp <= staleAfterMs ? 'fresh' : 'stale',
      record,
      text,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    return { state: 'blocked' };
  }
}
```

Malformed or unreadable claims block conservatively and require diagnose/manual recovery; they are never auto-deleted. A heartbeat is effective because freshness uses the later of immutable `createdAt` and current `mtimeMs`.

- [ ] **Step 2: Implement legacy blocking without deletion**

```js
async function inspectLegacyClaim(path, { fs, nowMs, staleAfterMs }) {
  try {
    const [text, metadata] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)]);
    const record = JSON.parse(text);
    if (
      !record
      || Object.keys(record).sort().join(',') !== 'createdAt,pid'
      || !Number.isSafeInteger(record.pid)
      || record.pid < 1
      || !Number.isFinite(Date.parse(record.createdAt))
      || new Date(Date.parse(record.createdAt)).toISOString() !== record.createdAt
    ) return { state: 'blocked' };
    const freshnessTimestamp = Math.max(Date.parse(record.createdAt), Number(metadata.mtimeMs));
    return { state: nowMs - freshnessTimestamp <= staleAfterMs ? 'fresh' : 'stale', record, text };
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    return { state: 'blocked' };
  }
}

async function legacyLockBlocks({ stateRoot, fs, nowMs, staleAfterMs }) {
  const legacyPath = join(stateRoot, 'collector.lock');
  const inspection = await inspectLegacyClaim(legacyPath, { fs, nowMs, staleAfterMs });
  return inspection.state !== 'missing' && inspection.state !== 'stale';
}
```

Never remove or overwrite the legacy path in the new protocol; a valid stale legacy claim is ignored, while malformed/unreadable legacy state blocks.

- [ ] **Step 3: Implement unique claim creation and arbitration**

Replace the old two-attempt loop with:

```js
await fs.mkdir(stateRoot, { recursive: true });
const claimRoot = join(stateRoot, 'collector.lock.d');
await fs.mkdir(claimRoot, { recursive: true });
const claimId = makeClaimId();
if (!/^[A-Za-z0-9-]{1,128}$/.test(claimId)) throw new TypeError('Invalid collector claim id');
const claimPath = join(claimRoot, `${claimId}.json`);
const createdAtMs = currentMilliseconds(now);
const record = JSON.stringify({
  pid: process.pid,
  claimId,
  createdAt: new Date(createdAtMs).toISOString(),
});

const handle = await fs.open(claimPath, 'wx');
try {
  await handle.writeFile(record, 'utf8');
  await handle.sync();
} finally {
  await handle.close();
}

let heartbeat;
try {
  if (await legacyLockBlocks({ stateRoot, fs, nowMs: createdAtMs, staleAfterMs })) {
    return { skipped: true, reason: 'locked' };
  }

  for (const name of await fs.readdir(claimRoot)) {
    if (!name.endsWith('.json') || name === `${claimId}.json`) continue;
    const otherPath = join(claimRoot, name);
    const otherClaimId = name.slice(0, -'.json'.length);
    const nowMs = currentMilliseconds(now);
    const inspection = await inspectClaim(otherPath, otherClaimId, { fs, nowMs, staleAfterMs });
    if (inspection.state === 'missing') continue;
    if (inspection.state !== 'stale' || await isProcessAlive(inspection.record.pid)) {
      return { skipped: true, reason: 'locked' };
    }

    const confirmation = await inspectClaim(otherPath, otherClaimId, {
      fs,
      nowMs: currentMilliseconds(now),
      staleAfterMs,
    });
    if (
      confirmation.state !== 'stale'
      || confirmation.text !== inspection.text
      || await isProcessAlive(confirmation.record.pid)
    ) return { skipped: true, reason: 'locked' };
    await fs.rm(otherPath, { force: true });
  }

  const survivors = (await fs.readdir(claimRoot))
    .filter((name) => name.endsWith('.json') && name !== `${claimId}.json`);
  if (survivors.length) return { skipped: true, reason: 'locked' };

  const heartbeatMs = Math.max(1000, Math.min(30_000, Math.floor(staleAfterMs / 3)));
  heartbeat = setIntervalFn(async () => {
    const date = new Date(currentMilliseconds(now));
    try { await fs.utimes(claimPath, date, date); } catch {}
  }, heartbeatMs);
  heartbeat?.unref?.();
  return await action();
} finally {
  if (heartbeat) clearIntervalFn(heartbeat);
  await fs.rm(claimPath, { force: true }).catch(() => {});
}
```

Auto-reclaim therefore requires all of: exact unique claim identity, expired `max(createdAt, mtime)`, the recorded process proven absent twice, and byte-identical confirmation immediately before deletion. A paused/live owner blocks even after its lease age; a heartbeat between inspection and confirmation makes the claim fresh and prevents deletion. Because claim filenames are unique and never reused, deletion cannot target a replacement owner. If two new claims see each other, one or both may conservatively skip, but both cannot proceed.

- [ ] **Step 4: Document the lease**

Document the 10-minute default stale lease, 30-second-or-faster heartbeat, unique claim files, conservative simultaneous behavior, and non-destructive legacy migration.

- [ ] **Step 5: Verify and commit the protocol**

```powershell
node --test tests/collectorState.test.mjs tests/collectorClaude.test.mjs
npm.cmd test
npm.cmd run build
node --test --experimental-test-coverage
git diff --check
git add collector/lib/collectorLock.mjs tests/collectorState.test.mjs docs/ARCHITECTURE.md
git commit -m "Replace stale collector lock with owned claims"
```

Expected: deterministic race/heartbeat/legacy tests pass. Stop before PR 6 publication.

---

## PR 7 — Exact Upload Acknowledgement

### Task 4: Add the Acknowledgement Failure Matrix

**Files:**
- Modify: `tests/collectorUpload.test.mjs:103-258`
- Modify: `tests/usageIngest.test.mjs:146-176`

**Interfaces:**
- Consumes: Fetch `Response` from `/api/usage`.
- Produces: success only for exact bounded JSON acknowledgement.

- [ ] **Step 1: Add one valid acknowledgement helper**

```js
function acknowledgement(
  collectedAt = '2026-07-10T00:00:00.000Z',
  { status = 200, contentType = 'application/json; charset=utf-8', extra = {} } = {},
) {
  return new Response(JSON.stringify({ ok: true, collectedAt, ...extra }), {
    status,
    headers: { 'content-type': contentType },
  });
}
```

Replace every existing successful fetch mock body such as `ok` with `acknowledgement()`. Give the stalled response JSON Content-Type so it still reaches body timeout logic.

- [ ] **Step 2: Add table-driven rejection and state-preservation tests**

```js
test('accepts only the exact bounded JSON upload acknowledgement', async () => {
  const invalid = [
    new Response(JSON.stringify({ ok: true, collectedAt: '2026-07-10T00:00:00.000Z' }), { status: 201, headers: { 'content-type': 'application/json' } }),
    new Response(null, { status: 204 }),
    new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ ok: false, collectedAt: '2026-07-10T00:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    acknowledgement('2026-07-10T00:00:00.000Z', { extra: { extra: true } }),
    acknowledgement('2026-07-10T00:00:00Z'),
    acknowledgement('not-a-date'),
    acknowledgement('2026-07-10T00:10:00.001Z'),
  ];

  for (const response of invalid) await withStateRoot(async (root) => {
    const prior = validSnapshot();
    await writeFile(join(root, 'last-upload.json'), JSON.stringify(prior));
    await assert.rejects(uploadSnapshot({
      snapshot: validSnapshot(),
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      now: () => Date.parse('2026-07-10T00:00:00.000Z'),
      fetch: async () => response,
    }), /acknowledgement|rejected|response/i);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'last-upload.json'), 'utf8')), prior);
    const backoff = JSON.parse(await readFile(join(root, 'upload-backoff.json'), 'utf8'));
    assert.ok(backoff.delayMs >= 300000);
  });
});
```

- [ ] **Step 3: Add boundary tests**

Add this exact table. `uploadWithResponse` is a 12-line local wrapper around existing `withStateRoot`, `validSnapshot`, fixed `now`, and `uploadSnapshot`; it returns `{ result, root }` only for assertions inside the callback and always uses the existing acknowledgement Content-Type.

```js
test('upload acknowledgement timestamp and byte boundaries are exact', async () => {
  const now = Date.parse('2026-07-10T00:00:00.000Z');
  for (const [collectedAt, accepted] of [
    ['2020-01-01T00:00:00.000Z', true],
    ['2026-07-10T00:10:00.000Z', true],
    ['2026-07-10T00:10:00.001Z', false],
    ['2026-07-10T00:00:00Z', false],
  ]) {
    await withStateRoot(async (root) => {
      const operation = uploadSnapshot({
        snapshot: validSnapshot(),
        ingestUrl: 'https://example.test/usage',
        ingestToken: 'secret-token',
        stateRoot: root,
        now: () => now,
        fetch: async () => acknowledgement(collectedAt),
      });
      if (accepted) assert.equal((await operation).uploaded, true);
      else await assert.rejects(operation, /acknowledgement|response/i);
    });
  }

  const json = JSON.stringify({ ok: true, collectedAt: '2026-07-10T00:00:00.000Z' });
  for (const [size, accepted] of [[4096, true], [4097, false]]) {
    const body = json + ' '.repeat(size - Buffer.byteLength(json));
    assert.equal(Buffer.byteLength(body), size);
    await withStateRoot(async (root) => {
      const operation = uploadSnapshot({
        snapshot: validSnapshot(),
        ingestUrl: 'https://example.test/usage',
        ingestToken: 'secret-token',
        stateRoot: root,
        now: () => now,
        fetch: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      });
      if (accepted) assert.equal((await operation).uploaded, true);
      else await assert.rejects(operation, /acknowledgement|response/i);
    });
  }
});
```

- [ ] **Step 4: Run focused tests and verify RED**

```powershell
node --test --test-name-pattern="exact bounded JSON upload acknowledgement" tests/collectorUpload.test.mjs
```

Expected: current `response.ok` accepts HTML/201/malformed bodies and writes success state.

### Task 5: Validate the Response Before Success-State Writes

**Files:**
- Modify: `collector/lib/uploadClient.mjs:12-45,125-209`
- Modify: `docs/ARCHITECTURE.md:5-8`
- Modify: `docs/SECURITY.md:9-13`

**Interfaces:**
- Consumes: response body stream and timeout promise.
- Produces: `validateUploadAcknowledgement(response, { now, timeoutPromise }) -> Promise<void>`.

- [ ] **Step 1: Add a bounded byte reader**

```js
const MAX_ACK_BYTES = 4096;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

async function readBoundedResponseBody(body, maxBytes, timeoutPromise) {
  if (!body?.getReader) throw new Error('Invalid upload acknowledgement');
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let completed = false;
  try {
    const bytes = await Promise.race([(async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error('bounded response exceeded');
        chunks.push(value);
      }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result;
    })(), timeoutPromise]);
    completed = true;
    return bytes;
  } catch {
    throw new Error('Invalid upload acknowledgement');
  } finally {
    if (!completed) {
      void reader.cancel().catch(() => {});
    }
  }
}
```

Add a custom `ReadableStream` timeout test whose `cancel()` increments a counter and returns a promise that never settles; assert upload rejection still settles within the outer test deadline, cancellation count is one, and no task awaits that promise. Add a stream-error case containing `SENTINEL_STREAM_URL_SECRET`; assert the fixed generic message, byte-identical last-upload, and neither rejection text nor serialized backoff contains the sentinel. The 4097-byte test asserts the same fire-and-forget cancellation behavior.

```js
test('ack timeout does not await a non-settling stream cancellation', { timeout: 2_000 }, async () => {
  await withStateRoot(async (root) => {
    const prior = validSnapshot();
    await writeFile(join(root, 'last-upload.json'), JSON.stringify(prior));
    let cancels = 0;
    const body = new ReadableStream({
      pull() { return new Promise(() => {}); },
      cancel() { cancels += 1; return new Promise(() => {}); },
    });
    const started = Date.now();
    await assert.rejects(uploadSnapshot({
      snapshot: validSnapshot(),
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      timeoutMs: 20,
      fetch: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    }), /acknowledgement|response|timed out/i);
    assert.ok(Date.now() - started < 1_000);
    assert.equal(cancels, 1);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'last-upload.json'), 'utf8')), prior);
  });
});
```

- [ ] **Step 2: Add exact acknowledgement validation**

```js
async function validateUploadAcknowledgement(response, { now, timeoutPromise }) {
  if (response.status !== 200) throw new Error('Upload rejected');
  const mediaType = (response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') throw new Error('Invalid upload acknowledgement');

  const bytes = await readBoundedResponseBody(response.body, MAX_ACK_BYTES, timeoutPromise);
  let parsed;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid upload acknowledgement');
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'collectedAt,ok'
    || parsed.ok !== true
    || typeof parsed.collectedAt !== 'string'
  ) throw new Error('Invalid upload acknowledgement');

  const timestamp = Date.parse(parsed.collectedAt);
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== parsed.collectedAt
    || timestamp - nowMilliseconds(now) > MAX_FUTURE_SKEW_MS
  ) throw new Error('Invalid upload acknowledgement');
}
```

- [ ] **Step 3: Replace `response.ok` and discarded body logic**

After fetch succeeds, call:

```js
await validateUploadAcknowledgement(response, { now, timeoutPromise });
await persistLatestUpload({ normalized, persistState, stateRoot });
await persistState('upload-backoff.json', { delayMs: 0 });
return { uploaded: true };
```

Delete lines 173-192 that accept any `response.ok` and discard the body. Keep the existing catch/backoff and timeout cleanup.

- [ ] **Step 4: Assert server response schema**

In `tests/usageIngest.test.mjs`, assert the success response has JSON Content-Type and exact keys `['collectedAt','ok']`. The server implementation already returns `Response.json({ ok: true, collectedAt })`; do not add fields.

- [ ] **Step 5: Verify and commit PR 7**

```powershell
node --test tests/collectorUpload.test.mjs tests/usageIngest.test.mjs tests/collectorClaude.test.mjs
npm.cmd test
npm.cmd run build
node --test --experimental-test-coverage
git diff --check
git add collector/lib/uploadClient.mjs tests/collectorUpload.test.mjs tests/usageIngest.test.mjs tests/collectorClaude.test.mjs docs/ARCHITECTURE.md docs/SECURITY.md
git commit -m "Require exact upload acknowledgements"
```

Expected: all failures preserve last-upload and advance only backoff. Stop before PR 7 publication.

---

## PR 8 — Installer Prerequisites and Windows Rollback

### Task 6: Enforce Node 20.9 Before Installer Mutation

**Files:**
- Modify: `collector/install-macos.sh:40-47`
- Modify: `collector/install-windows.ps1:247-260`
- Modify: `tests/collectorMacos.test.mjs`
- Modify: `tests/collectorWindows.test.mjs`

**Interfaces:**
- Consumes: resolved Node executable.
- Produces: rejection before any prompt/state change for `<20.9.0`.

- [ ] **Step 1: Add boundary tests**

Add four tests:

```text
macOS installer rejects Node 20.8 before prompting or touching state
macOS installer accepts the 20.9 boundary
Windows installer rejects Node 20.8 before prompting or touching state
Windows installer accepts the current supported Node
```

Use existing command shims. The 20.8 shims output only `v20.8.0`; rejected cases assert no settings, install root, task/LaunchAgent, Keychain adapter call, or prompt mutation.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/collectorMacos.test.mjs tests/collectorWindows.test.mjs
```

Expected: current installers check only command existence and accept 20.8.

- [ ] **Step 3: Add the macOS version predicate before ownership/prompt**

```sh
"$node_bin" -e '
const [major, minor] = process.versions.node.split(".").map(Number);
process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1);
' || fail 'Node.js 20.9 or newer is required'
```

- [ ] **Step 4: Add the Windows version predicate before backup/task work**

```powershell
$nodeVersionText = (& $nodePath --version 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$') {
    throw 'Node.js 20.9 or newer is required'
}
$nodeVersion = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
if ($nodeVersion -lt [version]'20.9.0') {
    throw 'Node.js 20.9 or newer is required'
}
```

- [ ] **Step 5: Verify and commit the prerequisite unit**

```powershell
node --test tests/collectorMacos.test.mjs tests/collectorWindows.test.mjs
git add collector/install-macos.sh collector/install-windows.ps1 tests/collectorMacos.test.mjs tests/collectorWindows.test.mjs
git commit -m "Enforce collector Node prerequisites"
```

### Task 7: Restore Exact Windows First-Install Absence

**Files:**
- Modify: `collector/install-windows.ps1:247-260,455-508`
- Modify: `tests/collectorWindows.test.mjs:488-608`
- Modify: `docs/WINDOWS-COLLECTOR.md`

**Interfaces:**
- Consumes: pre-install settings-file/directory existence and current owned status-line state.
- Produces: exact rollback or an explicit unproven-rollback failure without deleting concurrent/foreign data.

- [ ] **Step 1: Add the five rollback tests**

Refactor the existing `installer rolls back only its matching GUID task when create reports failure` harness into `runTaskFailureRollbackCase(fixture)`. Keep its current fake Task Scheduler behavior, but accept `installMode`, `initialSettings`, `settingsDirectoryExisted`, and `concurrentMutation`. Immediately before the first fake replacement `schtasks /Create` returns failure, run this exact hook:

```powershell
switch ($global:settingsMutationMode) {
    'none' {}
    'preserve-installed-status-add-theme' {
        $current = [IO.File]::ReadAllText($global:claudeSettingsPath) | ConvertFrom-Json
        if ($current.PSObject.Properties['theme']) { $current.theme = 'dark' }
        else { $current | Add-Member -NotePropertyName theme -NotePropertyValue 'dark' }
        [IO.File]::WriteAllText($global:claudeSettingsPath, ($current | ConvertTo-Json -Depth 20))
    }
    'replace-with-foreign-status' {
        $foreign = [ordered]@{
            theme = 'dark'
            statusLine = [ordered]@{ type = 'command'; command = 'node foreign-statusline.mjs' }
        }
        [IO.File]::WriteAllText($global:claudeSettingsPath, ($foreign | ConvertTo-Json -Depth 20))
    }
    default { throw 'Unknown settings mutation mode' }
}
$global:LASTEXITCODE = 1
return
```

The harness observation must return only `failure`, `settingsFileExists`, `settingsDirectoryExists`, and parsed `settings`; it must not return the token, task XML, command line, or raw file text. Drive it with this exact table and assertions:

```js
const foreign = { type: 'command', command: 'node foreign-statusline.mjs' };

for (const fixture of [
  {
    name: 'first install task failure restores a previously absent Claude settings file to absence',
    installMode: 'fresh',
    settingsDirectoryExisted: true,
    initialSettings: null,
    concurrentMutation: 'none',
    expectedFile: false,
    expectedDirectory: true,
    expectedSettings: null,
    failure: 'Unable to register collector task',
  },
  {
    name: 'first install rollback removes an installer-created empty Claude directory',
    installMode: 'fresh',
    settingsDirectoryExisted: false,
    initialSettings: null,
    concurrentMutation: 'none',
    expectedFile: false,
    expectedDirectory: false,
    expectedSettings: null,
    failure: 'Unable to register collector task',
  },
  {
    name: 'first install rollback preserves concurrent Claude fields and removes only the owned status line',
    installMode: 'fresh',
    settingsDirectoryExisted: true,
    initialSettings: null,
    concurrentMutation: 'preserve-installed-status-add-theme',
    expectedFile: true,
    expectedDirectory: true,
    expectedSettings: { theme: 'dark' },
    failure: 'Unable to register collector task',
  },
  {
    name: 'reinstall rollback restores the prior owned status line while preserving concurrent unrelated fields',
    installMode: 'reinstall',
    settingsDirectoryExisted: true,
    initialSettings: 'prior-owned-status',
    concurrentMutation: 'preserve-installed-status-add-theme',
    expectedFile: true,
    expectedDirectory: true,
    expectedTheme: 'dark',
    expectedStatusLine: 'prior-owned-status',
    failure: 'Unable to register collector task',
  },
  {
    name: 'first install rollback fails closed when the status line ownership changes concurrently',
    installMode: 'fresh',
    settingsDirectoryExisted: true,
    initialSettings: null,
    concurrentMutation: 'replace-with-foreign-status',
    expectedFile: true,
    expectedDirectory: true,
    expectedTheme: 'dark',
    expectedStatusLine: 'foreign-status',
    failure: 'Installation failed and rollback could not be proven complete',
  },
]) {
  test(fixture.name, () => {
    const result = runTaskFailureRollbackCase(fixture);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.observation?.failure, fixture.failure);
    assert.equal(result.observation?.settingsFileExists, fixture.expectedFile);
    assert.equal(result.observation?.settingsDirectoryExists, fixture.expectedDirectory);
    if (Object.hasOwn(fixture, 'expectedSettings')) {
      assert.deepEqual(result.observation?.settings ?? null, fixture.expectedSettings);
    } else {
      assert.equal(result.observation?.settings?.theme, fixture.expectedTheme);
      const expectedStatusLine = fixture.expectedStatusLine === 'prior-owned-status'
        ? result.expectedPriorStatusLine
        : foreign;
      assert.deepEqual(result.observation?.settings?.statusLine, expectedStatusLine);
    }
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-token-value/);
  });
}
```

`runTaskFailureRollbackCase` serializes the fixture inputs into PowerShell literals with the existing `psQuote`, creates the directory before execution only when requested, and exposes `$global:claudeSettingsPath` plus a mutation mode to the fake `/Create` branch. Immediately before the injected replacement failure, `preserve-installed-status-add-theme` parses the settings file after the real installer mutation, changes only `theme` to `dark`, and writes the same actual installed `statusLine`; `replace-with-foreign-status` writes `{ theme:'dark', statusLine:{ type:'command', command:'node foreign-statusline.mjs' } }`.

For `installMode:'reinstall'`, the helper must create all of the following before invoking the installer:

- the existing install root and collector entrypoint paths;
- a schema-valid previous manifest whose `installRoot`, `taskName`, `taskAction`, `statusLineCommand`, settings path, and backup path exactly match the fixture;
- an existing settings file whose status-line command exactly equals `previousManifest.statusLineCommand`, but whose complete prior object is observably different from the candidate: `{ type:'command', command:previousManifest.statusLineCommand, padding:7, fixtureMarker:'prior-owned' }`;
- a fake existing Task Scheduler XML action exactly matching `previousManifest.taskAction`.

Before invoking the installer, deep-clone that complete prior status-line object from the initial fixture JSON into `expectedPriorStatusLine`; never reconstruct it from the candidate or from post-mutation state. The fake scheduler tracks `/Create` calls. The first replacement `/Create` applies the requested concurrent settings mutation, installs the candidate task XML in fake state, returns exit 1, and triggers rollback. The later rollback `/Create /F` accepts only the byte-equivalent saved previous task XML, restores it in fake state, and returns exit 0. Any other `/Create` order fails the harness. The JavaScript assertion deep-compares the restored complete object, including `padding:7` and `fixtureMarker:'prior-owned'`; a missing rollback would leave the candidate `padding:0` object and fail. Fresh-install fixtures retain the existing query/end/delete failure behavior.

- [ ] **Step 2: Run the focused Windows tests and verify RED**

```powershell
node --test --test-name-pattern="first install rollback|task failure restores" tests/collectorWindows.test.mjs
```

Expected: current rollback writes `{}` when the file was originally absent and does not restore an installer-created empty `.claude` directory to absence.

- [ ] **Step 3: Capture exact pre-install existence**

Before mutation:

```powershell
$ClaudeSettingsRoot = Split-Path -Parent $ClaudeSettingsPath
$settingsDirectoryExisted = Test-Path -LiteralPath $ClaudeSettingsRoot -PathType Container
$settingsExisted = Test-Path -LiteralPath $ClaudeSettingsPath -PathType Leaf
$settingsRollbackFailed = $false
$settingsMutationStarted = $false
$originalSettings = $null
if ($settingsExisted) {
    $originalSettingsJson = [IO.File]::ReadAllText($ClaudeSettingsPath)
    $settings = $originalSettingsJson | ConvertFrom-Json
    $originalSettings = $originalSettingsJson | ConvertFrom-Json
}
```

The two `ConvertFrom-Json` calls create independent object graphs. Never assign `$originalSettings = $settings`; later status-line mutation must not alter the rollback snapshot.

- [ ] **Step 4: Use one ownership-aware three-way rollback for absent and existing files**

```powershell
if ($settingsMutationStarted) {
    try {
        if (-not (Test-Path -LiteralPath $ClaudeSettingsPath -PathType Leaf)) {
            throw 'Claude settings disappeared during rollback'
        }
        $current = [IO.File]::ReadAllText($ClaudeSettingsPath) | ConvertFrom-Json
        $statusProperty = $current.PSObject.Properties['statusLine']
        $owned = $statusProperty -and
            [StringComparer]::OrdinalIgnoreCase.Equals(
                [string]$current.statusLine.command,
                $statusLineCommand
            )
        if (-not $owned) { throw 'Claude settings ownership changed during rollback' }

        if ($settingsExisted) {
            $priorStatus = $originalSettings.PSObject.Properties['statusLine']
            if ($priorStatus) {
                $current.statusLine = $originalSettings.statusLine
            }
            else {
                $current.PSObject.Properties.Remove('statusLine')
            }
            Write-JsonAtomic -Path $ClaudeSettingsPath -Value $current
        }
        else {
            $current.PSObject.Properties.Remove('statusLine')
            if (@($current.PSObject.Properties).Count -eq 0) {
            Remove-Item -LiteralPath $ClaudeSettingsPath -Force
            }
            else {
                Write-JsonAtomic -Path $ClaudeSettingsPath -Value $current
            }
        }

        if (-not $settingsDirectoryExisted -and
            (Test-Path -LiteralPath $ClaudeSettingsRoot -PathType Container) -and
            -not (Get-ChildItem -LiteralPath $ClaudeSettingsRoot -Force)) {
            Remove-Item -LiteralPath $ClaudeSettingsRoot
        }
    }
    catch {
        $settingsRollbackFailed = $true
    }
}
```

Capture `$originalSettings` before mutation when the file exists and set `$settingsMutationStarted=$true` immediately before the first atomic settings write. A concurrent unrelated addition/update/deletion survives because rollback edits only `statusLine`. A prior owned status line is restored from `$originalSettings`. If the current file is missing/invalid or its status line is foreign, the current state is untouched and rollback is reported unproven.

- [ ] **Step 5: Raise an explicit rollback failure**

Before rethrowing the original installation error:

```powershell
if ($taskRollbackFailed -or $settingsRollbackFailed) {
    throw 'Installation failed and rollback could not be proven complete'
}
throw
```

- [ ] **Step 6: Verify and commit the rollback unit**

```powershell
node --test tests/collectorWindows.test.mjs tests/collectorMacos.test.mjs
npm.cmd test
npm.cmd run build
git diff --check
git add collector/install-windows.ps1 tests/collectorWindows.test.mjs docs/WINDOWS-COLLECTOR.md
git commit -m "Restore Windows installer state on failure"
```

Expected: exact absence/preservation cases pass; existing GUID/task ownership tests remain green.

### Task 8: Verify and Review PR 8

**Files:**
- PR 8 files only.

**Interfaces:**
- Consumes: Node-gate and Windows-rollback commits.
- Produces: reviewable PR 8 with no scheduler/Keychain feature expansion.

- [ ] **Step 1: Run the full platform gate**

```powershell
npm.cmd test
npm.cmd run build
node --test --experimental-test-coverage
& "$env:ProgramFiles\Git\bin\bash.exe" -n collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
```

Expected: all tests/build/syntax pass; diff contains only prerequisite/rollback files. Stop for user review before push/PR/merge.

## Platform Rollback Notes

- Before reverting PR 6, stop the owned Task Scheduler task/LaunchAgent and wait for the one-shot collector to exit; do not run old canonical-lock and new claim-directory collectors concurrently.
- PR 7 rollback reopens false-success acknowledgement behavior and is allowed only as a temporary code revert to a known compatible endpoint, never as the default fix.
- PR 8 rollback does not alter existing installations but removes protection for future failed installs; keep its runbook warning aligned.
