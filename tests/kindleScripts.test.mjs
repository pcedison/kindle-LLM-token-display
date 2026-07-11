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

test('queues the cached dashboard draw after the KUAL action returns', () => {
  const menu = JSON.parse(
    readFileSync(join(process.cwd(), 'kindle-extension', 'menu.json'), 'utf8'),
  );
  const cachedItem = menu.items.find((item) => item.name === 'Display Cached Dashboard');
  assert.equal(cachedItem?.action, './display-cached.sh');

  const launcher = readFileSync(
    join(process.cwd(), 'kindle-extension', 'display-cached.sh'),
    'utf8',
  );
  assert.match(launcher, /local\/display-once\.sh/);
  assert.match(launcher, /nohup/);
  assert.match(launcher, /&/);
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

test('diagnostics inspect standard Wario RTC interfaces without writing them', () => {
  const diagnose = readFileSync(join(process.cwd(), 'kindle-extension', 'diagnose.sh'), 'utf8');

  assert.match(diagnose, /\/sys\/class\/rtc\/rtc\*\/wakealarm/);
  assert.match(diagnose, /\/proc\/driver\/rtc/);
  assert.match(diagnose, /\/dev\/rtc\*/);
  assert.doesNotMatch(diagnose, />+\s*\"\$wakealarm\"/);
});
