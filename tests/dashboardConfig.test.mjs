import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_REFRESH_INTERVALS,
  normalizeDashboardConfig,
  publicDashboardConfig,
  validateNormalizedPngDataUrl,
} from '../app/api/config/dashboardConfig.mjs';

const EXPECTED_INTERVALS = Object.freeze([
  10, 20, 30, 40, 50, 60, 120, 180, 240, 300,
  360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
]);
const FIXED_NOW = '2026-07-12T12:00:00.000Z';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngBytes({ width = 104, height = 96, size = 33 } = {}) {
  const bytes = Buffer.alloc(size);
  PNG_SIGNATURE.copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function pngDataUrl(options) {
  return `data:image/png;base64,${pngBytes(options).toString('base64')}`;
}

test('exports the exact frozen refresh allowlist and accepts every value', () => {
  assert.deepEqual(ALLOWED_REFRESH_INTERVALS, EXPECTED_INTERVALS);
  assert.equal(Object.isFrozen(ALLOWED_REFRESH_INTERVALS), true);

  for (const refreshIntervalSeconds of EXPECTED_INTERVALS) {
    const config = normalizeDashboardConfig(
      { refreshIntervalSeconds },
      { profile: 'dp75sdi', now: () => FIXED_NOW },
    );
    assert.equal(config.refreshIntervalSeconds, refreshIntervalSeconds);
  }
});

test('uses stable defaults and constructs a new allowlisted object', () => {
  const input = {
    version: 99,
    profile: 'voyage',
    secret: 'discard-me',
    providers: {
      claude: { visible: false, imageDataUrl: null, token: 'discard-me' },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: true, imageDataUrl: 'discard-me', extra: true },
      unknown: { visible: true },
    },
  };

  const config = normalizeDashboardConfig(input, {
    profile: 'dp75sdi',
    now: () => FIXED_NOW,
  });

  assert.deepEqual(config, {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 720,
    providers: {
      claude: { visible: false, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: true },
    },
    updatedAt: FIXED_NOW,
  });
  assert.notEqual(config, input);
  assert.notEqual(config.providers, input.providers);
});

test('accepts only supported profiles and boolean provider visibility', () => {
  for (const profile of ['dp75sdi', 'kpw3', 'voyage', 'basic']) {
    assert.equal(normalizeDashboardConfig({}, { profile }).profile, profile);
  }

  assert.throws(() => normalizeDashboardConfig({}, { profile: 'paperwhite' }), /profile/i);
  assert.throws(
    () => normalizeDashboardConfig({ providers: { claude: { visible: 'true' } } }, { profile: 'dp75sdi' }),
    /visible/i,
  );
  assert.throws(
    () => normalizeDashboardConfig({ providers: { openai: null } }, { profile: 'dp75sdi' }),
    /provider/i,
  );
  assert.throws(
    () => normalizeDashboardConfig({ providers: [] }, { profile: 'dp75sdi' }),
    /providers/i,
  );
});

test('defaults missing providers while preserving independent null images', () => {
  const config = normalizeDashboardConfig(
    { providers: { claude: { imageDataUrl: null } } },
    { profile: 'basic', now: () => FIXED_NOW },
  );

  assert.deepEqual(config.providers, {
    claude: { visible: true, imageDataUrl: null },
    openai: { visible: true, imageDataUrl: null },
    gemini: { visible: false },
  });
});

test('rejects refresh values outside the exact integer allowlist', () => {
  for (const refreshIntervalSeconds of [59, 61, 901, '60', '60; reboot', null]) {
    assert.throws(
      () => normalizeDashboardConfig({ refreshIntervalSeconds }, { profile: 'dp75sdi' }),
      /refresh interval/i,
    );
  }
});

test('validates and canonicalizes exact 104 by 96 PNG data URLs', () => {
  const bytes = pngBytes({ size: 34 });
  const unpadded = bytes.toString('base64').replace(/=+$/, '');
  const canonical = `data:image/png;base64,${bytes.toString('base64')}`;

  assert.equal(validateNormalizedPngDataUrl(`data:image/png;base64,${unpadded}`), canonical);

  const config = normalizeDashboardConfig({
    providers: {
      claude: { imageDataUrl: `data:image/png;base64,${unpadded}` },
      openai: { imageDataUrl: pngDataUrl() },
    },
  }, { profile: 'dp75sdi', now: () => FIXED_NOW });
  assert.equal(config.providers.claude.imageDataUrl, canonical);
  assert.equal(config.providers.openai.imageDataUrl, pngDataUrl());
});

test('rejects non-PNG data URLs, malformed PNG headers, and wrong IHDR dimensions', () => {
  const badSignature = pngBytes();
  badSignature[0] = 0;
  const badChunk = pngBytes();
  badChunk.write('IDAT', 12, 'ascii');

  for (const value of [
    'https://example.test/art.png',
    `data:image/jpeg;base64,${pngBytes().toString('base64')}`,
    'data:image/png,not-base64',
    'data:image/png;base64,%%%%',
    `data:image/png;base64,${badSignature.toString('base64')}`,
    `data:image/png;base64,${badChunk.toString('base64')}`,
    pngDataUrl({ width: 103 }),
    pngDataUrl({ height: 95 }),
  ]) {
    assert.throws(() => validateNormalizedPngDataUrl(value), /PNG/i);
  }
});

test('accepts exactly 100 KiB decoded and rejects one byte more', () => {
  assert.equal(
    validateNormalizedPngDataUrl(pngDataUrl({ size: 100 * 1024 })),
    pngDataUrl({ size: 100 * 1024 }),
  );
  assert.throws(
    () => validateNormalizedPngDataUrl(pngDataUrl({ size: (100 * 1024) + 1 })),
    /100 KiB/i,
  );
});

test('public config reconstructs the documented fields without retaining references', () => {
  const imageDataUrl = pngDataUrl();
  const source = {
    version: 1,
    profile: 'kpw3',
    refreshIntervalSeconds: 300,
    providers: {
      claude: { visible: true, imageDataUrl, privateField: 'discard-me' },
      openai: { visible: false, imageDataUrl: null },
      gemini: { visible: true, privateField: 'discard-me' },
      unknown: { visible: true },
    },
    updatedAt: FIXED_NOW,
    storageMetadata: 'discard-me',
  };

  const result = publicDashboardConfig(source);
  assert.deepEqual(result, {
    version: 1,
    profile: 'kpw3',
    refreshIntervalSeconds: 300,
    providers: {
      claude: { visible: true, imageDataUrl },
      openai: { visible: false, imageDataUrl: null },
      gemini: { visible: true },
    },
    updatedAt: FIXED_NOW,
  });
  assert.notEqual(result, source);
  assert.notEqual(result.providers.claude, source.providers.claude);
});
