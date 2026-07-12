import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDashboardConfigStore,
  readDashboardConfig,
  writeDashboardConfig,
} from '../app/api/config/dashboardConfigStore.mjs';

const FIXED_NOW = '2026-07-12T10:00:00.000Z';

test('reads a profile from its private fixed-path Blob without using cache', async () => {
  const requests = [];
  const stored = {
    refreshIntervalSeconds: 300,
    providers: {
      claude: { visible: false, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: true },
    },
  };
  const store = createDashboardConfigStore({
    token: 'test-blob-token',
    blob: {
      async get(pathname, options) {
        requests.push({ pathname, options });
        return { stream: new Response(JSON.stringify(stored)).body };
      },
    },
  });

  const config = await readDashboardConfig('dp75sdi', {
    store,
    now: () => FIXED_NOW,
  });

  assert.equal(config.refreshIntervalSeconds, 300);
  assert.equal(config.providers.claude.visible, false);
  assert.deepEqual(requests, [{
    pathname: 'dashboard-config/dp75sdi.json',
    options: {
      access: 'private',
      token: 'test-blob-token',
      useCache: false,
    },
  }]);
});

test('returns normalized profile defaults when the Blob is missing', async () => {
  const store = createDashboardConfigStore({
    token: 'test-blob-token',
    blob: { async get() { return null; } },
  });

  const config = await readDashboardConfig('dp75sdi', {
    store,
    now: () => FIXED_NOW,
  });

  assert.deepEqual(config, {
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

test('normalizes and deterministically overwrites the complete private JSON document', async () => {
  const writes = [];
  const store = createDashboardConfigStore({
    token: 'test-blob-token',
    blob: {
      async put(pathname, body, options) {
        writes.push({ pathname, body, options });
      },
    },
  });

  const saved = await writeDashboardConfig('dp75sdi', {
    refreshIntervalSeconds: 60,
    providers: {
      claude: { visible: false },
      extra: { visible: true },
    },
    ignored: 'not-persisted',
  }, {
    store,
    now: () => FIXED_NOW,
  });

  assert.deepEqual(JSON.parse(writes[0].body), saved);
  assert.equal('ignored' in saved, false);
  assert.deepEqual(writes, [{
    pathname: 'dashboard-config/dp75sdi.json',
    body: JSON.stringify(saved),
    options: {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token: 'test-blob-token',
    },
  }]);
});

test('rejects writes before Blob access when the Blob token is missing', async () => {
  let puts = 0;
  const store = createDashboardConfigStore({
    token: undefined,
    blob: { async put() { puts += 1; } },
  });

  await assert.rejects(
    writeDashboardConfig('dp75sdi', {}, { store, now: () => FIXED_NOW }),
    /Blob storage is not configured/,
  );
  assert.equal(puts, 0);
});
