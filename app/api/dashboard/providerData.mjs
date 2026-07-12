const WINDOW_CONFIG = {
  fiveHour: { label: '5 HOURS', resetFields: ['FIVE_HOUR_REMAINING', 'FIVE_HOUR_RESET_LABEL'] },
  sevenDay: { label: '7 DAYS', resetFields: ['SEVEN_DAY_REMAINING', 'SEVEN_DAY_RESET_LABEL'] },
};

const PROVIDER_CONFIG = [
  {
    queryKey: 'claude',
    defaultVisible: true,
    displayName: 'Anthropic Claude Code',
    vendorLabel: 'ANTHROPIC',
    envPrefix: 'CLAUDE',
    snapshotKey: 'claude',
    acceptsLive: true,
  },
  {
    queryKey: 'openai',
    defaultVisible: true,
    displayName: 'Codex',
    vendorLabel: 'OPENAI',
    envPrefix: 'OPENAI',
    snapshotKey: 'codex',
    acceptsLive: true,
  },
  {
    queryKey: 'gemini',
    defaultVisible: false,
    displayName: 'Gemini',
    vendorLabel: 'GOOGLE',
    envPrefix: 'GEMINI',
    acceptsLive: false,
  },
];

function readEnv(env, key) {
  const value = env?.[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function clampProgress(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 100);
}

function parseProgress(value) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : undefined;
}

function toMilliseconds(now) {
  const milliseconds = new Date(now ?? Date.now()).getTime();
  return Number.isNaN(milliseconds) ? Date.now() : milliseconds;
}

function formatReset(epoch, windowKey, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(windowKey === 'sevenDay' ? { month: '2-digit', day: '2-digit' } : {}),
  }).formatToParts(new Date(epoch * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const time = `${values.hour}:${values.minute}`;
  return windowKey === 'sevenDay'
    ? `RESET ${values.month}/${values.day} ${time}`
    : `RESET ${time}`;
}

function isLiveWindow(window) {
  return Number.isFinite(window?.usedPercent) && Number.isInteger(window?.resetsAt);
}

function missingWindow(windowKey) {
  return {
    label: WINDOW_CONFIG[windowKey].label,
    remaining: '--%',
    progress: 0,
    reset: 'WAITING FOR LOCAL SYNC',
  };
}

function manualWindow(provider, windowKey, env) {
  const [remainingField, resetField] = WINDOW_CONFIG[windowKey].resetFields;
  const remaining = readEnv(env, `${provider.envPrefix}_${remainingField}`)
    || (windowKey === 'fiveHour' ? readEnv(env, `${provider.envPrefix}_STATUS_VALUE`) : undefined);
  if (!remaining) {
    return undefined;
  }

  const reset = readEnv(env, `${provider.envPrefix}_${resetField}`)
    || (windowKey === 'fiveHour' ? readEnv(env, `${provider.envPrefix}_RESET_LABEL`) : undefined);
  const explicitProgress = windowKey === 'fiveHour'
    ? parseProgress(readEnv(env, `${provider.envPrefix}_PROGRESS_VALUE`))
    : undefined;
  return {
    label: WINDOW_CONFIG[windowKey].label,
    remaining,
    progress: clampProgress(explicitProgress ?? parseProgress(remaining)),
    reset: reset || 'WAITING FOR LOCAL SYNC',
  };
}

function windowCollectedAt(snapshot, provider, window) {
  return window?.collectedAt || provider?.collectedAt || snapshot?.collectedAt;
}

function staleWindowSyncLabel(window, collectedAt, now, timeZone) {
  const collectedAtMs = new Date(collectedAt).getTime();
  if (!isLiveWindow(window)
    || !Number.isFinite(collectedAtMs)
    || window.resetsAt * 1000 <= now
    || now - collectedAtMs <= 30 * 60 * 1000) {
    return undefined;
  }

  const syncTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(collectedAtMs));
  return `SYNC ${syncTime}`;
}

function resolveOptions(options) {
  if (!options || typeof options !== 'object') {
    return { env: process.env };
  }
  if ('env' in options || 'snapshot' in options || 'now' in options || 'timeZone' in options) {
    return options;
  }
  return { env: options };
}

export function getWindowDisplay(window, options = {}) {
  const windowKey = options.windowKey === 'sevenDay' ? 'sevenDay' : 'fiveHour';
  if (!isLiveWindow(window)) {
    return missingWindow(windowKey);
  }

  const now = toMilliseconds(options.now);
  if (window.resetsAt * 1000 <= now) {
    return {
      label: WINDOW_CONFIG[windowKey].label,
      remaining: '--%',
      progress: 0,
      reset: 'SYNC PENDING',
    };
  }

  const remaining = clampProgress(100 - window.usedPercent);
  return {
    label: WINDOW_CONFIG[windowKey].label,
    remaining: `${remaining}%`,
    progress: remaining,
    reset: formatReset(window.resetsAt, windowKey, options.timeZone || 'Asia/Taipei'),
  };
}

export function getProviderCards(options = {}) {
  const { env = process.env, snapshot, now, timeZone = 'Asia/Taipei' } = resolveOptions(options);
  const currentTime = toMilliseconds(now);

  return PROVIDER_CONFIG.map((provider) => {
    const liveProvider = provider.acceptsLive
      ? snapshot?.providers?.[provider.snapshotKey]
      : undefined;
    const liveWindows = provider.acceptsLive
      ? liveProvider?.windows || {}
      : {};
    const hasLiveData = Object.values(liveWindows).some(isLiveWindow);
    const manualWindows = Object.fromEntries(
      Object.keys(WINDOW_CONFIG)
        .map((windowKey) => [windowKey, manualWindow(provider, windowKey, env)])
        .filter(([, window]) => window),
    );
    const hasManualData = Object.keys(manualWindows).length > 0;
    const source = hasLiveData ? 'live' : hasManualData ? 'manual' : 'missing';

    const staleLabels = Object.keys(WINDOW_CONFIG)
      .map((windowKey) => staleWindowSyncLabel(
        liveWindows[windowKey],
        windowCollectedAt(snapshot, liveProvider, liveWindows[windowKey]),
        currentTime,
        timeZone,
      ))
      .filter(Boolean);

    return {
      queryKey: provider.queryKey,
      defaultVisible: provider.defaultVisible,
      displayName: provider.displayName,
      vendorLabel: provider.vendorLabel,
      source,
      stale: hasLiveData && staleLabels.length > 0,
      syncLabel: staleLabels[0],
      windows: Object.fromEntries(Object.keys(WINDOW_CONFIG).map((windowKey) => [
        windowKey,
        hasLiveData
          ? getWindowDisplay(liveWindows[windowKey], { now: currentTime, timeZone, windowKey })
          : manualWindows[windowKey] || missingWindow(windowKey),
      ])),
    };
  });
}

export function providerEnvTemplate() {
  return PROVIDER_CONFIG.flatMap((provider) => [
    `${provider.envPrefix}_FIVE_HOUR_REMAINING`,
    `${provider.envPrefix}_FIVE_HOUR_RESET_LABEL`,
    `${provider.envPrefix}_SEVEN_DAY_REMAINING`,
    `${provider.envPrefix}_SEVEN_DAY_RESET_LABEL`,
    `${provider.envPrefix}_STATUS_VALUE`,
    `${provider.envPrefix}_RESET_LABEL`,
    `${provider.envPrefix}_PROGRESS_VALUE`,
  ]);
}
