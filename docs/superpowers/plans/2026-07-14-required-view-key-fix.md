# Required View Key Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the settings editor from producing private Kindle URLs or a managed preview until the operator enters a nonblank view key.

**Architecture:** Make `buildManagedUrls()` return `null` for missing, empty, or whitespace-only keys and normalize a valid key once before encoding it. The existing page already branches on nullable `managedUrls`; update its required-field copy and blank-state rendering, then prove the behavior with unit, source-contract, and localhost-only Chrome tests.

**Tech Stack:** Next.js 16 client component, JavaScript ES modules, Node.js 24 test runner, Chrome DevTools Protocol, GitHub CLI.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-14-required-view-key-design.md` exactly.
- Begin production behavior changes only after focused tests fail for the expected missing behavior.
- Treat missing, non-string, empty, and whitespace-only view keys as unavailable.
- Trim surrounding whitespace from a nonblank view key before URL encoding.
- Never persist or print an admin token, view key, authenticated URL, cookie, or secret.
- Do not change `/api/config`, `/api/dashboard`, or `/api/device-config` server contracts.
- Do not add dependencies or a frontend testing framework.
- Keep the view key in React memory only and out of the config PUT body.
- Preserve all existing artwork, provider, interval, Lock, reload, responsive, and cleanup behavior.
- Use the existing isolated worktree and do not rewrite or squash reviewed history.
- Push only after focused, full, build, coverage, Chrome, diff, secret, and independent review gates pass.
- Reply to and resolve only the authorized P2 thread after its fix is pushed.
- Merge only when the updated head is SHA-aligned, every check passes, and no unresolved review thread remains.

---

### Task 1: Add Required View Key Regression Tests

**Files:**
- Modify: `tests/configClient.test.mjs:103-132`
- Modify: `tests/openSourceRelease.test.mjs:176-205`

**Interfaces:**
- Consumes: current `buildManagedUrls({ origin, profile, viewToken })` behavior and `app/page.js` source.
- Produces: failing contracts for `null` blank-state URLs and required editor copy.

- [ ] **Step 1: Replace the optional-key helper expectation**

Keep the existing encoded-key and admin-token isolation assertions, but use surrounding whitespace to prove normalization and add explicit unavailable cases:

```js
test('builds encoded managed URLs only with a required view key', () => {
  const urls = buildManagedUrls({
    origin: 'https://dashboard.example/',
    profile: 'dp75sdi',
    viewToken: '  view key&private  ',
    adminToken: 'must-not-appear',
  });

  assert.deepEqual(urls, {
    dashboardUrl:
      'https://dashboard.example/api/dashboard?profile=dp75sdi&managed=true&key=view+key%26private',
    deviceConfigUrl:
      'https://dashboard.example/api/device-config?profile=dp75sdi&key=view+key%26private',
  });
  assert.doesNotMatch(JSON.stringify(urls), /must-not-appear/);

  for (const viewToken of [undefined, null, 42, '', '   ']) {
    assert.equal(
      buildManagedUrls({
        origin: 'https://dashboard.example',
        profile: 'voyage',
        viewToken,
      }),
      null,
    );
  }
});
```

- [ ] **Step 2: Add the editor source contract**

Add one focused test to `tests/openSourceRelease.test.mjs`:

```js
test('settings editor requires a view key before presenting private URLs', () => {
  const page = readFileSync('app/page.js', 'utf8');
  const viewTokenInput =
    page.match(/<input(?:(?!\/>)[\s\S])*id="view-token"(?:(?!\/>)[\s\S])*\/>/)?.[0] ?? '';

  assert.match(page, /View key \(required\)/);
  assert.doesNotMatch(page, /View key \(optional\)/);
  assert.match(viewTokenInput, /\brequired\b/);
  assert.match(page, /Enter the required view key to generate private Kindle URLs/i);
  assert.match(page, /Enter the required view key to load the authenticated preview/i);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test tests/configClient.test.mjs tests/openSourceRelease.test.mjs
```

Expected: the URL helper test fails because blank keys still return URL objects and surrounding whitespace is encoded; the editor contract fails because the label is optional and required guidance is absent. Existing unrelated tests remain green.

- [ ] **Step 4: Normalize the two edited Windows text files**

Run this bounded mechanical rewrite so patch insertion cannot leave mixed CRLF
and bare-LF bytes in the Windows worktree:

```powershell
node -e "const fs=require('node:fs'); for (const p of process.argv.slice(1)) { let text=fs.readFileSync(p,'utf8'); if (text.charCodeAt(0)===0xfeff) text=text.slice(1); text=text.replace(/\r\n?/g,'\n'); if (!text.endsWith('\n')) text+='\n'; fs.writeFileSync(p,text.replace(/\n/g,'\r\n')); }" tests/configClient.test.mjs tests/openSourceRelease.test.mjs
```

Expected: both files are UTF-8 without BOM, CRLF-only, and have a final newline.

- [ ] **Step 5: Commit the RED contracts**

Run:

```powershell
git add tests/configClient.test.mjs tests/openSourceRelease.test.mjs
git diff --cached --check
git commit -m "Add required view key regression tests"
```

Expected: only the two test files are committed; the focused suite remains intentionally RED until Task 2.

---

### Task 2: Implement the Nullable URL and Required Editor Contract

**Files:**
- Modify: `app/configClient.mjs:212-228`
- Modify: `app/page.js:85-92,472-540`

**Interfaces:**
- Consumes: `buildManagedUrls({ origin, profile, viewToken })`.
- Produces: `{ dashboardUrl, deviceConfigUrl } | null`; the page renders URLs and preview only for the object case.

- [ ] **Step 1: Make the helper fail closed with `null`**

Replace `buildManagedUrls()` with:

```js
export function buildManagedUrls({ origin, profile, viewToken }) {
  const requiredViewToken = typeof viewToken === 'string' ? viewToken.trim() : '';
  if (!requiredViewToken) return null;

  const dashboardUrl = new URL('/api/dashboard', origin);
  dashboardUrl.searchParams.set('profile', profile);
  dashboardUrl.searchParams.set('managed', 'true');
  dashboardUrl.searchParams.set('key', requiredViewToken);

  const deviceConfigUrl = new URL('/api/device-config', origin);
  deviceConfigUrl.searchParams.set('profile', profile);
  deviceConfigUrl.searchParams.set('key', requiredViewToken);

  return {
    dashboardUrl: dashboardUrl.toString(),
    deviceConfigUrl: deviceConfigUrl.toString(),
  };
}
```

- [ ] **Step 2: Mark the editor field required**

Change the label and input attributes:

```jsx
<label htmlFor="view-token">View key (required)</label>
<input
  id="view-token"
  type="password"
  value={viewToken}
  onChange={(event) => setViewToken(event.target.value)}
  autoComplete="off"
  required
  aria-invalid={previewFailed}
  aria-describedby={previewFailed ? 'view-token-help preview-error' : 'view-token-help'}
  placeholder="DASHBOARD_VIEW_TOKEN"
/>
<p id="view-token-help" className="band-note">
  Enter the required view key to generate private Kindle URLs.
</p>
```

- [ ] **Step 3: Hide unavailable URL and preview output**

Render the URL list only when `managedUrls` is non-null; the field guidance in
Step 2 is the blank-state message. In the preview section, add this explicit
null branch:

```jsx
{managedUrls ? (
  <div className="full-preview-stage">
    <img
      key={`${managedUrls.dashboardUrl}-${draft.updatedAt}`}
      src={managedUrls.dashboardUrl}
      alt={`Complete managed dashboard preview for ${profile}`}
      onLoad={() => setPreviewFailed(false)}
      onError={() => setPreviewFailed(true)}
    />
  </div>
) : (
  <p className="band-note">
    Enter the required view key to load the authenticated preview.
  </p>
)}
```

The existing `useEffect` dependency on `managedUrls?.dashboardUrl` clears a
previous preview error when the key is removed; do not add another state or
effect.

- [ ] **Step 4: Normalize the two edited implementation files**

Run:

```powershell
node -e "const fs=require('node:fs'); for (const p of process.argv.slice(1)) { let text=fs.readFileSync(p,'utf8'); if (text.charCodeAt(0)===0xfeff) text=text.slice(1); text=text.replace(/\r\n?/g,'\n'); if (!text.endsWith('\n')) text+='\n'; fs.writeFileSync(p,text.replace(/\n/g,'\r\n')); }" app/configClient.mjs app/page.js
```

Expected: both files are UTF-8 without BOM, CRLF-only, and have a final newline.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/configClient.test.mjs tests/openSourceRelease.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 6: Run the settings-related regression tests**

Run:

```powershell
node --test tests/configClient.test.mjs tests/configRoute.test.mjs tests/openSourceRelease.test.mjs
npm.cmd run build
git diff --check
```

Expected: all tests pass, production build succeeds, and no whitespace error is reported.

- [ ] **Step 7: Commit the implementation**

Run:

```powershell
git add app/configClient.mjs app/page.js
git diff --cached --check
git commit -m "Require view key before managed URLs"
```

Expected: only the helper and page implementation are committed.

---

### Task 3: Update and Run Localhost-Only Chrome Acceptance

**Files:**
- Modify ignored file only: `artifacts/settings-e2e.mjs`
- Produce ignored evidence: `artifacts/settings-e2e-result.json`
- Produce ignored evidence: `artifacts/settings-desktop.png`
- Produce ignored evidence: `artifacts/settings-mobile.png`

**Interfaces:**
- Consumes: production build and nullable managed URL behavior.
- Produces: secret-free browser evidence; no tracked diff.

- [ ] **Step 1: Change the blank-state assertions**

Immediately after unlock, assert that `.url-list` and `.full-preview-stage img`
are absent and `dashboardAuthorized`, `dashboardUnauthorized`, and
`nonLocalHttp` are all zero. Set `#view-token` to three spaces and assert the
same state remains with zero Dashboard requests.

- [ ] **Step 2: Retain the valid-key path**

Set the runtime synthetic key, then require both managed URL code elements,
one authorized Dashboard request, zero unauthorized Dashboard requests, and a
`758 x 1024` preview. Keep that state through the existing redacted desktop and
mobile screenshot captures. After both captures and before Lock, clear the
field and require both URL elements and the preview image to disappear without
another Dashboard request. Never print or save the synthetic key or unredacted
URLs.

- [ ] **Step 3: Run Chrome acceptance**

Run:

```powershell
node --check artifacts/settings-e2e.mjs
node artifacts/settings-e2e.mjs
```

Expected: all assertions pass; non-local HTTP is zero; tracked status is clean;
Next, Chrome, and the temporary profile are removed.

- [ ] **Step 4: Inspect desktop and mobile screenshots**

Use the local image viewer. Expected: required label and guidance are readable,
desktop `1440 x 1000` and mobile `390 x 844` have no horizontal breakage, and
synthetic managed URLs are redacted.

---

### Task 4: Reverify, Review, Publish, and Resolve P2

**Files:**
- All tracked files in Tasks 1-2 plus the approved design and plan documents.
- Modify ignored gate allowlist: `artifacts/run-pr1-gate.ps1`.

**Interfaces:**
- Consumes: green focused behavior and Chrome evidence.
- Produces: updated PR #22 head with a resolved P2 thread and green checks.

- [ ] **Step 1: Extend the ignored gate allowlist**

Add these new tracked paths to the gate's exact `origin/main..HEAD` allowlist:

```text
app/configClient.mjs
app/page.js
docs/superpowers/plans/2026-07-14-required-view-key-fix.md
docs/superpowers/specs/2026-07-14-required-view-key-design.md
tests/configClient.test.mjs
```

Keep the approved base SHA and all existing secret, URL, private-path, BOM,
mixed-line-ending, final-newline, coverage, build, and built-start checks. Add
an explicit `$minimumTestCount = 230`; require both the full-suite and coverage
summaries to report at least that many tests, with `pass == tests` and
`fail == 0` for the full suite.

- [ ] **Step 2: Run the complete publication gate**

Run the existing PowerShell 7 fail-closed runner:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File artifacts/run-pr1-gate.ps1
```

Expected: runner probes pass; test count is at least 230; build and built-start
pass; coverage does not regress; changed files match the expanded allowlist;
secret-free and line-ending gates pass; worktree is clean.

- [ ] **Step 3: Request independent whole-branch review**

Generate a fresh review package from `origin/main` to the new head. The reviewer
must verify the P2 behavior, test quality, security boundary, scope, and all
original PR1 contracts. Critical, Important, and P2-level findings must be
fixed and re-reviewed before publication.

- [ ] **Step 4: Push the updated branch**

Run:

```powershell
git push origin codex/hardening-view-protection
```

Expected: remote head equals local head.

- [ ] **Step 5: Reply in the authorized inline thread**

Reply to REST review comment `3577090048`, which belongs to thread
`PRRT_kwDOTRyQU86QqY4W`, not to the top-level PR conversation:

```powershell
$reply = 'Fixed in the updated PR head. Missing, empty, and whitespace-only view keys now return null; the editor labels the key as required and renders no managed URLs or preview request until a nonblank key is entered. Focused tests, the complete PR gate, and localhost-only Chrome acceptance pass.'
gh api --method POST repos/pcedison/kindle-LLM-token-display/pulls/22/comments/3577090048/replies -f body=$reply
```

Expected: one inline reply is created without any credential or URL.

- [ ] **Step 6: Resolve the authorized thread**

Run the GraphQL mutation on the exact P2 thread ID only:

```powershell
$mutation = 'mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}'
gh api graphql -f query=$mutation -F threadId='PRRT_kwDOTRyQU86QqY4W'
```

Expected: the returned thread ID is exact and `isResolved` is `true`; PR #22
has zero unresolved threads.

- [ ] **Step 7: Wait for all updated checks**

Run:

```powershell
gh pr checks 22 --watch --interval 10
```

Expected: Windows, macOS, Kindle shell, Vercel deployment, and Vercel preview
comment checks all pass on the new head.

- [ ] **Step 8: Merge and resume the controlling production gate**

Freshly verify PR state, updated head/base alignment, mergeability, checks, and
zero unresolved threads. Read the expected local head, then require the remote
branch head and PR `headRefOid` to equal it. Merge with the repository's
established merge-commit method while pinning that exact commit:

```powershell
$expectedHead = (& git rev-parse HEAD).Trim().ToLowerInvariant()
$remoteHead = (& git ls-remote origin refs/heads/codex/hardening-view-protection).Split()[0].ToLowerInvariant()
$prHead = (gh pr view 22 --json headRefOid | ConvertFrom-Json).headRefOid.ToLowerInvariant()
if ($remoteHead -cne $expectedHead -or $prHead -cne $expectedHead) {
    throw 'PR head moved after verification'
}
gh pr merge 22 --merge --match-head-commit $expectedHead
```

Record the merge SHA, then execute Production View Protection Task 8. Never
bind production to the feature-branch SHA.
