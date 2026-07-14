import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceConfigHandler } from '../app/api/device-config/deviceConfigHandler.mjs';

function storedConfig(overrides = {}) {
  return {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 720,
    providers: {
      claude: { visible: true, imageDataUrl: 'data:image/png;base64,private-claude-artwork' },
      openai: { visible: false, imageDataUrl: 'data:image/png;base64,private-openai-artwork' },
      gemini: { visible: true },
    },
    updatedAt: '2026-07-12T10:00:00.000Z',
    ...overrides,
  };
}

test('view authorization runs before dashboard config reads', async () => {
  let reads = 0;
  const handler = createDeviceConfigHandler({
    env: { DASHBOARD_VIEW_TOKEN: 'fixture-view-token' },
    readDashboardConfig: async () => {
      reads += 1;
      throw new Error('config storage must not be reached');
    },
  });

  const response = await handler(
    new Request('https://dashboard.test/api/device-config?profile=dp75sdi&key=wrong'),
  );

  assert.equal(response.status, 401);
  assert.equal(reads, 0);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
});

test('device config fails closed without a view token or under fixture mode', async () => {
  for (const env of [
    {},
    { DASHBOARD_PUBLIC_FIXTURE: 'true', NODE_ENV: 'test' },
  ]) {
    let reads = 0;
    const handler = createDeviceConfigHandler({
      env,
      readDashboardConfig: async () => { reads += 1; return storedConfig(); },
    });
    const response = await handler(new Request('https://dashboard.test/api/device-config'));
    assert.equal(response.status, 503);
    assert.equal(reads, 0);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
});

test('resolves the requested profile before reading its normalized config', async () => {
  const profiles = [];
  const handler = createDeviceConfigHandler({
    env: {},
    readDashboardConfig: async (profile) => {
      profiles.push(profile);
      return storedConfig({ profile, refreshIntervalSeconds: 300 });
    },
  });

  const response = await handler(
    new Request('https://dashboard.test/api/device-config?profile=paperwhite3&w=600&h=800'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(profiles, ['kpw3']);
  assert.equal(await response.text(), 'version=1\nrefresh_interval_seconds=300\n');
});

test('returns only version and refresh interval as cache-disabled text', async () => {
  const handler = createDeviceConfigHandler({
    env: { DASHBOARD_VIEW_TOKEN: 'fixture-view-token' },
    readDashboardConfig: async () => storedConfig(),
  });

  const response = await handler(new Request(
    'https://dashboard.test/api/device-config?profile=dp75sdi&key=fixture-view-token',
  ));
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/plain\b/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(body, 'version=1\nrefresh_interval_seconds=720\n');
  assert.doesNotMatch(body, /provider|artwork|image|claude|openai|gemini/i);
});
