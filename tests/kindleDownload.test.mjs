import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import UPNG from 'upng-js';

import { makeOpaqueGrayscalePng } from '../app/api/dashboard/kindlePng.mjs';

const gitBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const shell = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'sh';
const shellFlag = process.platform === 'win32' ? '-lc' : '-c';
const validPng = readFileSync(new URL('../docs/images/dashboard-dp75sdi.png', import.meta.url));

function grayscalePng(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(255);
  return Buffer.from(makeOpaqueGrayscalePng(UPNG.encode([rgba.buffer], width, height, 0)));
}

function fixture(wgetBody) {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-download-'));
  const shellPath = `$PWD/${relative(process.cwd(), directory).replaceAll('\\', '/')}`;
  const output = join(directory, 'dashboard.png');
  writeFileSync(join(directory, 'gasgauge-info'), "#!/usr/bin/env sh\nprintf '73%%\\n'\n");
  writeFileSync(join(directory, 'wget'), `#!/usr/bin/env sh
out=''
while [ "$#" -gt 0 ]; do
  case "$1" in -O) shift; out=$1 ;; esac
  shift
done
${wgetBody}
`);
  return { directory, shellPath, output };
}

function runDownload({ shellPath, output }, env = {}) {
  return spawnSync(
    shell,
    [shellFlag, `chmod +x "${shellPath}/gasgauge-info" "${shellPath}/wget"; PATH="${shellPath}:$PATH" FIFO_MARKER="${shellPath}/fifo-marker" KINDLE_LLM_RUNTIME_DIR="${shellPath}" ./kindle-extension/local/fetch-dashboard.sh "${shellPath}/dashboard.png"`],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DASHBOARD_URL: 'https://example.test/api/dashboard?key=TEST_ONLY',
        ...env,
      },
      timeout: 10_000,
    },
  );
}

test('dashboard download replaces the cache only with a valid profile PNG', () => {
  const fx = fixture('cp docs/images/dashboard-dp75sdi.png "$out"');
  writeFileSync(fx.output, 'cached');
  try {
    const result = runDownload(fx);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(fx.output), validPng);
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('dashboard download accepts another supported Kindle profile without local migration settings', () => {
  const fx = fixture('cp "$BOUNDED_PNG" "$out"');
  const basicPng = grayscalePng(600, 800);
  writeFileSync(join(fx.directory, 'basic.png'), basicPng);
  writeFileSync(fx.output, 'cached');
  try {
    const result = runDownload(fx, {
      BOUNDED_PNG: join(fx.directory, 'basic.png').replaceAll('\\', '/'),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(fx.output), basicPng);
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('dashboard download preserves the cache after a non-PNG response', () => {
  const fx = fixture("printf 'not-a-png' > \"$out\"");
  writeFileSync(fx.output, 'cached');
  try {
    const result = runDownload(fx);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(fx.output, 'utf8'), 'cached');
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('dashboard download rejects a PNG for the wrong configured profile size', () => {
  const fx = fixture('cp docs/images/dashboard-dp75sdi.png "$out"');
  writeFileSync(fx.output, 'cached');
  try {
    const result = runDownload(fx, {
      DASHBOARD_EXPECTED_WIDTH: '600',
      DASHBOARD_EXPECTED_HEIGHT: '800',
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(fx.output, 'utf8'), 'cached');
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('dashboard download caps an oversized response before replacing the cache', () => {
  const fx = fixture('head -c 4194305 /dev/zero | tr "\\000" x > "$out"');
  writeFileSync(fx.output, 'cached');
  try {
    const result = runDownload(fx);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(fx.output, 'utf8'), 'cached');
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('dashboard download reports replacement failure and cleans its temporary file', () => {
  const fx = fixture('cp docs/images/dashboard-dp75sdi.png "$out"');
  writeFileSync(fx.output, 'cached');
  writeFileSync(join(fx.directory, 'mv'), '#!/usr/bin/env sh\nexit 9\n');
  try {
    const result = spawnSync(
      shell,
      [shellFlag, `chmod +x "${fx.shellPath}/gasgauge-info" "${fx.shellPath}/wget" "${fx.shellPath}/mv"; PATH="${fx.shellPath}:$PATH" KINDLE_LLM_RUNTIME_DIR="${fx.shellPath}" ./kindle-extension/local/fetch-dashboard.sh "${fx.shellPath}/dashboard.png"`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, DASHBOARD_URL: 'https://example.test/api/dashboard?key=TEST_ONLY' },
        timeout: 10_000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(fx.output, 'utf8'), 'cached');
    assert.equal(readdirSync(fx.directory).some((name) => name.includes('.tmp')), false);
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('dashboard download stops a stalled client at the configured deadline', () => {
  const fx = fixture('exec tail -f /dev/null');
  writeFileSync(fx.output, 'cached');
  try {
    const startedAt = Date.now();
    const result = runDownload(fx, { DASHBOARD_DOWNLOAD_TIMEOUT_SECS: '1' });
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0);
    assert.ok(Date.now() - startedAt < 8000, 'deadline left a downloader or watchdog child alive');
    assert.equal(readFileSync(fx.output, 'utf8'), 'cached');
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

test('candidate promotion replaces the cache only after the display decoder succeeds', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-candidate-'));
  const shellPath = `$PWD/${relative(process.cwd(), directory).replaceAll('\\', '/')}`;
  writeFileSync(join(directory, 'candidate.png'), 'new-image');
  writeFileSync(join(directory, 'cache.png'), 'old-image');
  writeFileSync(join(directory, 'display'), '#!/usr/bin/env sh\nprintf \'%s\\n\' "$1" >> "$CALLS"\nexit 0\n');
  try {
    const result = spawnSync(shell, [shellFlag, `chmod +x "${shellPath}/display"; CALLS="${shellPath}/calls" ./kindle-extension/local/promote-dashboard-candidate.sh "${shellPath}/candidate.png" "${shellPath}/cache.png" "${shellPath}/display"`], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(directory, 'cache.png'), 'utf8'), 'new-image');
    assert.equal(existsSync(join(directory, 'candidate.png')), false);
    assert.match(readFileSync(join(directory, 'calls'), 'utf8'), /candidate\.png/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('candidate promotion preserves and redraws the cache after decoder failure', () => {
  const directory = mkdtempSync(join(process.cwd(), '.kindle-candidate-'));
  const shellPath = `$PWD/${relative(process.cwd(), directory).replaceAll('\\', '/')}`;
  writeFileSync(join(directory, 'candidate.png'), 'bad-image');
  writeFileSync(join(directory, 'cache.png'), 'old-image');
  writeFileSync(join(directory, 'display'), `#!/usr/bin/env sh
printf '%s\\n' "$1" >> "$CALLS"
case "$1" in *candidate.png) exit 1 ;; *) exit 0 ;; esac
`);
  try {
    const result = spawnSync(shell, [shellFlag, `chmod +x "${shellPath}/display"; CALLS="${shellPath}/calls" ./kindle-extension/local/promote-dashboard-candidate.sh "${shellPath}/candidate.png" "${shellPath}/cache.png" "${shellPath}/display"`], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(directory, 'cache.png'), 'utf8'), 'old-image');
    assert.equal(existsSync(join(directory, 'candidate.png')), false);
    assert.deepEqual(
      readFileSync(join(directory, 'calls'), 'utf8').trim().split(/\r?\n/).map((path) => path.split('/').at(-1)),
      ['candidate.png', 'cache.png'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
