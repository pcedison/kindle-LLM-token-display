import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('normalizes Kindle battery values and appends the battery query parameter', () => {
  assert.equal(runShell("normalize_battery_level '72%'"), '72');
  assert.equal(runShell("normalize_battery_level ' 0 '"), '0');
  assert.equal(runShell("normalize_battery_level '100'"), '100');
  assert.equal(runShell("normalize_battery_level '-5%'", { allowFailure: true }).status, 1);
  assert.equal(runShell("normalize_battery_level '101%'", { allowFailure: true }).status, 1);
  assert.equal(
    runShell("append_query_param 'https://example.test/api' battery 72"),
    'https://example.test/api?battery=72',
  );
  assert.equal(
    runShell("append_query_param 'https://example.test/api?profile=dp75sdi' battery 72"),
    'https://example.test/api?profile=dp75sdi&battery=72',
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
      { cwd: process.cwd(), encoding: 'utf8' },
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
