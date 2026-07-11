import { readCollectorConfig } from './lib/collectorConfig.mjs';
import { readCodexRateLimits } from './lib/codexRateLimits.mjs';
import { buildMergedLocalSnapshot, uploadSnapshot } from './lib/uploadClient.mjs';
import { stateRoot } from './lib/paths.mjs';

try {
  const config = await readCollectorConfig(process.argv[2] || undefined);
  const root = stateRoot();
  let codex = null; try { codex = { windows: await readCodexRateLimits({ command: config.codexCommand, timeoutMs: config.timeoutMs }) }; } catch {}
  const snapshot = await buildMergedLocalSnapshot({ stateRoot: root, codex });
  await uploadSnapshot({ ...config, snapshot, stateRoot: root });
} catch { process.exitCode = 1; }
