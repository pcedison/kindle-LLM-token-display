const PROVIDER_CONFIG = [
  {
    queryKey: 'claude',
    defaultVisible: true,
    name: 'Anthropic',
    detail: 'Claude / Code',
    statusEnv: 'CLAUDE_STATUS_VALUE',
    resetEnv: 'CLAUDE_RESET_LABEL',
  },
  {
    queryKey: 'openai',
    defaultVisible: true,
    name: 'OpenAI',
    detail: 'API / Codex',
    statusEnv: 'OPENAI_STATUS_VALUE',
    resetEnv: 'OPENAI_RESET_LABEL',
  },
  {
    queryKey: 'gemini',
    defaultVisible: false,
    name: 'Google',
    detail: 'Gemini API',
    statusEnv: 'GEMINI_STATUS_VALUE',
    resetEnv: 'GEMINI_RESET_LABEL',
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

export function getProviderCards(env = process.env) {
  return PROVIDER_CONFIG.map((provider) => ({
    queryKey: provider.queryKey,
    defaultVisible: provider.defaultVisible,
    name: provider.name,
    detail: provider.detail,
    remaining: readEnv(env, provider.statusEnv) || 'SETUP',
    reset: readEnv(env, provider.resetEnv) || `Set ${provider.resetEnv}`,
  }));
}

export function providerEnvTemplate() {
  return PROVIDER_CONFIG.flatMap((provider) => [
    provider.statusEnv,
    provider.resetEnv,
  ]);
}
