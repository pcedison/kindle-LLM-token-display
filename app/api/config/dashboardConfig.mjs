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

export function validateNormalizedPngDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new TypeError('Invalid PNG data URL');
  }

  const encoded = value.slice(PNG_DATA_URL_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new TypeError('Invalid PNG base64 data');
  }

  const bytes = Buffer.from(encoded, 'base64');
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

  const providers = input.providers ?? {};
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
