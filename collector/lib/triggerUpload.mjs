import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { defaultConfigPath } from './collectorConfig.mjs';

const defaultUploadPath = fileURLToPath(new URL('../upload.mjs', import.meta.url));

export function triggerClaudeUpload({
  configPath = defaultConfigPath(),
  spawn = spawnChild,
  execPath = process.execPath,
  uploadPath = defaultUploadPath,
} = {}) {
  try {
    const child = spawn(execPath, [
      uploadPath,
      '--mode=claude-event',
      `--config=${configPath}`,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
