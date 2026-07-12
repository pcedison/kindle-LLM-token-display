import UPNG from 'upng-js';

const CONFIG_VERSION = 1;
const DEFAULT_REFRESH_INTERVAL_SECONDS = 720;
const MAX_PNG_BYTES = 100 * 1024;
const NORMALIZED_PNG_WIDTH = 104;
const NORMALIZED_PNG_HEIGHT = 96;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SUPPORTED_PROFILES = Object.freeze(['dp75sdi', 'kpw3', 'voyage', 'basic']);

export const ALLOWED_REFRESH_INTERVALS = Object.freeze([
  10, 20, 30, 40, 50, 60, 120, 180, 240, 300,
  360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVisible(provider, defaultValue, providerKey) {
  if (provider.visible === undefined) return defaultValue;
  if (typeof provider.visible !== 'boolean') {
    throw new TypeError(`Invalid visible value for provider: ${providerKey}`);
  }
  return provider.visible;
}

function normalizeArtworkProvider(providers, providerKey) {
  const provider = providers[providerKey] === undefined ? {} : providers[providerKey];
  if (!isObject(provider)) {
    throw new TypeError(`Invalid provider: ${providerKey}`);
  }

  const imageDataUrl = provider.imageDataUrl === undefined || provider.imageDataUrl === null
    ? null
    : validateNormalizedPngDataUrl(provider.imageDataUrl);

  return {
    visible: normalizeVisible(provider, true, providerKey),
    imageDataUrl,
  };
}

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

function decodeStrictBase64(encoded) {
  if (!encoded) throw new TypeError('Invalid PNG base64 data');

  const paddingLength = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const unpadded = encoded.slice(0, encoded.length - paddingLength);
  const remainder = unpadded.length % 4;
  const hasValidPadding = paddingLength === 0
    ? remainder !== 1
    : (paddingLength === 1 && remainder === 3)
      || (paddingLength === 2 && remainder === 2);

  if (!/^[A-Za-z0-9+/]+$/.test(unpadded) || !hasValidPadding) {
    throw new TypeError('Invalid PNG base64 padding');
  }

  const decodedLength = Math.floor(unpadded.length * 3 / 4);
  if (decodedLength > MAX_PNG_BYTES) {
    throw new TypeError('PNG encoded length exceeds the 100 KiB decoded limit');
  }

  const bytes = Buffer.from(unpadded, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== unpadded) {
    throw new TypeError('Invalid PNG base64 data');
  }
  return bytes;
}

function validatePngChunks(bytes) {
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let hasImageData = false;
  let hasImageEnd = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new TypeError('Invalid truncated PNG');

    const dataLength = bytes.readUInt32BE(offset);
    const chunkEnd = offset + dataLength + 12;
    if (chunkEnd > bytes.length) throw new TypeError('Invalid truncated PNG');

    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const expectedCrc = bytes.readUInt32BE(offset + dataLength + 8);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + dataLength + 8));
    if (expectedCrc !== actualCrc) throw new TypeError('Invalid corrupt PNG chunk');

    if (chunkIndex === 0 && (type !== 'IHDR' || dataLength !== 13)) {
      throw new TypeError('Invalid PNG IHDR');
    }
    if (type === 'IDAT') hasImageData = true;
    if (type === 'IEND') {
      if (dataLength !== 0 || chunkEnd !== bytes.length) {
        throw new TypeError('Invalid PNG IEND');
      }
      hasImageEnd = true;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (!hasImageData || !hasImageEnd) throw new TypeError('Invalid incomplete PNG');
}

function validateOpaquePixels(bytes) {
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = UPNG.decode(arrayBuffer);
    const frames = UPNG.toRGBA8(decoded);
    if (frames.length !== 1) throw new TypeError('Animated PNG is not normalized artwork');

    const rgba = new Uint8Array(frames[0]);
    if (rgba.length !== NORMALIZED_PNG_WIDTH * NORMALIZED_PNG_HEIGHT * 4) {
      throw new TypeError('Invalid PNG pixel data');
    }
    for (let index = 3; index < rgba.length; index += 4) {
      if (rgba[index] !== 255) throw new TypeError('PNG must be fully opaque');
    }
  } catch {
    throw new TypeError('Invalid PNG image data; artwork must be fully opaque');
  }
}

export function validateNormalizedPngDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new TypeError('Invalid PNG data URL');
  }

  const encoded = value.slice(PNG_DATA_URL_PREFIX.length);
  const bytes = decodeStrictBase64(encoded);
  if (bytes.length > MAX_PNG_BYTES) {
    throw new TypeError('PNG exceeds the 100 KiB decoded limit');
  }
  if (bytes.length < 24 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new TypeError('Invalid PNG signature');
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new TypeError('Invalid PNG IHDR');
  }
  if (
    bytes.readUInt32BE(16) !== NORMALIZED_PNG_WIDTH
    || bytes.readUInt32BE(20) !== NORMALIZED_PNG_HEIGHT
  ) {
    throw new TypeError('PNG dimensions must be exactly 104 x 96');
  }
  validatePngChunks(bytes);
  validateOpaquePixels(bytes);

  return `${PNG_DATA_URL_PREFIX}${bytes.toString('base64')}`;
}

export function normalizeDashboardConfig(input = {}, options = {}) {
  if (!isObject(input)) {
    throw new TypeError('Invalid dashboard config');
  }

  const { profile, now = () => new Date() } = options;
  if (!SUPPORTED_PROFILES.includes(profile)) {
    throw new TypeError('Invalid dashboard profile');
  }

  const refreshIntervalSeconds = input.refreshIntervalSeconds === undefined
    ? DEFAULT_REFRESH_INTERVAL_SECONDS
    : input.refreshIntervalSeconds;
  if (!ALLOWED_REFRESH_INTERVALS.includes(refreshIntervalSeconds)) {
    throw new TypeError('Invalid refresh interval');
  }

  const providers = input.providers === undefined ? {} : input.providers;
  if (!isObject(providers)) {
    throw new TypeError('Invalid providers');
  }

  const gemini = providers.gemini === undefined ? {} : providers.gemini;
  if (!isObject(gemini)) {
    throw new TypeError('Invalid provider: gemini');
  }

  return {
    version: CONFIG_VERSION,
    profile,
    refreshIntervalSeconds,
    providers: {
      claude: normalizeArtworkProvider(providers, 'claude'),
      openai: normalizeArtworkProvider(providers, 'openai'),
      gemini: { visible: normalizeVisible(gemini, false, 'gemini') },
    },
    updatedAt: new Date(now()).toISOString(),
  };
}

export function publicDashboardConfig(config) {
  return {
    version: config.version,
    profile: config.profile,
    refreshIntervalSeconds: config.refreshIntervalSeconds,
    providers: {
      claude: {
        visible: config.providers.claude.visible,
        imageDataUrl: config.providers.claude.imageDataUrl,
      },
      openai: {
        visible: config.providers.openai.visible,
        imageDataUrl: config.providers.openai.imageDataUrl,
      },
      gemini: { visible: config.providers.gemini.visible },
    },
    updatedAt: config.updatedAt,
  };
}
