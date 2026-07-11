import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function defaultConfigPath() {
  return platform() === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'KindleLLMDashboard', 'config.json') : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'kindle-llm-dashboard', 'config.json');
}

export async function readCollectorConfig(path = defaultConfigPath()) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (!config?.ingestUrl || !config?.ingestToken) throw new Error('Collector configuration is incomplete');
  return { ingestUrl: String(config.ingestUrl), ingestToken: String(config.ingestToken), codexCommand: config.codexCommand || 'codex', timeoutMs: Math.min(120000, Math.max(1000, Number(config.timeoutMs) || 30000)), timeZone: config.timeZone || 'Asia/Taipei' };
}

export function validateIngestUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) throw new Error('Ingest URL must use HTTPS');
  return url;
}
