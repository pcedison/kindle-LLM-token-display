import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManagedUrls,
  calculateContainRect,
  formatRefreshOption,
  getArtworkControlNames,
  getArtworkErrorFocusProvider,
  getManagedUrlOpenName,
  normalizeArtworkFile,
  validateUploadFile,
} from '../app/configClient.mjs';

const FIVE_MIB = 5 * 1024 * 1024;
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function createArtworkAdapters({
  image = { width: 104, height: 96 },
  context = { fillRect() {}, drawImage() {} },
  exportPng = () => PNG_DATA_URL,
} = {}) {
  return {
    async decodeImage() {
      return image;
    },
    createCanvas() {
      return { getContext: () => context };
    },
    exportPng,
  };
}

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

test('focuses only the active provider new artwork error in either provider order', () => {
  assert.equal(
    getArtworkErrorFocusProvider({
      activeProvider: 'openai',
      artworkState: {
        claude: { processing: false, error: 'Old Claude error' },
        openai: { processing: false, error: 'New Codex error' },
      },
    }),
    'openai',
  );

  assert.equal(
    getArtworkErrorFocusProvider({
      activeProvider: 'claude',
      artworkState: {
        claude: { processing: false, error: 'New Claude error' },
        openai: { processing: false, error: 'Old Codex error' },
      },
    }),
    'claude',
  );
});

test('does not focus a retained artwork error while the active provider is processing', () => {
  assert.equal(
    getArtworkErrorFocusProvider({
      activeProvider: 'openai',
      artworkState: {
        claude: { processing: false, error: 'Old Claude error' },
        openai: { processing: true, error: '' },
      },
    }),
    null,
  );
});

test('builds provider-specific artwork upload and restore names', () => {
  assert.deepEqual(getArtworkControlNames('Claude'), {
    upload: 'Upload Claude artwork',
    restore: 'Restore default Claude artwork',
  });
  assert.deepEqual(getArtworkControlNames('Codex'), {
    upload: 'Upload Codex artwork',
    restore: 'Restore default Codex artwork',
  });
});

test('builds distinct managed PNG and device config open-link names', () => {
  assert.equal(getManagedUrlOpenName('Managed PNG'), 'Open Managed PNG');
  assert.equal(getManagedUrlOpenName('Device config'), 'Open Device config');
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
      return PNG_DATA_URL;
    },
  };

  const result = await normalizeArtworkFile(file, adapters);

  assert.equal(result, PNG_DATA_URL);
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

test('closes decoded artwork when PNG export throws', async () => {
  let closed = false;
  const adapters = createArtworkAdapters({
    image: {
      width: 104,
      height: 96,
      close() {
        closed = true;
      },
    },
    exportPng() {
      throw new Error('export failed');
    },
  });

  await assert.rejects(
    normalizeArtworkFile({ type: 'image/png', size: 1 }, adapters),
    /export failed/,
  );
  assert.equal(closed, true);
});

test('rejects empty and malformed PNG base64 exports', async () => {
  for (const output of [
    'data:image/png;base64,',
    'data:image/png;base64,not*base64',
    'data:image/png;base64,bm90LXBuZw==',
  ]) {
    await assert.rejects(
      normalizeArtworkFile(
        { type: 'image/png', size: 1 },
        createArtworkAdapters({ exportPng: () => output }),
      ),
      /did not export a PNG/i,
    );
  }
});

test('rejects artwork conversion when a 2D canvas context is unavailable', async () => {
  await assert.rejects(
    normalizeArtworkFile(
      { type: 'image/png', size: 1 },
      createArtworkAdapters({ context: null }),
    ),
    /2D rendering is unavailable/i,
  );
});

test('revokes fallback object URLs after successful image conversion', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revoked = [];

  try {
    globalThis.createImageBitmap = undefined;
    URL.createObjectURL = () => 'blob:fallback-success';
    URL.revokeObjectURL = (url) => revoked.push(url);
    globalThis.Image = class {
      width = 104;
      height = 96;

      async decode() {}
    };
    globalThis.document = {
      createElement() {
        return {
          getContext: () => ({ fillRect() {}, drawImage() {} }),
          toDataURL: () => PNG_DATA_URL,
        };
      },
    };

    await normalizeArtworkFile({ type: 'image/png', size: 1 });
    assert.deepEqual(revoked, ['blob:fallback-success']);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('revokes fallback object URLs when image decoding fails', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const revoked = [];

  try {
    globalThis.createImageBitmap = undefined;
    URL.createObjectURL = () => 'blob:fallback-failure';
    URL.revokeObjectURL = (url) => revoked.push(url);
    globalThis.Image = class {
      async decode() {
        throw new Error('decode failed');
      }
    };

    await assert.rejects(
      normalizeArtworkFile({ type: 'image/png', size: 1 }),
      /decode failed/,
    );
    assert.deepEqual(revoked, ['blob:fallback-failure']);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
