import assert from 'node:assert/strict';
import test from 'node:test';

import { handleUsageIngest } from '../app/api/usage/route.js';

const validSnapshot = {
  version: 1,
  collectedAt: '2026-07-10T09:30:00.000Z',
  providers: {
    claude: { windows: { fiveHour: { usedPercent: 17, resetsAt: 1783678020 } } },
  },
};

function makeRequest(body, { authorization = 'Bearer ingest-secret', contentLength } = {}) {
  const headers = new Headers({
    authorization,
    'content-type': 'application/json',
  });
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  }
  return new Request('https://dashboard.example/api/usage', { method: 'POST', headers, body });
}

function createDependencies(overrides = {}) {
  return {
    env: { DASHBOARD_INGEST_TOKEN: 'ingest-secret' },
    writeMergedQuotaSnapshot: async (snapshot) => snapshot,
    logger: { error() {} },
    now: () => Date.parse('2026-07-10T09:30:00.000Z'),
    ...overrides,
  };
}

test('rejects an unauthorized ingest without writing or logging credentials', async () => {
  let writes = 0;
  const logs = [];
  const response = await handleUsageIngest(
    makeRequest(JSON.stringify(validSnapshot), { authorization: 'Bearer wrong-secret' }),
    createDependencies({
      writeMergedQuotaSnapshot: async () => { writes += 1; },
      logger: { error(...args) { logs.push(args); } },
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(writes, 0);
  assert.equal(await response.text(), 'Unauthorized');
  assert.deepEqual(logs, []);
});

test('rejects a declared body larger than 8192 bytes before reading it', async () => {
  let writes = 0;
  const response = await handleUsageIngest(
    makeRequest(JSON.stringify(validSnapshot), { contentLength: 8193 }),
    createDependencies({ writeMergedQuotaSnapshot: async () => { writes += 1; } }),
  );

  assert.equal(response.status, 413);
  assert.equal(writes, 0);
  assert.equal(await response.text(), 'Payload Too Large');
});

test('accepts a valid body of exactly 8192 bytes', async () => {
  const json = JSON.stringify(validSnapshot);
  const body = json + ' '.repeat(8192 - Buffer.byteLength(json));
  const writes = [];
  assert.equal(Buffer.byteLength(body), 8192);

  const response = await handleUsageIngest(
    makeRequest(body, { contentLength: 8192 }),
    createDependencies({ writeMergedQuotaSnapshot: async (snapshot) => {
      writes.push(snapshot);
      return snapshot;
    } }),
  );

  assert.equal(response.status, 200);
  assert.equal(writes.length, 1);
});

test('rejects an actual body larger than 8192 bytes', async () => {
  const response = await handleUsageIngest(
    makeRequest(' '.repeat(8193)),
    createDependencies(),
  );

  assert.equal(response.status, 413);
  assert.equal(await response.text(), 'Payload Too Large');
});

test('stops reading a streamed body as soon as it exceeds 8192 bytes', async () => {
  const request = {
    headers: new Headers({ authorization: 'Bearer ingest-secret' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4096));
        controller.enqueue(new Uint8Array(4097));
        controller.close();
      },
    }),
    async arrayBuffer() {
      throw new Error('must not buffer the whole request');
    },
  };

  const response = await handleUsageIngest(request, createDependencies());

  assert.equal(response.status, 413);
  assert.equal(await response.text(), 'Payload Too Large');
});

test('rejects invalid JSON and invalid snapshot data without leaking the payload', async () => {
  const logs = [];
  const invalidJson = await handleUsageIngest(
    makeRequest('{"provider":"secret-value"'),
    createDependencies({ logger: { error(...args) { logs.push(args); } } }),
  );
  const invalidSnapshot = await handleUsageIngest(
    makeRequest(JSON.stringify({ ...validSnapshot, apiKey: 'secret-value' })),
    createDependencies({ logger: { error(...args) { logs.push(args); } } }),
  );

  assert.equal(invalidJson.status, 400);
  assert.equal(invalidSnapshot.status, 400);
  assert.equal(await invalidJson.text(), 'Invalid request');
  assert.equal(await invalidSnapshot.text(), 'Invalid request');
  assert.equal(JSON.stringify(logs).includes('secret-value'), false);
});

test('returns a credential-free 503 when storage fails', async () => {
  const logs = [];
  const response = await handleUsageIngest(
    makeRequest(JSON.stringify(validSnapshot)),
    createDependencies({
      writeMergedQuotaSnapshot: async () => { throw new TypeError('storage unavailable'); },
      logger: { error(...args) { logs.push(args); } },
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Storage unavailable');
  assert.deepEqual(logs, [['usage_ingest_error', 503, 'TypeError']]);
});

test('writes a valid normalized snapshot and returns its collection timestamp only', async () => {
  const writes = [];
  const response = await handleUsageIngest(
    makeRequest(JSON.stringify(validSnapshot)),
    createDependencies({ writeMergedQuotaSnapshot: async (snapshot) => {
      writes.push(snapshot);
      return snapshot;
    } }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  assert.deepEqual(await response.json(), {
    ok: true,
    collectedAt: '2026-07-10T09:30:00.000Z',
  });
  assert.deepEqual(writes, [{
    ...validSnapshot,
    version: 2,
    providers: {
      claude: {
        collectedAt: validSnapshot.collectedAt,
        windows: {
          fiveHour: {
            ...validSnapshot.providers.claude.windows.fiveHour,
            collectedAt: validSnapshot.collectedAt,
          },
        },
      },
    },
  }]);
});

test('rejects collection timestamps over ten minutes in the future', async () => {
  const makeSnapshot = (collectedAt) => ({
    version: 2,
    collectedAt,
    providers: {
      claude: {
        windows: {
          fiveHour: { usedPercent: 17, resetsAt: 1783678020, collectedAt },
        },
      },
    },
  });
  const now = () => Date.parse('2026-07-12T08:00:00.000Z');

  const rejected = await handleUsageIngest(
    makeRequest(JSON.stringify(makeSnapshot('2026-07-12T08:10:01.000Z'))),
    createDependencies({ now }),
  );
  const accepted = await handleUsageIngest(
    makeRequest(JSON.stringify(makeSnapshot('2026-07-12T08:10:00.000Z'))),
    createDependencies({ now }),
  );

  assert.equal(rejected.status, 400);
  assert.equal(accepted.status, 200);
});
