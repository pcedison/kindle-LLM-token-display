import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mapCodexRateLimits, readCodexRateLimits } from '../collector/lib/codexRateLimits.mjs';

function successfulChild() {
  return {
    stdin: { write() {}, end() {} },
    stdout: (async function* () {
      yield `${JSON.stringify({ id: 3, result: { rateLimits: { primary: { usedPercent: 1, resetsAt: 1700000000, windowDurationMins: 300 } } } })}\n`;
    })(),
    kill() {},
  };
}

test('maps Codex windows by duration and prefers codex limit id', () => {
  const result = {
    rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 12, resetsAt: 1700000000, windowDurationMins: 300 },
      secondary: { usedPercent: 34, resetsAt: 1700001000, windowDurationMins: 10080 },
    } },
    rateLimits: { primary: { usedPercent: 99, resetsAt: 1700000001, windowDurationMins: 300 } },
  };
  assert.deepEqual(mapCodexRateLimits(result), { fiveHour: { usedPercent: 12, resetsAt: 1700000000 }, sevenDay: { usedPercent: 34, resetsAt: 1700001000 } });
});

test('falls back to the official rateLimits object', () => {
  assert.deepEqual(mapCodexRateLimits({ rateLimits: { one: { usedPercent: 8, resetsAt: 1700000000, windowDurationMins: 10080 } } }), { sevenDay: { usedPercent: 8, resetsAt: 1700000000 } });
});

test('reads official app-server JSONL handshake and cleans up child', async () => {
  const sent = [];
  let killed = false;
  const child = {
    stdin: { write(value) { sent.push(JSON.parse(value)); }, end() {} },
    stdout: (async function* () { yield JSON.stringify({ id: 1, result: {} }) + '\n'; yield JSON.stringify({ id: 2, result: {} }) + '\n'; yield JSON.stringify({ id: 3, result: { rateLimits: { primary: { usedPercent: 1, resetsAt: 1700000000, windowDurationMins: 300 } } } }) + '\n'; })(),
    stderr: (async function* () { })(),
    kill() { killed = true; },
    once(event, handler) { if (event === 'close') this.close = handler; return this; },
  };
  const result = await readCodexRateLimits({ spawn: () => child, command: 'codex', timeoutMs: 1000 });
  assert.equal(result.fiveHour.usedPercent, 1);
  assert.deepEqual(sent.map((message) => message.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(sent[0].params.clientInfo.title, 'Kindle LLM Token Dashboard');
  assert.equal(killed, true);
});

test('keeps a carry buffer when the JSONL response is split across chunks', async () => {
  const child = {
    stdin: { write() {}, end() {} },
    stdout: (async function* () { const line = JSON.stringify({ id: 3, result: { rateLimits: { one: { usedPercent: 2, resetsAt: 1700000000, windowDurationMins: 300 } } } }) + '\n'; yield line.slice(0, 19); yield line.slice(19); })(),
    kill() {},
  };
  const result = await readCodexRateLimits({ spawn: () => child, timeoutMs: 1000 });
  assert.equal(result.fiveHour.usedPercent, 2);
});

test('rejects a Codex timeout deterministically and cleans up a child with open stdout', async () => {
  let killed = 0;
  const child = { stdin: { write() {}, end() {} }, stdout: (async function* () { await new Promise(() => {}); })(), kill() { killed += 1; } };
  await assert.rejects(readCodexRateLimits({ spawn: () => child, timeoutMs: 10 }), /timed out/);
  assert.equal(killed, 1);
});

test('sanitizes asynchronous spawn errors and drains child stderr', async () => {
  let drained = false;
  let killed = false;
  const child = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.stdout = (async function* () { await new Promise(() => {}); })();
  child.stderr = { resume() { drained = true; } };
  child.kill = () => { killed = true; };
  const pending = readCodexRateLimits({ spawn: () => child, timeoutMs: 1000 });
  queueMicrotask(() => child.emit('error', new Error('SENTINEL_PRIVATE_PATH')));
  await assert.rejects(pending, (error) => error.message === 'Codex app-server unavailable');
  assert.equal(drained, true);
  assert.equal(killed, true);
});

test('launches Windows command shims through cmd.exe with fixed safe arguments', async () => {
  const comspec = 'C:\\Windows\\System32\\cmd.exe';

  for (const extension of ['cmd', 'bat']) {
    let invocation;
    const command = `C:\\Program Files\\Codex\\codex.${extension}`;
    await readCodexRateLimits({
      command,
      platform: 'win32',
      env: { ComSpec: comspec },
      spawn(...args) {
        invocation = args;
        return successfulChild();
      },
      timeoutMs: 1000,
    });

    assert.equal(invocation[0], comspec);
    assert.deepEqual(invocation[1], ['/d', '/s', '/c', `""${command}" "app-server" "--stdio""`]);
    assert.deepEqual(invocation[2], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
    });
  }
});

test('launches ordinary Windows executables directly without a shell', async () => {
  let invocation;
  const command = 'C:\\Program Files\\Codex\\codex.exe';
  await readCodexRateLimits({
    command,
    platform: 'win32',
    spawn(...args) {
      invocation = args;
      return successfulChild();
    },
    timeoutMs: 1000,
  });

  assert.equal(invocation[0], command);
  assert.deepEqual(invocation[1], ['app-server', '--stdio']);
  assert.deepEqual(invocation[2], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
});

test('rejects unsafe Windows command shim text before spawning', async () => {
  let spawned = false;
  await assert.rejects(
    readCodexRateLimits({
      command: 'codex.cmd" & whoami & rem ".cmd',
      platform: 'win32',
      spawn() {
        spawned = true;
        return successfulChild();
      },
    }),
    (error) => error.message === 'Codex app-server unavailable',
  );
  assert.equal(spawned, false);
});
