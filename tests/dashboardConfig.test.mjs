import assert from 'node:assert/strict';
import test from 'node:test';
import UPNG from 'upng-js';

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
const MAX_PNG_BYTES = 100 * 1024;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function padPng(bytes, targetSize) {
  const dataLength = targetSize - bytes.length - 12;
  assert.ok(dataLength >= 0, 'target PNG size must fit an ancillary chunk');

  const chunk = Buffer.alloc(dataLength + 12);
  chunk.writeUInt32BE(dataLength, 0);
  chunk.write('tEXt', 4, 'ascii');
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + dataLength)), 8 + dataLength);
  return Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]);
}

function pngBytes({ width = 104, height = 96, alpha = 255, size } = {}) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 24;
    rgba[index + 1] = 96;
    rgba[index + 2] = 160;
    rgba[index + 3] = alpha;
  }

  const bytes = Buffer.from(UPNG.encode([rgba.buffer], width, height, 0));
  return size === undefined ? bytes : padPng(bytes, size);
}

function findChunk(bytes, expectedType) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === expectedType) return { offset, length, dataOffset: offset + 8 };
    offset += length + 12;
  }
  throw new Error(`Missing ${expectedType} chunk`);
}

function truncatedPng(bytes) {
  const { dataOffset, length } = findChunk(bytes, 'IDAT');
  return bytes.subarray(0, dataOffset + Math.max(1, Math.floor(length / 2)));
}

function corruptPng(bytes) {
  const corrupted = Buffer.from(bytes);
  const { dataOffset, length } = findChunk(corrupted, 'IDAT');
  for (let index = 0; index < Math.min(length, 8); index += 1) {
    corrupted[dataOffset + index] ^= 0xff;
  }
  return corrupted;
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
  assert.throws(
    () => normalizeDashboardConfig({ providers: null }, { profile: 'dp75sdi' }),
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
  const bytes = pngBytes({ size: 1_000 });
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

test('decodes a complete PNG and rejects truncated, corrupt, or transparent artwork', () => {
  const opaque = pngBytes();
  assert.equal(validateNormalizedPngDataUrl(pngDataUrl()), pngDataUrl());

  for (const bytes of [
    truncatedPng(opaque),
    corruptPng(opaque),
    pngBytes({ alpha: 0 }),
  ]) {
    assert.throws(
      () => validateNormalizedPngDataUrl(`data:image/png;base64,${bytes.toString('base64')}`),
      /PNG/i,
    );
  }
});

test('accepts canonical padded and unpadded base64 but rejects malformed padding', () => {
  const paddedBytes = pngBytes({ size: 1_000 });
  const padded = paddedBytes.toString('base64');
  const unpadded = padded.replace(/=+$/, '');
  assert.match(padded, /==$/);
  assert.equal(validateNormalizedPngDataUrl(`data:image/png;base64,${padded}`), `data:image/png;base64,${padded}`);
  assert.equal(validateNormalizedPngDataUrl(`data:image/png;base64,${unpadded}`), `data:image/png;base64,${padded}`);

  const noPadding = pngBytes({ size: 999 }).toString('base64');
  assert.doesNotMatch(noPadding, /=/);
  for (const malformed of [
    padded.slice(0, -1),
    `${noPadding}==`,
    `${unpadded}===`,
    `${unpadded.slice(0, 8)}=${unpadded.slice(8)}`,
  ]) {
    assert.throws(
      () => validateNormalizedPngDataUrl(`data:image/png;base64,${malformed}`),
      /base64/i,
    );
  }
});

test('bounds encoded payload length before decoding', () => {
  const oversized = Buffer.alloc(MAX_PNG_BYTES + 1).toString('base64');
  assert.throws(
    () => validateNormalizedPngDataUrl(`data:image/png;base64,${oversized}`),
    /encoded length.*100 KiB/i,
  );
});

test('accepts exactly 100 KiB decoded and rejects one byte more', () => {
  assert.equal(
    validateNormalizedPngDataUrl(pngDataUrl({ size: MAX_PNG_BYTES })),
    pngDataUrl({ size: MAX_PNG_BYTES }),
  );
  assert.throws(
    () => validateNormalizedPngDataUrl(pngDataUrl({ size: MAX_PNG_BYTES + 1 })),
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
