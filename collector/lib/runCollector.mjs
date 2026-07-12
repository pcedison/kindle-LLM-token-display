import { readCodexRateLimits } from './codexRateLimits.mjs';
import { readCollectorConfig } from './collectorConfig.mjs';
import { withCollectorLock } from './collectorLock.mjs';
import { resolveIngestToken } from './collectorSecret.mjs';
import { stateRoot } from './paths.mjs';
import { buildMergedLocalSnapshot, uploadSnapshot } from './uploadClient.mjs';

const MODES = new Set(['claude-event', 'scheduled-sync']);

export async function runCollector({ mode = 'scheduled-sync', configPath, deps = {} } = {}) {
  if (!MODES.has(mode)) {
    throw new TypeError('Unsupported collector mode');
  }

  const readConfig = deps.readCollectorConfig || readCollectorConfig;
  const resolveToken = deps.resolveIngestToken || resolveIngestToken;
  const lock = deps.withCollectorLock || withCollectorLock;
  const readCodex = deps.readCodexRateLimits || readCodexRateLimits;
  const buildSnapshot = deps.buildMergedLocalSnapshot || buildMergedLocalSnapshot;
  const upload = deps.uploadSnapshot || uploadSnapshot;
  const rootSource = deps.stateRoot || stateRoot;
  const root = typeof rootSource === 'function' ? rootSource() : rootSource;
  const config = await readConfig(configPath);

  return lock({
    stateRoot: root,
    action: async () => {
      const ingestToken = await resolveToken(config, deps.secretDependencies);
      let codex = null;
      if (mode === 'scheduled-sync') {
        try {
          codex = {
            windows: await readCodex({
              command: config.codexCommand,
              timeoutMs: config.timeoutMs,
            }),
          };
        } catch {
          // A failed provider read must not erase locally retained data.
        }
      }

      const providerNames = mode === 'claude-event'
        ? ['claude']
        : ['claude', 'codex'];
      const snapshot = await buildSnapshot({
        stateRoot: root,
        codex,
        providerNames,
      });
      return upload({
        snapshot,
        ingestUrl: config.ingestUrl,
        ingestToken,
        stateRoot: root,
        timeoutMs: config.timeoutMs,
        fetch: deps.fetch,
      });
    },
  });
}
