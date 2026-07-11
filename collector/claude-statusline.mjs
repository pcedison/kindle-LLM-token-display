import { formatClaudeStatusLine, parseClaudeStatus } from './lib/claudeStatus.mjs';
import { readJsonState, writeJsonStateAtomic } from './lib/localState.mjs';

const stateName = 'claude.json';
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const snapshot = parseClaudeStatus(input);
  const prior = await readJsonState(stateName);
  const effective = { collectedAt: snapshot.collectedAt, windows: { ...(prior?.windows || {}), ...snapshot.windows } };
  if (Object.keys(snapshot.windows).length) await writeJsonStateAtomic(stateName, effective);
  process.stdout.write(`${formatClaudeStatusLine(effective)}\n`);
} catch {
  process.stderr.write('Claude status-line input rejected\n');
  process.exitCode = 1;
}
