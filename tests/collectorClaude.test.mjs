import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatClaudeStatusLine, parseClaudeStatus } from '../collector/lib/claudeStatus.mjs';
import { runCollector } from '../collector/lib/runCollector.mjs';
import { triggerClaudeUpload } from '../collector/lib/triggerUpload.mjs';

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
  const collectedAt = '2026-07-12T08:00:00.000Z';
  const snapshot = parseClaudeStatus(input, { now: () => Date.parse(collectedAt) });
  assert.deepEqual(snapshot.windows, {
    fiveHour: { usedPercent: 4, resetsAt: 1783678200, collectedAt },
    sevenDay: { usedPercent: 11, resetsAt: 1784250000, collectedAt },
  });
  assert.equal(Object.hasOwn(snapshot, 'email'), false);
  assert.equal(JSON.stringify(snapshot).includes('sentinel'), false);
});

test('claude event uploads saved Claude state without starting Codex', async () => {
  let codexReads = 0;
  let includedProviders;
  const result = await runCollector({
    mode: 'claude-event',
    configPath: 'fixture-config.json',
    deps: {
      readCollectorConfig: async () => ({ ingestUrl: 'https://example.test/api/usage' }),
      resolveIngestToken: async () => 'fixture-secret',
      stateRoot: () => 'fixture-state',
      readCodexRateLimits: async () => { codexReads += 1; return {}; },
      buildMergedLocalSnapshot: async (options) => {
        includedProviders = options.providerNames;
        return {
          version: 2,
          collectedAt: '2026-07-12T08:00:00.000Z',
          providers: { claude: { windows: { fiveHour: {
            usedPercent: 10,
            resetsAt: 1783843200,
            collectedAt: '2026-07-12T08:00:00.000Z',
          } } } },
        };
      },
      uploadSnapshot: async () => ({ uploaded: true }),
      withCollectorLock: async ({ action }) => action(),
    },
  });

  assert.equal(codexReads, 0);
  assert.deepEqual(includedProviders, ['claude']);
  assert.equal(result.uploaded, true);
});

test('scheduled sync reads Codex and includes both provider spools', async () => {
  let codexReads = 0;
  let buildOptions;
  await runCollector({
    mode: 'scheduled-sync',
    deps: {
      readCollectorConfig: async () => ({
        ingestUrl: 'https://example.test/api/usage',
        codexCommand: 'codex',
        timeoutMs: 1000,
      }),
      resolveIngestToken: async () => 'fixture-secret',
      stateRoot: () => 'fixture-state',
      readCodexRateLimits: async () => {
        codexReads += 1;
        return { fiveHour: { usedPercent: 12, resetsAt: 1783843200 } };
      },
      buildMergedLocalSnapshot: async (options) => {
        buildOptions = options;
        return { version: 2, collectedAt: '2026-07-12T08:00:00.000Z', providers: {} };
      },
      uploadSnapshot: async () => ({ uploaded: false }),
      withCollectorLock: async ({ action }) => action(),
    },
  });

  assert.equal(codexReads, 1);
  assert.deepEqual(buildOptions.providerNames, ['claude', 'codex']);
  assert.equal(buildOptions.codex.windows.fiveHour.usedPercent, 12);
});

test('Claude upload trigger starts a hidden detached one-shot process', () => {
  let invocation;
  let unrefCalls = 0;
  const started = triggerClaudeUpload({
    configPath: 'C:\\Config Folder\\config.json',
    execPath: 'C:\\Program Files\\node.exe',
    uploadPath: 'C:\\Collector\\upload.mjs',
    spawn(...args) {
      invocation = args;
      return { unref() { unrefCalls += 1; } };
    },
  });

  assert.equal(started, true);
  assert.deepEqual(invocation, [
    'C:\\Program Files\\node.exe',
    [
      'C:\\Collector\\upload.mjs',
      '--mode=claude-event',
      '--config=C:\\Config Folder\\config.json',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  ]);
  assert.equal(unrefCalls, 1);
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

async function runStatuslineCollector(stateRoot, payload) {
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
  await runStatuslineCollector(root, { rate_limits: { five_hour: { used_percentage: 4, resets_at: 1783678200 }, seven_day: { used_percentage: 11, resets_at: 1784250000 } } });
  const first = JSON.parse(await readFile(join(root, 'claude.json'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await runStatuslineCollector(root, { rate_limits: { five_hour: { used_percentage: 8, resets_at: 1783678200 } } });
  const saved = JSON.parse(await readFile(join(root, 'claude.json'), 'utf8'));
  assert.equal(saved.windows.sevenDay.usedPercent, 11);
  assert.equal(saved.windows.sevenDay.collectedAt, first.windows.sevenDay.collectedAt);
  assert.notEqual(saved.windows.fiveHour.collectedAt, first.windows.fiveHour.collectedAt);
  await rm(root, { recursive: true, force: true });
});

test('partial status child updates preserve the prior five-hour window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collector-partial-'));
  await runStatuslineCollector(root, { rate_limits: { five_hour: { used_percentage: 4, resets_at: 1783678200 }, seven_day: { used_percentage: 11, resets_at: 1784250000 } } });
  await runStatuslineCollector(root, { rate_limits: { seven_day: { used_percentage: 18, resets_at: 1784250000 } } });
  const saved = JSON.parse(await readFile(join(root, 'claude.json'), 'utf8'));
  assert.equal(saved.windows.fiveHour.usedPercent, 4);
  await rm(root, { recursive: true, force: true });
});
