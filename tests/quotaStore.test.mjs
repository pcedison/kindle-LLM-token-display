import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QuotaStoreConflictError,
  createBlobQuotaStore,
  readQuotaSnapshot,
  writeMergedQuotaSnapshot,
} from '../app/api/dashboard/quotaStore.mjs';

const existingSnapshot = {
  version: 1,
  collectedAt: '2026-07-10T09:00:00.000Z',
  providers: {
    codex: { windows: { fiveHour: { usedPercent: 19, resetsAt: 1783678020 } } },
  },
};

const incomingClaudeOnly = {
  version: 1,
  collectedAt: '2026-07-10T09:30:00.000Z',
  providers: {
    claude: { windows: { sevenDay: { usedPercent: 21, resetsAt: 1784250000 } } },
  },
};

function createMemoryQuotaStore(initialSnapshot = null) {
  let snapshot = initialSnapshot;
  return {
    async read() {
      return snapshot;
    },
    async write(nextSnapshot) {
      snapshot = nextSnapshot;
    },
  };
}

test('returns null without Blob configuration', async () => {
  const store = createBlobQuotaStore({ token: undefined, blob: {} });
  assert.equal(await store.read(), null);
});

test('reads and normalizes the private Blob snapshot through an injected Blob client', async () => {
  const requests = [];
  const store = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get(pathname, options) {
        requests.push({ pathname, options });
        return {
          statusCode: 200,
          stream: new Response(JSON.stringify(existingSnapshot)).body,
          blob: { etag: 'etag-existing' },
        };
      },
    },
  });

  const snapshot = await readQuotaSnapshot({ store });

  assert.deepEqual(snapshot, {
    ...existingSnapshot,
    providers: {
      codex: {
        collectedAt: existingSnapshot.collectedAt,
        windows: existingSnapshot.providers.codex.windows,
      },
    },
  });
  assert.deepEqual(requests, [{
    pathname: 'usage/latest.json',
    options: { access: 'private', token: 'test-blob-token', useCache: false },
  }]);
});

test('returns null when the private Blob object is absent or invalid', async () => {
  const absent = createBlobQuotaStore({ token: 'test-blob-token', blob: { async get() { return null; } } });
  const invalid = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get() {
        return {
          statusCode: 200,
          stream: new Response('{"version":2}').body,
          blob: { etag: 'etag-invalid' },
        };
      },
    },
  });

  assert.equal(await readQuotaSnapshot({ store: absent }), null);
  assert.equal(await readQuotaSnapshot({ store: invalid }), null);
});

test('merges a partial provider update without erasing the other provider', async () => {
  const writes = [];
  const store = {
    ...createMemoryQuotaStore(existingSnapshot),
    async write(snapshot) {
      writes.push(snapshot);
    },
  };

  const merged = await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });

  assert.ok(merged.providers.codex.windows.fiveHour);
  assert.deepEqual(writes, [merged]);
});

test('writes the merged snapshot privately with a stable pathname through an injected Blob client', async () => {
  const writes = [];
  const store = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get() {
        return {
          statusCode: 200,
          stream: new Response(JSON.stringify(existingSnapshot)).body,
          blob: { etag: 'etag-existing' },
        };
      },
      async put(pathname, body, options) {
        writes.push({ pathname, body, options });
      },
    },
  });

  const merged = await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });

  assert.deepEqual(JSON.parse(writes[0].body), merged);
  assert.deepEqual(writes[0], {
    pathname: 'usage/latest.json',
    body: JSON.stringify(merged),
    options: {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      ifMatch: 'etag-existing',
      token: 'test-blob-token',
    },
  });
});

test('retries an ETag conflict and merges against the concurrent winner', async () => {
  const concurrentSnapshot = {
    version: 1,
    collectedAt: '2026-07-10T09:20:00.000Z',
    providers: {
      codex: {
        windows: {
          ...existingSnapshot.providers.codex.windows,
          sevenDay: { usedPercent: 7, resetsAt: 1783679000 },
        },
      },
    },
  };
  const reads = [
    { snapshot: existingSnapshot, etag: 'etag-1' },
    { snapshot: concurrentSnapshot, etag: 'etag-2' },
  ];
  const writes = [];
  const store = {
    async readVersioned() {
      return reads.shift();
    },
    async writeVersioned(snapshot, version) {
      writes.push({ snapshot, version });
      if (writes.length === 1) {
        throw new QuotaStoreConflictError();
      }
    },
  };

  const merged = await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });

  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(({ version }) => version.etag), ['etag-1', 'etag-2']);
  assert.ok(merged.providers.codex.windows.sevenDay);
  assert.ok(merged.providers.claude);
});

test('an ETag retry cannot replace a newer provider with a delayed snapshot', async () => {
  const initial = {
    version: 1,
    collectedAt: '2026-07-10T08:00:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T08:00:00.000Z',
        windows: { fiveHour: { usedPercent: 10, resetsAt: 1783678200 } },
      },
    },
  };
  const delayed = {
    version: 1,
    collectedAt: '2026-07-10T09:00:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T09:00:00.000Z',
        windows: { fiveHour: { usedPercent: 20, resetsAt: 1783678200 } },
      },
    },
  };
  const concurrentWinner = {
    version: 1,
    collectedAt: '2026-07-10T10:00:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T10:00:00.000Z',
        windows: { fiveHour: { usedPercent: 80, resetsAt: 1783678200 } },
      },
    },
  };
  const reads = [
    { snapshot: initial, etag: 'etag-initial' },
    { snapshot: concurrentWinner, etag: 'etag-winner' },
  ];
  const writes = [];
  const store = {
    async readVersioned() {
      return reads.shift();
    },
    async writeVersioned(snapshot, version) {
      writes.push({ snapshot, version });
      if (writes.length === 1) throw new QuotaStoreConflictError();
    },
  };

  const merged = await writeMergedQuotaSnapshot(delayed, { store });

  assert.equal(writes.length, 2);
  assert.equal(merged.providers.claude.windows.fiveHour.usedPercent, 80);
  assert.equal(merged.providers.claude.collectedAt, '2026-07-10T10:00:00.000Z');
  assert.equal(merged.collectedAt, '2026-07-10T10:00:00.000Z');
});

test('creates an absent blob without allowing an overwrite', async () => {
  const writes = [];
  const store = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get() {
        return null;
      },
      async put(pathname, body, options) {
        writes.push({ pathname, body, options });
      },
    },
  });

  await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.allowOverwrite, false);
  assert.equal('ifMatch' in writes[0].options, false);
});

test('retries a generic Blob already-exists error from a concurrent first create', async () => {
  const reads = [null, { snapshot: existingSnapshot, etag: 'etag-created' }];
  const putOptions = [];
  const store = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get() {
        const next = reads.shift();
        return next && {
          statusCode: 200,
          stream: new Response(JSON.stringify(next.snapshot)).body,
          blob: { etag: next.etag },
        };
      },
      async put(pathname, body, options) {
        putOptions.push(options);
        if (putOptions.length === 1) {
          const error = new Error('redacted');
          error.name = 'BlobAlreadyExistsError';
          throw error;
        }
      },
    },
  });

  const merged = await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });

  assert.equal(putOptions[0].allowOverwrite, false);
  assert.equal(putOptions[1].ifMatch, 'etag-created');
  assert.ok(merged.providers.codex);
  assert.ok(merged.providers.claude);
});

test('does not misclassify Blob access failures as concurrent first creates', async () => {
  const accessError = new Error('redacted');
  accessError.name = 'BlobAccessError';
  let writes = 0;
  const store = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get() {
        return null;
      },
      async put() {
        writes += 1;
        throw accessError;
      },
    },
  });

  await assert.rejects(
    writeMergedQuotaSnapshot(incomingClaudeOnly, { store }),
    (error) => error === accessError,
  );
  assert.equal(writes, 1);
});

test('maps Blob precondition failures to a fresh read and conditional retry', async () => {
  const reads = [
    { snapshot: existingSnapshot, etag: 'etag-before' },
    {
      snapshot: {
        ...existingSnapshot,
        providers: {
          codex: {
            windows: {
              ...existingSnapshot.providers.codex.windows,
              sevenDay: { usedPercent: 11, resetsAt: 1784250000 },
            },
          },
        },
      },
      etag: 'etag-after',
    },
  ];
  const putOptions = [];
  const store = createBlobQuotaStore({
    token: 'test-blob-token',
    blob: {
      async get(pathname, options) {
        const next = reads.shift();
        assert.equal(options.useCache, false);
        return {
          statusCode: 200,
          stream: new Response(JSON.stringify(next.snapshot)).body,
          blob: { etag: next.etag },
        };
      },
      async put(pathname, body, options) {
        putOptions.push(options);
        if (putOptions.length === 1) {
          const error = new Error('redacted');
          error.name = 'BlobPreconditionFailedError';
          throw error;
        }
      },
    },
  });

  const merged = await writeMergedQuotaSnapshot(incomingClaudeOnly, { store });

  assert.deepEqual(putOptions.map(({ ifMatch }) => ifMatch), ['etag-before', 'etag-after']);
  assert.ok(merged.providers.codex.windows.sevenDay);
  assert.ok(merged.providers.claude.windows.sevenDay);
});
