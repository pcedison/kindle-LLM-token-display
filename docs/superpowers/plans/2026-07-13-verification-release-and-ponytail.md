# Verification, Release, and Ponytail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible built-app and production smoke tooling, strengthen CI/release evidence, complete Kindle/Windows acceptance, and perform a report-only Ponytail audit after release approval.

**Architecture:** PR 10 adds only verification tooling, CI gates, and truthful documentation. Phase 4 then binds the approved merge SHA to production and performs secret-safe API, browser, Kindle, and Windows acceptance. Phase 5 invokes Ponytail audit in report-only mode; every future simplification requires a separate plan and PR.

**Tech Stack:** Node.js standard library and Fetch, Next.js production server, GitHub Actions, Vercel CLI 55+, PowerShell, in-app browser, Kindle KUAL/USB, Windows Task Scheduler.

## Global Constraints

- Every repository PR runs the exact fixed gate in `2026-07-13-project-hardening-master.md`; PR 10 installs the permanent `smoke:built` form of that gate.

- Verification output reports status, dimensions, booleans, IDs, and SHAs only; never a token, authenticated URL, cookie, response body containing private data, or complete Authorization header.
- Built-app smoke runs `next start` after `next build`; the existing `next dev` integration test remains.
- Production smoke receives credentials through stdin, not argv, committed files, or persistent environment configuration.
- Do not unset the production view token to test missing-token 503; cover that in unit/preview isolation.
- CI has no production secret and never calls production authenticated smoke.
- Dependency audit blocks new high/critical findings; existing lower findings require recorded exposure/mitigation/recheck criteria.
- Vercel `meta.githubCommitSha` must equal the approved merge SHA before release acceptance.
- USB B preserves the private Kindle `local/env.sh` and `dash.png` while deploying only merged tracked scripts.
- macOS remains Beta without real hardware evidence.
- Ponytail is audit-only until the user selects a candidate and approves a new plan.

---

## PR 10 — Verification and Documentation

### Task 1: Add Built Next Production Smoke

**Files:**
- Create: `scripts/smoke-built-app.mjs`
- Modify: `package.json:9-14`
- Modify: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Consumes: an existing `.next` production build.
- Produces: exit 0 only when `next start` passes Dashboard and device-config missing/wrong/exact auth, the exact two-line config contract, and all profile PNG metadata checks.

- [ ] **Step 1: Write the release-script contract test**

Add:

```js
test('release scripts include a built-app smoke entrypoint', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const builtSmoke = readFileSync('scripts/smoke-built-app.mjs', 'utf8');
  assert.equal(packageJson.scripts['smoke:built'], 'node scripts/smoke-built-app.mjs');
  assert.doesNotMatch(builtSmoke, /console\.log\([^)]*(token|authorization|url)/i);
});
```

Run it before implementation:

```powershell
node --test --test-name-pattern="built-app smoke entrypoint" tests/openSourceRelease.test.mjs
```

Expected RED: `smoke:built` and/or `scripts/smoke-built-app.mjs` do not exist. This Task has no dependency on the production-smoke files from Task 2.

- [ ] **Step 2: Create the complete built-app smoke script**

Create `scripts/smoke-built-app.mjs`:

```js
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const VIEW_TOKEN = 'built-smoke-view-token';
const PROFILES = [
  ['dp75sdi', 758, 1024],
  ['kpw3', 1072, 1448],
  ['voyage', 1080, 1440],
  ['basic', 600, 800],
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(origin, { cache: 'no-store' });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('built server did not become ready');
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
}

function assertNoStore(response) {
  if (!/no-store/i.test(response.headers.get('cache-control') || '')) {
    throw new Error('response is cacheable');
  }
}

function assertPng(bytes, width, height) {
  const data = Buffer.from(bytes);
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('invalid PNG signature');
  if (data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) {
    throw new Error('invalid PNG dimensions');
  }
  if (data[24] !== 8 || data[25] !== 0 || data[26] !== 0 || data[27] !== 0 || data[28] !== 0) {
    throw new Error('invalid Kindle PNG format');
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  let timer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(resolve, 5_000);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
  if (child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL');
    await exited;
  }
}

const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    BLOB_READ_WRITE_TOKEN: '',
    DASHBOARD_VIEW_TOKEN: VIEW_TOKEN,
    DASHBOARD_PUBLIC_FIXTURE: '',
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});

try {
  await waitForServer(origin);
  const anonymous = await fetchWithTimeout(`${origin}/api/dashboard?profile=dp75sdi`);
  const wrongDashboard = await fetchWithTimeout(`${origin}/api/dashboard?profile=dp75sdi&key=wrong-built-key`);
  if (anonymous.status !== 401 || wrongDashboard.status !== 401) throw new Error('missing/wrong Dashboard credentials were not rejected');
  assertNoStore(anonymous);
  assertNoStore(wrongDashboard);

  const configMissing = await fetchWithTimeout(`${origin}/api/device-config?profile=dp75sdi`);
  const configWrong = await fetchWithTimeout(`${origin}/api/device-config?profile=dp75sdi&key=wrong-built-key`);
  if (configMissing.status !== 401 || configWrong.status !== 401) {
    throw new Error('device config missing/wrong credentials were not rejected');
  }
  assertNoStore(configMissing);
  assertNoStore(configWrong);

  const deviceConfig = await fetchWithTimeout(`${origin}/api/device-config?profile=dp75sdi&key=${VIEW_TOKEN}`);
  if (deviceConfig.status !== 200) throw new Error('device config failed');
  assertNoStore(deviceConfig);
  if (!/^text\/plain\b/i.test(deviceConfig.headers.get('content-type') || '')) {
    throw new Error('invalid device config content type');
  }
  if (await deviceConfig.text() !== 'version=1\nrefresh_interval_seconds=720\n') {
    throw new Error('invalid device config contract');
  }

  for (const [profile, width, height] of PROFILES) {
    const response = await fetchWithTimeout(`${origin}/api/dashboard?profile=${profile}&key=${VIEW_TOKEN}`);
    if (response.status !== 200) throw new Error('private Dashboard failed');
    if (!/^image\/png\b/i.test(response.headers.get('content-type') || '')) throw new Error('invalid PNG content type');
    assertNoStore(response);
    assertPng(await response.arrayBuffer(), width, height);
  }
  process.stdout.write(JSON.stringify({ builtSmoke: true, profiles: PROFILES.length }) + '\n');
} catch {
  process.stderr.write('Built application smoke failed\n');
  process.exitCode = 1;
} finally {
  await stopChild(child);
}
```

- [ ] **Step 3: Add package scripts**

```json
"test": "node --test",
"smoke:built": "node scripts/smoke-built-app.mjs",
"dev": "next dev",
"build": "next build",
"start": "next start"
```

- [ ] **Step 4: Run the built-app contract and smoke, then verify GREEN**

```powershell
node --test --test-name-pattern="built-app smoke entrypoint" tests/openSourceRelease.test.mjs
npm.cmd run build
npm.cmd run smoke:built
```

Expected GREEN: the focused contract and built production smoke pass. Task 1 is complete and green before Task 2 begins.

### Task 2: Add Secret-Safe Production Smoke

**Files:**
- Create: `scripts/lib/png-validation.mjs`
- Create: `scripts/lib/bounded-response.mjs`
- Create: `scripts/release-acceptance.ps1`
- Create: `scripts/smoke-production.mjs`
- Create: `tests/smokePngValidation.test.mjs`
- Create: `tests/smokeBoundedResponse.test.mjs`
- Create: `tests/releaseAcceptance.test.mjs`
- Modify: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Consumes from stdin: JSON `{ "origin": https URL, "viewToken": string, "adminToken": string | "" }`.
- Produces: public JSON booleans/statuses only; no URL, token, response body, or complete Authorization header echo.

- [ ] **Step 1: Write and run the production-smoke contract test RED**

Add a separate test; do not extend the Task 1 test:

```js
test('production smoke accepts bounded stdin and never accepts a credential argv', () => {
  const productionSmoke = readFileSync('scripts/smoke-production.mjs', 'utf8');
  assert.match(productionSmoke, /process\.stdin/);
  assert.match(productionSmoke, /AbortSignal\.timeout/);
  assert.doesNotMatch(productionSmoke, /process\.argv\[2\]/);
  assert.doesNotMatch(productionSmoke, /console\.(log|error)\([^)]*(token|authorization|origin|url)/i);
});
```

Run:

```powershell
node --test --test-name-pattern="production smoke accepts bounded stdin" tests/openSourceRelease.test.mjs
```

Expected RED: `scripts/smoke-production.mjs` does not exist. Task 1 remains green.

- [ ] **Step 2: Add complete PNG unfiltering and its white-image negative tests**

Create `scripts/lib/png-validation.mjs`:

```js
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function pngMetadata(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('invalid PNG signature');
  }
  if (data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('invalid PNG header');
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepth = data[24];
  const colorType = data[25];
  const compression = data[26];
  const filter = data[27];
  const interlace = data[28];
  if (!width || !height || bitDepth !== 8 || colorType !== 0 || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error('unsupported Kindle PNG format');
  }

  const idat = [];
  let sawIend = false;
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const end = offset + 12 + length;
    if (end > data.length) throw new Error('truncated PNG chunk');
    if (type === 'IDAT') idat.push(data.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
    offset = end;
  }
  if (!sawIend || idat.length === 0) throw new Error('incomplete PNG');

  const stride = width;
  const expectedInflated = (stride + 1) * height;
  const scanlines = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflated });
  if (scanlines.length !== expectedInflated) throw new Error('invalid PNG scanline length');

  let nonwhite = 0;
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * (stride + 1);
    const filterType = scanlines[rowOffset];
    if (filterType > 4) throw new Error('unsupported PNG row filter');
    const reconstructed = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x += 1) {
      const encoded = scanlines[rowOffset + 1 + x];
      const left = x === 0 ? 0 : reconstructed[x - 1];
      const up = previous[x];
      const upperLeft = x === 0 ? 0 : previous[x - 1];
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = Math.floor((left + up) / 2);
      else if (filterType === 4) predictor = paethPredictor(left, up, upperLeft);
      const value = (encoded + predictor) & 0xff;
      reconstructed[x] = value;
      if (value < 250) nonwhite += 1;
    }
    previous = reconstructed;
  }

  return { width, height, bitDepth, colorType, compression, filter, interlace, nonwhite };
}
```

Create `tests/smokePngValidation.test.mjs` with synthetic one-row PNGs. CRC bytes are present but are deliberately not part of this metadata validator's contract:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { pngMetadata } from '../scripts/lib/png-validation.mjs';

function chunk(type, payload) {
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  result.write(type, 4, 4, 'ascii');
  payload.copy(result, 8);
  return result;
}

function grayscalePng(filteredRow) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(filteredRow.length - 1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filteredRow)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const WHITE_FILTERED_ROWS = [
  Buffer.from([0, 255, 255, 255, 255]),
  Buffer.from([1, 255, 0, 0, 0]),
  Buffer.from([2, 255, 255, 255, 255]),
  Buffer.from([3, 255, 128, 128, 128]),
  Buffer.from([4, 255, 0, 0, 0]),
];

test('PNG filters 0-4 are unfiltered before nonwhite pixels are counted', () => {
  for (const row of WHITE_FILTERED_ROWS) {
    assert.equal(pngMetadata(grayscalePng(row)).nonwhite, 0);
  }
  assert.equal(pngMetadata(grayscalePng(Buffer.from([4, 0, 255, 0, 0]))).nonwhite, 1);
});

test('white Sub, Up, and Paeth scanlines cannot satisfy a nonwhite threshold', () => {
  for (const index of [1, 2, 4]) {
    assert.equal(pngMetadata(grayscalePng(WHITE_FILTERED_ROWS[index])).nonwhite > 0, false);
  }
});
```

Run:

```powershell
node --test tests/smokePngValidation.test.mjs
```

Expected GREEN: filters 0-4 reconstruct correctly; all-white Sub, Up, and Paeth fixtures remain `nonwhite=0`.

Create `scripts/lib/bounded-response.mjs` and its non-settling cancellation regression test:

```js
export async function readBounded(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('response body too large');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('response body too large');
      chunks.push(Buffer.from(value));
    }
    completed = true;
    return Buffer.concat(chunks, total);
  } finally {
    if (!completed) void reader.cancel().catch(() => {});
  }
}
```

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readBounded } from '../scripts/lib/bounded-response.mjs';

test('bounded response rejection does not await a non-settling cancel', async () => {
  let cancelCalls = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array([1, 2])); },
    cancel() { cancelCalls += 1; return new Promise(() => {}); },
  }));
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('bounded reader hung')), 250);
  });
  try {
    await assert.rejects(Promise.race([readBounded(response, 1), deadline]), /response body too large/);
    assert.equal(cancelCalls, 1);
  } finally {
    clearTimeout(timer);
  }
});
```

Run `node --test tests/smokePngValidation.test.mjs tests/smokeBoundedResponse.test.mjs`. Expected GREEN: oversize rejection completes before the 250 ms deadline even though the stream's `cancel()` promise never settles.

- [ ] **Step 3: Create the complete bounded production-smoke script**

```js
import { randomBytes } from 'node:crypto';
import { readBounded } from './lib/bounded-response.mjs';
import { pngMetadata } from './lib/png-validation.mjs';

const PROFILES = [
  ['dp75sdi', 758, 1024],
  ['kpw3', 1072, 1448],
  ['voyage', 1080, 1440],
  ['basic', 600, 800],
];
const REQUEST_TIMEOUT_MS = 15_000;
const TEXT_BODY_LIMIT = 64 * 1024;
const PNG_BODY_LIMIT = 4 * 1024 * 1024;

async function readCredentialInput() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > 16384) throw new Error('credential input too large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value.viewToken !== 'string' || !value.viewToken) {
    throw new Error('view credential missing');
  }
  const origin = new URL(value.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || value.origin !== origin.origin) {
    throw new Error('production origin invalid');
  }
  if (typeof value.adminToken !== 'string') throw new Error('admin credential invalid');
  return { ...value, origin: origin.origin };
}

function statusOnly(response) { return Number(response.status); }
function noStore(response) { return /no-store/i.test(response.headers.get('cache-control') || ''); }

function wrongCredential(exactValues) {
  let candidate;
  do candidate = `wrong-${randomBytes(24).toString('base64url')}`;
  while (exactValues.includes(candidate));
  return candidate;
}

async function requestBounded(url, init, limit) {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readBounded(response, limit);
  return { response, body };
}

try {
  const { origin, viewToken, adminToken } = await readCredentialInput();
  const wrongView = wrongCredential([viewToken, adminToken]);
  const wrongAdmin = wrongCredential([viewToken, adminToken, wrongView]);
  const wrongIngest = wrongCredential([viewToken, adminToken, wrongView, wrongAdmin]);
  const { response: missing } = await requestBounded(`${origin}/api/dashboard?profile=dp75sdi`, {}, TEXT_BODY_LIMIT);
  const { response: wrong } = await requestBounded(`${origin}/api/dashboard?profile=dp75sdi&key=${encodeURIComponent(wrongView)}`, {}, TEXT_BODY_LIMIT);
  if (missing.status !== 401 || wrong.status !== 401 || !noStore(missing) || !noStore(wrong)) {
    throw new Error('anonymous view contract failed');
  }

  const profileResults = [];
  for (const [profile, width, height] of PROFILES) {
    const key = encodeURIComponent(viewToken);
    const { response, body } = await requestBounded(`${origin}/api/dashboard?profile=${profile}&managed=true&key=${key}`, {}, PNG_BODY_LIMIT);
    const metadata = pngMetadata(body);
    const valid = response.status === 200
      && /^image\/png\b/i.test(response.headers.get('content-type') || '')
      && noStore(response)
      && metadata.width === width
      && metadata.height === height
      && metadata.bitDepth === 8
      && metadata.colorType === 0
      && metadata.compression === 0
      && metadata.filter === 0
      && metadata.interlace === 0
      && metadata.nonwhite > 1000;
    profileResults.push({ profile, valid });
  }

  const { response: configMissing } = await requestBounded(`${origin}/api/device-config?profile=dp75sdi`, {}, TEXT_BODY_LIMIT);
  const { response: configWrong } = await requestBounded(`${origin}/api/device-config?profile=dp75sdi&key=${encodeURIComponent(wrongView)}`, {}, TEXT_BODY_LIMIT);
  const { response: config, body: configBytes } = await requestBounded(`${origin}/api/device-config?profile=dp75sdi&key=${encodeURIComponent(viewToken)}`, {}, TEXT_BODY_LIMIT);
  const configBody = configBytes.toString('utf8');
  const configValid = config.status === 200
    && configMissing.status === 401
    && configWrong.status === 401
    && noStore(config)
    && noStore(configMissing)
    && noStore(configWrong)
    && /^text\/plain\b/i.test(config.headers.get('content-type') || '')
    && /^version=1\nrefresh_interval_seconds=(10|20|30|40|50|60|120|180|240|300|360|420|480|540|600|660|720|780|840|900)\n$/.test(configBody);

  const { response: adminMissing } = await requestBounded(`${origin}/api/config?profile=dp75sdi`, {}, TEXT_BODY_LIMIT);
  const { response: adminWrong } = await requestBounded(`${origin}/api/config?profile=dp75sdi`, {
    headers: { authorization: `Bearer ${wrongAdmin}` },
  }, TEXT_BODY_LIMIT);
  let adminExact = null;
  if (adminToken) {
    const { response } = await requestBounded(`${origin}/api/config?profile=dp75sdi`, {
      headers: { authorization: `Bearer ${adminToken}` },
    }, TEXT_BODY_LIMIT);
    adminExact = response.status === 200 && noStore(response);
  }

  const { response: ingestWrong } = await requestBounded(`${origin}/api/usage`, {
    method: 'POST',
    headers: { authorization: `Bearer ${wrongIngest}`, 'content-type': 'application/json' },
    body: '{}',
  }, TEXT_BODY_LIMIT);

  const result = {
    viewMissing: statusOnly(missing),
    viewWrong: statusOnly(wrong),
    profiles: profileResults,
    deviceConfigMissing: statusOnly(configMissing),
    deviceConfigWrong: statusOnly(configWrong),
    deviceConfigExact: configValid,
    adminMissing: statusOnly(adminMissing),
    adminWrong: statusOnly(adminWrong),
    adminExact,
    ingestWrong: statusOnly(ingestWrong),
  };
  if (
    profileResults.some(({ valid }) => !valid)
    || !configValid
    || adminMissing.status !== 401
    || adminWrong.status !== 401
    || (adminToken && adminExact !== true)
    || ingestWrong.status !== 401
  ) throw new Error('production contract failed');
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write('Production smoke failed\n');
  process.exitCode = 1;
}
```

The origin and credentials all arrive through bounded stdin. The tracked script contains neither the real host nor an authenticated URL.

- [ ] **Step 4: Add the reloadable release-acceptance helper and tests**

Create `scripts/release-acceptance.ps1` as a dot-source-only helper with exactly these public functions:

```text
Assert-ReleaseCheckout(CanonicalRepo, Path, ApprovedMergeSha) -> no output or generic throw
Assert-CanonicalReleaseBinding(CanonicalRepo, ProductionHost, LinkedProjectId,
  ApprovedMergeSha, ExpectedDeploymentId = '', InvokeVercelApi = real CLI seam)
  -> boolean/ID metadata only
Write-ReleaseBindingCreateNew(BindingPath, State) -> no output
Open-ReleaseAcceptanceContext(CanonicalRepo, BindingPath) -> validated non-secret state
```

The binding schema has exactly eight keys: `schemaVersion`, `canonicalRepo`, `releaseWorktreePath`, `approvedMergeSha`, `productionOrigin`, `productionHost`, `linkedProjectId`, and `deploymentId`. `Write-ReleaseBindingCreateNew` requires the fixed `%LOCALAPPDATA%\KindleLLMDashboardReleaseAcceptance\binding.json` path, creates its dedicated directory, writes UTF-8 with `FileMode.CreateNew`/`WriteThrough`, and never overwrites or deletes an existing state. It rejects any credential-like key/value field and stores no token, authenticated URL, header, cookie, or environment data.

`Open-ReleaseAcceptanceContext` requires exact keys/types, canonical lowercase HTTPS origin equality, origin/host agreement, linked `.vercel/project.json` project ID, fixed sibling release-worktree path, current-user binding ownership, registered detached worktree, clean full porcelain, and exact approved `HEAD`. `Assert-CanonicalReleaseBinding` performs exactly three bounded JSON calls in order: `GET /v4/aliases/{productionHost}`, `GET /v13/deployments/{first.deploymentId}`, then the same alias GET again. It requires direct/non-redirect alias, exact alias/project/deployment ID, alias nested deployment ID/URL agreement, deployment ID/project/URL agreement, `READY`, target `production`, exact approved `meta.githubCommitSha`, and byte-identical alias deployment binding on the confirmation read. An optional expected ID must equal all reads. Only the API invocation is injectable, never validation logic; errors and output contain booleans/ID only, never an origin or API body.

Add executable PowerShell-backed tests in `tests/releaseAcceptance.test.mjs` for:

- create/read in two separate PowerShell processes, proving state and helper reload across session loss;
- existing binding refusal and byte identity;
- missing/extra/wrong-type fields, origin mismatch, wrong project, wrong SHA/path, and credential-like state refusal;
- registered detached clean exact-SHA worktree acceptance;
- attached, dirty, wrong-HEAD, unregistered, and path-collision rejection;
- safe reuse of an existing registered/detached/clean/exact-SHA worktree;
- alias/deployment/alias success, alias movement on confirmation, wrong deployment ID/project/URL/state/target/SHA, redirect, and malformed API JSON.

All fixtures use temp Git repositories and a fake API scriptblock; they never call Vercel or production.

- [ ] **Step 5: Run Task 2 tests and verify GREEN**

```powershell
node --test tests/smokePngValidation.test.mjs tests/smokeBoundedResponse.test.mjs tests/releaseAcceptance.test.mjs
node --test --test-name-pattern="production smoke accepts bounded stdin" tests/openSourceRelease.test.mjs
```

Expected GREEN without calling production. Task 1 remains green and Task 2 proves timeouts, bounded stdin/body reads, collision-proof wrong credentials, complete filters 0-4, device-config missing/wrong/exact auth plus `text/plain`, and restart-safe exact release binding/worktree assertions.

### Task 3: Add CI Gates Without Production Secrets

**Files:**
- Create: `scripts/check-coverage-baseline.mjs`
- Modify: `.github/workflows/ci.yml:17-56`
- Modify: `package.json:9-14`
- Modify: `tests/openSourceRelease.test.mjs:54-70`

**Interfaces:**
- Consumes: package lock, full tests, build.
- Produces: the unchanged full `npm test` gate, dependency high/critical gate, coverage non-regression against `docs/audits/hardening-coverage-baseline.json`, and built-app smoke on Windows/macOS.

- [ ] **Step 1: Add workflow contract assertions**

Assert `ci.yml` includes:

```text
npm audit --omit=dev --audit-level=high
npm test
npm run test:coverage
npm run build
npm run smoke:built
```

and contains no `DASHBOARD_VIEW_TOKEN`, production host, or production smoke command. Also assert `package.json` maps `test:coverage` to `node scripts/check-coverage-baseline.mjs` and that the checker reads `docs/audits/hardening-coverage-baseline.json`.

Run the focused contract before implementation and require RED because the checker is absent and the workflow does not contain the new gates.

- [ ] **Step 2: Create the cross-platform baseline checker**

Create `scripts/check-coverage-baseline.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(readFileSync('docs/audits/hardening-coverage-baseline.json', 'utf8'));
const run = spawnSync(process.execPath, ['--test', '--experimental-test-coverage'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.status !== 0) process.exit(run.status || 1);

const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const testsMatch = output.match(/^.*tests\s+(\d+)\s*$/m);
const coverageMatch = output.match(/^.*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/m);
if (!testsMatch || !coverageMatch) throw new Error('Unable to parse Node coverage summary');
const current = {
  tests: Number(testsMatch[1]),
  lines: Number(coverageMatch[1]),
  branches: Number(coverageMatch[2]),
  functions: Number(coverageMatch[3]),
};
for (const key of ['tests', 'lines', 'branches', 'functions']) {
  if (!Number.isFinite(current[key]) || !Number.isFinite(Number(baseline[key]))) {
    throw new Error(`Invalid coverage baseline field: ${key}`);
  }
  const floor = key === 'tests' ? Math.max(226, Number(baseline[key])) : Number(baseline[key]);
  if (current[key] < floor) throw new Error(`Coverage baseline regressed: ${key}`);
}
process.stdout.write(`${JSON.stringify({ coverageBaseline: true, ...current })}\n`);
```

Set:

```json
"test": "node --test",
"test:coverage": "node scripts/check-coverage-baseline.mjs",
"smoke:built": "node scripts/smoke-built-app.mjs"
```

The coverage command intentionally runs the full suite again with instrumentation; it does not replace `npm test`.

- [ ] **Step 3: Update Windows job order**

```yaml
      - run: npm ci
      - run: npm audit --omit=dev --audit-level=high
      - run: npm test
      - run: npm run test:coverage
      - run: npm run build
      - run: npm run smoke:built
```

- [ ] **Step 4: Update macOS job order**

Keep shell syntax, then:

```yaml
      - run: npm test
      - run: npm run test:coverage
      - run: npm run build
      - run: npm run smoke:built
```

Run dependency audit once in Windows CI to avoid duplicate network work. Keep the Ubuntu Kindle syntax job unchanged.

- [ ] **Step 5: Verify workflow tests and local built smoke GREEN**

```powershell
node --test tests/openSourceRelease.test.mjs
npm.cmd test
npm.cmd run test:coverage
npm.cmd run build
npm.cmd run smoke:built
npm.cmd audit --omit=dev --audit-level=high
```

Expected: the permanent `npm test` gate, baseline-enforced coverage, build, smoke, and high/critical audit gate pass. Record any lower advisory separately rather than hiding it. A coverage percentage or test count below any committed master-baseline field is a hard failure, even when `node --test` itself exits 0.

### Task 4: Add Acceptance and Release Documentation

**Files:**
- Create: `docs/KINDLE-ACCEPTANCE.md`
- Create: `docs/RELEASE-CHECKLIST.md`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/VERCEL-SETUP.md`
- Modify: `docs/WINDOWS-COLLECTOR.md`
- Modify: `docs/MACOS-COLLECTOR.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `tests/openSourceRelease.test.mjs`

**Interfaces:**
- Consumes: approved design and newly collected evidence only.
- Produces: executable checklists and truthful current status.

- [ ] **Step 1: Add document contract tests**

Require README links to both new files. Require Kindle acceptance to contain USB A/USB B, private URL preservation, cache checksum, two web-save cycles, normal/TERM/power restore, 0/30/60-minute observations, and five separate scheduled-cycle rows each requiring scheduled/observed timestamps, result, cache SHA-256, and daemon PID/state. Require Release Checklist to separate local, PR, CI, approved merge SHA, inspected deployment ID/READY/SHA, smoke, Kindle, Windows, and macOS Beta evidence.

- [ ] **Step 2: Create `docs/KINDLE-ACCEPTANCE.md`**

Use checkboxes for:

```text
deployment SHA recorded
missing/wrong/exact view-key statuses
private backup of env/cache/scripts
USB B preserves env.sh and dash.png
first hardened private refresh
invalid/network failure cache checksum unchanged
no-cache failure does not call eips
web Save takes effect without USB across two complete cycles
normal stop, TERM, and physical power restore chrome
720-second cadence for at least 60 minutes and five complete scheduled cycles
each of cycles 1-5 records scheduled timestamp, observed timestamp, refresh result, cache SHA-256, and daemon PID/state
battery, credential-free thermal data, daemon state at 0/30/60 minutes
user acceptance of observed battery/thermal change
```

Do not pre-check any box.

Include this mandatory evidence table; a row with any blank field cannot pass acceptance:

```text
| Cycle | Scheduled timestamp | Observed timestamp | Refresh result | Cache SHA-256 | Daemon PID/state |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
```

The 0-minute observation is the pre-cycle baseline. Cycles 1-5 are the five scheduled 720-second boundaries ending at approximately 12/24/36/48/60 minutes. Record a controlled result label such as `updated`, `unchanged-valid`, or the exact documented failure class; never copy a private URL or credential into the table.

- [ ] **Step 3: Create `docs/RELEASE-CHECKLIST.md`**

Use separate blank evidence fields for:

```text
Local branch/commit
PR head/merge SHA
Windows/macOS/Kindle CI
Approved merge SHA and Vercel inspect deployment ID/READY/githubCommitSha
Production auth/config/PNG smoke
Browser desktop/mobile
Kindle USB B/device acceptance
Windows real scheduler
macOS Beta exact evidence or not-run statement
Dependency audit disposition
Rollback SHA/deployment
Unresolved Critical/P1/P2/P3
```

- [ ] **Step 4: Update existing docs without stale claims**

Remove real production URLs from public docs, prohibit rollback to public reads, document bounded 4 MiB PNG validation and cache preservation, define upload acknowledgement/claim protocol, and mark macOS Beta. In `PROJECT_STATUS.md`, do not mark a future test or device gate passed; record `pending execution` until current evidence exists.

- [ ] **Step 5: Verify docs**

```powershell
node --test tests/openSourceRelease.test.mjs
git diff --check
```

Expected: documentation contract passes and contains no token/authenticated URL.

### Task 5: Verify and Commit PR 10

**Files:**
- PR 10 verification/docs files only.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: one reviewable verification/documentation PR.

- [ ] **Step 1: Run full gates**

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:coverage
npm.cmd run build
npm.cmd run smoke:built
npm.cmd audit --omit=dev --audit-level=high
& "$env:ProgramFiles\Git\bin\bash.exe" -lc "git ls-files -z '*.sh' | xargs -0 -n1 sh -n"
git diff --check
git status --short
```

Expected: all local gates pass; lower audit findings have a written disposition; `.recovery/` and private artifacts remain unstaged.

- [ ] **Step 2: Commit the verification tooling**

```powershell
git add scripts/smoke-built-app.mjs scripts/smoke-production.mjs scripts/release-acceptance.ps1 scripts/lib/png-validation.mjs scripts/lib/bounded-response.mjs scripts/check-coverage-baseline.mjs package.json .github/workflows/ci.yml tests/openSourceRelease.test.mjs tests/smokePngValidation.test.mjs tests/smokeBoundedResponse.test.mjs tests/releaseAcceptance.test.mjs docs/KINDLE-ACCEPTANCE.md docs/RELEASE-CHECKLIST.md README.md docs/ARCHITECTURE.md docs/SECURITY.md docs/VERCEL-SETUP.md docs/WINDOWS-COLLECTOR.md docs/MACOS-COLLECTOR.md PROJECT_STATUS.md
git diff --cached --check
git commit -m "Add hardening release verification"
```

Expected: one scoped commit. Stop for user review before push/PR/merge.

---

## Phase 4 — Release Acceptance

### Task 6: Bind Approved Merge to Vercel Production

**Files:**
- No repository edits during verification.

**Interfaces:**
- Consumes exactly once per acceptance run: the canonical production HTTPS origin and the explicitly approved PR 10 merge SHA.
- Produces: an alias-resolved deployment ID whose exact Vercel record is `production`, `READY`, and bound to the approved SHA, plus one clean detached release-acceptance worktree at that SHA.

- [ ] **Step 1: Resolve Git and deployment identity**

```powershell
$canonicalRepo = (git rev-parse --show-toplevel).Trim()
$releaseWorktreePath = Join-Path (Split-Path -Parent $canonicalRepo) 'kindle-hardening-release-acceptance'
$bindingRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardReleaseAcceptance'
$bindingPath = Join-Path $bindingRoot 'binding.json'
$bindingKeys = @(
    'approvedMergeSha', 'canonicalRepo', 'deploymentId', 'linkedProjectId',
    'productionHost', 'productionOrigin', 'releaseWorktreePath', 'schemaVersion'
) | Sort-Object
$resumeState = $null
if (Test-Path -LiteralPath $bindingPath -PathType Leaf) {
    $bindingItem = Get-Item -LiteralPath $bindingPath -Force
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $ownerAccount = [Security.Principal.NTAccount]::new((Get-Acl -LiteralPath $bindingPath).Owner)
    $ownerSid = $ownerAccount.Translate(
        [Security.Principal.SecurityIdentifier]
    )
    if (
        ($bindingItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $bindingItem.Length -lt 1 -or
        $bindingItem.Length -gt 16384 -or
        $ownerSid.Value -ne $currentSid.Value
    ) { throw 'Release binding state is not a bounded current-user regular file' }
    $resumeState = Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
    if ((@($resumeState.PSObject.Properties.Name | Sort-Object) -join ',') -ne ($bindingKeys -join ',')) {
        throw 'Release binding state schema is invalid'
    }
    if ([int]$resumeState.schemaVersion -ne 1 -or [string]$resumeState.canonicalRepo -ne $canonicalRepo) {
        throw 'Release binding state does not belong to this canonical repository'
    }
    if ([string]$resumeState.releaseWorktreePath -ne $releaseWorktreePath) {
        throw 'Release binding state points outside the fixed acceptance worktree'
    }
    $approvedMergeSha = ([string]$resumeState.approvedMergeSha).ToLowerInvariant()
    if ($approvedMergeSha -notmatch '^[0-9a-f]{40}$') { throw 'Stored approved merge SHA is invalid' }
} else {
    git fetch origin main
    $approvedMergeSha = (Read-Host 'Approved PR 10 merge SHA (40 hex characters)').Trim().ToLowerInvariant()
    if ($approvedMergeSha -notmatch '^[0-9a-f]{40}$') { throw 'Approved merge SHA format is invalid' }
    git cat-file -e "$approvedMergeSha`^{commit}"
    if ($LASTEXITCODE -ne 0) { throw 'Approved merge SHA is not present locally after fetch' }
    $resolvedApprovedSha = (git rev-parse "$approvedMergeSha`^{commit}").Trim().ToLowerInvariant()
    if ($resolvedApprovedSha -ne $approvedMergeSha) { throw 'Approved merge SHA did not resolve exactly' }

    $originInput = Read-Host 'Canonical production origin (exact lowercase https origin; no path/query/fragment)'
    try { $originUri = [Uri]::new($originInput) }
    catch { throw 'Canonical production origin is invalid' }
    $productionHost = $originUri.DnsSafeHost.ToLowerInvariant()
    $productionOrigin = "https://$productionHost"
    if (
        $originUri.Scheme -ne 'https' -or
        -not $originUri.IsDefaultPort -or
        $originUri.UserInfo -or
        $originUri.AbsolutePath -ne '/' -or
        $originUri.Query -or
        $originUri.Fragment -or
        $productionHost -notmatch '^[a-z0-9.-]+$' -or
        $originInput -cne $productionOrigin
    ) { throw 'Canonical production origin must be one exact lowercase HTTPS origin' }

    $linkPath = Join-Path $canonicalRepo '.vercel\project.json'
    if (-not (Test-Path -LiteralPath $linkPath -PathType Leaf)) { throw 'Linked Vercel project metadata is missing' }
    $link = Get-Content -LiteralPath $linkPath -Raw | ConvertFrom-Json
    $linkedProjectId = [string]$link.projectId
    if ($linkedProjectId -notmatch '^prj_') { throw 'Linked Vercel project ID is invalid' }
}

function Assert-ReleaseCheckout {
    param([string]$CanonicalRepo, [string]$Path, [string]$ApprovedMergeSha)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'Release-acceptance worktree is missing' }
    $expectedPath = [IO.Path]::GetFullPath($Path)
    $registeredPaths = @(& git -C $CanonicalRepo worktree list --porcelain |
        Where-Object { $_ -like 'worktree *' } |
        ForEach-Object { [IO.Path]::GetFullPath($_.Substring('worktree '.Length)) })
    if (-not ($registeredPaths | Where-Object { [StringComparer]::OrdinalIgnoreCase.Equals($_, $expectedPath) })) {
        throw 'Release-acceptance worktree is not registered to the canonical repository'
    }
    $head = (& git -C $Path rev-parse HEAD).Trim().ToLowerInvariant()
    $symbolicRef = @(& git -C $Path symbolic-ref -q HEAD)
    $symbolicRefExit = $LASTEXITCODE
    $porcelain = @(& git -C $Path status --porcelain=v1 -uall)
    if (
        $LASTEXITCODE -ne 0 -or
        $head -ne $ApprovedMergeSha -or
        $symbolicRefExit -ne 1 -or
        $symbolicRef.Count -ne 0 -or
        $porcelain.Count -ne 0
    ) {
        throw 'Release-acceptance worktree is not registered, detached, clean, and at the approved merge SHA'
    }
}

if (Test-Path -LiteralPath $releaseWorktreePath -PathType Container) {
    Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo -Path $releaseWorktreePath -ApprovedMergeSha $approvedMergeSha
} else {
    git worktree add --detach $releaseWorktreePath $approvedMergeSha
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create release-acceptance worktree' }
    Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo -Path $releaseWorktreePath -ApprovedMergeSha $approvedMergeSha
}

$releaseHelperPath = Join-Path $releaseWorktreePath 'scripts\release-acceptance.ps1'
if (-not (Test-Path -LiteralPath $releaseHelperPath -PathType Leaf)) { throw 'Approved release assertion helper is missing' }
. $releaseHelperPath

if ($resumeState) {
    $context = Open-ReleaseAcceptanceContext -CanonicalRepo $canonicalRepo -BindingPath $bindingPath
    $approvedMergeSha = $context.approvedMergeSha
    $productionOrigin = $context.productionOrigin
    $productionHost = $context.productionHost
    $linkedProjectId = $context.linkedProjectId
    $deploymentId = $context.deploymentId
    $binding = Assert-CanonicalReleaseBinding -CanonicalRepo $canonicalRepo -ProductionHost $productionHost `
        -LinkedProjectId $linkedProjectId -ApprovedMergeSha $approvedMergeSha -ExpectedDeploymentId $deploymentId
} else {
    $binding = Assert-CanonicalReleaseBinding -CanonicalRepo $canonicalRepo -ProductionHost $productionHost `
        -LinkedProjectId $linkedProjectId -ApprovedMergeSha $approvedMergeSha
    $deploymentId = $binding.DeploymentId
    $newState = [ordered]@{
        schemaVersion = 1
        canonicalRepo = $canonicalRepo
        releaseWorktreePath = $releaseWorktreePath
        approvedMergeSha = $approvedMergeSha
        productionOrigin = $productionOrigin
        productionHost = $productionHost
        linkedProjectId = $linkedProjectId
        deploymentId = $deploymentId
    }
    Write-ReleaseBindingCreateNew -BindingPath $bindingPath -State $newState
    $context = Open-ReleaseAcceptanceContext -CanonicalRepo $canonicalRepo -BindingPath $bindingPath
}
Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo -Path $releaseWorktreePath -ApprovedMergeSha $approvedMergeSha

$localHeadContext = (git rev-parse HEAD).Trim().ToLowerInvariant()
$originMainContext = (git rev-parse origin/main).Trim().ToLowerInvariant()
[pscustomobject]@{
    ApprovedMergeSha = $approvedMergeSha
    DeploymentId = $deploymentId
    ReadyState = 'READY'
    ProductionTarget = $true
    DeploymentSha = $approvedMergeSha
    CanonicalAliasBound = $true
    ReleaseWorktreeClean = $true
    ReleaseWorktreeHeadMatches = $true
    LocalHeadContext = $localHeadContext
    OriginMainContext = $originMainContext
}
```

Expected: the release checklist records the approved SHA, exact alias-resolved deployment ID, `READY`, production target, SHA match, and clean release-worktree booleans. The alias API proves which deployment the one canonical origin currently serves; the deployment API proves that exact ID's state/target/SHA. `local HEAD` and `origin/main` are context only and never acceptance gates. The binding JSON is non-secret, outside every worktree, exact-schema, current-user scoped, and created with `FileMode.CreateNew`; it is never overwritten in place.

At the start of every Task 7-11 invocation—and after any PowerShell restart—run this reload preamble instead of re-entering the origin/SHA:

```powershell
$canonicalRepo = (git rev-parse --show-toplevel).Trim()
$releaseWorktreePath = Join-Path (Split-Path -Parent $canonicalRepo) 'kindle-hardening-release-acceptance'
$bindingRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardReleaseAcceptance'
$bindingPath = Join-Path $bindingRoot 'binding.json'
if (-not (Test-Path -LiteralPath $bindingPath -PathType Leaf)) { throw 'Persisted release binding is missing' }
$bindingItem = Get-Item -LiteralPath $bindingPath -Force
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$ownerAccount = [Security.Principal.NTAccount]::new((Get-Acl -LiteralPath $bindingPath).Owner)
$ownerSid = $ownerAccount.Translate(
    [Security.Principal.SecurityIdentifier]
)
if (
    ($bindingItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    $bindingItem.Length -lt 1 -or
    $bindingItem.Length -gt 16384 -or
    $ownerSid.Value -ne $currentSid.Value
) { throw 'Persisted release binding is not a bounded current-user regular file' }
$bootstrap = Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
$bootstrapKeys = @(
    'approvedMergeSha', 'canonicalRepo', 'deploymentId', 'linkedProjectId',
    'productionHost', 'productionOrigin', 'releaseWorktreePath', 'schemaVersion'
) | Sort-Object
if ((@($bootstrap.PSObject.Properties.Name | Sort-Object) -join ',') -ne ($bootstrapKeys -join ',')) {
    throw 'Persisted release binding schema is invalid'
}
$approvedMergeSha = ([string]$bootstrap.approvedMergeSha).ToLowerInvariant()
if (
    [int]$bootstrap.schemaVersion -ne 1 -or
    [string]$bootstrap.canonicalRepo -ne $canonicalRepo -or
    [string]$bootstrap.releaseWorktreePath -ne $releaseWorktreePath -or
    $approvedMergeSha -notmatch '^[0-9a-f]{40}$'
) { throw 'Persisted release bootstrap is invalid' }

$registeredPaths = @(& git -C $canonicalRepo worktree list --porcelain |
    Where-Object { $_ -like 'worktree *' } |
    ForEach-Object { [IO.Path]::GetFullPath($_.Substring('worktree '.Length)) })
if (-not ($registeredPaths | Where-Object {
    [StringComparer]::OrdinalIgnoreCase.Equals($_, [IO.Path]::GetFullPath($releaseWorktreePath))
})) { throw 'Persisted release worktree is not registered' }
$head = (& git -C $releaseWorktreePath rev-parse HEAD).Trim().ToLowerInvariant()
$symbolicRef = @(& git -C $releaseWorktreePath symbolic-ref -q HEAD)
$symbolicRefExit = $LASTEXITCODE
$porcelain = @(& git -C $releaseWorktreePath status --porcelain=v1 -uall)
if ($head -ne $approvedMergeSha -or $symbolicRefExit -ne 1 -or $symbolicRef.Count -ne 0 -or $porcelain.Count -ne 0) {
    throw 'Persisted release worktree is not detached, clean, and at the approved SHA'
}

$releaseHelperPath = Join-Path $releaseWorktreePath 'scripts\release-acceptance.ps1'
if (-not (Test-Path -LiteralPath $releaseHelperPath -PathType Leaf)) { throw 'Approved release helper is missing' }
. $releaseHelperPath
$context = Open-ReleaseAcceptanceContext -CanonicalRepo $canonicalRepo -BindingPath $bindingPath
$productionOrigin = $context.productionOrigin
$productionHost = $context.productionHost
$linkedProjectId = $context.linkedProjectId
$deploymentId = $context.deploymentId
Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo -Path $releaseWorktreePath -ApprovedMergeSha $approvedMergeSha
$binding = Assert-CanonicalReleaseBinding -CanonicalRepo $canonicalRepo -ProductionHost $productionHost `
    -LinkedProjectId $linkedProjectId -ApprovedMergeSha $approvedMergeSha -ExpectedDeploymentId $deploymentId
```

The raw bootstrap validates registration/detached/clean/HEAD before dot-sourcing any helper. `Open-ReleaseAcceptanceContext` then revalidates the binding file's exact schema, canonical origin, linked project, fixed paths, current-user ownership, and release checkout. A missing/tampered state or unsafe existing worktree fails closed; a clean registered detached exact-SHA worktree is safely reusable.

### Task 7: Run Production and Browser Smoke

**Files:**
- Read the already-approved DPAPI holder; create no new persistent credential file.

**Interfaces:**
- Consumes: the Task 6 canonical origin/deployment binding and clean release worktree, the view token from the Phase 0 CurrentUser-DPAPI operator holder, plus an admin token entered into a SecureString prompt.
- Produces: production status/metadata JSON only.

- [ ] **Step 1: Pipe credentials to production smoke without argv/env persistence**

```powershell
Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo -Path $releaseWorktreePath -ApprovedMergeSha $approvedMergeSha
$preSmokeBinding = Assert-CanonicalReleaseBinding -CanonicalRepo $canonicalRepo -ProductionHost $productionHost `
    -LinkedProjectId $linkedProjectId -ApprovedMergeSha $approvedMergeSha -ExpectedDeploymentId $deploymentId
$smokeScript = Join-Path $releaseWorktreePath 'scripts\smoke-production.mjs'
if (-not (Test-Path -LiteralPath $smokeScript -PathType Leaf)) { throw 'Approved production smoke script is missing' }
$operatorSecretPath = Join-Path (Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardOperator') 'view-token.dpapi'
if (-not (Test-Path -LiteralPath $operatorSecretPath -PathType Leaf)) {
    throw 'Authorized DPAPI view credential holder is missing'
}
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('kindle-llm-dash/view-token/v1')
$protectedBytes = $null
$plainBytes = $null
$viewPlain = $null
$adminSecure = $null
$adminPlain = $null
$payload = $null
try {
    $protectedBytes = [IO.File]::ReadAllBytes($operatorSecretPath)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes,
        $entropy,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $viewPlain = [Text.Encoding]::UTF8.GetString($plainBytes)
    if ([string]::IsNullOrWhiteSpace($viewPlain)) { throw 'DPAPI view credential is empty' }
    $adminSecure = Read-Host 'Admin token' -AsSecureString
    $adminPlain = [Net.NetworkCredential]::new('', $adminSecure).Password
    $payload = [pscustomobject]@{
        origin = $productionOrigin
        viewToken = $viewPlain
        adminToken = $adminPlain
    } | ConvertTo-Json -Compress
    $payload | node $smokeScript
    if ($LASTEXITCODE -ne 0) { throw 'Production smoke failed' }
    $postSmokeBinding = Assert-CanonicalReleaseBinding -CanonicalRepo $canonicalRepo -ProductionHost $productionHost `
        -LinkedProjectId $linkedProjectId -ApprovedMergeSha $approvedMergeSha -ExpectedDeploymentId $deploymentId
} finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
    if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
    $viewPlain = $null
    $adminPlain = $null
    $adminSecure = $null
    $payload = $null
    Remove-Variable viewPlain, adminPlain, adminSecure, payload, plainBytes, protectedBytes, entropy -ErrorAction SilentlyContinue
}
```

Expected: JSON reports 401 Dashboard missing/wrong, four valid nonwhite profiles, device-config 401 missing/wrong plus exact `text/plain` content, 401 admin missing/wrong, true admin exact, and 401 wrong ingest; no secret appears. The exact smoke script comes from the clean approved-SHA worktree, and alias binding is unchanged immediately before/after the request sequence. The smoke script generates wrong credentials at runtime and rejects any collision with supplied exact credentials. Keep the DPAPI file only until final release acceptance; plaintext arrays/variables are cleared after this invocation even on failure.

- [ ] **Step 2: Exercise editor desktop/mobile**

Reload the persisted release context if this is a new process, then re-run `Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo ...` and `Assert-CanonicalReleaseBinding` with the Task 6 deployment ID. Use the same already-validated `$productionOrigin` in the in-app browser with 1440x1000 and 390x844 viewports; do not enter a second origin. Unlock, switch all profiles, upload valid artwork, trigger one invalid upload/focus error, save a reversible setting, verify preview, then restore the original setting. Re-run the alias assertion after restoration.

Expected: no horizontal overflow, clipped primary control, persistent admin token, or stale preview. The admin token is cleared by Lock and not retained after reload.

### Task 8: Perform USB B and Kindle Acceptance

**Files:**
- Read merged source: `kindle-extension/**`
- Modify device tracked scripts under: `<KINDLE_DRIVE>:\extensions\kindle-dash\`
- Preserve device private state: `<KINDLE_DRIVE>:\extensions\kindle-dash\local\env.sh`, `<KINDLE_DRIVE>:\extensions\kindle-dash\dash.png`

**Interfaces:**
- Consumes: merged hardened scripts and private device config/cache.
- Produces: real-device evidence from `docs/KINDLE-ACCEPTANCE.md`.

- [ ] **Step 1: Stop and privately back up USB B state**

Reload the persisted release context if needed. Before touching the Kindle, run `Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo -Path $releaseWorktreePath -ApprovedMergeSha $approvedMergeSha` and `Assert-CanonicalReleaseBinding` with `-ExpectedDeploymentId $deploymentId`; any failure stops acceptance. Then stop Dashboard/restore chrome, connect USB, select and verify the Kindle/FAT32 volume, copy `local/env.sh`, `dash.png`, and every replaced script to a timestamped device backup. Record SHA-256 hashes without printing file content.

- [ ] **Step 2: Copy only merged tracked runtime files**

Use `git -C $releaseWorktreePath ls-files -- kindle-extension` to build the allowlist and resolve every source below that exact clean worktree. Exclude `kindle-extension/local/env.sh`, `dash.png`, logs, backups, and test artifacts. Copy only those approved-SHA sources, preserve executable intent, and re-hash; never read a runtime file from the canonical/current worktree.

- [ ] **Step 3: Validate private configuration structurally**

Report only: Dashboard/device-config host equals the already-validated `$productionHost`, each key count equals one, expected dimensions 758x1024, interval 720, and shell syntax pass. Do not print URLs.

- [ ] **Step 4: Execute the checklist with five per-cycle records**

Complete every item in the approved-SHA worktree's `docs/KINDLE-ACCEPTANCE.md`: first refresh, network/invalid failure cache checksum, absent-cache no-eips controlled test, two web-save cycles without USB, three restore paths, and 60-minute/five-cycle observation with 0/30/60 diagnostics. Reassert the same canonical deployment immediately before and after the sustained observation. Before starting the timer, record the baseline cache SHA-256 and daemon PID/state. At each scheduled boundary 1-5, independently record all six table fields: cycle number, scheduled timestamp, observed timestamp, controlled refresh result, post-cycle cache SHA-256, and daemon PID/state. Do not infer intermediate cycles from only the 0/30/60 snapshots.

Expected: five complete nonblank cycle rows plus the 0/30/60 diagnostics. Any daemon exit, hang, missed refresh, unexplained cache hash, thermal warning, unexpected reboot, invalid draw, or chrome restoration failure stops release acceptance. An intentionally injected failure must retain the prior cache hash and carry its documented failure result. User explicitly accepts observed battery/thermal change.

### Task 9: Perform Windows Real-Scheduler Acceptance

**Files:**
- Follow: `docs/WINDOWS-COLLECTOR.md`
- Record in: `docs/RELEASE-CHECKLIST.md` only after current evidence is gathered.

**Interfaces:**
- Consumes: current Windows account, official signed-in clients, approved ingest endpoint/token, and installers/docs from the Task 6 clean approved-SHA release worktree.
- Produces: real install/schedule/upload/rollback/uninstall evidence.

- [ ] **Step 1: Run non-destructive primary-account acceptance**

Reload the persisted release context if needed, then re-run `Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo ...` and the exact alias/deployment assertion. Invoke install/diagnose/uninstall only by absolute paths under `$releaseWorktreePath`; never use scripts from the canonical/current worktree. Install, diagnose, run the owned GUID task, verify exact server acknowledgement and last-upload update, wait a full 12-minute second run, confirm `WakeToRun=false` and no overlap, test sleep/resume catch-up, reinstall, and uninstall. Reassert the same alias deployment after acceptance.

- [ ] **Step 2: Run destructive failures only in disposable scope**

Use Windows Sandbox/VM or a disposable user for task-create failure, foreign task/action, concurrent settings change, and rollback-failure tests. Never inject these into the user's primary scheduled task.

Expected: exact ownership and rollback pass; logs/config/task XML contain no exposed token.

### Task 10: Record macOS Beta Truthfully

Any real-Mac result collected at PR 3 is preliminary and cannot satisfy Phase 4 because PR 8 later modifies `install-macos.sh`. If no real Mac is available after the final PR 10 merge, record `not run - macOS remains Beta` and do not block the verified Kindle/Windows release. If available, start from a clean checkout, require `git rev-parse HEAD` to equal the user-approved final PR 10 merge SHA, rerun the complete disposable-account sequence from the macOS plan, and record OS version/architecture; otherwise record `not run - macOS remains Beta`. Never generalize support.

### Task 11: Final Release Review

- [ ] **Step 1: Populate and review the evidence**

Reload the persisted release context if needed. Immediately before final review, re-run `Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo ...` and `Assert-CanonicalReleaseBinding` against the same deployment ID. Use the approved-SHA `docs/RELEASE-CHECKLIST.md` only as a template and populate one secret-free review copy outside every Git worktree with freshly collected results, including the explicitly approved merge SHA and the alias-bound deployment ID/READY/production/SHA proof. Keep the release worktree byte-clean and stop for user approval. A failed required gate leaves the remediation incomplete; it is not converted to a documentation exception. Publishing the evidence into tracked docs would require a later explicitly approved docs-only PR and is not inferred from release approval.

- [ ] **Step 2: Remove the temporary operator credential holder only after approval**

After the user approves final acceptance, delete the Phase 0 DPAPI holder unless the user explicitly elects to retain it as an authorized read client:

```powershell
$operatorSecretRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardOperator'
$operatorSecretPath = Join-Path $operatorSecretRoot 'view-token.dpapi'
if (Test-Path -LiteralPath $operatorSecretPath) {
    Remove-Item -LiteralPath $operatorSecretPath -Force
}
if (Test-Path -LiteralPath $operatorSecretPath) { throw 'Temporary operator credential holder cleanup failed' }
if ((Test-Path -LiteralPath $operatorSecretRoot -PathType Container) -and -not (Get-ChildItem -LiteralPath $operatorSecretRoot -Force)) {
    Remove-Item -LiteralPath $operatorSecretRoot
}
[pscustomobject]@{ OperatorCredentialHolderRemoved = $true }
```

This removes neither the Vercel secret nor the private Kindle `env.sh`. Record only the cleanup boolean; never inspect or print deleted content.

- [ ] **Step 3: Remove the clean release-acceptance worktree after approval**

Re-run `Assert-ReleaseCheckout -CanonicalRepo $canonicalRepo ...`, return to `$canonicalRepo`, and run `git worktree remove $releaseWorktreePath` without `--force`. After successful removal, delete the non-secret `$bindingPath` with an exact path check and remove its dedicated directory only when empty. Require both paths to be absent and the canonical worktree's pre-existing `.recovery/` state to remain untouched. If the worktree is dirty or binding cleanup is ambiguous, stop and inspect rather than deleting evidence or product changes.

---

## Phase 5 — Ponytail Audit Only

### Task 12: Produce a No-Change Over-Engineering Audit

**Files:**
- Create as the only untracked audit output: `docs/audits/ponytail-audit.md`
- Do not modify runtime/test files.

**Interfaces:**
- Consumes: user-approved Phase 4 release state.
- Produces: ranked delete/simplify/stdlib candidates and explicit exclusions; no branch, commit, push, or PR.

- [ ] **Step 1: Capture and approve the complete no-change baseline**

From the canonical repository, create a new detached audit worktree from the explicitly approved final PR 10 merge SHA. Do not reuse the release-acceptance worktree or any moving branch:

```powershell
$canonicalRepo = [IO.Path]::GetFullPath((Get-Location).Path)
$resolvedCanonicalRoot = (git -C $canonicalRepo rev-parse --show-toplevel).Trim()
if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
    [IO.Path]::GetFullPath($resolvedCanonicalRoot),
    $canonicalRepo
)) { throw 'Phase 5 must start at the canonical repository root' }
git -C $canonicalRepo fetch origin main
$phase5ApprovedSha = (Read-Host 'Approved final PR 10 release SHA for report-only audit').Trim().ToLowerInvariant()
if ($phase5ApprovedSha -notmatch '^[0-9a-f]{40}$') { throw 'Approved audit SHA format is invalid' }
git -C $canonicalRepo cat-file -e "$phase5ApprovedSha`^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Approved audit SHA is unavailable' }
if ((git -C $canonicalRepo rev-parse "$phase5ApprovedSha`^{commit}").Trim().ToLowerInvariant() -ne $phase5ApprovedSha) {
    throw 'Approved audit SHA did not resolve exactly'
}
$auditWorktreePath = Join-Path (Split-Path -Parent $canonicalRepo) 'kindle-hardening-ponytail-audit'
if (Test-Path -LiteralPath $auditWorktreePath) { throw 'Audit worktree path already exists; inspect it before retrying' }
git -C $canonicalRepo worktree add --detach $auditWorktreePath $phase5ApprovedSha
if ($LASTEXITCODE -ne 0) { throw 'Unable to create detached audit worktree' }
$resolvedAuditRoot = (git -C $auditWorktreePath rev-parse --show-toplevel).Trim()
if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
    [IO.Path]::GetFullPath($resolvedAuditRoot),
    [IO.Path]::GetFullPath($auditWorktreePath)
)) { throw 'Audit root did not resolve exactly' }
if ((git -C $auditWorktreePath rev-parse HEAD).Trim().ToLowerInvariant() -ne $phase5ApprovedSha) { throw 'Audit HEAD is not the approved release SHA' }

$knownAllowlist = @()
$baselinePorcelain = @(git -C $auditWorktreePath status --porcelain=v1 -uall | Sort-Object)
$unexpected = @(Compare-Object -ReferenceObject $knownAllowlist -DifferenceObject $baselinePorcelain)
if ($unexpected.Count -ne 0) { throw 'Audit worktree is not the approved clean baseline' }
$baselineProofPath = Join-Path $env:TEMP "kindle-llm-dash-ponytail-baseline-$phase5ApprovedSha.json"
if (Test-Path -LiteralPath $baselineProofPath) { throw 'Audit baseline proof path already exists' }
$auditReportPath = Join-Path $auditWorktreePath 'docs\audits\ponytail-audit.md'
$baselineProof = [pscustomobject]@{
    sha = (git -C $auditWorktreePath rev-parse HEAD).Trim()
    worktreeRoot = $auditWorktreePath
    reportPath = $auditReportPath
    knownAllowlist = $knownAllowlist
    porcelain = $baselinePorcelain
}
[IO.File]::WriteAllText($baselineProofPath, ($baselineProof | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{
    BaselineSha = $baselineProof.sha
    PorcelainEntries = $baselinePorcelain.Count
    KnownAllowlistEntries = $knownAllowlist.Count
}
```

Expected: detached `HEAD` equals the approved final release SHA and both counts are zero. If a future approved baseline genuinely requires an entry, replace `@()` with the exact full porcelain lines during a separately reviewed checkpoint; never use a wildcard or silently absorb current dirt.

- [ ] **Step 2: Invoke the `ponytail-audit` skill**

Invoke it with `$auditWorktreePath` as the explicit whole-repository root, report-only; do not rely on process current directory. Require each finding to include path/line, what can be removed, native/stdlib replacement, behavior proof required, estimated line/dependency impact, and independent rollback.

- [ ] **Step 3: Write the audit report with `apply_patch`**

Sections are:

```text
Baseline SHA and green release evidence
Ranked safe candidates
Candidates rejected after analysis
Protected safety/integration mechanisms
Estimated net lines/dependencies
Required per-candidate tests
```

Protected items include auth, body/stream limits, PNG validation, exact acknowledgement, atomic state, unique lock ownership, installer ownership/rollback, bounded watchdogs, Kindle chrome/cache recovery, accessibility, and real Next integration.

Apply the patch to the absolute `$auditReportPath` from the baseline proof. Reject any target outside `$auditWorktreePath`; never write a relative `docs/...` path from the canonical/current directory.

- [ ] **Step 4: Prove the full porcelain delta is exactly one untracked report**

```powershell
$phase5ApprovedSha = (Read-Host 'Approved final PR 10 release SHA used for this audit').Trim().ToLowerInvariant()
if ($phase5ApprovedSha -notmatch '^[0-9a-f]{40}$') { throw 'Approved audit SHA format is invalid' }
$currentRoot = [IO.Path]::GetFullPath((Get-Location).Path)
$auditWorktreePath = if ((Split-Path -Leaf $currentRoot) -eq 'kindle-hardening-ponytail-audit') {
    $currentRoot
} else {
    Join-Path (Split-Path -Parent $currentRoot) 'kindle-hardening-ponytail-audit'
}
$baselineProofPath = Join-Path $env:TEMP "kindle-llm-dash-ponytail-baseline-$phase5ApprovedSha.json"
if (-not (Test-Path -LiteralPath $baselineProofPath -PathType Leaf)) { throw 'Audit baseline proof is missing' }
$baselineProof = Get-Content -LiteralPath $baselineProofPath -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath([string]$baselineProof.worktreeRoot) -ne [IO.Path]::GetFullPath($auditWorktreePath)) { throw 'Audit worktree root changed' }
if ([IO.Path]::GetFullPath([string]$baselineProof.reportPath) -ne [IO.Path]::GetFullPath((Join-Path $auditWorktreePath 'docs\audits\ponytail-audit.md'))) { throw 'Audit report path changed' }
if ((git -C $auditWorktreePath rev-parse HEAD).Trim() -ne $baselineProof.sha) { throw 'HEAD changed during report-only audit' }
$actualPorcelain = @(git -C $auditWorktreePath status --porcelain=v1 -uall | Sort-Object)
$expectedPorcelain = @((@($baselineProof.porcelain) + '?? docs/audits/ponytail-audit.md') | Sort-Object)
$porcelainDelta = @(Compare-Object -ReferenceObject $expectedPorcelain -DifferenceObject $actualPorcelain)
if ($porcelainDelta.Count -ne 0) { throw 'Audit changed paths outside the approved report' }
$untracked = @(git -C $auditWorktreePath ls-files --others --exclude-standard)
if ($untracked.Count -ne 1 -or $untracked[0] -ne 'docs/audits/ponytail-audit.md') {
    throw 'Untracked audit output differs from the one-file allowlist'
}
$trackedDiff = @(git -C $auditWorktreePath diff --name-only)
if ($trackedDiff.Count -ne 0) { throw 'Report-only audit modified tracked content' }
$reportLines = Get-Content -LiteralPath ([string]$baselineProof.reportPath)
if (@($reportLines | Where-Object { $_ -match '[ \t]+$' }).Count -ne 0) {
    throw 'Untracked audit report contains trailing whitespace'
}
git -C $auditWorktreePath diff --check
[pscustomobject]@{
    HeadUnchanged = $true
    TrackedChanges = $trackedDiff.Count
    UntrackedReport = $untracked[0]
    PorcelainMatches = $true
}
Remove-Item -LiteralPath $baselineProofPath -Force
```

Expected: unchanged detached approved-SHA `HEAD`, zero tracked changes, and exactly one fully reported untracked file, `docs/audits/ponytail-audit.md`. The proof compares complete `--porcelain=v1 -uall` state rather than relying on `git diff`, which omits untracked files. Keep the untracked audit worktree available for user review; do not commit, push, or open a PR. Stop for user candidate selection; audit approval does not authorize implementation.
