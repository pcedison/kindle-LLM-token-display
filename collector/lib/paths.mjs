import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function stateRoot({
  platformName = platform(),
  home = homedir(),
  env = process.env,
} = {}) {
  if (env.KINDLE_LLM_DASH_STATE_ROOT) return env.KINDLE_LLM_DASH_STATE_ROOT;
  if (platformName === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'KindleLLMDashboard', 'state');
  }
  if (platformName === 'darwin') {
    return join(home, 'Library', 'Application Support', 'KindleLLMDashboard', 'state');
  }
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'kindle-llm-dashboard');
}

export function statePath(name, root = stateRoot()) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new TypeError('Invalid state name');
  return join(root, name);
}
