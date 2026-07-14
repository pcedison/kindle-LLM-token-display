import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);
const macosKeychainHelper = fileURLToPath(new URL('./macos-keychain.js', import.meta.url));
const MAX_KEYCHAIN_SECRET_BYTES = 16384;
const MAX_KEYCHAIN_OUTPUT_BYTES = MAX_KEYCHAIN_SECRET_BYTES + 1024;

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
    if (!service || !account) {
      throw new Error('Collector ingest credential is unavailable');
    }

    try {
      const { stdout } = await execFile('/usr/bin/osascript', [
        '-l',
        'JavaScript',
        macosKeychainHelper,
        'read',
        service,
        account,
      ], {
        encoding: 'utf8',
        maxBuffer: MAX_KEYCHAIN_OUTPUT_BYTES,
        timeout: 30000,
        windowsHide: true,
      });
      const token = String(stdout || '').trim();
      if (token && Buffer.byteLength(token, 'utf8') <= MAX_KEYCHAIN_SECRET_BYTES) return token;
    } catch {
      // Keep Keychain details and command output out of collector logs.
    }
  }

  throw new Error('Collector ingest credential is unavailable');
}
