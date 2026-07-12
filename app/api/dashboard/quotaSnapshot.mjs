const PROVIDER_KEYS = ['claude', 'codex'];
const WINDOW_KEYS = ['fiveHour', 'sevenDay'];
const SUPPORTED_VERSIONS = new Set([1, 2]);
const SENSITIVE_KEY_PATTERN = /token|secret|cookie|authorization|api[_-]?key|email|accountid|orgid|prompt|transcript/i;
const MIN_RESET_EPOCH = Date.UTC(2020, 0, 1) / 1000;
const MAX_RESET_EPOCH = Date.UTC(2100, 0, 1) / 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

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

function normalizeCollectedAt(value, receivedAt) {
  const collectedAt = new Date(value);
  const collectedAtMs = collectedAt.getTime();
  if (Number.isNaN(collectedAtMs)) {
    throw new TypeError('Invalid collectedAt');
  }

  if (receivedAt !== undefined) {
    const receivedAtMs = new Date(receivedAt).getTime();
    if (Number.isNaN(receivedAtMs)) {
      throw new TypeError('Invalid receivedAt');
    }
    if (collectedAtMs - receivedAtMs > MAX_FUTURE_SKEW_MS) {
      throw new TypeError('collectedAt exceeds allowed clock skew');
    }
  }

  return collectedAt.toISOString();
}

function normalizeWindow(window, fallbackCollectedAt, receivedAt) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) {
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
    collectedAt: normalizeCollectedAt(window.collectedAt ?? fallbackCollectedAt, receivedAt),
  };
}

function newestCollectedAt(values) {
  const timestamps = values.filter(Boolean).map((value) => Date.parse(value));
  if (timestamps.length === 0) {
    return undefined;
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function normalizeProviders(providers, fallbackCollectedAt, receivedAt) {
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

    const providerFallback = normalizeCollectedAt(
      provider.collectedAt ?? fallbackCollectedAt,
      receivedAt,
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
        normalizedWindows[windowKey] = normalizeWindow(
          windows[windowKey],
          providerFallback,
          receivedAt,
        );
      }
    }
    if (Object.keys(normalizedWindows).length > 0) {
      normalized[providerKey] = {
        collectedAt: newestCollectedAt(
          Object.values(normalizedWindows).map(({ collectedAt }) => collectedAt),
        ),
        windows: normalizedWindows,
      };
    }
  }
  return normalized;
}

function emptySnapshot(collectedAt) {
  return { version: 2, collectedAt: normalizeCollectedAt(collectedAt), providers: {} };
}

function mergeWindow(leftWindow, rightWindow) {
  if (!rightWindow) return leftWindow;
  if (!leftWindow) return rightWindow;
  return Date.parse(rightWindow.collectedAt) >= Date.parse(leftWindow.collectedAt)
    ? rightWindow
    : leftWindow;
}

function mergeProvider(leftProvider, rightProvider) {
  if (!rightProvider) return leftProvider;
  if (!leftProvider) return rightProvider;

  const windows = {};
  for (const windowKey of WINDOW_KEYS) {
    const window = mergeWindow(leftProvider.windows[windowKey], rightProvider.windows[windowKey]);
    if (window) windows[windowKey] = window;
  }

  return {
    collectedAt: newestCollectedAt(Object.values(windows).map(({ collectedAt }) => collectedAt)),
    windows,
  };
}

function mergeOnlyPresentWindows(left, right) {
  const providers = {};
  for (const providerKey of PROVIDER_KEYS) {
    const provider = mergeProvider(left.providers[providerKey], right.providers[providerKey]);
    if (provider) providers[providerKey] = provider;
  }

  const newestWindow = newestCollectedAt(
    Object.values(providers).flatMap(({ windows }) =>
      Object.values(windows).map(({ collectedAt }) => collectedAt)),
  );

  return {
    version: 2,
    collectedAt: newestWindow || newestCollectedAt([left.collectedAt, right.collectedAt]),
    providers,
  };
}

export function normalizeQuotaSnapshot(input, { receivedAt } = {}) {
  assertNoSensitiveFields(input);
  if (!SUPPORTED_VERSIONS.has(input?.version)) {
    throw new TypeError('Unsupported snapshot version');
  }

  const fallbackCollectedAt = normalizeCollectedAt(input.collectedAt, receivedAt);
  const providers = normalizeProviders(input.providers, fallbackCollectedAt, receivedAt);
  const newestWindow = newestCollectedAt(
    Object.values(providers).flatMap(({ windows }) =>
      Object.values(windows).map(({ collectedAt }) => collectedAt)),
  );

  return {
    version: 2,
    collectedAt: newestWindow || fallbackCollectedAt,
    providers,
  };
}

export function mergeQuotaSnapshots(current, incoming) {
  const left = current ? normalizeQuotaSnapshot(current) : emptySnapshot(incoming?.collectedAt);
  const right = normalizeQuotaSnapshot(incoming);
  return mergeOnlyPresentWindows(left, right);
}
