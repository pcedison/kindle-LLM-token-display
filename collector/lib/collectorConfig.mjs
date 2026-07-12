import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function defaultConfigPath({
  platformName = platform(),
  home = homedir(),
  env = process.env,
} = {}) {
  if (platformName === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'KindleLLMDashboard', 'config.json');
  }
  if (platformName === 'darwin') {
    return join(home, 'Library', 'Application Support', 'KindleLLMDashboard', 'config.json');
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'kindle-llm-dashboard', 'config.json');
}

export async function readCollectorConfig(path = defaultConfigPath()) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  const hasInlineToken = Boolean(config?.ingestToken);
  const hasKeychainToken = config?.ingestTokenSource === 'macos-keychain'
    && Boolean(config?.keychainService);
  if (!config?.ingestUrl || (!hasInlineToken && !hasKeychainToken)) {
    throw new Error('Collector configuration is incomplete');
  }
  return {
    ingestUrl: String(config.ingestUrl),
    ...(hasInlineToken ? { ingestToken: String(config.ingestToken) } : {}),
    ...(hasKeychainToken ? {
      ingestTokenSource: 'macos-keychain',
      keychainService: String(config.keychainService),
      keychainAccount: config.keychainAccount ? String(config.keychainAccount) : undefined,
    } : {}),
    codexCommand: config.codexCommand || 'codex',
    timeoutMs: Math.min(120000, Math.max(1000, Number(config.timeoutMs) || 30000)),
    timeZone: config.timeZone || 'Asia/Taipei',
  };
}

export function validateIngestUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) throw new Error('Ingest URL must use HTTPS');
  return url;
}
