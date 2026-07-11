import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonState, statePath, stateRoot, writeJsonStateAtomic } from '../collector/lib/localState.mjs';

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

test('atomic state write retries transient Windows rename contention', async () => {
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
