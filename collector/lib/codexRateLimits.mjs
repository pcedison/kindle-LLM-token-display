import { spawn as nodeSpawn } from 'node:child_process';

const valid = (w) => w && Number.isFinite(w.usedPercent) && Number.isInteger(w.resetsAt) && (w.windowDurationMins === 300 || w.windowDurationMins === 10080);
const APP_SERVER_ARGS = ['app-server', '--stdio'];
const UNSAFE_CMD_PATTERN = /["\r\n\0&|<>^%!]/;

function codexSpawnSpec(command, platform, env) {
  const options = { shell: false, stdio: ['pipe', 'pipe', 'pipe'] };
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args: APP_SERVER_ARGS, options };
  }
  if (UNSAFE_CMD_PATTERN.test(command)) throw new TypeError('Unsafe command shim');
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `""${command}" "app-server" "--stdio""`],
    options: { ...options, windowsVerbatimArguments: true },
  };
}

export function mapCodexRateLimits(result) {
  const source = result?.rateLimitsByLimitId?.codex || result?.rateLimits || {};
  const windows = {};
  for (const value of Object.values(source)) {
    if (!valid(value)) continue;
    const key = value.windowDurationMins === 300 ? 'fiveHour' : 'sevenDay';
    windows[key] = { usedPercent: Math.min(100, Math.max(0, value.usedPercent)), resetsAt: value.resetsAt };
  }
  return windows;
}

export async function readCodexRateLimits({ command = 'codex', spawn = nodeSpawn, timeoutMs = 30000, platform = process.platform, env = process.env } = {}) {
  let child;
  try {
    const spec = codexSpawnSpec(command, platform, env);
    child = spawn(spec.command, spec.args, spec.options);
  } catch { throw new Error('Codex app-server unavailable'); }
  let timer; let timedOut = false; let cleaned = false;
  const kill = () => { if (cleaned) return; cleaned = true; try { child.kill(); } catch {} };
  try {
    child.stdin?.on?.('error', () => {});
    if (child.stderr?.resume) child.stderr.resume();
    else if (child.stderr) void (async () => { try { for await (const _ of child.stderr) {} } catch {} })();
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'kindle_llm_token_dashboard', title: 'Kindle LLM Token Dashboard', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'initialized', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'account/rateLimits/read', params: {} },
    ];
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    const response = new Promise(async (resolve, reject) => {
      let carry = '';
      try {
        for await (const chunk of child.stdout) {
          carry += String(chunk);
          const lines = carry.split(/\r?\n/);
          carry = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let parsed; try { parsed = JSON.parse(line); } catch { continue; }
            if (parsed.id === 3) return parsed.error ? reject(new Error('Codex rate limits unavailable')) : resolve(parsed.result);
          }
        }
        reject(new Error('Codex app-server closed'));
      } catch { reject(new Error('Codex app-server unavailable')); }
    });
    const childError = new Promise((_, reject) => child.once?.('error', () => reject(new Error('Codex app-server unavailable'))));
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; kill(); reject(new Error('Codex app-server timed out')); }, timeoutMs); });
    return mapCodexRateLimits(await Promise.race([response, timeout, childError]));
  } catch (error) { if (timedOut || error?.message === 'Codex app-server timed out') throw error; throw new Error('Codex app-server unavailable'); }
  finally { clearTimeout(timer); kill(); try { child.stdin.end(); } catch {} }
}
