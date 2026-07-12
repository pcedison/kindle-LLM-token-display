import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfigHandler } from '../app/api/config/configHandler.mjs';
import { createDashboardConfigStore } from '../app/api/config/dashboardConfigStore.mjs';
import {
  GET,
  PUT,
  dynamic,
  runtime,
} from '../app/api/config/route.js';

const FIXED_NOW = '2026-07-12T10:00:00.000Z';
const TOKEN_SENTINEL = 'admin-secret-sentinel';
const IMAGE_SENTINEL = 'invalid-image-sentinel';
const MAX_CONFIG_BODY_BYTES = 300 * 1024;

function makeRequest(method = 'GET', {
  authorization = `Bearer ${TOKEN_SENTINEL}`,
  profile = 'dp75sdi',
  body,
  contentLength,
} = {}) {
  const headers = new Headers();
  if (authorization !== null) headers.set('authorization', authorization);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return new Request(`https://dashboard.example/api/config?profile=${profile}`, {
    method,
    headers,
    body,
  });
}

function createDependencies(overrides = {}) {
  return {
    env: { DASHBOARD_ADMIN_TOKEN: TOKEN_SENTINEL },
    logger: { error() {} },
    now: () => FIXED_NOW,
    readDashboardConfig: async (profile) => ({
      version: 1,
      profile,
      refreshIntervalSeconds: 720,
      providers: {
        claude: { visible: true, imageDataUrl: null },
        openai: { visible: true, imageDataUrl: null },
        gemini: { visible: false },
      },
      updatedAt: FIXED_NOW,
    }),
    writeDashboardConfig: async (_profile, config) => config,
    ...overrides,
  };
}

async function assertJsonResponse(response, status, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  assert.deepEqual(await response.json(), expected);
}

test('returns no-store 503 before storage when the admin token is unconfigured', async () => {
  let storageAccesses = 0;
  const handler = createConfigHandler(createDependencies({
    env: {},
    readDashboardConfig: async () => { storageAccesses += 1; },
    writeDashboardConfig: async () => { storageAccesses += 1; },
  }));

  const getResponse = await handler(makeRequest());
  const putResponse = await handler(makeRequest('PUT', {
    body: '{}',
    contentLength: MAX_CONFIG_BODY_BYTES + 1,
  }));

  await assertJsonResponse(getResponse, 503, { error: 'Configuration unavailable' });
  await assertJsonResponse(putResponse, 503, { error: 'Configuration unavailable' });
  assert.equal(storageAccesses, 0);
});

test('returns 401 for missing or wrong Bearer authorization before profile or storage access', async () => {
  let storageAccesses = 0;
  const handler = createConfigHandler(createDependencies({
    readDashboardConfig: async () => { storageAccesses += 1; },
    writeDashboardConfig: async () => { storageAccesses += 1; },
  }));

  const missing = await handler(makeRequest('GET', {
    authorization: null,
    profile: 'not-a-profile',
  }));
  const wrong = await handler(makeRequest('PUT', {
    authorization: 'Bearer wrong-token-sentinel',
    profile: 'not-a-profile',
    body: `{"image":"${IMAGE_SENTINEL}"}`,
  }));

  await assertJsonResponse(missing, 401, { error: 'Unauthorized' });
  await assertJsonResponse(wrong, 401, { error: 'Unauthorized' });
  assert.equal(storageAccesses, 0);
});

test('rejects an oversized declared PUT body before reading or writing', async () => {
  let writes = 0;
  const handler = createConfigHandler(createDependencies({
    writeDashboardConfig: async () => { writes += 1; },
  }));
  let bodyReads = 0;
  const request = {
    method: 'PUT',
    url: 'https://dashboard.example/api/config?profile=dp75sdi',
    headers: new Headers({
      authorization: `Bearer ${TOKEN_SENTINEL}`,
      'content-length': String(MAX_CONFIG_BODY_BYTES + 1),
      'content-type': 'application/json',
    }),
    body: {
      getReader() {
        bodyReads += 1;
        throw new Error('oversized declared body must not be read');
      },
    },
  };

  const response = await handler(request);

  await assertJsonResponse(response, 413, { error: 'Payload too large' });
  assert.equal(bodyReads, 0);
  assert.equal(writes, 0);
});

test('rejects an oversized streamed PUT body without unbounded buffering', async () => {
  let writes = 0;
  const handler = createConfigHandler(createDependencies({
    writeDashboardConfig: async () => { writes += 1; },
  }));
  const request = {
    method: 'PUT',
    url: 'https://dashboard.example/api/config?profile=dp75sdi',
    headers: new Headers({
      authorization: `Bearer ${TOKEN_SENTINEL}`,
      'content-type': 'application/json',
    }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_CONFIG_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    }),
  };

  const response = await handler(request);

  await assertJsonResponse(response, 413, { error: 'Payload too large' });
  assert.equal(writes, 0);
});

test('accepts a valid PUT body at the exact encoded byte limit', async () => {
  const writes = [];
  const handler = createConfigHandler(createDependencies({
    writeDashboardConfig: async (_profile, config) => {
      writes.push(config);
      return config;
    },
  }));
  const body = `{}` + ' '.repeat(MAX_CONFIG_BODY_BYTES - 2);
  assert.equal(Buffer.byteLength(body), MAX_CONFIG_BODY_BYTES);

  const response = await handler(makeRequest('PUT', {
    body,
    contentLength: MAX_CONFIG_BODY_BYTES,
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(writes.length, 1);
});

test('wrong authorization wins before oversized PUT body inspection', async () => {
  let bodyReads = 0;
  const handler = createConfigHandler(createDependencies());
  const request = {
    method: 'PUT',
    url: 'https://dashboard.example/api/config?profile=dp75sdi',
    headers: new Headers({
      authorization: 'Bearer wrong-token-sentinel',
      'content-length': String(MAX_CONFIG_BODY_BYTES + 1),
    }),
    body: {
      getReader() {
        bodyReads += 1;
        throw new Error('unauthorized body must not be read');
      },
    },
  };

  const response = await handler(request);

  await assertJsonResponse(response, 401, { error: 'Unauthorized' });
  assert.equal(bodyReads, 0);
});

test('rejects an invalid profile before storage access', async () => {
  let storageAccesses = 0;
  let bodyReads = 0;
  const handler = createConfigHandler(createDependencies({
    readDashboardConfig: async () => { storageAccesses += 1; },
    writeDashboardConfig: async () => { storageAccesses += 1; },
  }));
  const request = {
    method: 'PUT',
    url: 'https://dashboard.example/api/config?profile=not-a-profile',
    headers: new Headers({
      authorization: `Bearer ${TOKEN_SENTINEL}`,
      'content-length': String(MAX_CONFIG_BODY_BYTES + 1),
    }),
    body: {
      getReader() {
        bodyReads += 1;
        throw new Error('invalid-profile body must not be read');
      },
    },
  };

  const response = await handler(request);

  await assertJsonResponse(response, 400, { error: 'Invalid request' });
  assert.equal(bodyReads, 0);
  assert.equal(storageAccesses, 0);
});

test('rejects malformed JSON and invalid config without writing or echoing input', async () => {
  let writes = 0;
  const handler = createConfigHandler(createDependencies({
    writeDashboardConfig: async () => { writes += 1; },
  }));

  const malformed = await handler(makeRequest('PUT', {
    body: `{"image":"${IMAGE_SENTINEL}"`,
  }));
  const invalid = await handler(makeRequest('PUT', {
    body: JSON.stringify({
      refreshIntervalSeconds: 60,
      providers: { claude: { imageDataUrl: IMAGE_SENTINEL } },
    }),
  }));

  await assertJsonResponse(malformed, 400, { error: 'Invalid request' });
  await assertJsonResponse(invalid, 400, { error: 'Invalid request' });
  assert.equal(writes, 0);
});

test('returns public defaults from an authorized GET', async () => {
  const handler = createConfigHandler(createDependencies());

  const response = await handler(makeRequest());

  await assertJsonResponse(response, 200, {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 720,
    providers: {
      claude: { visible: true, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: false },
    },
    updatedAt: FIXED_NOW,
  });
});

test('composes the handler with the real read helper for missing Blob defaults', async () => {
  const requests = [];
  const store = createDashboardConfigStore({
    token: 'test-blob-token',
    blob: {
      async get(pathname, options) {
        requests.push({ pathname, options });
        return null;
      },
    },
  });
  const handler = createConfigHandler(createDependencies({
    store,
    readDashboardConfig: null,
    writeDashboardConfig: null,
  }));

  const response = await handler(makeRequest());

  await assertJsonResponse(response, 200, {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 720,
    providers: {
      claude: { visible: true, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: false },
    },
    updatedAt: FIXED_NOW,
  });
  assert.deepEqual(requests, [{
    pathname: 'dashboard-config/dp75sdi.json',
    options: {
      access: 'private',
      token: 'test-blob-token',
      useCache: false,
    },
  }]);
});

test('maps a real helper write without a Blob token to a generic no-store 500', async () => {
  let puts = 0;
  const logs = [];
  const store = createDashboardConfigStore({
    token: null,
    blob: { async put() { puts += 1; } },
  });
  const handler = createConfigHandler(createDependencies({
    store,
    logger: { error(...args) { logs.push(args); } },
    readDashboardConfig: null,
    writeDashboardConfig: null,
  }));

  const response = await handler(makeRequest('PUT', { body: '{}' }));

  await assertJsonResponse(response, 500, { error: 'Storage unavailable' });
  assert.equal(puts, 0);
  assert.deepEqual(logs, [['dashboard_config_error', 500, 'Error']]);
});

test('normalizes an authorized PUT and returns only the saved public config', async () => {
  const writes = [];
  const handler = createConfigHandler(createDependencies({
    writeDashboardConfig: async (profile, config) => {
      writes.push({ profile, config });
      return config;
    },
  }));

  const response = await handler(makeRequest('PUT', {
    body: JSON.stringify({
      refreshIntervalSeconds: 300,
      providers: {
        claude: { visible: false, imageDataUrl: null },
        openai: { visible: true, imageDataUrl: null },
      },
      adminToken: TOKEN_SENTINEL,
      unknown: 'discard-me',
    }),
  }));

  const expected = {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 300,
    providers: {
      claude: { visible: false, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: false },
    },
    updatedAt: FIXED_NOW,
  };
  await assertJsonResponse(response, 200, expected);
  assert.deepEqual(writes, [{ profile: 'dp75sdi', config: expected }]);
  assert.equal(JSON.stringify(writes).includes(TOKEN_SENTINEL), false);
});

test('returns generic no-store 500 responses and logs no storage secrets', async () => {
  const logs = [];
  const storageError = new TypeError(`storage ${TOKEN_SENTINEL} ${IMAGE_SENTINEL}`);
  const dependencies = createDependencies({
    logger: { error(...args) { logs.push(args); } },
    readDashboardConfig: async () => { throw storageError; },
    writeDashboardConfig: async () => { throw storageError; },
  });
  const handler = createConfigHandler(dependencies);

  const getResponse = await handler(makeRequest());
  const putResponse = await handler(makeRequest('PUT', { body: '{}' }));

  await assertJsonResponse(getResponse, 500, { error: 'Storage unavailable' });
  await assertJsonResponse(putResponse, 500, { error: 'Storage unavailable' });
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(TOKEN_SENTINEL), false);
  assert.equal(serializedLogs.includes(IMAGE_SENTINEL), false);
  assert.deepEqual(logs, [
    ['dashboard_config_error', 500, 'TypeError'],
    ['dashboard_config_error', 500, 'TypeError'],
  ]);
});

test('route exports one force-dynamic Node.js handler for GET and PUT', () => {
  assert.equal(runtime, 'nodejs');
  assert.equal(dynamic, 'force-dynamic');
  assert.equal(GET, PUT);
});
