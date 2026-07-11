import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatClaudeStatusLine, parseClaudeStatus } from '../collector/lib/claudeStatus.mjs';

const input = JSON.stringify({
  email: 'sentinel@example.com',
  transcript_path: 'C:/secret/transcript.jsonl',
  rate_limits: {
    five_hour: { used_percentage: 4, resets_at: 1783678200 },
    seven_day: { used_percentage: 11, resets_at: 1784250000 },
  },
  arbitrary: 'must disappear',
});

test('parses only official Claude rate-limit fields into a sanitized snapshot', () => {
  const snapshot = parseClaudeStatus(input);
  assert.deepEqual(snapshot.windows, {
    fiveHour: { usedPercent: 4, resetsAt: 1783678200 },
    sevenDay: { usedPercent: 11, resetsAt: 1784250000 },
  });
  assert.equal(Object.hasOwn(snapshot, 'email'), false);
  assert.equal(JSON.stringify(snapshot).includes('sentinel'), false);
});

test('formats finite percentages as remaining quota', () => {
  assert.equal(formatClaudeStatusLine({ windows: {
    fiveHour: { usedPercent: 4, resetsAt: 1783678200 },
    sevenDay: { usedPercent: 11, resetsAt: 1784250000 },
  } }), 'Claude quota | 5h 96% | 7d 89%');
  assert.equal(formatClaudeStatusLine({ windows: {} }), 'Claude quota | waiting for first response');
});

test('accepts only shared contract reset epoch boundaries', () => {
  const min = 1577836800;
  const max = 4102444800;
  assert.equal(parseClaudeStatus(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1, resets_at: min } } })).windows.fiveHour.resetsAt, min);
  assert.equal(parseClaudeStatus(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1, resets_at: max } } })).windows.fiveHour.resetsAt, max);
  for (const resetsAt of [min - 1, max + 1, 1, 'not-a-number']) {
    assert.deepEqual(parseClaudeStatus(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1, resets_at: resetsAt } } })).windows, {});
  }
});

test('malformed child input exits nonzero without echoing sensitive input', async () => {
  const sentinel = 'SENSITIVE_SENTINEL_7f9b';
  const child = spawn(process.execPath, ['collector/claude-statusline.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, KINDLE_LLM_DASH_STATE_ROOT: await mkdtemp(join(tmpdir(), 'collector-')) },
  });
  child.stdin.end(`{"email":"${sentinel}",`);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.notEqual(code, 0);
  assert.equal(`${stdout}${stderr}`.includes(sentinel), false);
});

async function runCollector(stateRoot, payload) {
  const child = spawn(process.execPath, ['collector/claude-statusline.mjs'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, KINDLE_LLM_DASH_STATE_ROOT: stateRoot },
  });
  child.stdin.end(JSON.stringify(payload));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`collector failed: ${stderr}`);
  return stdout;
}

test('partial status child updates preserve the prior seven-day window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-partial-'));
  await runCollector(root, { rate_limits: { five_hour: { used_percentage: 4, resets_at: 1783678200 }, seven_day: { used_percentage: 11, resets_at: 1784250000 } } });
  await runCollector(root, { rate_limits: { five_hour: { used_percentage: 8, resets_at: 1783678200 } } });
  const saved = JSON.parse(await readFile(join(root, 'claude.json'), 'utf8'));
  assert.equal(saved.windows.sevenDay.usedPercent, 11);
  await rm(root, { recursive: true, force: true });
});

test('partial status child updates preserve the prior five-hour window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-partial-'));
  await runCollector(root, { rate_limits: { five_hour: { used_percentage: 4, resets_at: 1783678200 }, seven_day: { used_percentage: 11, resets_at: 1784250000 } } });
  await runCollector(root, { rate_limits: { seven_day: { used_percentage: 18, resets_at: 1784250000 } } });
  const saved = JSON.parse(await readFile(join(root, 'claude.json'), 'utf8'));
  assert.equal(saved.windows.fiveHour.usedPercent, 4);
  await rm(root, { recursive: true, force: true });
});
