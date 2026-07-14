import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const gitBash = String.raw`C:\Program Files\Git\bin\bash.exe`;
const shell = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'sh';
const shellFlag = process.platform === 'win32' ? '-lc' : '-c';

function runShell(command, env = {}) {
  return spawnSync(shell, [shellFlag, command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5_000,
  });
}

function makeFixture() {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-security-'));
  return {
    directory,
    shellPath: `$PWD/${relative(process.cwd(), directory).replaceAll('\\', '/')}`,
  };
}

test('HTTPS download failure never retries without certificate verification', () => {
  const { directory, shellPath } = makeFixture();
  const callsPath = join(directory, 'wget-calls');

  writeFileSync(join(directory, 'gasgauge-info'), "#!/usr/bin/env sh\nprintf '73%%\\n'\n");
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nprintf \'%s\\n\' "$*" >> "$CALLS"\nexit 60\n',
  );

  try {
    const result = runShell(
      `chmod +x "${shellPath}/gasgauge-info" "${shellPath}/wget"; PATH="${shellPath}:$PATH" CALLS="${shellPath}/wget-calls" ./kindle-extension/local/fetch-dashboard.sh "${shellPath}/dashboard.png"`,
      { DASHBOARD_URL: 'https://example.test/api?profile=dp75sdi&viewKey=TEST_ONLY' },
    );

    assert.notEqual(result.status, 0);
    const calls = readFileSync(callsPath, 'utf8').trim().split(/\r?\n/);
    assert.equal(calls.length, 1, `expected one fail-closed request, got:\n${calls.join('\n')}`);
    assert.doesNotMatch(calls[0], /--no-check-certificate|--insecure/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('xtrace fetch forwards the private URL without writing it to logs', () => {
  const { directory, shellPath } = makeFixture();
  const capturePath = join(directory, 'fetch-url');
  const outputPath = join(directory, 'dashboard.png');
  const privateUrl =
    'https://example.test/api?profile=dp75sdi&viewKey=TEST_VIEW_KEY_MUST_STAY_PRIVATE';

  writeFileSync(join(directory, 'gasgauge-info'), "#!/usr/bin/env sh\nprintf '73%%\\n'\n");
  writeFileSync(
    join(directory, 'wget'),
    `#!/usr/bin/env sh
out=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -O) shift; out=$1 ;;
    https://*) url=$1 ;;
  esac
  shift
done
cp docs/images/dashboard-dp75sdi.png "$out"
printf '%s\\n' "$url" > "$CAPTURE"
`,
  );

  try {
    const result = runShell(
      `chmod +x "${shellPath}/gasgauge-info" "${shellPath}/wget"; PATH="${shellPath}:$PATH" CAPTURE="${shellPath}/fetch-url" sh -x ./kindle-extension/local/fetch-dashboard.sh "${shellPath}/dashboard.png"`,
      { DASHBOARD_URL: privateUrl },
    );
    const logs = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, logs);
    assert.equal(readFileSync(capturePath, 'utf8').trim(), `${privateUrl}&battery=73`);
    assert.deepEqual(
      readFileSync(outputPath),
      readFileSync(join(process.cwd(), 'docs', 'images', 'dashboard-dp75sdi.png')),
    );
    assert.match(logs, /fetch-dashboard: battery=73/);
    assert.doesNotMatch(logs, /TEST_VIEW_KEY_MUST_STAY_PRIVATE/);
    assert.doesNotMatch(logs, /https:\/\/example\.test\/api\?/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('DEBUG launcher sources the private URL without writing it to xtrace', () => {
  const { directory, shellPath } = makeFixture();
  const privateUrl =
    'https://example.test/api?profile=dp75sdi&viewKey=TEST_ENV_KEY_MUST_STAY_PRIVATE';

  writeFileSync(join(directory, 'sleep'), '#!/usr/bin/env sh\nkill -TERM "$PPID"\n');

  try {
    const result = runShell(
      `chmod +x "${shellPath}/sleep"; PATH="${shellPath}:$PATH" ./kindle-extension/dash.sh`,
      {
        DASHBOARD_URL: privateUrl,
        DEBUG: 'true',
        KUAL_SETTLE_DELAY_SECS: '0',
      },
    );
    const logs = `${result.stdout}${result.stderr}`;

    assert.notEqual(result.error?.code, 'ETIMEDOUT', logs);
    assert.match(logs, /Starting LLM token dashboard/);
    assert.doesNotMatch(logs, /TEST_ENV_KEY_MUST_STAY_PRIVATE/);
    assert.doesNotMatch(logs, /https:\/\/example\.test\/api\?/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('remote config xtrace forwards its private URL without logging it', () => {
  const { directory, shellPath } = makeFixture();
  const capturePath = join(directory, 'remote-url');
  const privateUrl =
    'https://example.test/api/device-config?profile=dp75sdi&key=REMOTE_KEY_MUST_STAY_PRIVATE';

  writeFileSync(
    join(directory, 'wget'),
    `#!/usr/bin/env sh
out=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -O) shift; out=$1 ;;
    https://*) url=$1 ;;
  esac
  shift
done
printf 'version=1\nrefresh_interval_seconds=720\n' > "$out"
printf '%s\n' "$url" > "$CAPTURE"
`,
  );

  try {
    const result = runShell(
      `chmod +x "${shellPath}/wget"; PATH="${shellPath}:$PATH" CAPTURE="${shellPath}/remote-url" sh -x ./kindle-extension/local/fetch-remote-config.sh`,
      { REMOTE_CONFIG_URL: privateUrl },
    );
    const logs = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, logs);
    assert.equal(result.stdout.trim(), '720');
    assert.equal(readFileSync(capturePath, 'utf8').trim(), privateUrl);
    assert.doesNotMatch(logs, /REMOTE_KEY_MUST_STAY_PRIVATE/);
    assert.doesNotMatch(logs, /https:\/\/example\.test\/api\/device-config/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
