import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);

export async function resolveIngestToken(config, {
  platform = process.platform,
  execFile = execFileAsync,
} = {}) {
  if (config?.ingestToken) {
    return String(config.ingestToken);
  }

  if (platform === 'darwin' && config?.ingestTokenSource === 'macos-keychain') {
    const service = String(config.keychainService || '').trim();
    const account = String(config.keychainAccount || '').trim();
    if (!service) {
      throw new Error('Collector ingest credential is unavailable');
    }

    const args = ['find-generic-password', '-w', '-s', service];
    if (account) args.push('-a', account);
    try {
      const { stdout } = await execFile('/usr/bin/security', args);
      const token = String(stdout || '').trim();
      if (token) return token;
    } catch {
      // Keep Keychain details and command output out of collector logs.
    }
  }

  throw new Error('Collector ingest credential is unavailable');
}
