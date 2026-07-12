import { formatClaudeStatusLine, parseClaudeStatus } from './lib/claudeStatus.mjs';
import { defaultConfigPath } from './lib/collectorConfig.mjs';
import { readJsonState, writeJsonStateAtomic } from './lib/localState.mjs';
import { triggerClaudeUpload } from './lib/triggerUpload.mjs';

const stateName = 'claude.json';
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const snapshot = parseClaudeStatus(input);
  const prior = await readJsonState(stateName);
  const windows = { ...(prior?.windows || {}), ...snapshot.windows };
  const collectedAt = new Date(Math.max(
    ...Object.values(windows).map((window) => Date.parse(window.collectedAt || snapshot.collectedAt)),
  )).toISOString();
  const effective = { collectedAt, windows };
  if (Object.keys(snapshot.windows).length) await writeJsonStateAtomic(stateName, effective);
  process.stdout.write(`${formatClaudeStatusLine(effective)}\n`);
  if (Object.keys(snapshot.windows).length) {
    const configArgument = process.argv.find((argument) => argument.startsWith('--config='));
    triggerClaudeUpload({
      configPath: configArgument?.slice('--config='.length) || defaultConfigPath(),
    });
  }
} catch {
  process.stderr.write('Claude status-line input rejected\n');
  process.exitCode = 1;
}
