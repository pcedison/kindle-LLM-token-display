const PROVIDER_KEYS = ['claude', 'codex'];
const WINDOW_KEYS = ['fiveHour', 'sevenDay'];
const SENSITIVE_KEY_PATTERN = /token|secret|cookie|authorization|api[_-]?key|email|accountid|orgid|prompt|transcript/i;
const MIN_RESET_EPOCH = Date.UTC(2020, 0, 1) / 1000;
const MAX_RESET_EPOCH = Date.UTC(2100, 0, 1) / 1000;

function assertNoSensitiveFields(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new TypeError(`Sensitive field is not allowed: ${key}`);
    }
    assertNoSensitiveFields(nestedValue, seen);
  }
}

function normalizeWindow(window) {
  if (!window || typeof window !== 'object') {
    throw new TypeError('Invalid quota window');
  }

  const { usedPercent, resetsAt } = window;
  if (!Number.isFinite(usedPercent)) {
    throw new TypeError('Invalid usedPercent');
  }
  if (!Number.isInteger(resetsAt) || resetsAt < MIN_RESET_EPOCH || resetsAt > MAX_RESET_EPOCH) {
    throw new TypeError('Invalid reset epoch');
  }

  return {
    usedPercent: Math.min(Math.max(usedPercent, 0), 100),
    resetsAt,
  };
}

function normalizeCollectedAt(value) {
  const collectedAt = new Date(value);
  if (Number.isNaN(collectedAt.getTime())) {
    throw new TypeError('Invalid collectedAt');
  }
  return collectedAt.toISOString();
}

function normalizeProviders(providers, fallbackCollectedAt) {
  if (providers === undefined || providers === null) {
    return {};
  }
  if (typeof providers !== 'object' || Array.isArray(providers)) {
    throw new TypeError('Invalid providers');
  }

  const normalized = {};
  for (const providerKey of PROVIDER_KEYS) {
    const provider = providers[providerKey];
    if (provider === undefined || provider === null) {
      continue;
    }
    if (typeof provider !== 'object' || Array.isArray(provider)) {
      throw new TypeError(`Invalid provider: ${providerKey}`);
    }
    const providerCollectedAt = normalizeCollectedAt(
      provider.collectedAt ?? fallbackCollectedAt,
    );

    const windows = provider.windows;
    if (windows === undefined || windows === null) {
      continue;
    }
    if (typeof windows !== 'object' || Array.isArray(windows)) {
      throw new TypeError(`Invalid windows: ${providerKey}`);
    }

    const normalizedWindows = {};
    for (const windowKey of WINDOW_KEYS) {
      if (windows[windowKey] !== undefined && windows[windowKey] !== null) {
        normalizedWindows[windowKey] = normalizeWindow(windows[windowKey]);
      }
    }
    if (Object.keys(normalizedWindows).length > 0) {
      normalized[providerKey] = {
        collectedAt: providerCollectedAt,
        windows: normalizedWindows,
      };
    }
  }
  return normalized;
}

function emptySnapshot(collectedAt) {
  return { version: 1, collectedAt: normalizeCollectedAt(collectedAt), providers: {} };
}

function mergeProvider(leftProvider, rightProvider) {
  if (!rightProvider) return leftProvider;
  if (!leftProvider) return rightProvider;

  const leftCollectedAt = Date.parse(leftProvider.collectedAt);
  const rightCollectedAt = Date.parse(rightProvider.collectedAt);
  if (rightCollectedAt < leftCollectedAt) return leftProvider;

  return {
    collectedAt: rightProvider.collectedAt,
    windows: {
      ...leftProvider.windows,
      ...rightProvider.windows,
    },
  };
}

function mergeOnlyPresentWindows(left, right) {
  const providers = {};
  for (const providerKey of PROVIDER_KEYS) {
    const provider = mergeProvider(left.providers[providerKey], right.providers[providerKey]);
    if (provider) providers[providerKey] = provider;
  }

  const timestamps = [left.collectedAt, right.collectedAt]
    .concat(Object.values(providers).map(({ collectedAt }) => collectedAt))
    .map(Date.parse);

  return {
    version: 1,
    collectedAt: new Date(Math.max(...timestamps)).toISOString(),
    providers,
  };
}

export function normalizeQuotaSnapshot(input) {
  assertNoSensitiveFields(input);
  if (input?.version !== 1) {
    throw new TypeError('Unsupported snapshot version');
  }
  const collectedAt = normalizeCollectedAt(input.collectedAt);
  return {
    version: 1,
    collectedAt,
    providers: normalizeProviders(input.providers, collectedAt),
  };
}

export function mergeQuotaSnapshots(current, incoming) {
  const left = current ? normalizeQuotaSnapshot(current) : emptySnapshot(incoming?.collectedAt);
  const right = normalizeQuotaSnapshot(incoming);
  return mergeOnlyPresentWindows(left, right);
}
