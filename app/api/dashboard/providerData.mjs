const PROVIDER_CONFIG = [
  {
    queryKey: 'claude',
    defaultVisible: true,
    name: 'Anthropic',
    detail: 'Claude / Code',
    statusEnv: 'CLAUDE_STATUS_VALUE',
    resetEnv: 'CLAUDE_RESET_LABEL',
    progressEnv: 'CLAUDE_PROGRESS_VALUE',
  },
  {
    queryKey: 'openai',
    defaultVisible: true,
    name: 'OpenAI',
    detail: 'API / Codex',
    statusEnv: 'OPENAI_STATUS_VALUE',
    resetEnv: 'OPENAI_RESET_LABEL',
    progressEnv: 'OPENAI_PROGRESS_VALUE',
  },
  {
    queryKey: 'gemini',
    defaultVisible: false,
    name: 'Google',
    detail: 'Gemini API',
    statusEnv: 'GEMINI_STATUS_VALUE',
    resetEnv: 'GEMINI_RESET_LABEL',
    progressEnv: 'GEMINI_PROGRESS_VALUE',
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

  return Math.min(Math.max(Math.round(value), 0), 100);
}

function parseProgress(value) {
  if (!value) {
    return undefined;
  }

  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }

  return Number.parseFloat(match[0]);
}

export function getProviderCards(env = process.env) {
  return PROVIDER_CONFIG.map((provider) => {
    const remaining = readEnv(env, provider.statusEnv) || 'SETUP';
    const explicitProgress = parseProgress(readEnv(env, provider.progressEnv));
    const inferredProgress = parseProgress(remaining);

    return {
      queryKey: provider.queryKey,
      defaultVisible: provider.defaultVisible,
      name: provider.name,
      detail: provider.detail,
      remaining,
      reset: readEnv(env, provider.resetEnv) || `Set ${provider.resetEnv}`,
      progress: clampProgress(explicitProgress ?? inferredProgress),
    };
  });
}

export function providerEnvTemplate() {
  return PROVIDER_CONFIG.flatMap((provider) => [
    provider.statusEnv,
    provider.resetEnv,
    provider.progressEnv,
  ]);
}
