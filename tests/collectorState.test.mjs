import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonState, statePath, stateRoot, writeJsonStateAtomic } from '../collector/lib/localState.mjs';
import { withCollectorLock } from '../collector/lib/collectorLock.mjs';

test('collector publishes a claim only after a synced private temp is complete', () => {
  const source = readFileSync(new URL('../collector/lib/collectorLock.mjs', import.meta.url), 'utf8');
  const openTemporary = source.indexOf("open(temporaryClaimPath, 'wx')");
  const syncTemporary = source.indexOf('await handle.sync()', openTemporary);
  const publishClaim = source.indexOf('rename(temporaryClaimPath, claimPath)', syncTemporary);

  assert.ok(openTemporary >= 0);
  assert.ok(syncTemporary > openTemporary);
  assert.ok(publishClaim > syncTemporary);
  assert.doesNotMatch(source, /open\(claimPath, 'wx'\)/);
});

test('atomic state write leaves sanitized JSON and no temp file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-state-'));
  const prior = process.env.KINDLE_LLM_DASH_STATE_ROOT;
  process.env.KINDLE_LLM_DASH_STATE_ROOT = root;
  const name = `test-${Date.now()}.json`;
  try {
    await writeJsonStateAtomic(name, { collectedAt: '2026-07-10T00:00:00.000Z', windows: {} });
    assert.deepEqual(await readJsonState(name), { collectedAt: '2026-07-10T00:00:00.000Z', windows: {} });
    const files = await readdir(stateRoot());
    assert.equal(files.some((file) => file.includes('.tmp')), false);
  } finally {
    if (prior === undefined) delete process.env.KINDLE_LLM_DASH_STATE_ROOT; else process.env.KINDLE_LLM_DASH_STATE_ROOT = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('state names cannot escape the state root', async () => {
  assert.throws(() => statePath('../outside.json'), /Invalid state name/);
  assert.throws(() => statePath('nested/outside.json'), /Invalid state name/);
});

test('durability syncs the temporary file and containing directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-durable-'));
  const prior = process.env.KINDLE_LLM_DASH_STATE_ROOT;
  process.env.KINDLE_LLM_DASH_STATE_ROOT = root;
  const calls = [];
  const fakeHandle = () => ({ writeFile: async () => {}, sync: async () => calls.push('sync'), close: async () => calls.push('close') });
  const fakeFs = {
    mkdir: async () => {},
    open: async (path) => { calls.push(`open:${path.endsWith('.tmp') ? 'file' : 'directory'}`); return fakeHandle(); },
    rename: async () => calls.push('rename'),
    rm: async () => {},
  };
  try {
    await writeJsonStateAtomic('durability.json', { collectedAt: '2026-07-10T00:00:00.000Z', windows: {} }, { fs: fakeFs });
    assert.deepEqual(calls.filter((call) => call === 'sync'), ['sync', 'sync']);
    assert.equal(calls.includes('rename'), true);
  } finally {
    if (prior === undefined) delete process.env.KINDLE_LLM_DASH_STATE_ROOT; else process.env.KINDLE_LLM_DASH_STATE_ROOT = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('atomic state write retries transient Windows rename contention', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-rename-retry-'));
  let renameCalls = 0;
  const fakeHandle = () => ({ writeFile: async () => {}, sync: async () => {}, close: async () => {} });
  const fakeFs = {
    mkdir: async () => {},
    open: async () => fakeHandle(),
    rename: async () => {
      renameCalls += 1;
      if (renameCalls === 1) {
        const error = new Error('busy');
        error.code = 'EPERM';
        throw error;
      }
    },
    rm: async () => {},
  };
  try {
    await writeJsonStateAtomic('contention.json', { ok: true }, { fs: fakeFs, root });
    assert.equal(renameCalls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent rename contention preserves the destination and removes its temporary file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-rename-failure-'));
  const destination = join(root, 'contention.json');
  await writeFile(destination, JSON.stringify({ version: 'old' }));
  let renameCalls = 0;
  const fakeFs = {
    mkdir,
    open,
    rename: async () => {
      renameCalls += 1;
      const error = new Error('busy');
      error.code = 'EPERM';
      throw error;
    },
    rm,
  };
  try {
    await assert.rejects(
      writeJsonStateAtomic('contention.json', { version: 'new' }, { fs: fakeFs, root }),
      { code: 'EPERM' },
    );
    assert.equal(renameCalls, process.platform === 'win32' ? 5 : 1);
    assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), { version: 'old' });
    assert.equal((await readdir(root)).some((file) => file.endsWith('.tmp')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collector lock prevents overlap and removes its owned lock', { timeout: 5_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-lock-'));
  let release;
  let markStarted;
  const held = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const first = withCollectorLock({
    stateRoot: root,
    action: () => {
      markStarted();
      return held;
    },
  });

  try {
    await Promise.race([
      started,
      first.then(
        () => assert.fail('first lock completed before its action started'),
        (error) => { throw error; },
      ),
    ]);

    const second = await withCollectorLock({ stateRoot: root, action: async () => 'must-not-run' });
    assert.deepEqual(second, { skipped: true, reason: 'locked' });
    release('finished');
    assert.equal(await first, 'finished');
    assert.deepEqual(await readdir(join(root, 'collector.lock.d')), []);
  } finally {
    release('finished');
    await first.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('collector lock ignores a stale dead legacy claim without unlinking a reused path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-stale-lock-'));
  const legacyRecord = JSON.stringify({
    pid: 99999,
    createdAt: '2026-07-12T07:00:00.000Z',
  });
  await writeFile(join(root, 'collector.lock'), legacyRecord);

  const result = await withCollectorLock({
    stateRoot: root,
    now: () => Date.parse('2026-07-12T08:00:00.000Z'),
    staleAfterMs: 120000,
    isProcessAlive: async () => false,
    action: async () => 'recovered',
  });

  assert.equal(result, 'recovered');
  assert.equal(await readFile(join(root, 'collector.lock'), 'utf8'), legacyRecord);
  await rm(root, { recursive: true, force: true });
});

test('collector lock treats an expired live PID claim as active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-live-lock-'));
  const record = JSON.stringify({
    pid: process.pid,
    createdAt: '2026-07-12T07:00:00.000Z',
  });
  await writeFile(join(root, 'collector.lock'), record);
  let actionCalls = 0;

  const result = await withCollectorLock({
    stateRoot: root,
    now: () => Date.parse('2026-07-12T08:00:00.000Z'),
    staleAfterMs: 120000,
    action: async () => { actionCalls += 1; },
  });

  assert.deepEqual(result, { skipped: true, reason: 'locked' });
  assert.equal(actionCalls, 0);
  assert.equal(await readFile(join(root, 'collector.lock'), 'utf8'), record);
  await rm(root, { recursive: true, force: true });
});

test('collector lock removes only a stale unique claim and preserves a fresh claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-unique-lock-'));
  const claims = join(root, 'collector.lock.d');
  await mkdir(claims, { recursive: true });
  const stalePath = join(claims, '00000000-0000-4000-8000-000000000001.json');
  const freshPath = join(claims, '00000000-0000-4000-8000-000000000002.json');
  await writeFile(stalePath, JSON.stringify({ pid: 11111, createdAt: '2026-07-12T07:00:00.000Z' }));
  const freshRecord = JSON.stringify({ pid: 22222, createdAt: '2026-07-12T07:59:30.000Z' });
  await writeFile(freshPath, freshRecord);
  let actionCalls = 0;

  const result = await withCollectorLock({
    stateRoot: root,
    now: () => Date.parse('2026-07-12T08:00:00.000Z'),
    staleAfterMs: 120000,
    isProcessAlive: async (pid) => pid === 22222,
    action: async () => { actionCalls += 1; },
  });

  assert.deepEqual(result, { skipped: true, reason: 'locked' });
  assert.equal(actionCalls, 0);
  await assert.rejects(readFile(stalePath), { code: 'ENOENT' });
  assert.equal(await readFile(freshPath, 'utf8'), freshRecord);
  await rm(root, { recursive: true, force: true });
});

test('collector lock treats a fresh partially written lock as active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-partial-lock-'));
  await writeFile(join(root, 'collector.lock'), '{"pid":');
  let actionCalls = 0;

  const result = await withCollectorLock({
    stateRoot: root,
    now: Date.now,
    staleAfterMs: 120000,
    action: async () => { actionCalls += 1; },
  });

  assert.deepEqual(result, { skipped: true, reason: 'locked' });
  assert.equal(actionCalls, 0);
  await rm(root, { recursive: true, force: true });
});
