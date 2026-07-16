import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const gitBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const shell = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'sh';
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

test('accepts only bounded refresh intervals used by the dashboard daemon', () => {
  for (const value of ['10', '50', '60', '720', '900']) {
    assert.equal(runShell(`normalize_refresh_interval '${value}'`), value);
  }
  for (const value of ['', '0', '-1', '9', '11', '61', '901', 'abc', '10.5']) {
    assert.equal(
      runShell(`normalize_refresh_interval '${value}'`, { allowFailure: true }).status,
      1,
    );
  }

  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  assert.match(dash, /normalize_refresh_interval "\$\{REFRESH_INTERVAL_SECS:-720\}"/);
  assert.match(dash, /duration=\$\{1:-\$refresh_interval_secs\}/);
});

test('accepts only bounded integer download deadlines', () => {
  for (const value of ['1', '9', '10', '20', '59', '60']) {
    assert.equal(runShell(`normalize_download_timeout '${value}'`), value);
  }
  for (const value of ['', '0', '01', '1.5', '61', '-1', 'abc', '999999999999999999999999999999999999']) {
    assert.equal(
      runShell(`normalize_download_timeout '${value}'`, { allowFailure: true }).status,
      1,
    );
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
  const directory = mkdtempSync(join(process.cwd(), '.kindle-scripts-'));
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
  const directory = mkdtempSync(join(process.cwd(), '.kindle-scripts-'));
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
  const directory = mkdtempSync(join(process.cwd(), '.kindle-scripts-'));
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
  const directory = mkdtempSync(join(process.cwd(), '.kindle-scripts-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const capture = join(directory, 'fetch-url');
  const output = join(directory, 'dashboard.png');

  writeFileSync(join(directory, 'gasgauge-info'), '#!/usr/bin/env sh\nprintf \'73%%\\n\'\n');
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\ncp docs/images/dashboard-dp75sdi.png "$3"\nprintf \'%s\\n\' "$4" > "$CAPTURE"\n',
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
    assert.deepEqual(
      readFileSync(output),
      readFileSync(join(process.cwd(), 'docs', 'images', 'dashboard-dp75sdi.png')),
    );
    assert.match(result.stdout, /battery=73/);
    assert.doesNotMatch(result.stdout, /https:\/\/example\.test\/api\?token=private/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('finds an overridden duration RTC path and writes suspend inputs without suspending the host', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-rtc-'));
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
  const directory = mkdtempSync(join(process.cwd(), '.kindle-rtc-'));
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

test('schedules an epoch RTC wakealarm before writing the mem power state', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-wakealarm-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const wakealarmPath = join(directory, 'wakealarm');
  const sinceEpochPath = join(directory, 'since_epoch');
  const powerStatePath = join(directory, 'power_state');

  writeFileSync(wakealarmPath, '');
  writeFileSync(sinceEpochPath, '1700000000\n');
  writeFileSync(powerStatePath, '');

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `export RTC_WAKEALARM_PATH="$PWD/${fixture}/wakealarm"; export RTC_SINCE_EPOCH_PATH="$PWD/${fixture}/since_epoch"; export POWER_STATE_PATH="$PWD/${fixture}/power_state"; . ./kindle-extension/local/dashboard-utils.sh; find_epoch_rtc_path; suspend_for_seconds 60; printf '\\n'; cat "$PWD/${fixture}/wakealarm"; printf '|'; cat "$PWD/${fixture}/power_state"`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wakealarm/);
    assert.match(result.stdout, /1700000060\|mem/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects an epoch RTC whose clock is still near 1970', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-wakealarm-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');

  writeFileSync(join(directory, 'wakealarm'), '');
  writeFileSync(join(directory, 'since_epoch'), '69321\n');

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `export RTC_WAKEALARM_PATH="$PWD/${fixture}/wakealarm"; export RTC_SINCE_EPOCH_PATH="$PWD/${fixture}/since_epoch"; . ./kindle-extension/local/dashboard-utils.sh; find_epoch_rtc_path`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
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

test('queues one-shot draws after the KUAL action returns', () => {
  const menu = JSON.parse(
    readFileSync(join(process.cwd(), 'kindle-extension', 'menu.json'), 'utf8'),
  );
  const cachedItem = menu.items.find((item) => item.name === 'Display Cached Dashboard');
  assert.equal(cachedItem?.action, './display-cached.sh');
  const testItem = menu.items.find((item) => item.name === 'Display Test Frame');
  assert.equal(testItem?.action, './local/display-test-frame.sh');

  for (const path of [
    join(process.cwd(), 'kindle-extension', 'display-cached.sh'),
    join(process.cwd(), 'kindle-extension', 'local', 'display-test-frame.sh'),
  ]) {
    const launcher = readFileSync(path, 'utf8');
    assert.match(launcher, /display-once\.sh/);
    assert.match(launcher, /nohup/);
    assert.match(launcher, /&/);
  }

  const env = readFileSync(
    join(process.cwd(), 'kindle-extension', 'local', 'env.sh'),
    'utf8',
  );
  assert.match(env, /KUAL_SETTLE_DELAY_SECS=\$\{KUAL_SETTLE_DELAY_SECS:-8\}/);

  const displayOnce = readFileSync(
    join(process.cwd(), 'kindle-extension', 'local', 'display-once.sh'),
    'utf8',
  );
  assert.match(displayOnce, /kual_settle_delay=\$\{KUAL_SETTLE_DELAY_SECS:-8\}/);
  assert.match(displayOnce, /kual_settle_delay" -lt 8/);
});

test('hides and restores Kindle system chrome with reversible commands', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-chrome-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const capture = join(directory, 'commands.log');

  writeFileSync(
    join(directory, 'lipc-set-prop'),
    '#!/usr/bin/env sh\nprintf \'lipc %s\\n\' "$*" >> "$CAPTURE"\n',
  );
  writeFileSync(
    join(directory, 'killall'),
    '#!/usr/bin/env sh\nprintf \'killall %s\\n\' "$*" >> "$CAPTURE"\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `chmod +x "$PWD/${fixture}/lipc-set-prop" "$PWD/${fixture}/killall"; PATH="$PWD/${fixture}:$PATH" CAPTURE="$PWD/${fixture}/commands.log" HIDE_KINDLE_CHROME=true FREEZE_KINDLE_WINDOW_MANAGER=true sh -c '. ./kindle-extension/local/chrome-control.sh; hide_kindle_chrome; restore_kindle_chrome'`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
      'lipc com.lab126.pillow disableEnablePillow disable',
      'killall -STOP awesome',
      'killall -CONT awesome',
      'lipc com.lab126.pillow disableEnablePillow enable',
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('pillow-only hide never pauses the Kindle window manager', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-pillow-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const capture = join(directory, 'commands.log');

  writeFileSync(
    join(directory, 'lipc-set-prop'),
    '#!/usr/bin/env sh\nprintf \'lipc %s\\n\' "$*" >> "$CAPTURE"\n',
  );
  writeFileSync(
    join(directory, 'killall'),
    '#!/usr/bin/env sh\nprintf \'killall %s\\n\' "$*" >> "$CAPTURE"\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `chmod +x "$PWD/${fixture}/lipc-set-prop" "$PWD/${fixture}/killall"; PATH="$PWD/${fixture}:$PATH" CAPTURE="$PWD/${fixture}/commands.log" HIDE_KINDLE_CHROME=true FREEZE_KINDLE_WINDOW_MANAGER=true sh -c '. ./kindle-extension/local/chrome-control.sh; hide_kindle_pillow'`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
      'lipc com.lab126.pillow disableEnablePillow disable',
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('dashboard lifecycle always restores Kindle system chrome', () => {
  const env = readFileSync(join(process.cwd(), 'kindle-extension', 'local', 'env.sh'), 'utf8');
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  const start = readFileSync(join(process.cwd(), 'kindle-extension', 'start.sh'), 'utf8');
  const stop = readFileSync(join(process.cwd(), 'kindle-extension', 'stop.sh'), 'utf8');

  assert.match(env, /HIDE_KINDLE_CHROME=.*true/);
  assert.match(env, /FREEZE_KINDLE_WINDOW_MANAGER=.*true/);
  assert.match(env, /POWER_BUTTON_RESTORES_KINDLE=.*true/);
  assert.match(dash, /local\/chrome-control\.sh/);
  assert.match(dash, /local\/power-button-exit\.sh/);
  assert.match(dash, /hide_kindle_chrome/);
  assert.match(dash, /trap dashboard_cleanup EXIT/);
  assert.match(dash, /trap dashboard_shutdown HUP INT TERM/);
  assert.match(stop, /local\/chrome-control\.sh/);
  assert.match(stop, /restore_kindle_chrome/);
  assert.doesNotMatch(stop, /env\.sh/);
  assert.match(start, /"\$DIR\/dash\.sh"/);
  assert.doesNotMatch(start, /nohup \.\/dash\.sh/);
  assert.match(stop, /logs\/dash\.pid/);
  assert.match(stop, /signal_owned_process/);
});

test('re-hides full chrome for daemon draws and only Pillow for one-shot draws', () => {
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  const displayOnce = readFileSync(
    join(process.cwd(), 'kindle-extension', 'local', 'display-once.sh'),
    'utf8',
  );
  const showStart = dash.indexOf('show_dashboard_png()');
  const showEnd = dash.indexOf('\nrefresh_dashboard()', showStart);
  const showBody = dash.slice(showStart, showEnd);

  assert.ok(showStart >= 0 && showEnd > showStart);
  assert.ok(showBody.indexOf('hide_kindle_chrome') >= 0);
  assert.ok(showBody.indexOf('hide_kindle_chrome') < showBody.indexOf('/usr/sbin/eips'));
  assert.match(displayOnce, /local\/chrome-control\.sh/);
  assert.ok(displayOnce.indexOf('hide_kindle_pillow') >= 0);
  assert.ok(displayOnce.indexOf('hide_kindle_pillow') < displayOnce.indexOf('/usr/sbin/eips'));
  assert.doesNotMatch(displayOnce, /\bhide_kindle_chrome\b/);
});

test('signals only a PID owned by the absolute dashboard command', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-process-owner-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const capture = join(directory, 'signals.log');

  mkdirSync(join(directory, 'proc', '4242'), { recursive: true });
  mkdirSync(join(directory, 'proc', '5252'), { recursive: true });
  writeFileSync(
    join(directory, 'proc', '4242', 'cmdline'),
    '/bin/sh\0/mnt/us/extensions/kindle-dash/dash.sh\0',
  );
  writeFileSync(join(directory, 'proc', '5252', 'cmdline'), '/bin/sh\0unrelated.sh\0');
  writeFileSync(
    join(directory, 'signal-process'),
    '#!/usr/bin/env sh\nprintf \'%s\\n\' "$*" >> "$CAPTURE"\n',
  );

  try {
    const result = spawnSync(
      shell,
      [
        shellFlag,
        `chmod +x "$PWD/${fixture}/signal-process"; export PROCESS_PROC_ROOT="$PWD/${fixture}/proc"; export PROCESS_SIGNAL_CMD="$PWD/${fixture}/signal-process"; export CAPTURE="$PWD/${fixture}/signals.log"; . ./kindle-extension/local/dashboard-utils.sh; signal_owned_process 4242 'extensions/kindle-dash/dash.sh' TERM || exit 1; if signal_owned_process 5252 'extensions/kindle-dash/dash.sh' TERM; then exit 2; fi`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(capture, 'utf8').trim(), '-TERM 4242');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('physical power-button event exits dashboard mode without matching RTC wake', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-power-exit-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const capture = join(directory, 'stop.log');
  const eventPidFile = join(directory, 'event.pid');
  const eventFifo = join(directory, 'events.fifo');

  writeFileSync(
    join(directory, 'lipc-wait-event'),
    '#!/usr/bin/env sh\nprintf \'wakeupFromSuspend 0\\n\'\n',
  );
  writeFileSync(
    join(directory, 'stop-dashboard'),
    '#!/usr/bin/env sh\nprintf \'stopped\\n\' >> "$CAPTURE"\n',
  );

  try {
    const rtcResult = spawnSync(
      shell,
      [
        shellFlag,
        `chmod +x "$PWD/${fixture}/lipc-wait-event" "$PWD/${fixture}/stop-dashboard"; PATH="$PWD/${fixture}:$PATH" CAPTURE="$PWD/${fixture}/stop.log" DASHBOARD_EVENT_FIFO="$PWD/${fixture}/events.fifo" ./kindle-extension/local/power-button-exit.sh "$PWD/${fixture}/stop-dashboard" "$PWD/${fixture}/event.pid"`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(rtcResult.status, 0, rtcResult.stderr);
    assert.equal(existsSync(capture), false);
    assert.equal(existsSync(eventPidFile), false);
    assert.equal(existsSync(eventFifo), false);

    writeFileSync(
      join(directory, 'lipc-wait-event'),
      '#!/usr/bin/env sh\nprintf \'goingToScreenSaver 2\\n\'\n',
    );

    const powerButtonResult = spawnSync(
      shell,
      [
        shellFlag,
        `PATH="$PWD/${fixture}:$PATH" CAPTURE="$PWD/${fixture}/stop.log" DASHBOARD_EVENT_FIFO="$PWD/${fixture}/events.fifo" ./kindle-extension/local/power-button-exit.sh "$PWD/${fixture}/stop-dashboard" "$PWD/${fixture}/event.pid"`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(powerButtonResult.status, 0, powerButtonResult.stderr);
    assert.equal(readFileSync(capture, 'utf8').trim(), 'stopped');
    assert.equal(existsSync(eventPidFile), false);
    assert.equal(existsSync(eventFifo), false);

    const watcher = readFileSync(
      join(process.cwd(), 'kindle-extension', 'local', 'power-button-exit.sh'),
      'utf8',
    );
    assert.match(watcher, /kill -KILL "\$EVENT_PID"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('keeps RTC refresh opt-in and falls back to a full userspace sleep', () => {
  const env = readFileSync(join(process.cwd(), 'kindle-extension', 'local', 'env.sh'), 'utf8');
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  const probe = readFileSync(join(process.cwd(), 'kindle-extension', 'low-power-test.sh'), 'utf8');

  assert.match(env, /DASHBOARD_USE_RTC=.*false/);
  assert.match(dash, /find_rtc_wake_source/);
  assert.match(dash, /suspend_for_seconds/);
  assert.match(dash, /com\.lab126\.wifid enable 0/);
  assert.match(dash, /sleep \"\$duration\"/);
  assert.match(probe, /find_rtc_wake_source/);
});

test('remote config helper accepts only the exact refresh allowlist', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-remote-config-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  const allowed = [
    10, 20, 30, 40, 50, 60, 120, 180, 240, 300,
    360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
  ];

  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nout=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in -O) shift; out=$1 ;; esac\n  shift\ndone\nprintf "%s" "$REMOTE_BODY" > "$out"\n',
  );

  try {
    for (const seconds of allowed) {
      const result = spawnSync(
        shell,
        [shellFlag, `chmod +x "$PWD/${fixture}/wget"; PATH="$PWD/${fixture}:$PATH" REMOTE_CONFIG_URL='https://example.test/device' REMOTE_BODY='version=1\nrefresh_interval_seconds=${seconds}\n' ./kindle-extension/local/fetch-remote-config.sh`],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), String(seconds));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('remote config helper rejects malformed, duplicate, and unsafe values', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-remote-config-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nout=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in -O) shift; out=$1 ;; esac\n  shift\ndone\nprintf "%s" "$REMOTE_BODY" > "$out"\n',
  );

  const invalidBodies = [
    '',
    'version=1\n',
    'refresh_interval_seconds=59\n',
    'refresh_interval_seconds=61\n',
    'refresh_interval_seconds=901\n',
    'refresh_interval_seconds=60;reboot\n',
    'refresh_interval_seconds=60\nrefresh_interval_seconds=120\n',
  ];

  try {
    for (const body of invalidBodies) {
      const result = spawnSync(
        shell,
        [shellFlag, `chmod +x "$PWD/${fixture}/wget"; PATH="$PWD/${fixture}:$PATH" REMOTE_CONFIG_URL='https://example.test/device' ./kindle-extension/local/fetch-remote-config.sh`],
        { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, REMOTE_BODY: body } },
      );
      assert.notEqual(result.status, 0, `unexpected success for ${JSON.stringify(body)}`);
      assert.equal(result.stdout, '');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('remote config helper fails closed when the download fails', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-remote-config-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nexit 4\n',
  );

  try {
    const result = spawnSync(
      shell,
      [shellFlag, `chmod +x "$PWD/${fixture}/wget"; PATH="$PWD/${fixture}:$PATH" REMOTE_CONFIG_URL='https://example.test/device?key=PRIVATE_SENTINEL' ./kindle-extension/local/fetch-remote-config.sh`],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(output, /PRIVATE_SENTINEL/);
    assert.doesNotMatch(output, /https:\/\/example\.test/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('remote config helper terminates a stalled HTTP client at its deadline', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-remote-config-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nout=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in -O) shift; out=$1 ;; esac\n  shift\ndone\n: > "$out"\ntrap "" TERM\nwhile :; do sleep 1; done\n',
  );

  try {
    const result = spawnSync(
      shell,
      [shellFlag, `chmod +x "$PWD/${fixture}/wget"; PATH="$PWD/${fixture}:$PATH" REMOTE_CONFIG_TIMEOUT_SECS=1 REMOTE_CONFIG_URL='https://example.test/device' ./kindle-extension/local/fetch-remote-config.sh`],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('remote config helper terminates an oversized streamed response', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-remote-config-'));
  const fixture = relative(process.cwd(), directory).replaceAll('\\', '/');
  writeFileSync(
    join(directory, 'wget'),
    '#!/usr/bin/env sh\nout=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in -O) shift; out=$1 ;; esac\n  shift\ndone\nhead -c 5000 /dev/zero | tr "\\000" x > "$out"\nexit 0\n',
  );

  try {
    const result = spawnSync(
      shell,
      [shellFlag, `chmod +x "$PWD/${fixture}/wget"; PATH="$PWD/${fixture}:$PATH" REMOTE_CONFIG_TIMEOUT_SECS=10 REMOTE_CONFIG_URL='https://example.test/device' ./kindle-extension/local/fetch-remote-config.sh`],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    const helper = readFileSync(
      join(process.cwd(), 'kindle-extension', 'local', 'fetch-remote-config.sh'),
      'utf8',
    );
    assert.match(helper, /head -c "\$MAX_RESPONSE_BYTES_PLUS_ONE"/);
    assert.match(helper, /MAX_RESPONSE_BYTES_PLUS_ONE=4097/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('dashboard daemon refreshes remote settings before PNG and sleeps with the in-memory value', () => {
  const env = readFileSync(join(process.cwd(), 'kindle-extension', 'local', 'env.sh'), 'utf8');
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  const mainStart = dash.indexOf('main_loop()');
  const mainBody = dash.slice(mainStart, dash.indexOf('\n}', mainStart) + 2);

  assert.match(env, /REMOTE_CONFIG_URL=/);
  assert.match(dash, /local\/fetch-remote-config\.sh/);
  assert.ok(mainBody.indexOf('refresh_remote_config') < mainBody.indexOf('refresh_dashboard'));
  assert.match(mainBody, /sleep_until_next_refresh "\$refresh_interval_secs"/);
  assert.doesNotMatch(mainBody, /sleep 5/);
});

test('production refresh paths promote a candidate only after eips succeeds', () => {
  const dash = readFileSync(join(process.cwd(), 'kindle-extension', 'dash.sh'), 'utf8');
  const refreshNow = readFileSync(join(process.cwd(), 'kindle-extension', 'refresh-now.sh'), 'utf8');
  const displayOnce = readFileSync(
    join(process.cwd(), 'kindle-extension', 'local', 'display-once.sh'),
    'utf8',
  );

  assert.match(dash, /FETCH_DASHBOARD_CMD[^\n]+DASH_CANDIDATE/);
  assert.match(dash, /show_dashboard_png[^\n]+DASH_CANDIDATE/);
  assert.ok(dash.indexOf('show_dashboard_png "$display_mode" "$DASH_CANDIDATE"') < dash.indexOf('mv -f "$DASH_CANDIDATE" "$DASH_PNG"'));
  assert.match(refreshNow, /promote-dashboard-candidate\.sh/);
  assert.match(refreshNow, /fetch-dashboard\.sh" "\$DASH_CANDIDATE"/);
  assert.match(displayOnce, /exit "\$display_status"/);
});

test('diagnostics inspect standard Wario RTC interfaces without writing them', () => {
  const diagnose = readFileSync(join(process.cwd(), 'kindle-extension', 'diagnose.sh'), 'utf8');

  assert.match(diagnose, /\/sys\/class\/rtc\/rtc\*\/wakealarm/);
  assert.match(diagnose, /\/proc\/driver\/rtc/);
  assert.match(diagnose, /\/dev\/rtc\*/);
  assert.doesNotMatch(diagnose, />+\s*\"\$wakealarm\"/);
});
