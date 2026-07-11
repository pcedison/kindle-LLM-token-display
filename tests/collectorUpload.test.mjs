import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMergedLocalSnapshot, uploadSnapshot } from '../collector/lib/uploadClient.mjs';
import { defaultConfigPath } from '../collector/lib/collectorConfig.mjs';

const validSnapshot = () => ({
  version: 1,
  collectedAt: '2026-07-10T00:00:00.000Z',
  providers: { claude: { collectedAt: '2026-07-10T00:00:00.000Z', windows: { fiveHour: { usedPercent: 1, resetsAt: 1783678200 } } } },
});

async function withStateRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'quota-upload-'));
  const prior = process.env.KINDLE_LLM_DASH_STATE_ROOT;
  process.env.KINDLE_LLM_DASH_STATE_ROOT = root;
  try {
    return await run(root);
  } finally {
    if (prior === undefined) delete process.env.KINDLE_LLM_DASH_STATE_ROOT;
    else process.env.KINDLE_LLM_DASH_STATE_ROOT = prior;
    await rm(root, { recursive: true, force: true });
  }
}

test('merges usable providers and preserves the last valid provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-upload-'));
  await writeFile(join(root, 'claude.json'), JSON.stringify({ collectedAt: '2026-07-10T00:00:00.000Z', windows: { fiveHour: { usedPercent: 10, resetsAt: 1783678200 } } }));
  const snapshot = await buildMergedLocalSnapshot({
    stateRoot: root,
    codex: { windows: { sevenDay: { usedPercent: 20, resetsAt: 1784250000 } } },
    now: () => Date.parse('2026-07-10T01:00:00.000Z'),
  });
  assert.equal(snapshot.providers.claude.windows.fiveHour.usedPercent, 10);
  assert.equal(snapshot.providers.claude.collectedAt, '2026-07-10T00:00:00.000Z');
  assert.equal(snapshot.providers.codex.windows.sevenDay.usedPercent, 20);
  assert.equal(snapshot.providers.codex.collectedAt, '2026-07-10T01:00:00.000Z');
  await rm(root, { recursive: true, force: true });
});

test('does not refresh a retained provider when its collection fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-upload-'));
  const retainedAt = '2026-07-09T00:00:00.000Z';
  const claudeAt = '2026-07-10T00:00:00.000Z';
  await writeFile(join(root, 'last-upload.json'), JSON.stringify({
    version: 1,
    collectedAt: retainedAt,
    providers: { codex: { windows: { sevenDay: { usedPercent: 20, resetsAt: 1784250000 } } } },
  }));
  await writeFile(join(root, 'claude.json'), JSON.stringify({ collectedAt: claudeAt, windows: { fiveHour: { usedPercent: 10, resetsAt: 1783678200 } } }));

  const snapshot = await buildMergedLocalSnapshot({
    stateRoot: root,
    codex: null,
    now: () => Date.parse('2026-07-11T00:00:00.000Z'),
  });

  assert.equal(snapshot.providers.codex.collectedAt, retainedAt);
  assert.equal(snapshot.providers.claude.collectedAt, claudeAt);
  assert.equal(snapshot.collectedAt, claudeAt);
  await rm(root, { recursive: true, force: true });
});

test('does not replace a retained provider with an older local spool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-upload-'));
  await writeFile(join(root, 'last-upload.json'), JSON.stringify({
    version: 1,
    collectedAt: '2026-07-10T10:00:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T10:00:00.000Z',
        windows: { fiveHour: { usedPercent: 80, resetsAt: 1783678200 } },
      },
    },
  }));
  await writeFile(join(root, 'claude.json'), JSON.stringify({
    collectedAt: '2026-07-10T09:00:00.000Z',
    windows: { fiveHour: { usedPercent: 20, resetsAt: 1783678200 } },
  }));

  const snapshot = await buildMergedLocalSnapshot({
    stateRoot: root,
    codex: null,
    now: () => Date.parse('2026-07-10T11:00:00.000Z'),
  });

  assert.equal(snapshot.providers.claude.windows.fiveHour.usedPercent, 80);
  assert.equal(snapshot.providers.claude.collectedAt, '2026-07-10T10:00:00.000Z');
  await rm(root, { recursive: true, force: true });
});

test('does not upload when neither provider is usable and rejects non-HTTPS', async () => {
  let calls = 0;
  const noOp = await uploadSnapshot({ snapshot: null, ingestUrl: 'https://example.test/usage', ingestToken: 'secret', fetch: async () => { calls += 1; } });
  assert.equal(noOp.uploaded, false);
  assert.equal(calls, 0);
  await assert.rejects(() => uploadSnapshot({ snapshot: { version: 1 }, ingestUrl: 'http://example.test/usage', ingestToken: 'secret' }), /HTTPS/);
});

test('uploads only bounded normalized JSON and never writes the token to state', async () => {
  await withStateRoot(async (root) => {
    const snapshot = { version: 1, collectedAt: '2026-07-10T00:00:00.000Z', providers: { claude: { collectedAt: '2026-07-09T23:00:00.000Z', windows: { fiveHour: { usedPercent: 1, resetsAt: 1783678200 } } } } };
    let request;
    const result = await uploadSnapshot({ snapshot, ingestUrl: 'https://example.test/usage', ingestToken: 'secret-token', stateRoot: root, fetch: async (url, options) => { request = { url, options }; return new Response('ok', { status: 200 }); } });
    assert.equal(result.uploaded, true);
    assert.equal(request.options.headers.authorization, 'Bearer secret-token');
    assert.equal(JSON.parse(request.options.body).providers.claude.windows.fiveHour.usedPercent, 1);
    assert.equal(JSON.parse(request.options.body).providers.claude.collectedAt, '2026-07-09T23:00:00.000Z');
    assert.equal(JSON.parse(request.options.body).secretToken, undefined);
    assert.equal(JSON.parse(await readFile(join(root, 'last-upload.json'), 'utf8')).providers.claude.collectedAt, '2026-07-09T23:00:00.000Z');
    assert.equal((await readFile(join(root, 'upload.lock')).catch(() => '')).toString().includes('secret-token'), false);
  });
});

test('rejects arbitrary and credential-like upload fields before request or state persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-upload-'));
  const snapshot = { version: 1, collectedAt: '2026-07-10T00:00:00.000Z', token: 'SENTINEL_TOKEN', providers: { claude: { windows: { fiveHour: { usedPercent: 1, resetsAt: 1783678200 } }, rawTranscript: 'SENTINEL_RAW' } } };
  await assert.rejects(() => uploadSnapshot({ snapshot, ingestUrl: 'https://example.test/usage', ingestToken: 'secret-token', stateRoot: root, fetch: async () => { throw new Error('must not send'); } }), /Sensitive|Invalid/);
  assert.equal((await readFile(join(root, 'last-upload.json')).catch(() => '')).toString().includes('SENTINEL'), false);
  await rm(root, { recursive: true, force: true });
});

test('keeps the abort timeout active while a response body stalls', async () => {
  await withStateRoot(async (root) => {
    const body = new ReadableStream({ pull() { return new Promise(() => {}); } });
    await assert.rejects(() => uploadSnapshot({ snapshot: validSnapshot(), ingestUrl: 'https://example.test/usage', ingestToken: 'secret-token', stateRoot: root, timeoutMs: 20, fetch: async () => new Response(body, { status: 200 }) }), /Upload failed|timed out|aborted|AbortError/);
  });
});

test('parallel uploads complete without a persistent filesystem lock', async () => {
  await withStateRoot(async (root) => {
    let requests = 0;
    const fetch = async () => {
      requests += 1;
      return new Response('ok', { status: 200 });
    };
    const options = {
      snapshot: validSnapshot(),
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      fetch,
    };

    const results = await Promise.all([uploadSnapshot(options), uploadSnapshot(options)]);

    assert.deepEqual(results, [{ uploaded: true }, { uploaded: true }]);
    assert.equal(requests, 2);
    await assert.rejects(readFile(join(root, 'upload.lock')), { code: 'ENOENT' });
  });
});

test('a delayed older upload cannot roll back last-upload state', async () => {
  await withStateRoot(async (root) => {
    let releaseOld;
    const oldMayFinish = new Promise((resolve) => { releaseOld = resolve; });
    const oldSnapshot = validSnapshot();
    const newSnapshot = {
      ...validSnapshot(),
      collectedAt: '2026-07-10T10:00:00.000Z',
      providers: {
        claude: {
          collectedAt: '2026-07-10T10:00:00.000Z',
          windows: { fiveHour: { usedPercent: 80, resetsAt: 1783678200 } },
        },
      },
    };
    const oldUpload = uploadSnapshot({
      snapshot: oldSnapshot,
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      fetch: async () => {
        await oldMayFinish;
        return new Response('ok', { status: 200 });
      },
    });
    await uploadSnapshot({
      snapshot: newSnapshot,
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      fetch: async () => new Response('ok', { status: 200 }),
    });
    releaseOld();
    await oldUpload;

    const retained = JSON.parse(await readFile(join(root, 'last-upload.json'), 'utf8'));
    assert.equal(retained.providers.claude.windows.fiveHour.usedPercent, 80);
    assert.equal(retained.providers.claude.collectedAt, '2026-07-10T10:00:00.000Z');
  });
});

test('routes successful upload state through the atomic state writer', async () => {
  await withStateRoot(async (root) => {
    const writes = [];
    await uploadSnapshot({
      snapshot: validSnapshot(),
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      writeState: async (name, value) => writes.push({ name, value }),
      fetch: async () => new Response('ok', { status: 200 }),
    });

    assert.deepEqual(writes.map(({ name }) => name), ['last-upload.json', 'upload-backoff.json']);
    assert.equal(JSON.stringify(writes).includes('secret-token'), false);
  });
});

test('default atomic upload state honors the explicit state root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-upload-explicit-'));
  const unrelatedRoot = await mkdtemp(join(tmpdir(), 'quota-upload-unrelated-'));
  const prior = process.env.KINDLE_LLM_DASH_STATE_ROOT;
  process.env.KINDLE_LLM_DASH_STATE_ROOT = unrelatedRoot;
  try {
    await uploadSnapshot({
      snapshot: validSnapshot(),
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      fetch: async () => new Response('ok', { status: 200 }),
    });

    assert.equal(JSON.parse(await readFile(join(root, 'last-upload.json'), 'utf8')).version, 1);
    await assert.rejects(readFile(join(unrelatedRoot, 'last-upload.json')), { code: 'ENOENT' });
  } finally {
    if (prior === undefined) delete process.env.KINDLE_LLM_DASH_STATE_ROOT;
    else process.env.KINDLE_LLM_DASH_STATE_ROOT = prior;
    await rm(root, { recursive: true, force: true });
    await rm(unrelatedRoot, { recursive: true, force: true });
  }
});

test('routes failed-upload backoff through the atomic state writer', async () => {
  await withStateRoot(async (root) => {
    const writes = [];
    await assert.rejects(() => uploadSnapshot({
      snapshot: validSnapshot(),
      ingestUrl: 'https://example.test/usage',
      ingestToken: 'secret-token',
      stateRoot: root,
      now: () => Date.parse('2026-07-10T00:00:00.000Z'),
      writeState: async (name, value) => writes.push({ name, value }),
      fetch: async () => { throw new Error('SENTINEL_PAYLOAD'); },
    }), (error) => error.message === 'Upload failed');

    assert.deepEqual(writes.map(({ name }) => name), ['upload-backoff.json']);
    assert.equal(writes[0].value.nextAttemptAt, Date.parse('2026-07-10T00:05:00.000Z'));
    assert.equal(JSON.stringify(writes).includes('SENTINEL_PAYLOAD'), false);
    assert.equal(JSON.stringify(writes).includes('secret-token'), false);
  });
});

test('uses a safe per-user default config location', () => {
  assert.match(defaultConfigPath(), /KindleLLMDashboard/);
});
