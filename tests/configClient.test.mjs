import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagedUrls,
  calculateContainRect,
  formatRefreshOption,
  normalizeArtworkFile,
  validateUploadFile,
} from '../app/configClient.mjs';

const FIVE_MIB = 5 * 1024 * 1024;

test('calculates centered contain rectangles for common aspect ratios', () => {
  assert.deepEqual(calculateContainRect(200, 100), {
    x: 0,
    y: 22,
    width: 104,
    height: 52,
  });
  assert.deepEqual(calculateContainRect(100, 200), {
    x: 28,
    y: 0,
    width: 48,
    height: 96,
  });
  assert.deepEqual(calculateContainRect(100, 100), {
    x: 4,
    y: 0,
    width: 96,
    height: 96,
  });
  assert.deepEqual(calculateContainRect(104, 96), {
    x: 0,
    y: 0,
    width: 104,
    height: 96,
  });
});

test('rejects invalid contain dimensions', () => {
  for (const dimensions of [[0, 10], [10, 0], [-1, 10], [10, Number.NaN]]) {
    assert.throws(
      () => calculateContainRect(...dimensions),
      /dimensions/i,
    );
  }
});

test('accepts only PNG, JPEG, and WebP uploads through the exact 5 MiB boundary', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    const file = { type, size: FIVE_MIB };
    assert.equal(validateUploadFile(file), file);
  }

  assert.throws(
    () => validateUploadFile({ type: 'image/svg+xml', size: 1024 }),
    /PNG, JPEG, or WebP/i,
  );
  assert.throws(
    () => validateUploadFile({ type: 'image/png', size: FIVE_MIB + 1 }),
    /5 MiB/i,
  );
});

test('formats exact refresh labels with clear power guidance', () => {
  assert.equal(formatRefreshOption(10), '10 秒（高耗電測試）');
  assert.equal(formatRefreshOption(50), '50 秒（高耗電測試）');
  assert.equal(formatRefreshOption(60), '1 分鐘');
  assert.equal(formatRefreshOption(300), '5 分鐘');
  assert.equal(formatRefreshOption(720), '12 分鐘（建議）');
  assert.equal(formatRefreshOption(900), '15 分鐘');
});

test('builds encoded managed URLs without accepting an admin token', () => {
  const urls = buildManagedUrls({
    origin: 'https://dashboard.example/',
    profile: 'dp75sdi',
    viewToken: 'view key&private',
    adminToken: 'must-not-appear',
  });

  assert.deepEqual(urls, {
    dashboardUrl:
      'https://dashboard.example/api/dashboard?profile=dp75sdi&managed=true&key=view+key%26private',
    deviceConfigUrl:
      'https://dashboard.example/api/device-config?profile=dp75sdi&key=view+key%26private',
  });
  assert.doesNotMatch(JSON.stringify(urls), /must-not-appear/);

  assert.deepEqual(
    buildManagedUrls({
      origin: 'https://dashboard.example',
      profile: 'voyage',
      viewToken: '',
    }),
    {
      dashboardUrl:
        'https://dashboard.example/api/dashboard?profile=voyage&managed=true',
      deviceConfigUrl:
        'https://dashboard.example/api/device-config?profile=voyage',
    },
  );
});

test('normalizes artwork onto an opaque 104 x 96 PNG through injected browser adapters', async () => {
  const calls = [];
  const image = { width: 200, height: 100, close: () => calls.push(['close']) };
  const context = {
    set fillStyle(value) {
      calls.push(['fillStyle', value]);
    },
    fillRect(...args) {
      calls.push(['fillRect', ...args]);
    },
    drawImage(...args) {
      calls.push(['drawImage', ...args]);
    },
  };
  const canvas = {
    getContext(type) {
      calls.push(['getContext', type]);
      return context;
    },
  };
  const file = { type: 'image/jpeg', size: 2048 };
  const adapters = {
    async decodeImage(receivedFile) {
      calls.push(['decodeImage', receivedFile]);
      return image;
    },
    createCanvas(width, height) {
      calls.push(['createCanvas', width, height]);
      return canvas;
    },
    exportPng(receivedCanvas) {
      calls.push(['exportPng', receivedCanvas, 'image/png']);
      return 'data:image/png;base64,normalized';
    },
  };

  const result = await normalizeArtworkFile(file, adapters);

  assert.equal(result, 'data:image/png;base64,normalized');
  assert.deepEqual(calls, [
    ['decodeImage', file],
    ['createCanvas', 104, 96],
    ['getContext', '2d'],
    ['fillStyle', '#fff'],
    ['fillRect', 0, 0, 104, 96],
    ['drawImage', image, 0, 22, 104, 52],
    ['exportPng', canvas, 'image/png'],
    ['close'],
  ]);
});
