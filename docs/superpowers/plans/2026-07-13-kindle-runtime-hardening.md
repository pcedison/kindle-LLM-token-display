# Kindle Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the Kindle downloads only bounded, structurally valid profile PNGs, reaches the network in the correct order, never leaks private URLs through xtrace, and accepts only exact device-config version 1.

**Architecture:** PR 2 replaces the unsafe downloader without altering refresh orchestration. PR 4 centralizes private environment sourcing and introduces a single Wi-Fi/config/PNG cycle. PR 9b tightens the already bounded remote-config parser; each PR remains independently revertible.

**Tech Stack:** POSIX `sh`, old Kindle BusyBox commands (`mkfifo`, `head`, `dd`, `od`, `wc`, `sed`, `tr`, `grep`), Kindle Linux `/proc`, FAT32 `/mnt/us`, Node.js test runner, Git Bash test harness.

## Global Constraints

- Every repository PR runs the exact fixed gate in `2026-07-13-project-hardening-master.md`; the shorter commands below are additional focused gates, not replacements.

- The Dashboard download deadline is 20 seconds by default and bounded to 1-60 seconds.
- The maximum response is 4 MiB (`4194304` bytes); read at most one additional byte to detect overflow.
- The final temporary PNG is in the same directory as `dash.png`; FIFO and watchdog files remain under `/tmp` because FAT32 cannot host a FIFO.
- The DP75SDI default contract is 758x1024, 8-bit grayscale, compression 0, filter 0, non-interlaced PNG.
- A failed download removes only its temporary state and preserves the existing cache byte for byte.
- If no cache exists, no failure path may invoke `eips`.
- Do not log `DASHBOARD_URL`, `REMOTE_CONFIG_URL`, a query key, or an authenticated request URL.
- Tokens, cookies, and complete Authorization headers never enter argv. An
  authenticated URL is prohibited in argv everywhere except the fixed Kindle
  downloader URL operand used by BusyBox `wget` or a separately shipped and
  real-device-validated `xh`/`ht`. The actual DP75SDI has only BusyBox `wget`;
  that build accepts a URL operand and has no stdin URL, cookie-file, or
  header-file transport. A no-argv adapter therefore cannot be claimed without
  shipping a new binary.
- The Kindle-only URL-operand exception is valid only while the identical URL is
  already held in private `local/env.sh`, xtrace is disabled before source and
  before URL use, logs are generic, the production device keeps the 20-second
  watchdog boundary, cleanup terminates producer/reader/descendants and removes
  temporary state, and no `/proc/*/cmdline` or `/proc/*/environ` snapshot is
  captured or reported as evidence. Cleanup may inspect only the non-secret
  owner marker needed to terminate descendants.
- This exception never extends to operator, CI, server, collector, macOS, or
  Windows commands. Single-user Kindle root access and physical compromise are
  outside the threat model because they can already read private `env.sh`; either
  event requires view-token rotation.
- The device-local argv exposure is a known user-review item. If the user does
  not accept it, stop and create a separate plan to ship and validate a new
  downloader binary on the real Kindle; do not invent a stdin transport for the
  installed BusyBox `wget`.
- Wi-Fi order is exactly `wait -> config -> PNG`; an unavailable network performs no HTTP request and may display only a pre-existing cache.
- Device config is exactly two newline-terminated lines in fixed order: `version=1` then one allowlisted interval.
- Do not refactor the working remote-config watchdog into a shared abstraction during PR 2.

---

## PR 2 — Kindle Bounded PNG Download

### Task 1: Add Download Fault-Injection Tests

**Files:**
- Create: `tests/kindleDownload.test.mjs`
- Modify: `tests/kindleScripts.test.mjs:185-218`
- Modify: `tests/kindleSecurity.test.mjs:53-94`
- Use fixture: `docs/images/dashboard-dp75sdi.png`

**Interfaces:**
- Consumes: `fetch-dashboard.sh` with one required output-path argument and environment overrides.
- Produces: executable tests for timeout, stream cap, PNG structure/profile, checked replacement, and absent cache.

- [ ] **Step 1: Create the reusable test harness**

Start `tests/kindleDownload.test.mjs` with:

```js
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bash = process.env.GIT_BASH_PATH || (process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(existsSync) || 'bash'
  : '/bin/sh');
const toShellPath = (value) => process.platform === 'win32'
  ? value.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  : value;
const script = toShellPath(fileURLToPath(new URL('../kindle-extension/local/fetch-dashboard.sh', import.meta.url)));
const validPng = fileURLToPath(new URL('../docs/images/dashboard-dp75sdi.png', import.meta.url));
const kindleProcessHarness = { skip: process.platform === 'darwin' };

async function makeHarness({ response, mode = 'copy', priorCache = Buffer.from('OLD_CACHE') } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kindle-download-'));
  const bin = join(root, 'bin');
  const output = join(root, 'dash.png');
  const responsePath = join(root, 'response.bin');
  const childPidPath = join(root, 'child.pid');
  const runtime = join(root, 'runtime');
  await mkdir(bin);
  await mkdir(runtime);
  if (priorCache !== null) await writeFile(output, priorCache);
  if (response) await writeFile(responsePath, response);

  const wget = join(bin, 'wget');
  await writeFile(wget, `#!/bin/sh
out=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -O) out=$2; shift 2 ;;
    *) shift ;;
  esac
done
case "$FAKE_WGET_MODE" in
  stall) sleep 30 ;;
  exit-before-fifo) exit 7 ;;
  parent-exits-child-holds-fifo)
    ( sleep 30 ) >"$out" &
    printf '%s\n' "$!" >"$FAKE_CHILD_PID_FILE"
    exit 0
    ;;
  oversize) head -c 4194305 /dev/zero >"$out" ;;
  *) cat "$FAKE_RESPONSE" >"$out" ;;
esac
`);
  await chmod(wget, 0o755);
  return { root, bin, output, responsePath, childPidPath, runtime, priorCache, mode };
}

function runFetch(harness, extraEnv = {}) {
  return spawnSync(bash, [script, toShellPath(harness.output)], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${toShellPath(harness.bin)}:/usr/bin:/bin`,
      FAKE_WGET_MODE: harness.mode,
      FAKE_RESPONSE: toShellPath(harness.responsePath),
      FAKE_CHILD_PID_FILE: toShellPath(harness.childPidPath),
      KINDLE_LLM_RUNTIME_DIR: toShellPath(harness.runtime),
      DASHBOARD_URL: 'https://dashboard.test/api/dashboard?key=SENTINEL_PRIVATE',
      DASHBOARD_DOWNLOAD_TIMEOUT_SECS: '1',
      DASHBOARD_EXPECTED_WIDTH: '758',
      DASHBOARD_EXPECTED_HEIGHT: '1024',
      ...extraEnv,
    },
  });
}

async function assertCachePreserved(harness) {
  assert.deepEqual(await readFile(harness.output), harness.priorCache);
  assert.deepEqual((await readdir(dirname(harness.output))).filter((name) => /\.tmp\.|\.pipe$|\.guard$/.test(name)), []);
  assert.deepEqual(await readdir(harness.runtime), []);
}

function pngHeader({ width = 758, height = 1024, bitDepth = 8, colorType = 0, compression = 0, filter = 0, interlace = 0 } = {}) {
  const bytes = Buffer.alloc(57);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = bitDepth;
  bytes[25] = colorType;
  bytes[26] = compression;
  bytes[27] = filter;
  bytes[28] = interlace;
  Buffer.from([0, 0, 0, 0]).copy(bytes, 29);
  Buffer.from([0, 0, 0, 0, 73, 68, 65, 84, 0, 0, 0, 0]).copy(bytes, 33);
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 45);
  return bytes;
}

function pngWithoutIdat() {
  const bytes = Buffer.concat([
    pngHeader().subarray(0, 33),
    Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]),
  ]);
  return bytes;
}
```

The harness selects Git Bash on Windows and `/bin/sh` on Unix, converts only paths crossing the shell boundary, and gives the shell a colon-delimited minimal PATH. macOS skips the `/proc` lifecycle scenarios because it has no Linux procfs; the required Ubuntu Kindle job runs every downloader case, including the non-cooperative descendant. macOS still runs tracked shell syntax/security tests. The product script remains POSIX shell for Kindle Linux.

The URL sentinel is asserted absent from combined stdout/stderr and every
xtrace/log fixture. Do not add an assertion that downloader argv lacks the URL,
and do not snapshot `/proc/*/cmdline` or `/proc/*/environ` as evidence; on the
actual BusyBox-only DP75SDI the URL operand is the reviewed exception. The Linux
process-lifecycle test may inspect only the non-secret owner marker already used
for bounded descendant cleanup.

- [ ] **Step 2: Add timeout and oversize tests**

Append:

```js
test('dashboard download enforces one deadline over producer and reader plus the streamed 4 MiB limit', kindleProcessHarness, async () => {
  for (const mode of ['stall', 'exit-before-fifo', 'oversize']) {
    const harness = await makeHarness({ mode });
    const startedAt = Date.now();
    const result = runFetch(harness);
    assert.notEqual(result.status, 0, `${mode} should fail`);
    assert.notEqual(result.error?.code, 'ETIMEDOUT', `${mode} escaped the product deadline`);
    assert.ok(Date.now() - startedAt < 8_000, `${mode} exceeded the bounded harness window`);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SENTINEL_PRIVATE/);
    await assertCachePreserved(harness);
  }
});

test('deadline kills a non-cooperative orphan that inherits the download owner marker', {
  skip: process.platform !== 'linux',
}, async () => {
  const harness = await makeHarness({ mode: 'parent-exits-child-holds-fifo' });
  const result = runFetch(harness);
  assert.notEqual(result.status, 0);
  assert.notEqual(result.error?.code, 'ETIMEDOUT');
  const childPid = Number((await readFile(harness.childPidPath, 'utf8')).trim());
  const alive = spawnSync('/bin/sh', ['-c', `kill -0 ${childPid} 2>/dev/null`]);
  assert.notEqual(alive.status, 0, 'owned descendant survived the product deadline');
  await assertCachePreserved(harness);
});
```

- [ ] **Step 3: Add the structural PNG matrix**

Append:

```js
test('dashboard download rejects truncated, malformed, and profile-incompatible PNGs', kindleProcessHarness, async () => {
  const cases = [
    ['html', Buffer.from('<html>401</html>')],
    ['json', Buffer.from('{"error":"unauthorized"}')],
    ['short', Buffer.from('PNG')],
    ['truncated IHDR', pngHeader().subarray(0, 32)],
    ['no IDAT', pngWithoutIdat()],
    ['wrong width', pngHeader({ width: 600 })],
    ['wrong height', pngHeader({ height: 800 })],
    ['wrong bit depth', pngHeader({ bitDepth: 16 })],
    ['wrong color type', pngHeader({ colorType: 6 })],
    ['wrong compression', pngHeader({ compression: 1 })],
    ['wrong filter', pngHeader({ filter: 1 })],
    ['interlaced', pngHeader({ interlace: 1 })],
  ];

  for (const [name, response] of cases) {
    const harness = await makeHarness({ response });
    const result = runFetch(harness);
    assert.notEqual(result.status, 0, name);
    await assertCachePreserved(harness);
  }
});
```

- [ ] **Step 4: Add success, move failure, and absent-cache cases**

Append:

```js
test('dashboard download replaces cache only after a valid profile PNG', kindleProcessHarness, async () => {
  const bytes = await readFile(validPng);
  const harness = await makeHarness({ response: bytes });
  const result = runFetch(harness);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(harness.output), bytes);
});

test('dashboard download preserves cache when atomic replacement fails', kindleProcessHarness, async () => {
  const bytes = await readFile(validPng);
  const harness = await makeHarness({ response: bytes });
  const fakeMv = join(harness.bin, 'mv');
  await writeFile(fakeMv, '#!/bin/sh\nexit 9\n');
  await chmod(fakeMv, 0o755);
  const result = runFetch(harness);
  assert.notEqual(result.status, 0);
  await assertCachePreserved(harness);
});

test('failed download without a prior cache leaves no drawable file', kindleProcessHarness, async () => {
  const harness = await makeHarness({ response: Buffer.from('<html>401</html>'), priorCache: null });
  const result = runFetch(harness);
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(harness.output), { code: 'ENOENT' });
});
```

- [ ] **Step 5: Replace legacy text fixtures with the real PNG**

In the existing successful downloader fixtures in `kindleScripts.test.mjs` and `kindleSecurity.test.mjs`, copy `docs/images/dashboard-dp75sdi.png` instead of writing the literal string `PNG`. Keep the existing sentinel URL assertions.

- [ ] **Step 6: Run PR 2 focused tests and verify RED**

Run:

```powershell
node --test tests/kindleDownload.test.mjs tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs
```

Expected: invalid nonempty responses overwrite the cache, stall hits the harness timeout, the move-failure path can report success, and the new tests fail.

### Task 2: Implement the Bounded Structural PNG Downloader

**Files:**
- Modify: `kindle-extension/local/env.sh:9-13`
- Replace behavior in: `kindle-extension/local/fetch-dashboard.sh:8-58`

**Interfaces:**
- Consumes: `DASHBOARD_URL`, expected dimensions, 20-second deadline, available `wget`/`xh`/`ht`.
- Produces: a validated PNG atomically installed at the requested output path or a nonzero result with cache unchanged.

The installed DP75SDI path is BusyBox `wget` and necessarily supplies
`$FETCH_URL` as its URL operand. `xh`/`ht` remain valid only if a later package
actually ships and real-device-validates them. Keep the existing top-of-script
xtrace guard before `URL`/`FETCH_URL` is read or used; never replace this with a
fictional stdin URL adapter.

- [ ] **Step 1: Add explicit profile and deadline settings**

Add to `env.sh` after the URLs:

```sh
export DASHBOARD_DOWNLOAD_TIMEOUT_SECS=${DASHBOARD_DOWNLOAD_TIMEOUT_SECS:-20}
export DASHBOARD_EXPECTED_WIDTH=${DASHBOARD_EXPECTED_WIDTH:-758}
export DASHBOARD_EXPECTED_HEIGHT=${DASHBOARD_EXPECTED_HEIGHT:-1024}
```

- [ ] **Step 2: Add bounded download state and cleanup**

After resolving `DIR`, `OUT`, and `URL`, initialize:

```sh
umask 077

MAX_DASHBOARD_BYTES=4194304
MAX_DASHBOARD_BYTES_PLUS_ONE=4194305
DOWNLOAD_TIMEOUT_SECS=${DASHBOARD_DOWNLOAD_TIMEOUT_SECS:-20}
EXPECTED_WIDTH=${DASHBOARD_EXPECTED_WIDTH:-758}
EXPECTED_HEIGHT=${DASHBOARD_EXPECTED_HEIGHT:-1024}
TMP="${OUT}.tmp.$$"
RUNTIME_DIR=${KINDLE_LLM_RUNTIME_DIR:-/tmp}
[ -d "$RUNTIME_DIR" ] || mkdir -p "$RUNTIME_DIR" || exit 1
FIFO="$RUNTIME_DIR/kindle-dash-dashboard.$$.pipe"
GUARD_FILE="$RUNTIME_DIR/kindle-dash-dashboard.$$.guard"
DONE_FILE="$RUNTIME_DIR/kindle-dash-dashboard.$$.done"
DOWNLOAD_OWNER="kindle-dash-dashboard-$$"
DOWNLOAD_PID=''
READER_PID=''
WATCHDOG_PID=''

case "$DOWNLOAD_TIMEOUT_SECS" in
  ''|*[!0-9]*) DOWNLOAD_TIMEOUT_SECS=20 ;;
esac
if [ "$DOWNLOAD_TIMEOUT_SECS" -lt 1 ] || [ "$DOWNLOAD_TIMEOUT_SECS" -gt 60 ]; then
  DOWNLOAD_TIMEOUT_SECS=20
fi

terminate_child() {
  pid=$1
  [ -n "$pid" ] || return 0
  kill "$pid" >/dev/null 2>&1 || true
  remaining=2
  while kill -0 "$pid" >/dev/null 2>&1 && [ "$remaining" -gt 0 ]; do
    sleep 1
    remaining=$((remaining - 1))
  done
  if kill -0 "$pid" >/dev/null 2>&1; then kill -KILL "$pid" >/dev/null 2>&1 || true; fi
  wait "$pid" >/dev/null 2>&1 || true
}

owned_download_pids() {
  for environ_path in /proc/[0-9]*/environ; do
    [ -r "$environ_path" ] || continue
    if tr '\000' '\n' <"$environ_path" 2>/dev/null |
      grep -Fqx "KINDLE_DASH_DOWNLOAD_OWNER=$DOWNLOAD_OWNER"; then
      pid=${environ_path#/proc/}
      pid=${pid%/environ}
      case "$pid" in ''|*[!0-9]*) continue ;; esac
      printf '%s\n' "$pid"
    fi
  done
}

signal_owned_downloads() {
  owned_signal=$1
  for owned_pid in $(owned_download_pids); do
    kill -"$owned_signal" "$owned_pid" >/dev/null 2>&1 || true
  done
}

cleanup() {
  signal_owned_downloads TERM
  terminate_child "$DOWNLOAD_PID"
  terminate_child "$READER_PID"
  [ -z "$DONE_FILE" ] || : >"$DONE_FILE"
  [ -z "$WATCHDOG_PID" ] || wait "$WATCHDOG_PID" >/dev/null 2>&1 || true
  [ -z "$TMP" ] || rm -f "$TMP"
  rm -f "$FIFO" "$GUARD_FILE" "$DONE_FILE"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
```

- [ ] **Step 3: Add the bounded reader/downloader/watchdog**

Add:

```sh
start_bounded_reader() {
  command -v mkfifo >/dev/null 2>&1 || return 127
  command -v head >/dev/null 2>&1 || return 127
  command -v tr >/dev/null 2>&1 || return 127
  command -v grep >/dev/null 2>&1 || return 127
  [ -d /proc ] || return 127
  rm -f "$FIFO"
  mkfifo "$FIFO" || return 1
  head -c "$MAX_DASHBOARD_BYTES_PLUS_ONE" <"$FIFO" >"$TMP" &
  READER_PID=$!
}

start_download() {
  # Kindle-only reviewed boundary: this downloader requires the URL operand.
  # xtrace is already disabled; logs never include FETCH_URL.
  if command -v wget >/dev/null 2>&1; then
    KINDLE_DASH_DOWNLOAD_OWNER="$DOWNLOAD_OWNER" wget -q -O "$FIFO" "$FETCH_URL" &
  elif [ -x "$DIR/../xh" ]; then
    KINDLE_DASH_DOWNLOAD_OWNER="$DOWNLOAD_OWNER" "$DIR/../xh" -d -q -o "$FIFO" get "$FETCH_URL" &
  elif [ -x "$DIR/../ht" ]; then
    KINDLE_DASH_DOWNLOAD_OWNER="$DOWNLOAD_OWNER" "$DIR/../ht" -d -q -o "$FIFO" get "$FETCH_URL" &
  else
    return 127
  fi
  DOWNLOAD_PID=$!
}

watch_download() {
  trap - EXIT HUP INT TERM
  elapsed=0
  while [ ! -f "$DONE_FILE" ]; do
    if [ "$elapsed" -ge "$DOWNLOAD_TIMEOUT_SECS" ]; then
      printf '%s\n' timeout >"$GUARD_FILE"
      signal_owned_downloads TERM
      kill "$READER_PID" >/dev/null 2>&1 || true
      sleep 1
      signal_owned_downloads KILL
      if kill -0 "$READER_PID" >/dev/null 2>&1; then kill -KILL "$READER_PID" >/dev/null 2>&1 || true; fi
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

download_with_limits() {
  start_bounded_reader || return $?
  start_download || { terminate_child "$READER_PID"; READER_PID=''; return 1; }
  watch_download >/dev/null 2>&1 &
  WATCHDOG_PID=$!

  wait "$DOWNLOAD_PID"
  download_status=$?
  DOWNLOAD_PID=''
  wait "$READER_PID"
  reader_status=$?
  READER_PID=''
  : >"$DONE_FILE"
  wait "$WATCHDOG_PID" >/dev/null 2>&1 || true
  WATCHDOG_PID=''

  if [ -n "$(owned_download_pids)" ]; then
    signal_owned_downloads TERM
    sleep 1
    signal_owned_downloads KILL
    return 1
  fi

  [ ! -f "$GUARD_FILE" ] || return 1
  [ "$download_status" -eq 0 ] || return "$download_status"
  [ "$reader_status" -eq 0 ]
}
```

- [ ] **Step 4: Add structural PNG parsing**

Add:

```sh
read_chunk_header() {
  dd if="$1" bs=1 skip="$2" count=8 2>/dev/null | od -An -tu1
}

validate_dashboard_png() {
  file=$1
  expected_width=$2
  expected_height=$3
  file_size=$4

  case "$expected_width:$expected_height" in
    *[!0-9:]*|:*|*:) return 1 ;;
  esac
  [ "$expected_width" -ge 1 ] && [ "$expected_width" -le 4096 ] || return 1
  [ "$expected_height" -ge 1 ] && [ "$expected_height" -le 4096 ] || return 1
  [ "$file_size" -ge 57 ] || return 1

  header=$(od -An -tu1 -N 33 "$file" 2>/dev/null) || return 1
  set -- $header
  [ "$#" -eq 33 ] || return 1
  [ "$1:$2:$3:$4:$5:$6:$7:$8" = '137:80:78:71:13:10:26:10' ] || return 1
  [ "$9:${10}:${11}:${12}" = '0:0:0:13' ] || return 1
  [ "${13}:${14}:${15}:${16}" = '73:72:68:82' ] || return 1
  [ "${17}:${18}:${19}:${20}" = "0:0:$((expected_width / 256)):$((expected_width % 256))" ] || return 1
  [ "${21}:${22}:${23}:${24}" = "0:0:$((expected_height / 256)):$((expected_height % 256))" ] || return 1
  [ "${25}:${26}:${27}:${28}:${29}" = '8:0:0:0:0' ] || return 1

  offset=33
  saw_idat=false
  while [ "$offset" -le $((file_size - 12)) ]; do
    chunk_header=$(read_chunk_header "$file" "$offset") || return 1
    set -- $chunk_header
    [ "$#" -eq 8 ] || return 1
    chunk_length=$((($1 * 16777216) + ($2 * 65536) + ($3 * 256) + $4))
    chunk_end=$((offset + 12 + chunk_length))
    [ "$chunk_end" -le "$file_size" ] || return 1
    chunk_type="$5:$6:$7:$8"
    if [ "$chunk_type" = '73:68:65:84' ]; then
      saw_idat=true
    elif [ "$chunk_type" = '73:69:78:68' ]; then
      [ "$chunk_length" -eq 0 ] || return 1
      [ "$saw_idat" = true ] || return 1
      [ "$chunk_end" -eq "$file_size" ] || return 1
      return 0
    fi
    offset=$chunk_end
  done
  return 1
}
```

This validates chunk boundaries and requires IDAT before terminal IEND. It intentionally does not claim to recompute every PNG CRC or decode DEFLATE on the old Kindle.

- [ ] **Step 5: Replace the direct download/replacement body**

After building `FETCH_URL`, use:

```sh
rm -f "$TMP" "$FIFO" "$GUARD_FILE" "$DONE_FILE"
echo 'fetch-dashboard: fetching dashboard PNG'

if ! download_with_limits; then
  echo 'fetch-dashboard: download failed' >&2
  exit 1
fi

response_size=$(wc -c <"$TMP" 2>/dev/null) || response_size=0
if [ "$response_size" -gt "$MAX_DASHBOARD_BYTES" ]; then
  echo 'fetch-dashboard: response too large' >&2
  exit 1
fi

if ! validate_dashboard_png "$TMP" "$EXPECTED_WIDTH" "$EXPECTED_HEIGHT" "$response_size"; then
  echo 'fetch-dashboard: invalid dashboard PNG' >&2
  exit 1
fi

if ! mv -f "$TMP" "$OUT"; then
  echo 'fetch-dashboard: replacement failed' >&2
  exit 1
fi
TMP=''
echo 'fetch-dashboard: saved dashboard PNG'
```

Do not print `$OUT` because a user-controlled path is unnecessary diagnostic content.

- [ ] **Step 6: Run focused tests and shell syntax**

Run:

```powershell
node --test tests/kindleDownload.test.mjs tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs
& "$env:ProgramFiles\Git\bin\bash.exe" -lc "git ls-files -z '*.sh' | xargs -0 -n1 sh -n"
```

Expected: all focused tests and every tracked shell syntax check pass.

### Task 3: Verify and Commit PR 2

**Files:**
- `kindle-extension/local/env.sh`
- `kindle-extension/local/fetch-dashboard.sh`
- `tests/kindleDownload.test.mjs`
- `tests/kindleScripts.test.mjs`
- `tests/kindleSecurity.test.mjs`

**Interfaces:**
- Consumes: green downloader behavior.
- Produces: one independently revertible PR 2 commit.

- [ ] **Step 1: Run the complete gate**

```powershell
npm.cmd test
npm.cmd run build
node --test --experimental-test-coverage
git diff --check
git diff -- kindle-extension/local/env.sh kindle-extension/local/fetch-dashboard.sh tests/kindleDownload.test.mjs tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs
```

Expected: full suite and build pass; no URL/token/cache/private file appears in the diff.

- [ ] **Step 2: Commit**

```powershell
git add kindle-extension/local/env.sh kindle-extension/local/fetch-dashboard.sh tests/kindleDownload.test.mjs tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs
git diff --cached --check
git commit -m "Harden Kindle dashboard downloads"
```

Expected: only PR 2 files are committed. Stop for user review before push/PR/merge.

---

## PR 4 — Kindle Runtime Correctness

### Task 4: Centralize Private Environment Sourcing

**Files:**
- Modify: `kindle-extension/local/dashboard-utils.sh:1-3`
- Modify: `kindle-extension/dash.sh:16-34`
- Modify: `kindle-extension/start.sh:3-12`
- Modify: `kindle-extension/refresh-now.sh:3-10`
- Modify: `kindle-extension/diagnose.sh:3-9`
- Modify: `kindle-extension/local/display-once.sh:3-12`
- Modify: `kindle-extension/local/display-test-frame.sh:3-12`
- Modify: `tests/kindleSecurity.test.mjs`

**Interfaces:**
- Consumes: a path to a private shell environment file.
- Produces: `source_private_env(path) -> source status`, preserving inherited xtrace state without printing file content.

- [ ] **Step 1: Add failing entrypoint and xtrace tests**

Add tests that run the helper under `sh -x`, source an env file containing `DASHBOARD_URL=https://dashboard.test/?key=SENTINEL_PRIVATE`, and assert the export works while combined stdout/stderr excludes the sentinel and URL. Also run both `fetch-dashboard.sh` and `fetch-remote-config.sh` with inherited xtrace and a sentinel authenticated URL; require their xtrace guard to execute before URL assignment/use and require stdout/stderr/log output to exclude the sentinel. Do not inspect downloader argv or capture `/proc` URL evidence. Add a table assertion over:

```js
const entrypoints = [
  'kindle-extension/dash.sh',
  'kindle-extension/start.sh',
  'kindle-extension/refresh-now.sh',
  'kindle-extension/diagnose.sh',
  'kindle-extension/local/display-once.sh',
  'kindle-extension/local/display-test-frame.sh',
];
```

Each file must call `source_private_env` and must not directly contain `. "$ENV_FILE"`.

- [ ] **Step 2: Run the tests and verify RED**

```powershell
node --test tests/kindleSecurity.test.mjs
```

Expected: helper is absent and five entrypoints still source the private file directly.

- [ ] **Step 3: Add the helper**

Insert at the top of `dashboard-utils.sh`:

```sh
source_private_env() {
  private_env_path=$1
  private_env_had_xtrace=false
  case $- in
    *x*) private_env_had_xtrace=true; set +x ;;
  esac

  private_env_status=0
  if [ -f "$private_env_path" ]; then
    # shellcheck disable=SC1090
    . "$private_env_path" || private_env_status=$?
  fi

  if [ "$private_env_had_xtrace" = true ]; then set -x; fi
  unset private_env_path private_env_had_xtrace
  return "$private_env_status"
}
```

- [ ] **Step 4: Route every entrypoint through the helper**

Each entrypoint resolves `DIR`, sources `dashboard-utils.sh` first, and then calls:

```sh
source_private_env "$ENV_FILE" || exit $?
```

Delete `dash.sh`'s duplicate hand-written source-time xtrace block. Preserve the
top-of-script xtrace-off guards in both downloader helpers so restored entrypoint
xtrace cannot expose URL use. Preserve every other entrypoint behavior.

- [ ] **Step 5: Verify and commit the private-env unit**

```powershell
node --test tests/kindleSecurity.test.mjs tests/kindleScripts.test.mjs
& "$env:ProgramFiles\Git\bin\bash.exe" -lc "git ls-files -z '*.sh' | xargs -0 -n1 sh -n"
git add kindle-extension/local/dashboard-utils.sh kindle-extension/dash.sh kindle-extension/start.sh kindle-extension/refresh-now.sh kindle-extension/diagnose.sh kindle-extension/local/display-once.sh kindle-extension/local/display-test-frame.sh tests/kindleSecurity.test.mjs tests/kindleScripts.test.mjs
git commit -m "Protect Kindle private environment sourcing"
```

Expected: focused tests pass and the first PR 4 commit contains only source-boundary changes.

### Task 5: Enforce One Runtime Network Order

**Files:**
- Modify: `kindle-extension/dash.sh:125-172,232-238`
- Create: `tests/kindleRuntime.test.mjs`
- Modify: `tests/kindleScripts.test.mjs:709-721`

**Interfaces:**
- Consumes: existing `wait-for-wifi.sh`, `refresh_remote_config`, downloader, cache renderer.
- Produces: `refresh_cycle()` with exact `Wi-Fi -> config -> PNG`, plus separate `display_dashboard_image()` and `refresh_cached_dashboard()`.

- [ ] **Step 1: Add executable call-order tests**

Create a temp extension fixture with stub `wait-for-wifi.sh`, `fetch-remote-config.sh`, and `fetch-dashboard.sh` that append `wifi`, `config`, and `png` to one marker. Run one daemon cycle and terminate at its first cadence sleep. Assert exact marker order `['wifi','config','png']`.

Add offline cases whose Wi-Fi stub returns 1 and assert the marker contains only `wifi`; with no cache, the fake `eips` log remains empty. Add an RTC-wake fixture that executes `sleep_until_next_refresh` followed by one cycle and asserts exactly one `wifi` entry before `config,png`; the sleep helper itself must not call `wait-for-wifi.sh`.

- [ ] **Step 2: Run the runtime tests and verify RED**

```powershell
node --test tests/kindleRuntime.test.mjs
```

Expected: current order is config before Wi-Fi and the config helper is invoked while offline.

- [ ] **Step 3: Split fetch from cache display**

Use these function boundaries in `dash.sh`:

```sh
display_dashboard_image() {
  if [ ! -s "$DASH_PNG" ]; then
    echo 'Not updating screen because no cached dashboard image exists.'
    return 1
  fi
  stop_kindle_ui_once
  if [ "$num_refresh" -ge "$FULL_DISPLAY_REFRESH_RATE" ] || [ "$num_refresh" -eq 0 ]; then
    num_refresh=0
    show_dashboard_png full
  else
    show_dashboard_png partial
  fi
  num_refresh=$((num_refresh + 1))
}

refresh_dashboard() {
  echo 'Refreshing dashboard'
  "$FETCH_DASHBOARD_CMD" "$DASH_PNG"
  fetch_status=$?
  if [ "$fetch_status" -ne 0 ]; then
    echo 'Using cached dashboard image after download failure.'
  fi
  display_dashboard_image
}

refresh_cached_dashboard() {
  echo 'Using cached dashboard image while Wi-Fi is unavailable.'
  display_dashboard_image
}
```

- [ ] **Step 4: Add the orchestration function**

Replace `main_loop` with:

```sh
refresh_cycle() {
  if "$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP"; then
    refresh_remote_config || true
    log_battery_stats
    refresh_dashboard
    return $?
  fi
  echo 'Wi-Fi unavailable; keeping remote config and cached dashboard.'
  log_battery_stats
  refresh_cached_dashboard
}

main_loop() {
  while true; do
    refresh_cycle || true
    sleep_until_next_refresh "$refresh_interval_secs"
  done
}
```

Remove Wi-Fi waiting from both `refresh_dashboard` and the post-RTC branch of `sleep_until_next_refresh`. The next `refresh_cycle` is the single authoritative enable/wait/config/PNG boundary for normal sleep, RTC wake, resume, and manual refresh.

- [ ] **Step 5: Verify and commit the runtime unit**

```powershell
node --test tests/kindleRuntime.test.mjs tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs
& "$env:ProgramFiles\Git\bin\bash.exe" -lc "git ls-files -z '*.sh' | xargs -0 -n1 sh -n"
npm.cmd test
npm.cmd run build
git diff --check
git add kindle-extension/dash.sh tests/kindleRuntime.test.mjs tests/kindleScripts.test.mjs
git commit -m "Order Kindle refreshes after Wi-Fi"
```

Expected: exact call order and offline cache behavior pass. Stop for PR 4 review before push/merge.

---

## PR 9b — Exact Device Config Version

### Task 6: Require Exact Ordered Version 1

**Files:**
- Modify: `kindle-extension/local/fetch-remote-config.sh:147-168`
- Modify: `tests/kindleScripts.test.mjs:574-707`

**Interfaces:**
- Consumes: bounded temporary device-config file.
- Produces: one allowlisted interval on stdout only for exact `version=1` wire format.

- [ ] **Step 1: Add the invalid wire-format table**

Extend the remote-config test harness with:

```js
const invalidBodies = [
  'refresh_interval_seconds=60\n',
  'version=2\nrefresh_interval_seconds=60\n',
  'refresh_interval_seconds=60\nversion=1\n',
  'version=1\nversion=1\nrefresh_interval_seconds=60\n',
  'version=1\nrefresh_interval_seconds=60\nrefresh_interval_seconds=120\n',
  'version=1\nrefresh_interval_seconds=60\nunknown=true\n',
  'version=1\nrefresh_interval_seconds=60\n\n',
];
```

For every body, assert nonzero status and empty stdout. Preserve the tests for all 20 allowlisted values, timeout, oversize, and secret-free xtrace.

Also seed `refresh_interval_secs=720`, run `refresh_remote_config` through the daemon/function harness for unknown version, reordered, duplicate, oversized, timeout, and network failure, and assert after each case:

```js
assert.equal(state.refreshIntervalSeconds, 720);
assert.deepEqual(state.networkOrder, ['wifi', 'config', 'png']);
assert.equal(state.pngFetches, 1);
assert.equal(state.cacheRemainsValidProfilePng, true);
```

Wi-Fi unavailable is a separate case and still asserts only `['wifi']`, zero config, and zero PNG. For one valid exact response with `refresh_interval_seconds=60`, assert the state changes to 60 and the same cycle appends `png`. This integration table proves config failure cannot clear/reset the last valid cadence while preserving the approved behavior that a config failure does not suppress an otherwise valid Dashboard refresh.

- [ ] **Step 2: Run the focused parser tests and verify RED**

```powershell
node --test --test-name-pattern="remote config helper" tests/kindleScripts.test.mjs
```

Expected: several bodies succeed because the current parser searches only for one valid interval line.

- [ ] **Step 3: Replace interval search with the exact two-line parser**

Use:

```sh
line_count=$(wc -l <"$TMP" 2>/dev/null) || line_count=0
[ "$line_count" -eq 2 ] || {
  echo 'fetch-remote-config: invalid response' >&2
  exit 1
}

version_line=$(sed -n '1p' "$TMP")
interval_line=$(sed -n '2p' "$TMP")
[ "$version_line" = 'version=1' ] || {
  echo 'fetch-remote-config: unsupported version' >&2
  exit 1
}

case "$interval_line" in
  refresh_interval_seconds=*) value=${interval_line#refresh_interval_seconds=} ;;
  *) echo 'fetch-remote-config: invalid response' >&2; exit 1 ;;
esac
case "$value" in
  ''|*[!0-9]*) echo 'fetch-remote-config: invalid response' >&2; exit 1 ;;
esac
case "$value" in
  10|20|30|40|50|60|120|180|240|300|360|420|480|540|600|660|720|780|840|900)
    printf '%s\n' "$value"
    ;;
  *)
    echo 'fetch-remote-config: unsupported interval' >&2
    exit 1
    ;;
esac
```

- [ ] **Step 4: Verify, commit, and stop**

```powershell
node --test --test-name-pattern="remote config helper" tests/kindleScripts.test.mjs
npm.cmd test
npm.cmd run build
& "$env:ProgramFiles\Git\bin\bash.exe" -lc "git ls-files -z '*.sh' | xargs -0 -n1 sh -n"
git diff --check
git add kindle-extension/local/fetch-remote-config.sh tests/kindleScripts.test.mjs
git commit -m "Require exact Kindle device config v1"
```

Expected: parser and full gates pass. Stop for PR 9b review before publication.

## Device Deployment and Rollback Boundary

The existing device requires two clearly separated USB visits:

1. **USB A in Phase 0:** credential-only URL/dimension migration while the unsafe downloader is stopped.
2. **USB B in Phase 4:** execute Task 8 of `2026-07-13-verification-release-and-ponytail.md` exactly: stop daemon/restore chrome, hash and privately back up every replaced tracked file, build the copy allowlist from `git ls-files kindle-extension`, explicitly exclude `local/env.sh`, `dash.png`, logs/backups/test artifacts, copy only merged files, verify hashes and FAT32-visible bytes, safely eject, and run the device checklist.

USB B rollback stops the daemon, reconnects USB, restores each backed-up script from the recorded allowlist, re-hashes every restored byte, preserves `local/env.sh` and `dash.png`, safely ejects, and runs one cached/device smoke. FAT32 does not preserve POSIX executable mode; KUAL invokes the tracked `.sh` files through the shell, and syntax/shebang plus byte hashes—not a fabricated Windows mode bit—are the verification contract. Rollback never removes the View Token, reverts to an unauthenticated URL, or deletes the cached PNG.
