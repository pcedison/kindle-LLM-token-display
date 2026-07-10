import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const shell = process.platform === 'win32' ? 'bash.exe' : 'sh';
const shellFlag = process.platform === 'win32' ? '-lc' : '-c';

function runShell(command, { allowFailure = false } = {}) {
  const result = spawnSync(
    shell,
    [shellFlag, `. ./kindle-extension/local/dashboard-utils.sh; ${command}`],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  const shellResult = {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
  };

  if (allowFailure) return shellResult;

  assert.equal(shellResult.status, 0, shellResult.stderr);
  return shellResult.stdout;
}

test('normalizes only exact Kindle battery values', () => {
  assert.equal(runShell("normalize_battery_level '72%'"), '72');
  assert.equal(runShell("normalize_battery_level ' 0 '"), '0');
  assert.equal(runShell("normalize_battery_level '100'"), '100');
  assert.equal(runShell("normalize_battery_level '-5%'", { allowFailure: true }).status, 1);
  assert.equal(runShell("normalize_battery_level '101%'", { allowFailure: true }).status, 1);
  for (const value of ['7 2', '72%%', '1%00', '%72', '72 %']) {
    const result = runShell("normalize_battery_level '" + value + "'", { allowFailure: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});

test('appends the battery query parameter before an optional fragment', () => {
  assert.equal(
    runShell("append_query_param 'https://example.test/api' battery 72"),
    'https://example.test/api?battery=72',
  );
  assert.equal(
    runShell("append_query_param 'https://example.test/api?profile=dp75sdi' battery 72"),
    'https://example.test/api?profile=dp75sdi&battery=72',
  );
  assert.equal(
    runShell("append_query_param 'https://example.test/api#fragment' battery 72"),
    'https://example.test/api?battery=72#fragment',
  );
  assert.equal(
    runShell("append_query_param 'https://example.test/api?profile=dp75sdi#fragment' battery 72"),
    'https://example.test/api?profile=dp75sdi&battery=72#fragment',
  );
});

test('reads a valid diagnostic battery value and rejects invalid values', () => {
  const valid = spawnSync(shell, [shellFlag, "./kindle-extension/local/get-battery-level.sh '72%'"], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), '72');

  const invalid = spawnSync(shell, [shellFlag, "./kindle-extension/local/get-battery-level.sh '101%'"], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
});

test('uses LIPC after an invalid gasgauge result and does not consult powerd_test', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-scripts-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const powerdMarker = join(directory, 'powerd-ran');

  writeFileSync(join(directory, 'gasgauge-info'), '#!/usr/bin/env sh\nprintf \'1%%00\\n\'\n');
  writeFileSync(join(directory, 'lipc-get-prop'), '#!/usr/bin/env sh\nprintf \'64%%\\n\'\n');
  writeFileSync(
    join(directory, 'powerd_test'),
    '#!/usr/bin/env sh\nprintf invoked > "$POWERD_MARKER"\nprintf \'Battery Level: 51%%\\n\'\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        'chmod +x "$PWD/' + fixture + '/gasgauge-info" "$PWD/' + fixture + '/lipc-get-prop" "$PWD/' + fixture + '/powerd_test"; PATH="$PWD/' + fixture + ':$PATH" BATTERY_SYSFS_ROOT="$PWD/' + fixture + '/sys" POWERD_MARKER="$PWD/' + fixture + '/powerd-ran" ./kindle-extension/local/get-battery-level.sh',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '64');
    assert.equal(existsSync(powerdMarker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses an isolated Kindle sysfs battery_capacity before LIPC', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-scripts-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const sysfsBattery = join(
    directory,
    'sys',
    'devices',
    'system',
    'yoshi_battery',
    'yoshi_battery0',
    'battery_capacity',
  );
  const lipcMarker = join(directory, 'lipc-ran');

  mkdirSync(join(sysfsBattery, '..'), { recursive: true });
  writeFileSync(sysfsBattery, '58%\n');
  writeFileSync(join(directory, 'gasgauge-info'), '#!/usr/bin/env sh\nprintf \'invalid\\n\'\n');
  writeFileSync(
    join(directory, 'lipc-get-prop'),
    '#!/usr/bin/env sh\nprintf invoked > "$LIPC_MARKER"\nprintf \'64%%\\n\'\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        'chmod +x "$PWD/' + fixture + '/gasgauge-info" "$PWD/' + fixture + '/lipc-get-prop"; PATH="$PWD/' + fixture + ':$PATH" BATTERY_SYSFS_ROOT="$PWD/' + fixture + '/sys" LIPC_MARKER="$PWD/' + fixture + '/lipc-ran" ./kindle-extension/local/get-battery-level.sh',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '58');
    assert.equal(existsSync(lipcMarker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('parses the final powerd_test Battery Level after earlier sources fail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-scripts-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');

  writeFileSync(join(directory, 'gasgauge-info'), '#!/usr/bin/env sh\nprintf \'invalid\\n\'\n');
  writeFileSync(join(directory, 'lipc-get-prop'), '#!/usr/bin/env sh\nprintf \'invalid\\n\'\n');
  writeFileSync(
    join(directory, 'powerd_test'),
    '#!/usr/bin/env sh\nprintf \'Power status\\nBattery Level: 47%%\'\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        'chmod +x "$PWD/' + fixture + '/gasgauge-info" "$PWD/' + fixture + '/lipc-get-prop" "$PWD/' + fixture + '/powerd_test"; PATH="$PWD/' + fixture + ':$PATH" BATTERY_SYSFS_ROOT="$PWD/' + fixture + '/sys" ./kindle-extension/local/get-battery-level.sh',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '47');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses the first valid battery source and forwards it without logging the configured URL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-scripts-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const capture = join(directory, 'fetch-url');
  const output = join(directory, 'dashboard.png');

  writeFileSync(join(directory, 'gasgauge-info'), '#!/usr/bin/env sh\nprintf \'73%%\\n\'\n');
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nprintf \'PNG\' > "$3"\nprintf \'%s\\n\' "$4" > "$CAPTURE"\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `chmod +x "$PWD/${fixture}/gasgauge-info" "$PWD/${fixture}/wget"; PATH="$PWD/${fixture}:$PATH" CAPTURE="$PWD/${fixture}/fetch-url" DASHBOARD_URL='https://example.test/api?token=private' ./kindle-extension/local/fetch-dashboard.sh "$PWD/${fixture}/dashboard.png"`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(capture, 'utf8').trim(), 'https://example.test/api?token=private&battery=73');
    assert.equal(readFileSync(output, 'utf8'), 'PNG');
    assert.match(result.stdout, /battery=73/);
    assert.doesNotMatch(result.stdout, /https:\/\/example\.test\/api\?token=private/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('finds an overridden duration RTC path and writes suspend inputs without suspending the host', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-rtc-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const rtcPath = join(directory, 'wakeup_enable');
  const powerStatePath = join(directory, 'power_state');

  writeFileSync(rtcPath, '');
  writeFileSync(powerStatePath, '');

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `export RTC_WAKE_PATH="$PWD/${fixture}/wakeup_enable"; export POWER_STATE_PATH="$PWD/${fixture}/power_state"; . ./kindle-extension/local/dashboard-utils.sh; find_duration_rtc_path; suspend_for_seconds 60; printf '\\n'; cat "$PWD/${fixture}/wakeup_enable"; printf '|'; cat "$PWD/${fixture}/power_state"`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, RTC_WAKE_PATH: rtcPath, POWER_STATE_PATH: powerStatePath },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wakeup_enable/);
    assert.match(result.stdout, /60\|mem/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports no duration RTC path when the override is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-rtc-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `export RTC_WAKE_PATH="$PWD/${fixture}/missing"; . ./kindle-extension/local/dashboard-utils.sh; find_duration_rtc_path`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, RTC_WAKE_PATH: join(directory, 'missing') },
      },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ships the diagnostic and low-power probe actions without enabling RTC by default', () => {
  assert.equal(existsSync(join(process.cwd(), 'kindle-extension', 'diagnose.sh')), true);
  assert.equal(existsSync(join(process.cwd(), 'kindle-extension', 'low-power-test.sh')), true);

  const menu = readFileSync(join(process.cwd(), 'kindle-extension', 'menu.json'), 'utf8');
  assert.match(menu, /Low Power Test \(60 sec\)/);

  const env = readFileSync(join(process.cwd(), 'kindle-extension', 'local', 'env.sh'), 'utf8');
  assert.match(env, /DASHBOARD_USE_RTC=.*false/);
});

test('keeps RTC refresh opt-in and falls back to a full userspace sleep', () => {
  const env = readFileSync(join(process.cwd(), 'kindle-extension', 'local', 'env.sh'), 'utf8');
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');

  assert.match(env, /DASHBOARD_USE_RTC=.*false/);
  assert.match(dash, /suspend_for_seconds/);
  assert.match(dash, /com\.lab126\.wifid enable 0/);
  assert.match(dash, /sleep \"\$duration\"/);
});

test('diagnostics inspect standard Wario RTC interfaces without writing them', () => {
  const diagnose = readFileSync(join(process.cwd(), 'kindle-extension', 'diagnose.sh'), 'utf8');

  assert.match(diagnose, /\/sys\/class\/rtc\/rtc\*\/wakealarm/);
  assert.match(diagnose, /\/proc\/driver\/rtc/);
  assert.match(diagnose, /\/dev\/rtc\*/);
  assert.doesNotMatch(diagnose, />+\s*\"\$wakealarm\"/);
});
