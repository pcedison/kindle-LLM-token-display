import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const paths = {
  install: fileURLToPath(new URL('../collector/install-macos.sh', import.meta.url)),
  diagnose: fileURLToPath(new URL('../collector/diagnose-macos.sh', import.meta.url)),
  uninstall: fileURLToPath(new URL('../collector/uninstall-macos.sh', import.meta.url)),
  keychainHelper: fileURLToPath(new URL('../collector/lib/macos-keychain.js', import.meta.url)),
  docs: fileURLToPath(new URL('../docs/MACOS-COLLECTOR.md', import.meta.url)),
};
const bashPath = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
].find(existsSync) || 'bash';

function toBashPath(path) {
  return path
    .replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll('\\', '/');
}

function source(name) {
  return readFileSync(paths[name], 'utf8');
}

function writeExecutable(path, content) {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kindle mac collector '));
  const home = join(root, 'Home With Spaces');
  const bin = join(root, 'fake-bin');
  const commandLog = join(root, 'commands.log');
  const keychainPath = join(root, 'keychain.secret');
  const legacyKeychainPath = join(root, 'legacy-keychain.secret');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, 'security'), `#!/bin/sh
printf 'security:%s\n' "$*" >> "$KINDLE_LLM_COMMAND_LOG"
case "$1" in
  find-generic-password) [ -s "$KINDLE_LLM_FAKE_LEGACY_KEYCHAIN" ] ;;
  delete-generic-password)
    [ "\${KINDLE_LLM_FAIL_LEGACY_DELETE:-0}" -ne 1 ] || exit 47
    rm -f "$KINDLE_LLM_FAKE_LEGACY_KEYCHAIN"
    ;;
  *) exit 46 ;;
esac
`);
  writeExecutable(join(bin, 'launchctl'), `#!/bin/sh
printf 'launchctl:%s\n' "$*" >> "$KINDLE_LLM_COMMAND_LOG"
exit 0
`);
  writeExecutable(join(bin, 'osascript'), `#!/bin/sh
token=''
printf 'osascript:%s\n' "$*" >> "$KINDLE_LLM_COMMAND_LOG"
case "$4" in
  write)
    IFS= read -r token || true
    [ -n "$token" ] || exit 45
    printf '%s' "$token" > "$KINDLE_LLM_FAKE_KEYCHAIN"
    [ "\${KINDLE_LLM_FAIL_KEYCHAIN_WRITE_AFTER_MUTATION:-0}" -ne 1 ] || exit 47
    ;;
  read)
    [ -s "$KINDLE_LLM_FAKE_KEYCHAIN" ] || exit 44
    cat "$KINDLE_LLM_FAKE_KEYCHAIN"
    ;;
  exists)
    [ -s "$KINDLE_LLM_FAKE_KEYCHAIN" ] || exit 44
    ;;
  delete)
    rm -f "$KINDLE_LLM_FAKE_KEYCHAIN"
    ;;
  *) exit 46 ;;
esac
token=''
exit 0
`);
  writeExecutable(join(bin, 'plutil'), `#!/bin/sh
printf 'plutil:%s\n' "$*" >> "$KINDLE_LLM_COMMAND_LOG"
exit 0
`);
  const env = {
    ...process.env,
    HOME: toBashPath(home),
    USER: 'fixture-user',
    KINDLE_LLM_COMMAND_LOG: toBashPath(commandLog),
    KINDLE_LLM_FAKE_KEYCHAIN: toBashPath(keychainPath),
    KINDLE_LLM_FAKE_LEGACY_KEYCHAIN: toBashPath(legacyKeychainPath),
    KINDLE_LLM_SECURITY_BIN: toBashPath(join(bin, 'security')),
    KINDLE_LLM_LAUNCHCTL_BIN: toBashPath(join(bin, 'launchctl')),
    KINDLE_LLM_PLUTIL_BIN: toBashPath(join(bin, 'plutil')),
    KINDLE_LLM_OSASCRIPT_BIN: toBashPath(join(bin, 'osascript')),
    KINDLE_LLM_NODE_BIN: toBashPath(process.execPath),
  };
  return { root, home, commandLog, keychainPath, legacyKeychainPath, env };
}

test('ships reversible macOS scripts and a public runbook', () => {
  for (const path of Object.values(paths)) {
    assert.equal(existsSync(path), true, `${path} must exist`);
  }
});

test('LaunchAgent and Keychain contract is 12-minute, one-shot, and secret-free', () => {
  const install = source('install');
  const keychainHelper = source('keychainHelper');
  assert.match(install, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(install, /<key>StartInterval<\/key>\s*<integer>720<\/integer>/);
  assert.match(install, /<key>KeepAlive<\/key>\s*<false\/>/);
  assert.doesNotMatch(install, /add-generic-password[^\n]+-w/);
  assert.match(install, /^set \+x$/m);
  assert.match(install, /KINDLE_LLM_OSASCRIPT_BIN/);
  assert.match(keychainHelper, /readDataOfLength/);
  assert.match(keychainHelper, /SecItemUpdate/);
  assert.match(keychainHelper, /SecItemAdd/);
  assert.match(keychainHelper, /SecItemCopyMatching/);
  assert.match(keychainHelper, /SecItemDelete/);
  const cleanup = install.slice(install.indexOf('cleanup()'));
  assert.ok(cleanup.indexOf('set +e') < cleanup.indexOf('write_keychain_token "$old_keychain_token"'));
  assert.ok(cleanup.indexOf('write_keychain_token "$old_keychain_token"') < cleanup.indexOf('rm -rf "$install_root"'));
  assert.ok(cleanup.indexOf('mv "$install_backup" "$install_root"') < cleanup.indexOf('bootstrap "gui/$(id -u)"'));
  assert.match(cleanup, /\[ "\$restore_agent" -eq 1 \] && \[ "\$rollback_failed" -eq 0 \]/);
  assert.match(install, /macos-keychain/);
  assert.match(install, /chmod 600 "\$config_path"/);
  assert.match(install, /chmod 600 "\$manifest_path"/);
  const plistTemplate = install.match(/<\?xml[\s\S]*?<\/plist>/)?.[0] || '';
  assert.doesNotMatch(plistTemplate, /ingestToken|Bearer\s|authorization/i);
});

test('all macOS scripts pass shell syntax validation', () => {
  for (const name of ['install', 'diagnose', 'uninstall']) {
    const result = spawnSync(bashPath, ['-n', toBashPath(paths[name])], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('installer handles spaces, writes no secret to files, and uninstall restores settings', () => {
  const fx = fixture();
  const settingsPath = join(fx.home, '.claude', 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }));
  writeFileSync(fx.legacyKeychainPath, 'legacy-fixture-token');
  try {
    const installed = spawnSync(bashPath, ['-x',
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], { env: fx.env, input: 'fixture-secret\n', encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.doesNotMatch(`${installed.stdout}${installed.stderr}`, /fixture-secret/);

    const installRoot = join(fx.home, 'Library', 'Application Support', 'KindleLLMDashboard');
    const configPath = join(installRoot, 'config.json');
    const manifestPath = join(installRoot, 'install-manifest.json');
    const plistPath = join(fx.home, 'Library', 'LaunchAgents', 'com.kindle-llm-dashboard.sync.plist');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const serialized = [
      readFileSync(configPath, 'utf8'),
      readFileSync(manifestPath, 'utf8'),
      readFileSync(plistPath, 'utf8'),
    ].join('\n');

    assert.equal(config.ingestTokenSource, 'macos-keychain');
    assert.equal(config.keychainService, 'KindleLLMDashboard.ingest.v2');
    if (process.platform !== 'win32') {
      assert.equal(statSync(configPath).mode & 0o777, 0o600);
    }
    assert.equal(manifest.owner, 'kindle-llm-dash/macos-collector');
    assert.match(settings.statusLine.command, /claude-statusline\.mjs/);
    assert.doesNotMatch(serialized, /fixture-secret/);
    assert.match(readFileSync(plistPath, 'utf8'), /<integer>720<\/integer>/);
    assert.match(readFileSync(fx.commandLog, 'utf8'), /osascript:-l JavaScript/);
    assert.doesNotMatch(readFileSync(fx.commandLog, 'utf8'), /fixture-secret/);
    assert.equal(existsSync(fx.legacyKeychainPath), false);

    const reinstalled = spawnSync(bashPath, [
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], { env: fx.env, input: 'fixture-secret-2\n', encoding: 'utf8' });
    assert.equal(reinstalled.status, 0, reinstalled.stderr || reinstalled.stdout);
    const reinstalledManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(reinstalledManifest.backupPath, manifest.backupPath);
    assert.doesNotMatch([
      readFileSync(configPath, 'utf8'),
      readFileSync(manifestPath, 'utf8'),
      readFileSync(plistPath, 'utf8'),
    ].join('\n'), /fixture-secret(?:-2)?/);

    const diagnosed = spawnSync(bashPath, [toBashPath(paths.diagnose)], { env: fx.env, encoding: 'utf8' });
    assert.equal(diagnosed.status, 0, diagnosed.stderr || diagnosed.stdout);
    assert.doesNotMatch(`${diagnosed.stdout}${diagnosed.stderr}`, /fixture-secret/);

    const uninstalled = spawnSync(bashPath, [toBashPath(paths.uninstall)], { env: fx.env, encoding: 'utf8' });
    assert.equal(uninstalled.status, 0, uninstalled.stderr || uninstalled.stdout);
    const restored = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(restored.theme, 'dark');
    assert.equal(Object.hasOwn(restored, 'statusLine'), false);
    assert.equal(existsSync(installRoot), false);
    assert.equal(existsSync(plistPath), false);
    assert.equal(existsSync(fx.keychainPath), false);
    assert.equal(existsSync(manifest.backupPath), true);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('installer refuses a foreign Claude status line before touching Keychain', () => {
  const fx = fixture();
  const settingsPath = join(fx.home, '.claude', 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({
    statusLine: { type: 'command', command: '/usr/local/bin/foreign-status' },
  }));
  try {
    const result = spawnSync(bashPath, [
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], { env: fx.env, input: 'fixture-secret\n', encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /foreign|refus/i);
    assert.equal(existsSync(fx.commandLog), false);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('installer rejects an oversized token before touching Keychain', () => {
  const fx = fixture();
  try {
    const result = spawnSync(bashPath, [
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], { env: fx.env, input: `${'x'.repeat(16385)}\n`, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /x{32}/);
    assert.equal(existsSync(fx.commandLog), false);
    assert.equal(existsSync(fx.keychainPath), false);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('installer accepts an exact 16384-byte token with CRLF framing', () => {
  const fx = fixture();
  try {
    const result = spawnSync(bashPath, [
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], { env: fx.env, input: `${'x'.repeat(16384)}\r\n`, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(statSync(fx.keychainPath).size, 16384);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /x{32}/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('installer removes a new item when the Keychain helper fails after mutation', () => {
  const fx = fixture();
  try {
    writeFileSync(fx.legacyKeychainPath, 'legacy-fixture-token');
    const result = spawnSync(bashPath, [
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], {
      env: { ...fx.env, KINDLE_LLM_FAIL_KEYCHAIN_WRITE_AFTER_MUTATION: '1' },
      input: 'fixture-secret\n',
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(fx.keychainPath), false);
    assert.equal(readFileSync(fx.legacyKeychainPath, 'utf8'), 'legacy-fixture-token');
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fixture-secret/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('legacy migration failure rolls back v2 and preserves the legacy item', () => {
  const fx = fixture();
  try {
    writeFileSync(fx.legacyKeychainPath, 'legacy-fixture-token');
    const result = spawnSync(bashPath, [
      toBashPath(paths.install),
      '--ingest-url', 'https://example.test/api/usage',
    ], {
      env: { ...fx.env, KINDLE_LLM_FAIL_LEGACY_DELETE: '1' },
      input: 'fixture-secret\n',
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(fx.keychainPath), false);
    assert.equal(readFileSync(fx.legacyKeychainPath, 'utf8'), 'legacy-fixture-token');
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fixture-secret/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('legacy uninstall reports Keychain deletion failure and preserves metadata', () => {
  const fx = fixture();
  const installRoot = join(fx.home, 'Library', 'Application Support', 'KindleLLMDashboard');
  const manifestPath = join(installRoot, 'install-manifest.json');
  const launchAgentPath = join(fx.home, 'Library', 'LaunchAgents', 'com.kindle-llm-dashboard.sync.plist');
  const settingsPath = join(fx.home, '.claude', 'settings.json');
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(fx.legacyKeychainPath, 'legacy-fixture-token');
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    owner: 'kindle-llm-dash/macos-collector',
    installRoot: toBashPath(installRoot),
    launchAgentPath: toBashPath(launchAgentPath),
    claudeSettingsPath: toBashPath(settingsPath),
    backupPath: null,
    statusLineCommand: 'fixture-command',
    keychainService: 'KindleLLMDashboard.ingest',
    keychainAccount: 'fixture-user',
  }));
  try {
    const result = spawnSync(bashPath, [toBashPath(paths.uninstall)], {
      env: { ...fx.env, KINDLE_LLM_FAIL_LEGACY_DELETE: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(manifestPath), true);
    assert.equal(readFileSync(fx.legacyKeychainPath, 'utf8'), 'legacy-fixture-token');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
