const ARTWORK_WIDTH = 104;
const ARTWORK_HEIGHT = 96;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const ALLOWED_REFRESH_INTERVALS = new Set([
  10, 20, 30, 40, 50, 60, 120, 180, 240, 300,
  360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
]);
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ARTWORK_PROVIDERS = new Set(['claude', 'openai']);

function readUint32(decoded, offset) {
  return (
    decoded.charCodeAt(offset) * 0x1000000
    + decoded.charCodeAt(offset + 1) * 0x10000
    + decoded.charCodeAt(offset + 2) * 0x100
    + decoded.charCodeAt(offset + 3)
  );
}

function hasCompleteNormalizedPng(decoded) {
  if (decoded.length < 45) return false;
  if (!PNG_SIGNATURE.every((byte, index) => decoded.charCodeAt(index) === byte)) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let sawHeader = false;
  let sawImageData = false;

  while (offset + 12 <= decoded.length) {
    const length = readUint32(decoded, offset);
    const type = decoded.slice(offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > decoded.length) return false;

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = readUint32(decoded, offset + 8);
      const height = readUint32(decoded, offset + 12);
      if (width !== ARTWORK_WIDTH || height !== ARTWORK_HEIGHT) return false;
      sawHeader = true;
    } else if (type === 'IDAT') {
      if (length === 0) return false;
      sawImageData = true;
    } else if (type === 'IEND') {
      return length === 0 && sawImageData && chunkEnd === decoded.length;
    }

    offset = chunkEnd;
  }

  return false;
}

function isValidPngDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return false;
  }

  const payload = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (
    !payload
    || payload.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  ) {
    return false;
  }

  try {
    const decoded = globalThis.atob(payload);
    return hasCompleteNormalizedPng(decoded);
  } catch {
    return false;
  }
}

export function validateUploadFile(file) {
  if (!file || !ALLOWED_UPLOAD_TYPES.has(file.type)) {
    throw new TypeError('Choose a PNG, JPEG, or WebP image.');
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new TypeError('Artwork uploads must be 5 MiB or smaller.');
  }
  return file;
}

export function calculateContainRect(width, height) {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    throw new TypeError('Artwork dimensions must be positive numbers.');
  }

  const scale = Math.min(ARTWORK_WIDTH / width, ARTWORK_HEIGHT / height);
  const containedWidth = Math.min(
    ARTWORK_WIDTH,
    Math.max(1, Math.round(width * scale)),
  );
  const containedHeight = Math.min(
    ARTWORK_HEIGHT,
    Math.max(1, Math.round(height * scale)),
  );

  return {
    x: Math.floor((ARTWORK_WIDTH - containedWidth) / 2),
    y: Math.floor((ARTWORK_HEIGHT - containedHeight) / 2),
    width: containedWidth,
    height: containedHeight,
  };
}

export function createArtworkErrorFocusRequest(current, provider) {
  if (!ARTWORK_PROVIDERS.has(provider)) {
    throw new TypeError('Invalid artwork provider.');
  }
  return { provider, id: (current?.id || 0) + 1 };
}

export function getArtworkErrorFocusProvider({ artworkState, focusRequest, activeProvider }) {
  const provider = focusRequest?.provider || activeProvider;
  const state = provider ? artworkState[provider] : null;
  return state && !state.processing && state.error ? provider : null;
}

export function getArtworkControlNames(providerName) {
  return {
    upload: `Upload ${providerName} artwork`,
    restore: `Restore default ${providerName} artwork`,
  };
}

export function getManagedUrlOpenName(destination) {
  return `Open ${destination}`;
}

async function decodeBrowserImage(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    return globalThis.createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

const browserAdapters = {
  decodeImage: decodeBrowserImage,
  createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  exportPng(canvas) {
    return canvas.toDataURL('image/png');
  },
};

export async function normalizeArtworkFile(file, adapters = browserAdapters) {
  validateUploadFile(file);

  const image = await adapters.decodeImage(file);
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const rect = calculateContainRect(width, height);
    const canvas = adapters.createCanvas(ARTWORK_WIDTH, ARTWORK_HEIGHT);
    const context = canvas.getContext('2d');
    if (!context) throw new TypeError('Canvas 2D rendering is unavailable.');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, ARTWORK_WIDTH, ARTWORK_HEIGHT);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);

    const dataUrl = await adapters.exportPng(canvas, 'image/png');
    if (!isValidPngDataUrl(dataUrl)) {
      throw new TypeError('Canvas did not export a PNG image.');
    }
    return dataUrl;
  } finally {
    image.close?.();
    if (image.src?.startsWith?.('blob:')) URL.revokeObjectURL(image.src);
  }
}

export function formatRefreshOption(seconds) {
  if (!ALLOWED_REFRESH_INTERVALS.has(seconds)) {
    throw new TypeError('Invalid refresh interval.');
  }
  if (seconds < 60) return `${seconds} 秒（高耗電測試）`;

  const minutes = seconds / 60;
  return `${minutes} 分鐘${seconds === 720 ? '（建議）' : ''}`;
}

export function buildManagedUrls({ origin, profile, viewToken }) {
  const dashboardUrl = new URL('/api/dashboard', origin);
  dashboardUrl.searchParams.set('profile', profile);
  dashboardUrl.searchParams.set('managed', 'true');

  const deviceConfigUrl = new URL('/api/device-config', origin);
  deviceConfigUrl.searchParams.set('profile', profile);

  if (viewToken) {
    dashboardUrl.searchParams.set('key', viewToken);
    deviceConfigUrl.searchParams.set('key', viewToken);
  }

  return {
    dashboardUrl: dashboardUrl.toString(),
    deviceConfigUrl: deviceConfigUrl.toString(),
  };
}
