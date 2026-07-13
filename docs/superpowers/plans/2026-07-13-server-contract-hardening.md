# Server Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent prototype-chain profile crashes, formally test the single-administrator complete-document storage contract, and reject the full approved credential-like field-name family.

**Architecture:** PR 5 makes the smallest own-property fix without changing the public profile fallback and adds characterization tests for existing atomic last-successful-write-wins storage. PR 9a expands the recursive sensitive-name predicate while retaining the current normalized schema and generic error behavior.

**Tech Stack:** Node.js ESM, Next.js route handlers, Vercel Blob adapter, Node test runner.

## Global Constraints

- Every repository PR runs the exact fixed gate in `2026-07-13-project-hardening-master.md`; the shorter commands below are additional focused gates, not replacements.

- Unknown and prototype-chain profile names safely fall back to `dp75sdi`; no route returns 500 or reads an attacker-selected Blob path.
- Do not redesign profile resolution, renderer layout, or custom dimensions.
- Dashboard configuration supports one administrator, one complete document per profile, no field merge, and the last successfully committed complete write wins.
- Do not add ETag, CAS, revisions, identities, merge logic, or collaborative editing.
- Sensitive-name checks run recursively before normalization and never echo the offending value.
- Preserve existing stricter bans for email, account/org identity, prompts, and transcripts.
- No stored Blob migration is required.

---

## PR 5 — Profile and Configuration Contracts

### Task 1: Reproduce Prototype-Chain Profile Failures

**Files:**
- Modify: `tests/kindleProfiles.test.mjs`
- Modify: `tests/dashboardRoute.test.mjs`
- Modify: `tests/deviceConfigRoute.test.mjs`

**Interfaces:**
- Consumes: `resolveDashboardProfile(searchParams)`.
- Produces: regression proof for `__proto__`, `constructor`, `prototype`, and `toString` across pure resolution and both read routes.

- [ ] **Step 1: Add the pure profile test**

Append to `tests/kindleProfiles.test.mjs`:

```js
test('prototype-chain profile names resolve only through own aliases', () => {
  for (const name of ['__proto__', 'constructor', 'prototype', 'toString']) {
    const profile = resolveDashboardProfile(new URLSearchParams({ profile: name }));
    assert.deepEqual(
      { key: profile.key, width: profile.width, height: profile.height },
      { key: 'dp75sdi', width: 758, height: 1024 },
      name,
    );
  }
});
```

- [ ] **Step 2: Add route/storage-boundary cases**

Add to `tests/dashboardRoute.test.mjs`:

```js
test('managed dashboard never uses a prototype-chain profile for config storage', async () => {
  const profiles = [];
  const png = await renderFixture({
    query: 'profile=__proto__&managed=true&key=fixture-view-token',
    env: { DASHBOARD_VIEW_TOKEN: 'fixture-view-token' },
    snapshot: liveSnapshot(),
    readDashboardConfig: async (profile) => {
      profiles.push(profile);
      return managedConfig({ profile: 'dp75sdi' });
    },
  });
  assert.deepEqual(profiles, ['dp75sdi']);
  assertPngMetadata(png, 758, 1024);
});
```

Add to `tests/deviceConfigRoute.test.mjs` with an explicitly authorized request:

```js
test('device config maps prototype-chain profile names to the safe default', async () => {
  const profiles = [];
  const handler = createDeviceConfigHandler({
    env: { DASHBOARD_VIEW_TOKEN: 'fixture-view-token' },
    readDashboardConfig: async (profile) => {
      profiles.push(profile);
      return storedConfig({ profile });
    },
  });
  const response = await handler(new Request(
    'https://dashboard.test/api/device-config?profile=constructor&key=fixture-view-token',
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(profiles, ['dp75sdi']);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
node --test tests/kindleProfiles.test.mjs tests/deviceConfigRoute.test.mjs tests/dashboardRoute.test.mjs
```

Expected: at least `constructor`, `toString`, or `__proto__` reaches an inherited property and throws while reading `baseProfile.width`.

### Task 2: Resolve Aliases Through Own Properties Only

**Files:**
- Modify: `app/api/dashboard/kindleProfiles.mjs:86-108`

**Interfaces:**
- Consumes: normalized requested profile string.
- Produces: the existing profile object with safe `dp75sdi` fallback.

- [ ] **Step 1: Make the minimal lookup change**

Replace the direct alias indexing with:

```js
const normalized = normalizeProfile(requestedProfile);
const profileKey = Object.hasOwn(PROFILE_ALIASES, normalized)
  ? PROFILE_ALIASES[normalized]
  : 'dp75sdi';
const baseProfile = KINDLE_PROFILES[profileKey];
```

Do not change `PROFILE_ALIASES`, `KINDLE_PROFILES`, width/height overrides, or the function signature.

- [ ] **Step 2: Run focused tests and verify GREEN**

```powershell
node --test tests/kindleProfiles.test.mjs tests/deviceConfigRoute.test.mjs tests/dashboardRoute.test.mjs
```

Expected: all names map to DP75SDI and storage readers receive only `dp75sdi`.

- [ ] **Step 3: Commit the correctness unit**

```powershell
git add app/api/dashboard/kindleProfiles.mjs tests/kindleProfiles.test.mjs tests/dashboardRoute.test.mjs tests/deviceConfigRoute.test.mjs
git diff --cached --check
git commit -m "Resolve dashboard profiles through own aliases"
```

Expected: first PR 5 commit has no config concurrency or documentation changes.

### Task 3: Characterize Single-Administrator Complete Writes

**Files:**
- Modify: `tests/dashboardConfigStore.test.mjs:121-159`
- Modify: `README.md:108-138`
- Modify: `docs/ARCHITECTURE.md:12-24`

**Interfaces:**
- Consumes: `createDashboardConfigStore().write(profile, config)` and complete private JSON writes.
- Produces: a deterministic last-successful-storage-commit test and explicit documentation.

- [ ] **Step 1: Add a controllable deferred helper**

In `tests/dashboardConfigStore.test.mjs` add:

```js
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
```

- [ ] **Step 2: Add the complete-document concurrency characterization**

```js
test('concurrent complete-document writes never merge and last successful storage commit wins', async () => {
  const gates = new Map([[60, deferred()], [300, deferred()]]);
  let committed = null;
  const blob = {
    async put(_pathname, body) {
      const value = JSON.parse(body);
      await gates.get(value.refreshIntervalSeconds).promise;
      committed = value;
      return { url: 'https://blob.test/dashboard-config/dp75sdi.json' };
    },
  };
  const store = createDashboardConfigStore({
    token: 'fixture-blob-token',
    blob,
  });
  const first = {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 60,
    providers: {
      claude: { visible: true, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: false },
    },
    updatedAt: '2026-07-12T10:00:00.000Z',
  };
  const second = {
    version: 1,
    profile: 'dp75sdi',
    refreshIntervalSeconds: 300,
    providers: {
      claude: { visible: false, imageDataUrl: null },
      openai: { visible: true, imageDataUrl: null },
      gemini: { visible: false },
    },
    updatedAt: '2026-07-12T10:01:00.000Z',
  };

  const firstWrite = store.write('dp75sdi', first);
  const secondWrite = store.write('dp75sdi', second);
  gates.get(300).resolve();
  await secondWrite;
  gates.get(60).resolve();
  await firstWrite;

  assert.deepEqual(committed, first);
  assert.notDeepEqual(committed.providers, second.providers);
});
```

- [ ] **Step 3: Run the characterization test**

```powershell
node --test --test-name-pattern="complete-document writes" tests/dashboardConfigStore.test.mjs
```

Expected: PASS on the current complete overwrite implementation. This task intentionally characterizes the approved contract rather than fabricating a failure.

- [ ] **Step 4: Document the exact scope**

Add this meaning to README and Architecture:

```text
Each profile is one complete private configuration document. The editor supports one administrator; PUT requests do not merge fields or provide collaborative conflict detection. If complete writes overlap, the complete document whose storage commit succeeds last becomes current.
```

- [ ] **Step 5: Verify and commit the contract unit**

```powershell
node --test tests/dashboardConfigStore.test.mjs tests/configRoute.test.mjs
git add tests/dashboardConfigStore.test.mjs README.md docs/ARCHITECTURE.md
git diff --cached --check
git commit -m "Define single-admin configuration writes"
```

Expected: second PR 5 commit contains tests/docs only and no storage algorithm change.

### Task 4: Verify and Review PR 5

**Files:**
- PR 5 files from Tasks 1-3 only.

**Interfaces:**
- Consumes: two green commits.
- Produces: independently reviewable PR 5.

- [ ] **Step 1: Run full gates**

```powershell
npm.cmd test
npm.cmd run build
node --test --experimental-test-coverage
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
```

Expected: full suite/build pass; diff contains no renderer redesign, Blob schema change, Token, or unrelated file.

- [ ] **Step 2: Stop before publication**

Provide both commit SHAs, focused/full evidence, and the no-migration rollback. Push/PR/merge only after user approval.

---

## PR 9a — Recursive Sensitive-Name Contract

### Task 5: Expand Credential-Name Tests

**Files:**
- Modify: `tests/quotaSnapshot.test.mjs:91-119`
- Modify: `tests/usageIngest.test.mjs:113-129`
- Modify: `tests/collectorUpload.test.mjs:118-124`

**Interfaces:**
- Consumes: recursive snapshot input.
- Produces: rejection cases for exact `auth` and normalized token/secret/password/credential/cookie/authorization/oauth/bearer/key families.

- [ ] **Step 1: Add the normalized field-name table**

```js
const newlySensitiveNames = [
  'auth', 'AUTH', 'password', 'passwordHash', 'credential', 'credentials',
  'oauthState', 'bearerHeader', 'accessKey', 'access_key',
  'privateKey', 'private-key',
];

test('rejects every approved credential-like field name recursively', () => {
  const baseSnapshot = () => ({
    version: 2,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: {
        windows: {
          fiveHour: { usedPercent: 17, resetsAt: 1783678020 },
        },
      },
    },
  });
  for (const key of newlySensitiveNames) {
    for (const decorate of [
      (value) => ({ ...baseSnapshot(), [key]: value }),
      (value) => ({ ...baseSnapshot(), providers: { claude: { [key]: value } } }),
      (value) => ({ ...baseSnapshot(), providers: { claude: { windows: { fiveHour: { [key]: value } } } } }),
      (value) => ({ ...baseSnapshot(), providers: [{ [key]: value }] }),
    ]) {
      assert.throws(() => normalizeQuotaSnapshot(decorate('SENTINEL_SECRET')), TypeError, key);
    }
  }
});
```

- [ ] **Step 2: Add one API and collector boundary sentinel**

```js
test('ingest rejects nested oauth fields without logging or storing the value', async () => {
  const logs = [];
  let writes = 0;
  const body = {
    ...validSnapshot,
    providers: {
      claude: {
        ...validSnapshot.providers.claude,
        oauthState: 'SENTINEL_OAUTH',
      },
    },
  };
  const response = await handleUsageIngest(
    makeRequest(JSON.stringify(body)),
    createDependencies({
      writeMergedQuotaSnapshot: async () => { writes += 1; },
      logger: { error(...args) { logs.push(args); } },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(await response.text(), 'Invalid request');
  assert.equal(writes, 0);
  assert.doesNotMatch(JSON.stringify(logs), /SENTINEL_OAUTH/);
});

test('collector rejects private-key material before fetch or state persistence', async () => {
  await withStateRoot(async (root) => {
    let fetches = 0;
    let error;
    try {
      await uploadSnapshot({
        snapshot: { ...validSnapshot(), privateKey: 'SENTINEL_PRIVATE_KEY' },
        ingestUrl: 'https://example.test/usage',
        ingestToken: 'secret-token',
        stateRoot: root,
        fetch: async () => { fetches += 1; throw new Error('must not send'); },
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.match(error.message, /Sensitive|Invalid/);
    assert.doesNotMatch(error.message, /SENTINEL_PRIVATE_KEY/);
    assert.equal(fetches, 0);
    assert.equal(await readFile(join(root, 'last-upload.json'), 'utf8').catch(() => ''), '');
    const stateText = await Promise.all((await readdir(root)).map((name) => readFile(join(root, name), 'utf8').catch(() => '')));
    assert.doesNotMatch(stateText.join('\n'), /SENTINEL_PRIVATE_KEY/);
  });
});
```

Extend `collectorUpload.test.mjs` imports with `readdir`. These tests use its existing `validSnapshot()` and `withStateRoot()` helpers; no new fixture API is introduced.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
node --test tests/quotaSnapshot.test.mjs tests/usageIngest.test.mjs tests/collectorUpload.test.mjs
```

Expected: password, credential, oauth, bearer, access/private key, and exact auth cases are currently accepted or fail for the wrong reason.

### Task 6: Implement Normalized Sensitive-Name Detection

**Files:**
- Modify: `app/api/dashboard/quotaSnapshot.mjs:4-25`
- Modify: `docs/SECURITY.md:9-13`

**Interfaces:**
- Consumes: arbitrary object key.
- Produces: `isSensitiveFieldName(key) -> boolean` used before schema normalization.

- [ ] **Step 1: Replace the incomplete regex with normalized parts**

```js
const SENSITIVE_KEY_PARTS = [
  'token', 'secret', 'password', 'credential', 'cookie', 'authorization',
  'oauth', 'bearer', 'apikey', 'accesskey', 'privatekey',
  'email', 'accountid', 'orgid', 'prompt', 'transcript',
];

function isSensitiveFieldName(key) {
  const normalized = String(key)
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  return normalized === 'auth'
    || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}
```

In `assertNoSensitiveFields`, replace the regex test with `isSensitiveFieldName(key)`. Do not weaken recursion or allowlisted schema validation.

- [ ] **Step 2: Document the exact normalized rule**

State that separators/case are removed before matching, `auth` is an exact normalized key, listed fragments are rejected anywhere, and retained identity/prompt/transcript bans remain.

- [ ] **Step 3: Verify and commit PR 9a**

```powershell
node --test tests/quotaSnapshot.test.mjs tests/usageIngest.test.mjs tests/collectorUpload.test.mjs
npm.cmd test
npm.cmd run build
node --test --experimental-test-coverage
git diff --check
git add app/api/dashboard/quotaSnapshot.mjs tests/quotaSnapshot.test.mjs tests/usageIngest.test.mjs tests/collectorUpload.test.mjs docs/SECURITY.md
git commit -m "Expand recursive credential-name rejection"
```

Expected: all tests pass, generic errors contain no sentinel, and no stored schema migration is needed. Stop for user review before publication.
