import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function stateRoot() {
  if (process.env.KINDLE_LLM_DASH_STATE_ROOT) return process.env.KINDLE_LLM_DASH_STATE_ROOT;
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'KindleLLMDashboard', 'state');
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'kindle-llm-dashboard');
}

export function statePath(name, root = stateRoot()) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new TypeError('Invalid state name');
  return join(root, name);
}
