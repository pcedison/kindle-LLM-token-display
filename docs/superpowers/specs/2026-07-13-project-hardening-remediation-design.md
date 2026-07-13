# Project Hardening and Remediation Design

**Date:** 2026-07-13

**Status:** Original design and construction plan approved 2026-07-13; commit-level safety amendments pending publication re-review

**Canonical repository:** `https://github.com/pcedison/kindle-LLM-token-display`

**Canonical branch:** `main`

## Goal

Remediate the confirmed production privacy, Kindle runtime, collector, installer,
concurrency, documentation, and verification debt without mixing correctness
work with speculative refactoring. The work must proceed in reviewable phases,
fail closed at every trust boundary, preserve the Kindle's last known good
display, and leave macOS support explicitly marked Beta until it passes real-Mac
acceptance.

The original design and construction plan was approved on 2026-07-13. That
approval does not authorize a phase, push, pull request, merge, environment or
deployment mutation, or device/USB mutation. Each remains an independent user
authorization gate. The commit-level safety amendments added for publication
must be re-reviewed by the user before this amended plan set is published or
used as execution authority.

## Baseline and Evidence Status

The design was prepared from a read-only inspection of the repository and the
existing project audit. At the time of inspection:

- Local `main` tracked `origin/main` at `61632d4f6ad0a45399c4681ce5d3657ed661554d`.
- The only visible worktree change was the existing untracked `.recovery/`
  directory. It must not be staged, deleted, or moved without a separate backup
  decision.
- The last recorded full test result was 226 passing tests. That is historical
  evidence, not a fresh verification result for this design turn.
- CI contained Windows test/build, macOS shell/test/build, and Linux Kindle shell
  syntax jobs.
- CI did not contain a coverage threshold, build-produced `next start` smoke,
  browser E2E, production smoke, deployment-SHA gate, or real-device acceptance.
- Production had no configured `DASHBOARD_VIEW_TOKEN` in the inspected handoff,
  so protected-read behavior depended on a missing environment setting and the
  deployed dashboard was publicly readable.

The current implementation also deliberately treats an absent view token as
public mode. This design replaces that production behavior with a fail-closed
contract so that deleting an environment variable cannot silently reopen live
data.

## Confirmed Product Decisions

1. Public viewing is not accepted for the production dashboard.
2. View, ingest, admin, and Blob credentials remain separate and cannot be
   reused across roles.
3. The one-time Kindle credential migration will be performed by USB.
4. macOS collector support remains in the repository but is labeled Beta.
5. macOS static, secret-handling, ownership, and rollback defects are repaired
   now; production-ready status requires a real Mac later.
6. Remediation is phased, with a user review checkpoint after every phase.
7. Correctness, privacy, rollback, and release verification precede Ponytail
   simplification.
8. The dashboard is a single-administrator product. Configuration writes use an
   explicit atomic last-successful-write-wins contract; multi-administrator
   collaborative editing is out of scope.

## Approaches Considered

### 1. Correctness-first phased remediation (selected)

Close the production exposure first, then repair P1 safety defects, P2 runtime
and concurrency defects, P3 contracts and documentation, perform release and
device acceptance, and only then audit for simplification.

This approach gives every risk category its own rollback point and prevents a
large cleanup diff from hiding security regressions.

### 2. One comprehensive hardening pull request

Rejected because Kindle shell, macOS installation transactions, server routes,
collector concurrency, and documentation would share one review and rollback
boundary. A failure would be harder to isolate and a partial revert could reopen
privacy or ownership defects.

### 3. Parallel implementation workstreams

Rejected for execution because several changes share files and behavioral
contracts. Parallel read-only review remains useful, but implementation must be
serialized through the phase gates defined below.

## Phase Architecture

### Phase 0: Close public production access

This is an operational security gate, not a substitute for a code pull request.

1. Capture secret-free deployment metadata and private backups of the Kindle
   `env.sh` and cached `dash.png`.
2. Parse the official Vercel CLI environment-list shape through a strict
   root/row/property projection before classifying scopes with the DPAPI holder.
   Required and optional fields, conditional plain `value`, branch/configuration
   bindings, `system`, and unrelated custom targets follow the official bounded
   schema; no value is projected or printed and no decrypt/readback is requested.
   View-token rows separately reject branch/custom bindings, nonstandard targets,
   scalar/array coercion, wrong types, and duplicate scopes. Zero scopes and no
   holder is a new run; zero scopes plus a confirmed same-interrupted-run holder
   is `ResumePrepared` and must load rather than regenerate. Other fresh resumes
   accept only exact typed Production, Production+Preview, or all-three metadata
   with that holder. Unconfirmed holder provenance or any other state requires
   dedicated reviewed cleanup/rotation rather than overwrite.
3. For a new run, generate a view token from at least 32 cryptographically
   random bytes independently from ingest/admin. For a bounded resume, load only
   the same interrupted run's DPAPI holder. Never print the value to terminal,
   transcript, Git, or chat. Record the credential-provenance gate and blockers.
4. Audit project metadata and the Vercel dashboard for Shareable Links,
   automation bypasses, and Deployment Protection Exceptions. Any such bypass
   or exception stops the phase.
5. Idempotently ensure project-level Vercel Authentication **Standard
   Protection** before changing environment variables or redeploying. Standard
   Protection covers every Preview and generated Production deployment URL
   while leaving production domains available for the application-level view
   token used by the Kindle. Do not change the project to **All Deployments**
   unless a separately approved design supplies and validates a Kindle-capable
   Vercel bypass.
   The project API must contain exactly one top-level `ssoProtection` property.
   Only its explicit null value is Disabled. A non-null value must be one object
   with exactly one nonempty string `deploymentType`. The fixed write enum is
   `prod_deployment_urls_and_all_previews`; the live-confirmed
   `all_except_custom_domains` is a compatibility readback, not complete proof.
   The same project baseline must read one exact Boolean
   `autoAssignCustomDomains` plus a `lastRollbackTarget` value that is either
   explicit null or one object, record only its presence category, and reject
   concurrent drift during Standard Protection setup. A false Boolean is not by
   itself proof that a historical rollback occurred.
6. With redirects disabled, bracket the full enumeration with fresh, strict,
   identity-bound project-setting reads and require the accepted protection
   category/enum to remain case-exact and unchanged. Then require every
   discoverable current/past generated Production URL and every discoverable
   Preview URL to return the specific HTTPS Vercel Authentication redirect
   category. Production and Preview enumeration must each follow the prior
   page's Int64 millisecond `next` cursor through an explicit null terminal
   cursor. Page arrays/counts and scalar URLs are strict; a malformed or repeated
   cursor/URL or reached page/deployment safety cap fails closed. An arbitrary
   non-302 or wrong redirect category is not proof. Report only page/count and
   presence/result booleans plus the accepted pre/post protection
   enum/category and bracket-stability Boolean; never a cursor, URL, `Location`,
   or body. If no Preview URL exists, record `Present=False` explicitly. A
   disabled/malformed post-read or category/enum drift fails closed even when
   every preceding redirect probe passed.
7. Store the selected new-or-resumed token in Vercel Production only, without force-overwriting.
   Immediately require exact Production-only/sensitive metadata; Preview and
   Development must still be absent.
8. Before redeploy, resolve authority from the canonical Production origin using
   alias GET → exact deployment API GET → the same alias GET. Require stable,
   direct project/ID/nested-URL agreement, READY Production, and one scalar
   40-character source SHA. Recent deployment lists are neither authority nor a
   required availability gate. Read the exact Boolean
   `autoAssignCustomDomains` and null-or-object `lastRollbackTarget` category.
   Reuse without redeploy only when the canonical `401/200` preflight already
   passes, auto-assignment is true, and the rollback marker is null. A
   legacy-public or private-but-pinned state redeploys only that exact API URL
   after strict generated-origin normalization, then proves the distinct
   candidate through `/v13/deployments/{id}` with the same SHA.
   Double-read the alias before promotion: if it is already the candidate and
   project state is closed, skip; if it is still the frozen prior ID, or the
   candidate is current but pin state is open, conditionally promote the exact
   candidate; a third ID or unstable binding stops. `--target production` is
   not promotion. Phase 0 approval must explicitly accept the lasting promote
   side effect of restoring automatic production-domain assignment. CLI output
   and exit code are not completion authority.
9. With redirects disabled, require anonymous canonical Dashboard and
   device-config requests to return 401 and exact-token requests to return 200.
   First require a fresh project read with `autoAssignCustomDomains=True`, null
   rollback marker, and `targets.production` equal to the candidate ID/SHA, plus
   canonical alias → exact deployment API → alias identity. Only this full
   Production write/candidate/promotion-post-state/smoke chain sets
   `PrivacyClosureAchieved=True`. Any failure records false, must not be called
   protected, and cannot reach a Phase 0/Phase 1 approval checkpoint.
10. Only after privacy closure, write Preview and Development, then hard-fail
    unless target-level coverage is exactly Production/Preview/Development,
    Production and Preview are sensitive, Development is encrypted, and there
    are no empty, duplicate, or unexpected targets. A partial non-production
    write preserves privacy closure but records `Phase0Complete=False`.
11. The bounded resume never overwrites or removes a value. `ResumePrepared`
    accepts zero scopes plus the confirmed holder, writes Production once, and
    enters the full authority/candidate/promotion-post-state/smoke chain. Other resumes accept
    only exact Production, Production+Preview, or all-three typed states and
    re-run that same chain before closure. A completed interrupted promotion is
    detected through the current canonical/project post-state and does not
    redeploy; unresolved public or pinned state creates a distinct candidate.
    No local deployment checkpoint is trusted. After closure, only the missing
    suffix is written. Standard Protection remains enabled. All Deployments requires
    separate entitlement, billing, design, and real-device approval and is never
    enabled here.
12. Keep both Standard Protection and the application view token enabled while
   the Kindle still has its old URL. The Kindle displays its cached PNG during
   this interval.
13. Through USB, update only `DASHBOARD_URL`, `REMOTE_CONFIG_URL`, and the explicit
    expected PNG dimensions while preserving all other device calibration and
    runtime settings. Capture and retain the exact Kindle volume identity, reject
    reparse roots, and inventory every historical/current same-directory
    `env.sh.new.*`, `env.sh.failed.*`, and `env.sh.rollback.*` before and after
    the transaction. These files are temporary transaction artifacts, never
    diagnostic holders: every error path restores and proves the original bytes
    when possible, deletes only the current run's credential copies, then proves
    the identity-bound global inventory is empty. Disconnect/replacement media or
    an inventory error is not proof of absence. In-memory token material is
    cleared in the transaction's `finally`, including when validation throws.
14. Confirm the key is appended exactly once to both URLs.
15. Safely eject the Kindle and run authenticated endpoint and real-device smoke.
16. Remove real production URLs from public documentation after protection is
   confirmed.

The rollback for a failed USB migration is to preserve Standard Protection and
the application view token, restore a private device backup if required, and
keep displaying the cached PNG. Disabling Standard Protection, changing to All
Deployments without a reviewed Kindle bypass design, removing the view token,
or returning to public mode is never an allowed rollback.
When conditional promotion is required, its documented lasting effect is to
restore automatic production-domain assignment. This plan does not turn that
setting off again as rollback; re-pinning or disabling auto-assignment would be
a separate reviewed production operation.

If a failed USB transaction cannot re-prove the captured volume/root identity
and zero global transaction residue, report only
`UsbCredentialResidueDetected=True`, set
`ViewTokenRotationRequired=True` and `Phase0Complete=False`, keep production
protected, and stop for a separately reviewed cleanup/rotation. Never retain a
credential-bearing transaction file for diagnosis, print its content, or
continue to Kindle acceptance on an unproved cleanup.

If ingest/admin trusted creation evidence or Blob provenance/server-only
placement remains unresolved, the immediate privacy closure may be recorded as
achieved but Phase 0 is not complete and no later phase begins. A separately
reviewed rotation/evidence task must clear the blocker.

### Phase 1: P1 hardening

#### Kindle bounded PNG download

- Add a complete download deadline.
- Bound streamed response data to 4 MiB.
- Write under `umask 077` to a private same-directory temporary file.
- Validate PNG signature, a complete IHDR, expected dimensions, and the supported
  Kindle image contract before replacement.
- Check replacement success before reporting success.
- On every error, remove the temporary file, preserve `dash.png` byte for byte,
  and return nonzero so the caller uses the cache.

#### macOS Beta hardening

- Resolve absolute Node, Codex, and other required executable paths during the
  interactive install.
- Emit a LaunchAgent with absolute executable paths and a controlled PATH.
- Keep the ingest token in Keychain through one dedicated adapter.
- Prohibit token transport through argv, xtrace, plist, manifest, config, log, or
  temporary files.
- Install terminal-restoration traps before disabling echo.
- Validate the complete destructive manifest schema in install, diagnose, and
  uninstall paths.
- Make Keychain, LaunchAgent, Claude settings, backup, and install-root ownership
  checks fail closed.
- If a no-argv Keychain write is unavailable on a supported Mac, installation
  stops. There is no plaintext fallback.

The adapter is a project-owned
[Security.framework generic-password](https://developer.apple.com/documentation/Security/kSecClassGenericPassword)
boundary rather than a wrapper around `security add-generic-password -w`. Its write operation receives the
secret only through standard input or a dedicated file descriptor; the fixed
service and current account are non-secret arguments. It exposes only fixed
write, existence-check, and ownership-scoped delete operations, returns a status
code or boolean metadata, and never returns the password. The runtime Keychain
read may place the token in collector memory but must not place it in argv,
environment variables, logs, or persistent state.

The adapter's create-or-update operation is one atomic Keychain item mutation:
on failure, the prior item remains unchanged or a new item remains absent. The
installer prepares and validates every file, setting, manifest, and LaunchAgent
mutation first, rolling those changes back if any preparation fails. The atomic
Keychain create-or-update is the final commit step. After it succeeds, the
installer performs no further fallible mutation. This ordering makes reinstall
rollback possible without exporting the prior Keychain password: failure before
the commit leaves the old item untouched, and success completes the transaction.

macOS remains Beta without a broad version claim. Automated support means the
exact GitHub `macos-latest` image recorded by a passing run. Device support means
only the exact macOS version and architecture recorded by a passing real-Mac
acceptance. Required platform facilities are Security.framework, per-user
Keychain, `launchctl`, `plutil`, Node 20.9 or newer, and the official Codex and
Claude Code clients.

The ownership manifest is an exact schema shared by install, diagnose, and
uninstall. Before any destructive action, all of these fields must validate:

- `schemaVersion`: the one explicitly supported integer version;
- `owner`: exactly `kindle-llm-dash/macos-collector`;
- `installRoot`: the computed current-user Application Support path;
- `launchAgentPath`: the computed current-user
  `com.kindle-llm-dashboard.sync.plist` path;
- `claudeSettingsPath`: the computed current-user Claude settings path;
- `backupPath`: `null` or a regular file matching the project backup naming
  contract beside the Claude settings file;
- `statusLineCommand`: exactly the command generated from the validated absolute
  Node path, owned collector entrypoint, and owned config path;
- `keychainService`: exactly `KindleLLMDashboard.ingest`;
- `keychainAccount`: exactly the current account resolved by the installer.

No path or Keychain identity read from a partially validated manifest may be
used for deletion. A schema change increments `schemaVersion` and supplies an
explicit migration or a fail-closed refusal; it is not silently accepted.

### Phase 2: Confirmed P2 defects

- Wait for Wi-Fi before fetching remote config and then the Dashboard PNG.
- Ensure private `env.sh` values cannot leak when any entrypoint inherits
  `set -x`.
- Reject prototype-chain profile names such as `__proto__`, `constructor`,
  `prototype`, and `toString` without a 500 response or unsafe Blob lookup.
- Reclaim stale collector locks using an ownership-safe atomic protocol rather
  than read-then-unconditional-delete.
- Treat an upload as successful only after status 200, a bounded JSON response,
  `ok: true`, and a valid `collectedAt` acknowledgement.
- Keep configuration storage atomic and document the single-administrator,
  last-successful-write-wins contract. Do not add speculative ETag/CAS machinery.

### Phase 3: P3 contracts, verification support, and documentation

- Enforce Node `>=20.9.0` in supported installers.
- Expand credential-like field rejection to the agreed case-insensitive
  sensitive-name contract: an exact normalized `auth` key or a key containing
  `token`, `secret`, `password`, `credential`, `cookie`, `authorization`,
  `oauth`, `bearer`, `apiKey`, `accessKey`, or `privateKey` is rejected anywhere
  outside the approved normalized schema.
- Require the Kindle client to accept exactly the supported device-config
  version and reject unknown versions without changing its last valid interval.
- Correct Windows first-install rollback so a failed install does not leave an
  empty or newly fabricated Claude settings document.
- Add a build-produced `next start` HTTP smoke path.
- Re-run and record dependency audit results. No new high or critical advisory is
  accepted; an existing advisory needs an exposure analysis, mitigation, and
  recheck condition.
- Update status, runbooks, release checklists, and deployment evidence only from
  newly collected results.
- Leave `.recovery/` untouched until the user selects and verifies a backup
  destination.

### Phase 4: Release and real-device acceptance

- Re-run focused tests, the complete suite, coverage, build, shell validation,
  CI, UI checks, deployment metadata, and production smoke.
- Perform the first private Kindle refresh after USB migration.
- Change a web setting without a second USB connection and observe two complete
  refresh cycles.
- Exercise network failure, cached display, chrome hide/restore, termination,
  power-button exit, temperature, and battery behavior.
- Perform real Windows Task Scheduler installation, execution, resume, overlap,
  upload, rollback, and uninstall acceptance.
- Keep macOS marked Beta until a real Mac completes install, scheduled run,
  diagnose, rollback, and uninstall acceptance.

### Phase 5: Ponytail audit and simplification

Run a whole-repository audit only after Phases 0 through 4 are green. The first
deliverable is one untracked report in a clean detached worktree at the approved
final release SHA; it has no branch, commit, push, or pull request and makes no
product changes. Each later approved deletion or simplification is a separate,
independently revertible pull request.

Ponytail work must preserve authentication, body and stream limits, PNG
validation, atomic storage, lock ownership, installer ownership, rollback,
bounded watchdog behavior, Kindle chrome recovery, accessibility, and the real
Next route integration test.

## Trust Boundaries and Credential Roles

Project-level Vercel Authentication Standard Protection is the outer boundary
for Preview and generated Production deployment URLs. The canonical production
domain remains outside Vercel login so the Kindle can reach it, and is protected
by the application view-token contract below. Shareable Links, automation
bypasses, and Deployment Protection Exceptions are prohibited. Phase 0 must
re-check this volatile project state rather than treating the inspection-time
setting as execution evidence.

| Credential | Holder | Permitted use | Prohibited use |
| --- | --- | --- | --- |
| View token | Kindle and authorized read client | Read Dashboard PNG and device config | Admin writes or collector upload |
| Ingest token | Collector | Upload sanitized quota snapshots to `/api/usage` | Kindle URL or dashboard read |
| Admin token | Administrator browser session | Authorized `/api/config` GET/PUT | Persistent browser storage, Kindle, or collector |
| Blob token | Vercel server | Private Blob access | Browser, Kindle, collector, documentation, or logs |

Only presence, authorization result, and configuration category may be reported.
Actual credentials, complete Authorization headers, private authenticated URLs,
cookies, and clipboard content must never appear in test output or handoff text.

Role separation is an executable provisioning rule. The new view token's
creation record must prove that this run used a CSPRNG for exactly 32 random
bytes and generated the role independently. Before that generation, the view
variable must be absent from Production, Preview, and Development; any existing
scope stops normal provisioning. The resume exceptions are zero scopes plus a
confirmed prepared holder, or exact Production, Production+Preview, or all-three
states with correct types, no duplicate/unexpected target, and that same holder.
Prepared resume writes Production once; every resume must re-prove canonical
pre-redeploy authority, conditional distinct-candidate/promotion post-state,
post-alias identity, anonymous 401, and exact-token 200 before privacy closure
is true. An already-private resume may skip redeploy only when exact project
state proves auto-assignment restored and no rollback marker. Every other state requires
dedicated reviewed cleanup/rotation.

The ingest and admin roles each require their own trusted creation record that
proves a CSPRNG, at least 32 random bytes, and independent role generation. A
handoff that merely calls a value “random” does not prove the byte count or
independence. Existing Vercel secrets are never exported or read back to create
this evidence. Missing evidence produces `RotationRequired=True` for that role
and blocks remediation completion until a separately reviewed rotation closes
the record. Phase 0 may still close the immediate public-read exposure while
such a provenance blocker is reported truthfully.

The Blob token follows a different rule: record only that it was Vercel-issued
and is placed server-side only. It is never copied into an application-token
role. All evidence tables contain booleans/categories only and no value.

Tokens, cookies, and complete Authorization headers are never permitted in
argv. An authenticated URL is also prohibited in argv except at one fixed,
bounded Kindle downloader boundary: the BusyBox `wget` (or a separately shipped
and device-validated `xh`/`ht`) URL operand. The DP75SDI has only BusyBox `wget`,
which has no stdin URL, cookie-file, or header-file transport, so avoiding this
operand would require shipping a new binary. The exception is valid only when
the same URL already resides in private `env.sh`, xtrace is disabled before
sourcing and using it, logs remain generic, the process is watchdog-bounded to
20 seconds, cleanup always runs, and no `/proc` command-line/environment
snapshot is captured or reported as evidence. It never extends to an operator,
CI, server, collector, macOS, or Windows command. Single-user Kindle root access
and physical compromise are outside the threat model because either can already
read private `env.sh`; any such compromise requires view-token rotation.

This device-local argv exposure is a known user-review item. If the user does
not accept it, a separate plan must add and validate a downloader binary on the
real Kindle; this remediation plan must not claim a no-argv transport that the
device does not have.

Backups containing an authenticated Kindle URL are private operational artifacts
and must never be committed.

## Production View Authorization Contract

For Dashboard and device-config read endpoints:

| Deployment state | Result |
| --- | --- |
| Any Vercel Production, Preview, or Development environment with no configured view token | Credential-free `503`; no Blob/config read |
| Configured token, missing or incorrect request key | `401`; no Blob/config read |
| Configured token, exact request key | Continue to normal handler |
| Explicit local fixture with `DASHBOARD_PUBLIC_FIXTURE=true`, no `VERCEL_ENV`, non-production `NODE_ENV`, and no configured view token | Only unmanaged manual Dashboard rendering; no Blob, live quota, managed config, or device-config read |

Public demo behavior becomes an explicit local development fixture. It cannot be
implicitly activated by deleting a production secret.

Fixture eligibility is an exact conjunction, not a precedence rule. Setting the
fixture flag in any Vercel environment, in production `NODE_ENV`, or together
with a view token is a conflicting configuration and returns a credential-free
`503` rather than choosing one mode.

Every authorization error response is cache-disabled and contains no credential,
authenticated URL, or private configuration detail.

The root editor shell may load without exposing private quota or managed
configuration. `/api/config` remains separately protected by the admin Bearer
token and returns a credential-free `503` when its server token is unconfigured.

## Kindle Data Flow

```text
Wi-Fi ready
  -> bounded device-config download
  -> version and interval validation
  -> bounded Dashboard download
  -> private same-directory temporary file
  -> PNG signature, IHDR, dimensions, and format validation
  -> checked atomic replacement of dash.png
  -> eips draw
```

The expected PNG width and height are explicit device settings. The DP75SDI
defaults are 758 by 1024. They are not inferred through brittle parsing of the
Dashboard URL.

Server HTTP tests verify status, `Content-Type`, and cache headers. The Kindle
validates the received bytes because its available downloader implementations do
not provide an equally reliable shared header interface.

Any config failure retains the current in-memory interval. Any PNG failure
retains the old cached PNG. An absent cache means the runtime must not send
invalid data to `eips`.

## Remote Configuration Contract

The only supported response is bounded, cache-disabled plain text containing
exactly:

```text
version=1
refresh_interval_seconds=<allowlisted integer>
```

The client does not source or evaluate the response. It requires exactly those
two lines in that order and rejects missing, duplicate, reordered, unknown,
additional, oversized, timed-out, or non-allowlisted data. A rejected response
cannot change the last valid refresh interval.

## Collector Upload Acknowledgement

An upload is successful only when all conditions hold:

- HTTP status is exactly 200.
- The response body is read through the existing bounded response mechanism.
- The response Content-Type is JSON.
- The content is valid JSON.
- `ok` is exactly `true`.
- `collectedAt` is a valid supported timestamp.
- The top-level object contains exactly `ok` and `collectedAt`, with no additional
  fields.

An acknowledged `collectedAt` is the canonical UTC ISO-8601 millisecond form
produced by `Date.prototype.toISOString()` and cannot be more than ten minutes
in the future relative to the collector clock. No minimum age is imposed because
the server may acknowledge a retained, already newer merged provider snapshot.

Empty bodies, HTML, status 204, arbitrary 2xx responses, invalid JSON,
`{"ok":false}`, and malformed timestamps are failures. They preserve the last
successful upload state and enter the existing failure/backoff path.

## Configuration Concurrency Contract

The product supports one administrator and one complete configuration document
per profile.

- Every PUT validates and writes the complete profile document atomically.
- Fields from concurrent requests are not merged.
- If two writes overlap, the last write successfully committed by storage wins.
- The UI and runbook do not promise multi-administrator conflict detection.
- Optimistic concurrency, user identities, and collaborative editing require a
  future separately approved design.

## Rollback Rules

| Failure | Allowed rollback | Forbidden rollback |
| --- | --- | --- |
| Standard Protection or view-token protection precedes Kindle migration | Keep Standard Protection, the protected deployment, and cached Kindle PNG; repair the private URL by USB | Disable Standard Protection, switch to All Deployments without a reviewed Kindle bypass, remove the view token, or reopen public reads |
| Kindle URL or local setting is invalid | Restore the private backup and reapply the correct view key | Delete the cached PNG or copy secrets into Git |
| New production code is faulty | Deploy the last verified SHA while keeping current secrets | Untracked hot edit or unverifiable deployment |
| macOS install fails | Restore only manifest-proven LaunchAgent, settings, Keychain, and backup state | Delete resources when ownership is uncertain |
| Windows install fails | Restore the exact pre-install state or absence | Leave fabricated empty settings or delete foreign tasks |
| A pull request regresses behavior | Revert that isolated pull request or commit | `git reset --hard`, force push, or mixed rollback |
| Ponytail changes behavior | Revert the one simplification pull request | Roll back unrelated security fixes |

A lost view token is rotated, not recovered from logs or Git. The replacement is
written to Vercel and then to the Kindle through a new private USB update.

## Repository and Audit Sequence

Phase 0 protection is performed as a reviewed operation. Repository work then
uses the following sequence:

1. `view-protection-fail-closed`
   - Production missing-token `503`, authorization regressions, and public URL
     removal.
2. `kindle-download-hardening`
   - Deadline, 4 MiB cap, PNG validation, checked replacement, and cache
     preservation.
3. `macos-beta-hardening`
   - Absolute paths, controlled PATH, Keychain adapter, terminal traps, complete
     ownership, rollback, and Beta documentation. Runtime resolution and secret
     transaction remain separate commits inside the pull request.
4. `kindle-runtime-correctness`
   - Wi-Fi ordering, private-env xtrace guards, and runtime call-order tests.
5. `server-profile-and-config-contracts`
   - Prototype-name safety and the single-admin atomic last-write-wins contract.
6. `collector-stale-lock-hardening`
   - Atomic ownership-safe reclaim and deterministic race tests.
7. `collector-upload-ack-contract`
   - Exact bounded JSON acknowledgement behavior.
8. `installer-prerequisites-and-rollback`
   - Node version gates and Windows first-install rollback.
9. `schema-edge-contracts`
   - Sensitive-name rejection and exact device-config version handling.
10. `verification-and-documentation`
    - Production-start smoke support, newly collected status, runbooks,
      checklists, and release evidence; no unrelated runtime changes.
11. `ponytail-audit-only` (non-PR report)
    - Ranked untracked report from a clean detached approved-SHA worktree, with
      no code changes, branch, commit, push, or pull request.
12. Approved Ponytail candidates
    - One candidate per independently revertible pull request.

Every implementation pull request (items 1-10 and later approved candidates)
starts from the latest `main`, declares its file allowlist,
and excludes `.recovery/`, private Kindle environment files, authenticated URLs,
tokens, device backups, and unrelated user changes.

## Test Strategy

### Fixed gate for every pull request

1. Add a failing regression test and retain the failure evidence.
2. Make the smallest behavior-preserving repair.
3. Pass focused tests.
4. Pass the complete test suite with a count no lower than the 226-test baseline.
5. Pass `npm run build`.
6. Start the built application with `next start` and pass local HTTP smoke.
7. Pass applicable PowerShell parsing, macOS `bash -n`, and all tracked Kindle
   shell syntax checks.
8. Pass `git diff --check` and a secret/private-URL scan.
9. Pass all GitHub CI jobs and the Vercel preview check when present.
10. Resolve every Critical, P1, and P2 review finding.
11. Record the pull request head, merge, rollback, and eventual deployment SHAs.
12. Stop for user review before the next phase.

### Coverage policy

Use Node's built-in coverage capability before considering any new dependency.
Record a fresh repository baseline at implementation start and do not allow it to
decrease. Every new or changed authorization, parser, validation, ownership, and
rollback decision must have positive, boundary, negative, timeout/I/O, and
credential-leakage cases where applicable.

A single repository-wide percentage is not a substitute for risk cases. Shell
and PowerShell paths use executable scenario matrices rather than a misleading
line-coverage percentage.

### Required fault-injection matrix

| Area | Required cases | Pass condition |
| --- | --- | --- |
| Credential roles | Independently generated view/ingest/admin values and a deliberately duplicated role pair | Distinct values provision; an equal pair is rejected while output reports booleans only |
| View authorization | Unconfigured, missing, wrong, exact key | `503`, `401`, `401`, `200`; no pre-auth storage access |
| Local fixture isolation | Flag absent; eligible local flag; flag in each Vercel environment; flag in production; flag with a view token; managed/live/device-config attempts | Only the eligible unmanaged local fixture renders; every conflict or private-data attempt returns `503` with zero Blob/config/quota access |
| Admin authorization | Unconfigured, wrong, legal GET/PUT, oversized body, storage failure | Correct status, no input or secret echo |
| Ingest | Wrong Bearer, over 8 KiB, invalid snapshot, storage failure | No unintended write and credential-free errors |
| Upload ack | Correct JSON, wrong Content-Type, 204, HTML, empty, invalid JSON, `ok:false`, malformed/future `collectedAt` | Only exact acknowledgement updates success state |
| Kindle PNG | Stall, oversized stream, HTML/JSON, bad signature, truncated IHDR, wrong dimensions/format, move failure, and failure with no prior cache | Nonzero result, temp cleanup, byte-identical old cache; without a cache, never call `eips` |
| Device config | Wi-Fi absent, oversized body, timeout, unknown version, invalid interval | Last valid interval remains active |
| Profile | `__proto__`, `constructor`, `prototype`, `toString` | No 500 and no unsafe Blob access |
| Collector lock | Stale decision followed by lock replacement | New lock survives; at most one collector runs |
| macOS Beta | Scrubbed PATH, prompt interruption, Keychain failure, manifest tamper, foreign resources | Executables resolve, terminal restores, secret remains absent, no foreign deletion |
| Windows | Fresh install, reinstall, task-create failure, foreign task, uninstall | Exact rollback and ownership preservation |

### Web and rendering acceptance

- Exercise editor unlock, profile selection, artwork conversion, save, error
  focus, and managed preview.
- Verify desktop 1440 by 1000 and mobile 390 by 844 layouts with no horizontal
  overflow, inaccessible controls, or material text clipping.
- Verify every supported profile:
  - DP75SDI: 758 by 1024
  - KPW3: 1072 by 1448
  - Voyage: 1080 by 1440
  - Basic: 600 by 800
- Every PNG must be nonblank, opaque, 8-bit grayscale, non-interlaced, served as
  `image/png`, and marked no-store.

### Supply-chain and secret checks

- Re-run `npm audit` and record severity, reachability, mitigation, and recheck
  criteria.
- Reject newly introduced high or critical findings unless separately reviewed
  and explicitly accepted.
- Scan diffs, logs, xtrace output, manifests, plist content, documentation, and
  generated smoke output for secrets and authenticated URLs. Outside the fixed
  Kindle downloader boundary, scan argv fixtures as well. Kindle tests prove
  the sentinel is absent from stdout/stderr/xtrace and never capture `/proc`
  argv/environment evidence merely to inspect the unavoidable URL operand.

## Merge, Deploy, and Release Gates

```text
Focused tests
  -> full tests and production build
  -> independent review
  -> GitHub CI
  -> user phase approval
  -> merge
  -> Vercel deployment
  -> deployment SHA verification
  -> authenticated production smoke
  -> Kindle and Windows acceptance
```

The final release evidence must keep these states separate:

- Local commit and branch
- Pull request head and merge SHA
- Each GitHub CI result
- Vercel deployment ID, readiness, and `githubCommitSha`
- Production authentication and response smoke
- Kindle device acceptance
- Windows real-scheduler acceptance
- macOS Beta outstanding or completed real-Mac acceptance

The Vercel production deployment must be `READY` and its `githubCommitSha` must
equal the approved merge SHA. A push to a feature branch is not a deployment.

## Production Smoke Requirements

- Anonymous Dashboard and device-config reads are rejected.
- Missing or wrong view keys are rejected without storage access.
- The correct key returns the intended Dashboard PNG and device config.
- Admin and ingest endpoints reject wrong authorization.
- Production admin write testing uses an explicitly reversible profile update and
  restore; secrets are never printed.
- Device config is exactly two lines, version 1, and an allowlisted interval.
- All four profiles pass PNG status, content type, no-store, signature,
  dimensions, grayscale, interlace, and nonblank checks.
- Production deployment metadata matches the approved merge.

## Real-Device and Platform Acceptance

### Kindle

- The authenticated key appears exactly once in each managed URL.
- The first private Wi-Fi refresh succeeds after USB migration.
- A failed network or invalid download leaves the cached PNG byte for byte.
- A web save changes runtime behavior within two complete refresh cycles without
  a second USB connection.
- Normal stop, termination, and physical power-button exit restore system chrome.
- Temperature, battery drain, and sustained execution are recorded and judged
  acceptable for the selected interval. The sustained run lasts at least 60
  minutes at the recommended 720-second interval, covers at least five complete
  scheduled intervals, and records battery and credential-free thermal
  diagnostics at the start, 30 minutes, and 60 minutes. It fails on a daemon
  exit, hang, missed refresh, thermal warning, unexpected reboot, or chrome
  restoration failure. Because battery age and thermal sensors vary by device,
  the recorded battery and temperature change is an explicit user acceptance
  item rather than an invented universal numeric threshold.

### Windows

- A real per-user Task Scheduler task runs at login and at the 12-minute cadence.
- It does not wake the computer and does not overlap an active run.
- Claude and Codex are collected through their official local surfaces and a
  valid snapshot is acknowledged by the server.
- Resume, reinstall, failure rollback, diagnose, and uninstall preserve ownership
  boundaries.

### macOS Beta

- CI and fake-command harness tests are necessary but do not establish production
  readiness.
- A real Mac must complete install, scheduled LaunchAgent execution, actual
  collection/upload, diagnose, rollback, and uninstall.
- Until that happens, documentation and release notes say Beta.
- macOS Beta status does not block the otherwise verified Kindle/Windows release.

## Stop Conditions

Stop the current phase and report evidence if any of the following occurs:

- A focused or full test, build, CI, or smoke gate fails.
- Production deployment metadata does not match the approved merge SHA.
- Cache preservation or Kindle chrome restoration becomes uncertain.
- Any token, cookie, or complete Authorization header appears in output, diff,
  logs, argv, or generated artifacts.
- Any authenticated URL appears in output, diff, logs, generated artifacts, or
  argv outside the fixed bounded Kindle downloader exception; or a test/report
  captures the Kindle URL from `/proc` as evidence.
- Installer ownership or rollback cannot be proven.
- A change requires files or behavior outside the approved phase scope.
- A Ponytail candidate changes observable output or a safety contract.

## Ownership and Review Checkpoints

Codex is responsible for scoped implementation, regression tests, documentation,
review evidence, and secret-free verification output. It must distinguish local
commits, GitHub state, CI, and production deployment.

The user is responsible for approving this design and the later implementation
plan, authorizing production environment writes, participating in the one-time
Kindle USB migration, confirming real-device behavior, and later providing a Mac
for promotion beyond Beta if desired.

At the end of every phase, Codex stops and provides:

- Exact diff scope
- Focused and full test evidence
- CI and deployment status where applicable
- Unresolved risks and deferred items
- Rollback point
- Confirmation that no secret or private artifact entered Git

The next phase starts only after user confirmation.

## Definition of Done

The primary remediation may be described as complete only when:

- Every confirmed P1, P2, and P3 item has a mapped regression test, repair, and
  verification result.
- No unresolved Critical, P1, or P2 finding remains.
- The fresh complete suite exceeds or equals the 226-test baseline with zero
  failures and no skipped critical case.
- The production build and build-produced HTTP smoke pass.
- All GitHub CI jobs pass on the merge commit.
- Vercel production readiness and deployment SHA are verified.
- Vercel Authentication Standard Protection is re-verified at project level;
  no Shareable Link, automation bypass, or Deployment Protection Exception is
  present; and every discoverable generated Production/Preview URL passes the
  redirects-disabled Vercel Authentication response gate.
- Production authentication, device config, and PNG smoke pass without exposing
  credentials.
- View-token creation evidence is complete, trusted creation records prove the
  ingest/admin CSPRNG byte-count and independence requirements, and Blob
  provenance/server-only placement are recorded. No `RotationRequired=True`
  blocker remains.
- Kindle and Windows real acceptance pass.
- The user has explicitly accepted the bounded Kindle downloader argv exception,
  or a separately approved downloader binary has removed it and passed real-
  device validation.
- macOS is either still truthfully labeled Beta or has separate real-Mac evidence
  supporting promotion.
- Current documentation contains only newly collected evidence and accurate
  limitations.
- `.recovery/`, device backups, private environment files, and credentials never
  enter Git.
- Approved Ponytail work, if any, preserves observable and safety contracts.

Completion means the project passed the deep verification defined here. It does
not claim that software can be proven free of every unknown defect.

## Out of Scope

- Public production dashboard mode
- Multi-administrator identity and collaborative editing
- Provider OAuth, browser-cookie, or consumer-account credentials on Vercel
- New quota providers or display features
- RTC redesign, Kindle UI redesign, or renderer redesign
- Promotion of macOS beyond Beta without real hardware evidence
- Ponytail changes before correctness and release gates are green
- Deleting or relocating `.recovery/` without a separately approved and verified
  backup decision
