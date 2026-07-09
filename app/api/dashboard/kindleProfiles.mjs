const MIN_DIMENSION = 320;
const MAX_DIMENSION = 2000;

export const KINDLE_PROFILES = {
  dp75sdi: {
    key: 'dp75sdi',
    label: 'DP75SDI / PW2',
    width: 758,
    height: 1024,
  },
  kpw3: {
    key: 'kpw3',
    label: 'Paperwhite 3',
    width: 1072,
    height: 1448,
  },
  voyage: {
    key: 'voyage',
    label: 'Voyage',
    width: 1080,
    height: 1440,
  },
  basic: {
    key: 'basic',
    label: 'Kindle Basic',
    width: 600,
    height: 800,
  },
};

const PROFILE_ALIASES = {
  dp75sdi: 'dp75sdi',
  pw2: 'dp75sdi',
  kpw2: 'dp75sdi',
  paperwhite2: 'dp75sdi',
  paperwhite_2: 'dp75sdi',
  pw3: 'kpw3',
  kpw3: 'kpw3',
  paperwhite3: 'kpw3',
  paperwhite_3: 'kpw3',
  voyage: 'voyage',
  basic: 'basic',
  kindlebasic: 'basic',
};

function getParam(searchParams, key) {
  if (!searchParams) {
    return undefined;
  }

  if (typeof searchParams.get === 'function') {
    return searchParams.get(key) ?? undefined;
  }

  return searchParams[key];
}

function normalizeProfile(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function parseDimension(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) {
    return undefined;
  }

  if (number < MIN_DIMENSION || number > MAX_DIMENSION) {
    return undefined;
  }

  return number;
}

function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

export function resolveDashboardProfile(searchParams) {
  const requestedProfile =
    getParam(searchParams, 'profile') || getParam(searchParams, 'device') || 'dp75sdi';
  const profileKey = PROFILE_ALIASES[normalizeProfile(requestedProfile)] || 'dp75sdi';
  const baseProfile = KINDLE_PROFILES[profileKey];

  const customWidth =
    parseDimension(getParam(searchParams, 'w')) ||
    parseDimension(getParam(searchParams, 'width'));
  const customHeight =
    parseDimension(getParam(searchParams, 'h')) ||
    parseDimension(getParam(searchParams, 'height'));

  const width = customWidth || baseProfile.width;
  const height = customHeight || baseProfile.height;

  return {
    ...baseProfile,
    requestedProfile,
    width,
    height,
    isCustomSize: width !== baseProfile.width || height !== baseProfile.height,
  };
}

export function getLayoutMetrics({ width, height }) {
  const scale = clamp(Math.min(width / 758, height / 1024), 0.72, 1.55);

  return {
    border: Math.round(3 * scale),
    padding: Math.round(34 * scale),
    headerFont: Math.round(32 * scale),
    metaFont: Math.round(17 * scale),
    cardGap: Math.round(22 * scale),
    cardPadding: Math.round(22 * scale),
    cardTitleFont: Math.round(23 * scale),
    valueFont: Math.round(58 * scale),
    resetFont: Math.round(18 * scale),
    footerFont: Math.round(16 * scale),
  };
}
