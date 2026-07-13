# macOS Beta Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the macOS Beta installer, diagnostics, and uninstaller use exact ownership validation, no-argv Keychain operations, and reversible file/LaunchAgent transactions without claiming support beyond evidence from the tested Mac.

**Architecture:** PR 3 contains three independently revertible commits. M1 resolves absolute executables and writes a controlled LaunchAgent. M2 introduces one exact state validator and separates installedExpected from desiredExpected. M3 introduces a bounded JXA Security.framework adapter and makes both installation and uninstallation two-phase transactions whose Keychain mutation is the final product-state commit.

**Tech Stack:** POSIX sh, Node.js ESM, Node test runner, macOS JXA through /usr/bin/osascript -l JavaScript, Security.framework generic-password items, launchctl, plutil, Python 3 standard-library pty only in macOS CI, and GitHub macOS runners.

## Controlling Contracts

- The approved design is docs/superpowers/specs/2026-07-13-project-hardening-remediation-design.md.
- The repository-wide fixed PR gate is docs/superpowers/plans/2026-07-13-project-hardening-master.md, section Fixed Gate for Every Pull Request. Task 11 below repeats that command verbatim. Focused commands in M1, M2, and M3 are additional gates and never replace it.
- macOS stays Beta. Automated support means only the exact macos-latest runner image recorded by a passing GitHub run. Device support means only the exact OS version and architecture recorded by Task 10.
- No implementation starts until the user approves this plan. No push, PR, merge, Keychain mutation, LaunchAgent mutation, or real-Mac operation occurs without the phase approval required by the master plan.

## Invariants

1. The ingest token is accepted only from a TTY/stdin or dedicated descriptor. It never enters argv, environment, xtrace, plist, manifest, config, log, command transcript, or temporary file.
2. Runtime Keychain read may place the token in Node memory, but it never places it in argv, environment, logs, or persistent state.
3. There is no plaintext fallback if the JXA Security.framework boundary is unavailable.
4. Every path consumed for mutation is either computed from the current HOME and fixed label or returned by the exact validator after complete validation.
5. The manifest has exactly these nine fields: schemaVersion, owner, installRoot, launchAgentPath, claudeSettingsPath, backupPath, statusLineCommand, keychainService, keychainAccount.
6. Missing, extra, wrong-type, wrong-value, symlink, non-regular, foreign, oversized, or malformed state fails closed before mutation.
7. Existing state is validated against installedExpected. Newly staged state is validated against desiredExpected. A new Node or Codex path must never be used to prove ownership of the old installation.
8. A Keychain put is the last fallible product-state mutation during install. A Keychain delete is the last fallible product-state mutation during uninstall.
9. Security.framework put is create-or-update and atomic: failure preserves the previous item or preserves absence.
10. After the final Keychain mutation succeeds, only ingest-token-free private scratch cleanup and reporting remain; scratch may contain unrelated Claude settings and always stays 0700/0600 with no path/content output.
11. Rollback is idempotent, restores the previous LaunchAgent loaded/unloaded state, and reports a distinct rollback-failed result while retaining scratch evidence if restoration is incomplete.
12. Foreign LaunchAgents, settings, backups, install roots, and Keychain identities are never removed.
13. currentAccount is computed only by the absolute /usr/bin/id -un (or the
    explicit test seam), never from USER; JXA independently requires NSUserName
    to match. Tests set a spoofed USER and require it to be ignored.

## Fixed Names, Limits, and Data Shapes

Use these constants in collector/macos-install-state.mjs and mirror them in tests:

~~~js
export const OWNER = 'kindle-llm-dash/macos-collector';
export const LABEL = 'com.kindle-llm-dashboard.sync';
export const KEYCHAIN_SERVICE = 'KindleLLMDashboard.ingest';
export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_SECRET_BYTES = 16_384;
export const MAX_MANIFEST_BYTES = 65_536;
export const MAX_CONFIG_BYTES = 65_536;
export const MAX_PLIST_JSON_BYTES = 262_144;
export const MAX_PLIST_SOURCE_BYTES = 262_144;
export const MAX_SETTINGS_BYTES = 1_048_576;
export const MAX_BACKUP_BYTES = 1_048_576;

export const MANIFEST_KEYS = [
  'schemaVersion',
  'owner',
  'installRoot',
  'launchAgentPath',
  'claudeSettingsPath',
  'backupPath',
  'statusLineCommand',
  'keychainService',
  'keychainAccount',
].sort();

export const CONFIG_KEYS = [
  'ingestUrl',
  'ingestTokenSource',
  'keychainService',
  'keychainAccount',
  'codexCommand',
  'timeoutMs',
  'timeZone',
].sort();

export const PLIST_KEYS = [
  'EnvironmentVariables',
  'KeepAlive',
  'Label',
  'ProcessType',
  'ProgramArguments',
  'RunAtLoad',
  'StandardErrorPath',
  'StandardOutPath',
  'StartInterval',
].sort();
~~~

Exact modes are: install root/log directory/private scratch `0700`; installed config, manifest, LaunchAgent source, settings snapshot, backup, safe projection, converted plist JSON, stdout log, and stderr log `0600`; executable shell/Node entrypoints `0700`. Existing user `settings.json` retains its original mode and must be a regular non-symlink no more than `MAX_SETTINGS_BYTES`; a backup retains `0600` and is no more than `MAX_BACKUP_BYTES`.

The validator uses these exact shapes:

~~~text
baseExpected = {
  installRoot,
  launchAgentPath,
  settingsPath,
  currentAccount,
  collectorRoot,
  configPath,
  uploadEntrypoint,
  statusLineEntrypoint,
  stdoutPath,
  stderrPath
}

installedExpected = {
  ...baseExpected,
  nodePath,          # decoded only after exact manifest validation
  codexCommand,      # read only after exact config validation
  controlledPath,    # derived from dirname(nodePath) and dirname(codexCommand)
  statusLineCommand, # decoded and regenerated to exact equality
  backupPath         # null or exact validated regular non-symlink backup
}

desiredExpected = {
  ...baseExpected,
  nodePath,          # resolved by the current installer preflight
  codexCommand,      # resolved by the current installer preflight
  controlledPath,    # derived from the desired paths
  statusLineCommand, # generated by quoteShellWords
  backupPath,        # inherited from installedExpected or newly reserved
  ingestUrl          # parsed and normalized by assertAllowedIngestUrl
}
~~~

The words installed and desired are mandatory names in implementation and tests. Do not collapse the objects into one expected value.

---

## Commit M1 — Absolute Runtime Paths and Controlled LaunchAgent

### Task 1: Replace the macOS Test Harness With One Complete Synchronous Fixture

**Files:**

- Modify: tests/collectorMacos.test.mjs
- Create: tests/fixtures/fake-macos-command.mjs

**Interfaces:**

- All JavaScript fixture operations are synchronous. No test in this file uses await, readFile, or an undefined convenience wrapper.
- tests/fixtures/fake-macos-command.mjs is a token-blind command emulator selected by its first argument: launchctl, plutil, or osascript.

- [ ] **Step 1: Extend imports and define every primitive used by the fixture**

Keep the current spawnSync, toBashPath, source, and writeExecutable helpers. Add only these synchronous primitives:

~~~js
function readTextOrEmpty(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function parseJsonLines(path) {
  const text = readTextOrEmpty(path).trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}

function regularFilesRecursively(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...regularFilesRecursively(path));
    else if (entry.isFile()) output.push(path);
  }
  return output.sort();
}

function snapshot(paths) {
  return Object.fromEntries(paths.map((path) => [
    path,
    existsSync(path)
      ? { exists: true, text: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 }
      : { exists: false },
  ]));
}
~~~

Add dirname and readdirSync to imports. Do not add a second asynchronous fixture or a hidden global mutable fixture.

- [ ] **Step 2: Define the exact fake-command protocol**

The fixture writes tiny executable shell shims that execute the real Node binary with tests/fixtures/fake-macos-command.mjs and a mode. The real Node path is passed as the shim's fixed quoted literal when the shim is created; it is not discovered through PATH.

fake node:

~~~text
Invocation: fake-node -p process.execPath
Result: print the fake-node absolute POSIX path and exit 0.

All other invocations:
exec REAL_NODE with the original argv.

Every invocation appends JSON metadata to argv.log:
{ command: "node", argv: [non-secret arguments] }
~~~

fake codex:

~~~text
It is executable, accepts arbitrary non-secret arguments, appends
{ command: "codex", argv: [...] } to argv.log, emits no credential text,
and exits with the configured fixture status, default 0.
~~~

transitional fake security (M1/M2 only):

~~~text
find-generic-password:
  emit a fixed non-sentinel fixture value only when keychain-present.flag exists.
add-generic-password:
  require the legacy -w argument, record only { operation, service, account,
  secretInArgv: true, secretBytes }, never record the argument value, then set
  keychain-present.flag.
delete-generic-password:
  record fixed metadata and remove keychain-present.flag.

M3 removes KINDLE_LLM_SECURITY_BIN from install/diagnose/uninstall and asserts
that this fake receives zero calls. It remains only for the allowed runtime-read
unit tests, where stdout is dependency-injected rather than persisted.
~~~

fake id:

~~~text
-un prints fixture-user; -u prints 501; every other argv exits 64.
Production defaults to /usr/bin/id. KINDLE_LLM_ID_BIN is a test-only seam and
is never persisted.
~~~

fake launchctl:

~~~text
print gui/UID/LABEL:
  exit 0 exactly when launch-loaded.flag exists; otherwise exit 113.

bootout gui/UID PLIST:
  append { command: "launchctl", operation: "bootout", target, plist }.
  if fail-next-bootout.flag exists, remove that flag and exit 71.
  otherwise remove launch-loaded.flag and exit 0.

bootstrap gui/UID PLIST:
  append { command: "launchctl", operation: "bootstrap", target, plist }.
  if fail-next-bootstrap.flag exists, remove that flag and exit 72.
  otherwise create launch-loaded.flag and exit 0.

Any other argv exits 64.
~~~

fake plutil:

~~~text
-lint PLIST:
  append { command: "plutil", operation: "lint", plist }.
  require PLIST to be a nonempty regular file.
  if fail-next-plutil.flag exists, remove it and exit 73; otherwise exit 0.

-convert json -o - PLIST:
  append { command: "plutil", operation: "convert", plist }.
  atomically claim the lowest numbered JSON file from plutil-queue/.
  write that file verbatim to stdout, remove it, and exit 0.
  if the queue is empty, exit 74.

Any other argv exits 64.
~~~

The queue is intentional. Exact conversion counts are: fresh install = staged desired plus final desired (2); reinstall = initial installed, staged desired, final pre-mutation installed recheck, final desired (4); diagnose = installed (1); uninstall = initial installed plus final pre-mutation installed recheck (2). Tests enqueue every conversion explicitly; no fake silently invents state.

fake osascript:

~~~text
Require exactly:
-l JavaScript ADAPTER OPERATION SERVICE ACCOUNT

Require ADAPTER either to equal the original fixture adapter or to be a regular non-symlink below the fixture's deterministic `scratchParent` and byte-identical to the original adapter. The fixture sets `KINDLE_LLM_SCRATCH_PARENT` only in tests; production defaults to the computed private Application Support parent. Require SERVICE to equal KindleLLMDashboard.ingest and ACCOUNT to equal fixture-user.

put:
  stream stdin through a byte counter without storing its bytes.
  append { command: "osascript", operation: "put", service, account,
           stdinPresent: byteCount > 0, stdinBytes: byteCount }.
  if fail-next-put.flag exists, remove it and exit 75 before changing state.
  if require-prepared.flag exists, require config, manifest, plist, settings,
  stdout log, and stderr log to exist before changing state.
  create keychain-present.flag and exit 0.
  If signal-during-put contains HUP, INT, or TERM, send that signal to the
  installer parent after creating the flag but before returning success.

exists:
  append metadata with no stdin field.
  if fail-next-exists.flag exists, remove it and exit 76.
  print true or false from keychain-present.flag and exit 0.

delete:
  append metadata with no stdin field.
  if fail-next-delete.flag exists, remove it and exit 77 before changing state.
  remove keychain-present.flag if present and exit 0.
  If signal-during-delete contains HUP, INT, or TERM, send that signal to the
  uninstaller parent after removal but before returning success.

Never log, persist, echo, hash, encode, or compare stdin bytes.
Any other argv exits 64.
~~~

All fake logs are JSON Lines. They record argv and state metadata only, never stdin or environment values.

- [ ] **Step 3: Define macosFixture and installedMacosFixture completely**

macosFixture accepts this exact options object:

~~~text
{
  token = "fixture-secret",
  codexCommand = "codex",
  homeName = "Home With Spaces ' Quote $ Dollar",
  inheritedXtrace = false,
  nodeVariant = "a",
  codexVariant = "a",
  initialKeychainPresent = false,
  initialLaunchLoaded = false,
  useRealPlutil = false
}
~~~

It creates these named absolute paths and returns them as properties:

~~~text
root, home, bin, commandLog, argvLog, adapterLog, stateDir, scratchParent,
installRoot, collectorRoot, configPath, manifestPath, settingsPath,
launchAgentPath, stdoutPath, stderrPath, adapterPath, nodePath,
nodePathA, nodePathB, codexPath, codexPathA, codexPathB,
securityPath, idPath, uploadPath, statusLinePath, account,
controlledPath, env
~~~

It returns only these methods; every later test uses methods from this list:

~~~text
install({ token, codexCommand, inheritedXtrace } = {}) -> SpawnSyncReturns
reinstall(options = {}) -> SpawnSyncReturns
diagnose() -> { result: SpawnSyncReturns, json: object | null }
uninstall() -> SpawnSyncReturns
queuePlutilObject(object) -> void
queueFreshInstallConversions({ desired } = {}) -> void
queueReinstallConversions({ installed, desired } = {}) -> void
desiredPlistObject(overrides = {}) -> exact plist object
installedPlistObject(overrides = {}) -> exact plist object from current files
plutilConversions() -> object[]
plutilQueueDepth() -> number
readManifest() -> object
writeManifest(object) -> void
readConfig() -> object
writeConfig(object) -> void
readLaunchAgentText() -> string
setLaunchLoaded(boolean) -> void
launchLoaded() -> boolean
setKeychainPresent(boolean) -> void
keychainPresent() -> boolean
failNext(operation) -> void
signalDuringFinal(operation, signal) -> void
  requirePreparedOnPut(boolean = true) -> void
  selectRuntimeVariant({ nodeVariant, codexVariant }) -> void
adapterCalls() -> object[]
commandCalls() -> object[]
ownedSnapshot() -> object
observableText(results = []) -> Array<{ label, text }>
cleanup() -> void
~~~

install builds argv as:

~~~text
[ optional "-x", install-script, "--ingest-url",
  "https://example.test/api/usage", "--codex-command", requested-command ]
~~~

The optional -x is passed to bash before the script path. Spawn input is token plus one newline. reinstall delegates to install after state exists. diagnose parses stdout only when status is zero. uninstall has no stdin.

The fixture always creates fake-node-a/b and fake-codex-a/b. Each fake Node returns its own absolute shim for `-p process.execPath` and delegates all other calls to the real Node. `selectRuntimeVariant` changes only the next desired install inputs; it never rewrites installed files. desiredPlistObject returns exactly the nine PLIST_KEYS and uses the selected desired node/codex paths. installedPlistObject reads the current manifest/config only after a successful fixture install and represents the old installation. Neither object method mutates the plutil queue. `queueFreshInstallConversions` enqueues the supplied `desired` object, or `desiredPlistObject()`, twice in staged/final order. `queueReinstallConversions` computes or accepts one installed object and one desired object, then enqueues `installed, desired, installed, desired` in initial-installed/staged-desired/final-installed/final-desired order. Optional objects let a failure test capture valid old state before tampering or deliberately enqueue one malformed conversion without inventing fallback state. `plutilConversions` returns only conversion log metadata; `plutilQueueDepth` counts unclaimed numbered queue files. No helper supplies an object when the queue is empty.

ownedSnapshot captures exact existence/content/mode for settings, backup when non-null, install-root regular files, LaunchAgent, diagnostic logs, Keychain presence, and LaunchAgent loaded state. It does not contain a Keychain value.

observableText returns labeled text for:

~~~text
each supplied SpawnSync stdout and stderr
commandLog, argvLog, adapterLog
config, manifest, plist, settings
all regular files below installRoot
stdoutPath and stderrPath
~~~

It also serializes the fake processes' argv and selected environment key names. It must not include process.env values wholesale because unrelated developer secrets may exist.

Log routing is fixed: node/codex write argvLog, security/launchctl/plutil write
commandLog, and osascript writes adapterLog. env contains the corresponding
KINDLE_LLM_*_BIN seams, including security during M1/M2 and id for all commits.

Pure object/quoting/fake-protocol tests run on Windows, Linux, and macOS.
Filesystem-backed POSIX path, lstat, transaction, LaunchAgent, and pty tests run
only when process.platform is darwin; other platforms emit named skips. The
macos-test-build job is therefore a mandatory PR gate and Windows skips cannot
be used as evidence for these macOS contracts.

installedMacosFixture is exactly:

~~~js
function installedMacosFixture(options = {}) {
  const fx = macosFixture(options);
  fx.queueFreshInstallConversions();
  const result = fx.install();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fx.plutilConversions().length, 2);
  assert.equal(fx.plutilQueueDepth(), 0);
  return fx;
}
~~~

- [ ] **Step 4: Add fixture contract tests**

Add one test for every fake protocol branch, including empty plutil queue, the exact 2/4/1/2 conversion counts, put failure preserving prior Keychain presence, delete failure preserving presence, bootstrap/bootout state, and both fake-node `process.execPath` variants. Every successful fresh-install test calls `queueFreshInstallConversions()` and asserts exactly two convert calls plus queue depth zero. Every successful reinstall test captures the installed variant, selects the desired variant, calls `queueReinstallConversions()`, and asserts exactly four convert calls plus queue depth zero. Diagnose and uninstall tests enqueue exactly one and two installed objects respectively. Add a reinstall test that installs variant A, calls `selectRuntimeVariant({nodeVariant:'b',codexVariant:'b'})`, and proves old extraction remains A while staged/final validation uses B. Add an uninstall test whose byte-identical adapter below `scratchParent` is accepted, then alter one byte and prove rejection before delete. These tests call the fake commands directly and assert that the sentinel never appears in logs. An empty queue must exit 74; tests never catch that result and retry with an invented object.

Add one fixture cleanup test using t.after:

~~~js
test('macOS fixture is synchronous and self-cleaning', (t) => {
  const fx = macosFixture();
  t.after(() => fx.cleanup());
  assert.equal(existsSync(fx.root), true);
  assert.equal(typeof fx.install, 'function');
  assert.equal(typeof fx.observableText, 'function');
});
~~~

- [ ] **Step 5: Verify the harness before behavior tests**

~~~powershell
node --test --test-name-pattern="fixture|fake node|fake launchctl|fake plutil|fake osascript" tests/collectorMacos.test.mjs
~~~

Expected: fixture-only tests pass against current product scripts or fail only where the current product invokes the old security seam.

### Task 2: Add and Implement Absolute-Path and Controlled-LaunchAgent Behavior

**Files:**

- Modify: tests/collectorMacos.test.mjs
- Modify: collector/install-macos.sh
- Modify: README.md
- Modify: docs/MACOS-COLLECTOR.md

- [ ] **Step 1: Add RED tests**

Add synchronous tests for:

1. HOME, fake Node, and fake Codex paths containing spaces, apostrophe, dollar, and backtick.
2. command-name Codex resolution and explicit-path Codex resolution.
3. missing or non-executable Codex failure before prompt, scratch creation, or command mutation.
4. absolute nodePath and codexCommand in config.
5. exact ProgramArguments, controlled PATH, private stdout/stderr logs, mode 0600 files, and mode 0700 log directory.
6. URL credentials, fragment, malformed URL, nonlocal HTTP, CR/LF/NUL path, and PATH-directory colon rejection.
7. README and runbook explicitly say macOS Collector (Beta), never production-ready.

The successful-path test queues both required desired-plist conversions before install and reads only synchronous methods:

~~~js
test('installer resolves absolute runtime paths and emits a controlled LaunchAgent', (t) => {
  const fx = macosFixture();
  t.after(() => fx.cleanup());
  fx.queueFreshInstallConversions();
  const result = fx.install();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fx.plutilConversions().length, 2);
  assert.equal(fx.plutilQueueDepth(), 0);
  assert.equal(fx.readConfig().codexCommand, fx.codexPath);
  assert.match(fx.readConfig().codexCommand, /^\//);
  assert.match(fx.readLaunchAgentText(), /<key>EnvironmentVariables<\/key>/);
  assert.match(fx.readLaunchAgentText(), /launch-agent\.out\.log/);
  assert.match(fx.readLaunchAgentText(), /launch-agent\.err\.log/);
});
~~~

- [ ] **Step 2: Run and confirm RED**

~~~powershell
node --test --test-name-pattern="absolute runtime|controlled LaunchAgent|Beta|URL|unsupported path" tests/collectorMacos.test.mjs
~~~

Expected: config still stores codex, PATH is uncontrolled/absent, logs still point to /dev/null, unsupported URL/path boundaries are not all rejected, and Beta copy is incomplete.

- [ ] **Step 3: Resolve all executables before prompt or mutation**

Implement this preflight order:

~~~text
parse CLI
-> disable inherited xtrace
-> resolve script_dir
-> require ingest URL
-> parse URL through Node assertAllowedIngestUrl
-> resolve current account with absolute id -un and numeric UID with id -u
-> resolve Node to process.execPath
-> resolve Codex by explicit path or command -v
-> canonicalize Codex with fs.realpathSync
-> verify Node and Codex are absolute executable regular files
-> verify fixed or test-seam launchctl/plutil/osascript are executable
-> derive controlledPath
-> compute all logical paths
-> only then inspect existing product state
~~~

Production defaults remain /usr/bin/id, /bin/launchctl, /usr/bin/plutil, and
/usr/bin/osascript. KINDLE_LLM_*_BIN values are test seams only. Never persist a
seam path except the resolved Node/Codex paths intentionally stored in
config/plist. USER is not an identity source.

assertAllowedIngestUrl uses new URL(value), rejects username, password, and hash, accepts HTTPS with a nonempty hostname, and accepts HTTP only for localhost, 127.0.0.1, or ::1. The exact original URL is stored after validation; do not normalize away its path or query.

For every executable path:

- reject NUL, CR, and LF;
- require a POSIX absolute path;
- require lstat to report a regular file rather than a symlink;
- require execute access;
- reject a dirname containing colon because it cannot be represented in PATH.

The desired controlled PATH is unique dirname(nodePath), unique dirname(codexPath), /usr/bin, /bin, /usr/sbin, /sbin in that order.

- [ ] **Step 4: Generate shell-safe statusLine command through the Node module**

Do not interpolate a command with shell double quotes. Task 4 adds quoteShellWords and decodeShellWords. M1 may temporarily call a small Node expression with the same grammar, but M2 must replace it with the shared exported function.

The grammar is:

~~~text
command := word SP word SP word
word := POSIX single-quoted word
embedded apostrophe := close quote, backslash-apostrophe, reopen quote
arguments := nodePath, statusLineEntrypoint, "--config=" plus configPath
~~~

Spaces, dollar, backtick, backslash, and apostrophe round-trip. NUL/CR/LF fail. Tests require decodeShellWords(quoteShellWords(words)) to equal words.

- [ ] **Step 5: Emit diagnostic files and exact LaunchAgent**

Create the diagnostic directory mode 0700 and two empty mode 0600 files in staged state. XML-escape all plist string values, including controlled PATH and diagnostic paths. The plist contains exactly the PLIST_KEYS data and no token/auth fields.

- [ ] **Step 6: Update Beta documentation**

README heading:

~~~text
## macOS Collector (Beta)
~~~

Runbook statement:

~~~text
Automated macOS CI validates shell, Security.framework bridging, and ownership contracts only on the recorded runner image. It does not establish broad production readiness. Promotion beyond Beta requires the exact disposable-user real-Mac acceptance in this runbook.
~~~

- [ ] **Step 7: Verify and commit M1**

~~~powershell
node --test tests/collectorMacos.test.mjs
& "$env:ProgramFiles\Git\bin\bash.exe" -n collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh
git diff --check
git add collector/install-macos.sh tests/collectorMacos.test.mjs tests/fixtures/fake-macos-command.mjs README.md docs/MACOS-COLLECTOR.md
git commit -m "Harden macOS collector runtime paths"
~~~

Expected: M1 contains no Keychain transport change and is independently revertible.

---

## Commit M2 — Exact Ownership Boundary

### Task 3: Add Exact Validator Unit and Integration Tests

**Files:**

- Create: collector/macos-install-state.mjs
- Modify: tests/collectorMacos.test.mjs

- [ ] **Step 1: Define canonical valid objects in the test file**

Add these synchronous constructors. They are pure and take all dependencies explicitly:

~~~text
validManifest(baseExpected, installedExpected) -> exact nine-field object
validConfig(installedExpected, ingestUrl) -> exact seven-field object
validPlist(installedExpected) -> exact nine-field object
validSettings(installedExpected, otherFields = {}) -> settings with exact owned statusLine
~~~

Do not use a generic storedConfig, validSnapshot, or an unlisted fixture helper.

- [ ] **Step 2: Add exact-key/type/value tables**

For every key in MANIFEST_KEYS, CONFIG_KEYS, and PLIST_KEYS, test:

- missing key;
- one extra unexpected key;
- null where disallowed;
- wrong primitive type;
- structurally valid but wrong value.

Also test:

- __proto__, constructor, and prototype as extra own JSON keys;
- manifest/config/plist files at their byte limit and one byte over;
- malformed JSON and non-object JSON;
- symlinked install root, manifest, config, plist, settings, and backup;
- directory/FIFO/device where a regular file is required;
- normalized-looking path with a dot segment, relative path, NUL/CR/LF;
- backup in another directory, wrong timestamp, duplicate suffix, absent backup, and symlink backup;
- HTTPS, allowed local HTTP, credential-bearing URL, fragment URL, nonlocal HTTP, malformed URL;
- node/codex paths with spaces, dollar, backtick, backslash, apostrophe;
- controlled PATH with wrong order, duplicate directory, empty component, or colon-bearing directory;
- statusLine with missing quotes, extra word, shell operator, command substitution, alternate config, alternate entrypoint, relative Node, or noncanonical encoding;
- foreign ProgramArguments, label, log paths, interval, environment, and one extra plist key.

Table assertions must expect the generic validator error class and must not assert a private absolute path in error text.

- [ ] **Step 3: Prove installedExpected and desiredExpected differ during reinstall**

Create an installation with old fake-node-A and fake-codex-A. Then request reinstall with fake-node-B and fake-codex-B.

Queue plutil objects in this exact order:

~~~text
1. validPlist(installedExpectedA)
2. validPlist(desiredExpectedB)
~~~

Assert:

- old state validates only against installedExpectedA;
- staged state validates only against desiredExpectedB;
- using desiredExpectedB to validate the old plist/config/manifest fails;
- reinstall succeeds only after both independent validations pass;
- the old backupPath is retained and lstat-validated;
- rollback after a staged failure restores A byte-for-byte and loaded/unloaded state exactly.

- [ ] **Step 4: Add three-script tamper integration coverage**

For each manifest field, mutate one case at a time after installedMacosFixture:

~~~text
reinstall -> nonzero and no product mutation
diagnose -> exit zero with manifestValid false and no adapter call
uninstall -> nonzero and no product mutation
~~~

Repeat for foreign plist ProgramArguments, foreign settings statusLine, symlink backup, missing config, and extra plist key.

Use fx.ownedSnapshot before and after. A destructive command is any launchctl bootstrap/bootout, osascript put/delete, rename/removal of owned state, or settings write. assert.deepEqual proves none occurred.

- [ ] **Step 5: Run and confirm RED**

~~~powershell
node --test --test-name-pattern="manifest|config exact|plist exact|installedExpected|desiredExpected|symlink|backup|statusLine quoting" tests/collectorMacos.test.mjs
~~~

Expected: current scripts trust a partial manifest, grep plist text, read manifest-derived values separately, and cannot distinguish old from desired state.

### Task 4: Implement One Exact Validator and Safe Extractor

**Files:**

- Create: collector/macos-install-state.mjs
- Modify: collector/install-macos.sh
- Modify: collector/diagnose-macos.sh
- Modify: collector/uninstall-macos.sh

**Exported interface:**

~~~js
export function assertAllowedIngestUrl(value) {}
export function quoteShellWords(words) {}
export function decodeShellWords(command) {}
export function validateMacosManifest(value, baseExpected) {}
export function validateMacosConfig(value, baseExpected) {}
export function validateMacosLaunchAgent(value, expected) {}
export function validateInstalledState(physical, baseExpected) {}
export function validateDesiredState(physical, desiredExpected) {}
~~~

There are no other public exports. Private helper names and contracts are fixed below so implementers do not invent alternate trust paths.

- [ ] **Step 1: Implement bounded regular-file JSON input**

Private helper:

~~~text
readRegularJson(path, maxBytes, role)
~~~

Algorithm:

1. Reject non-absolute, NUL/CR/LF, non-normalized paths.
2. lstat path; reject symbolic link and anything other than a regular file.
3. Reject size greater than maxBytes before read.
4. Read once with fs.readFileSync and parse with JSON.parse.
5. Require a non-null object, not an array.
6. Errors are new Error(role plus " is invalid"); do not include content or a private path.

Private helper:

~~~text
assertExactRecord(value, keys, role)
~~~

It requires Object.getPrototypeOf(value) to be Object.prototype or null, requires Object.keys(value).sort() to deep-equal keys, and never uses in or inherited-property lookup.

- [ ] **Step 2: Implement exact POSIX path and filesystem checks**

Private helpers:

~~~text
assertAbsoluteNormalizedPath(value, role) -> value
assertRegularNoSymlink(path, role) -> lstat result
assertDirectoryNoSymlink(path, role) -> lstat result
assertExecutableNoSymlink(path, role) -> value
assertExactBackupPath(value, settingsPath) -> null or value
controlledPathFor(nodePath, codexCommand) -> string
~~~

Rules:

- path.posix.isAbsolute must be true;
- path.posix.normalize(value) must equal value;
- value may not contain NUL, CR, or LF;
- installRoot, collectorRoot, config, entrypoints, logs, manifest, settings, and plist equal their computed path exactly;
- a child path must pass path.posix.relative(parent, child): result is nonempty, not .., and does not begin ../;
- lstat, not stat, proves file type;
- executable paths are regular non-symlinks with X_OK access;
- controlled PATH rejects colon in either executable dirname, removes exact duplicate directories, has no empty component, and ends with the four fixed system directories;
- backup is null or exactly settingsPath plus .kindlelmldashboard.YYYYMMDD-HHMMSS.bak;
- a non-null backup must already be a regular non-symlink at installed-state validation;
- creation uses COPYFILE_EXCL or open flag wx, then chmod 0600, followed by lstat verification. No overwrite is allowed.

- [ ] **Step 3: Implement exact URL and command quoting**

assertAllowedIngestUrl:

~~~text
new URL(value)
-> require value is string and has no NUL/CR/LF
-> reject username, password, and hash
-> accept https with nonempty hostname
-> accept http only for localhost, 127.0.0.1, or ::1
-> otherwise throw generic invalid-config error
-> return the original value
~~~

quoteShellWords accepts a nonempty string array, rejects NUL/CR/LF in each word, wraps each word in POSIX single quotes, represents an apostrophe as close-quote + backslash-apostrophe + reopen-quote, and joins words with one ASCII space.

decodeShellWords is a strict state machine:

1. At word start, require apostrophe.
2. Append every byte until apostrophe.
3. At apostrophe, either finish the word when followed by space/end, or require the exact four-byte embedded-apostrophe encoding and append one apostrophe.
4. Require exactly one space between words.
5. Reject any unquoted byte, backslash sequence other than the exact apostrophe encoding, empty trailing data, NUL/CR/LF, or more/fewer than three words.
6. Regenerate quoteShellWords(decoded) and require byte-for-byte equality with input.

For statusLine, decoded words must be exactly:

~~~text
[ absolute validated nodePath,
  baseExpected.statusLineEntrypoint,
  "--config=" plus baseExpected.configPath ]
~~~

This avoids evaluating the command and makes apostrophe/space/dollar/backtick paths round-trip without shell injection.

- [ ] **Step 4: Implement exact object validation**

validateMacosManifest:

~~~text
exact MANIFEST_KEYS
schemaVersion === 1
owner === kindle-llm-dash/macos-collector
installRoot === baseExpected.installRoot
launchAgentPath === baseExpected.launchAgentPath
claudeSettingsPath === baseExpected.settingsPath
backupPath passes exact backup rule
statusLineCommand passes decodeShellWords and exact owned entrypoint/config
keychainService === KindleLLMDashboard.ingest
keychainAccount === baseExpected.currentAccount
return frozen { backupPath, statusLineCommand, nodePath }
~~~

validateMacosConfig:

~~~text
exact CONFIG_KEYS
ingestUrl passes assertAllowedIngestUrl
ingestTokenSource === macos-keychain
keychainService === fixed service
keychainAccount === current account
codexCommand is absolute executable regular non-symlink
timeoutMs === 30000
timeZone === Asia/Taipei
return frozen { ingestUrl, codexCommand }
~~~

validateMacosLaunchAgent:

~~~text
exact PLIST_KEYS
Label === fixed label
ProgramArguments deep-equals:
  [expected.nodePath, expected.uploadEntrypoint,
   "--mode=scheduled-sync", "--config=" plus expected.configPath]
EnvironmentVariables deep-equals { PATH: expected.controlledPath }
RunAtLoad === true
StartInterval === 720
KeepAlive === false
ProcessType === Background
StandardOutPath === expected.stdoutPath
StandardErrorPath === expected.stderrPath
return frozen input
~~~

- [ ] **Step 5: Implement validateInstalledState with installedExpected**

physical is:

~~~text
{
  installRootPath,
  manifestPath,
  configPath,
  launchAgentPath,
  launchAgentJsonPath,
  settingsPath
}
~~~

Algorithm:

1. lstat logical install root as a non-symlink directory.
2. read manifest/config/plist JSON through bounded regular-file readers.
3. validate manifest against baseExpected, yielding nodePath and backupPath.
4. validate config against baseExpected, yielding codexCommand and ingestUrl.
5. verify nodePath and codexCommand are executable regular non-symlinks.
6. derive controlledPath from those installed paths.
7. construct installedExpected exactly.
8. validate plist against installedExpected.
9. read settings as bounded JSON; require statusLine to be an exact object with type command, command equal installedExpected.statusLineCommand, and padding 0. Other settings keys are allowed and preserved.
10. if backupPath is non-null, lstat it as regular non-symlink and parse it as a bounded JSON object.
11. return Object.freeze(installedExpected).

Never pass desired Node, Codex, PATH, URL, or statusLine values into this function.

- [ ] **Step 6: Implement validateDesiredState with desiredExpected**

physical points to the staged install root, staged config/manifest, staged plist JSON, and staged settings. Manifest values remain the final logical paths in desiredExpected.

Algorithm:

1. lstat every physical staged parent/file as non-symlink with exact mode.
2. validate staged manifest/config against desiredExpected base values.
3. require manifest nodePath/statusLineCommand, config codexCommand/ingestUrl, and derived controlledPath to equal desiredExpected.
4. validate staged plist and staged settings.
5. validate backupPath as null or a reserved regular non-symlink at its final path.
6. emit no output and return Object.freeze(desiredExpected).

- [ ] **Step 7: Implement the only CLI operations**

The CLI accepts fixed-position individually quoted arguments, not a shell-built JSON string.

~~~text
extract-installed
  MANIFEST CONFIG PLIST_JSON INSTALL_ROOT LAUNCH_AGENT SETTINGS ACCOUNT

validate-desired
  STAGED_MANIFEST STAGED_CONFIG STAGED_PLIST_JSON STAGED_SETTINGS
  LOGICAL_INSTALL_ROOT LOGICAL_LAUNCH_AGENT LOGICAL_SETTINGS ACCOUNT
  NODE_PATH CODEX_PATH INGEST_URL BACKUP_PATH_OR_EMPTY

diagnose
  MANIFEST CONFIG PLIST_JSON INSTALL_ROOT LAUNCH_AGENT SETTINGS ACCOUNT

validate-plist-source
  PHYSICAL_PLIST
~~~

extract-installed calls validateInstalledState in the same process and prints exactly one JSON object:

~~~text
{
  backupPath,
  statusLineCommand,
  nodePath,
  codexCommand,
  controlledPath,
  ingestUrl
}
~~~

No field is printed before all state validates. The JSON contains no token. Shell reads this projection from a mode-0600 scratch file and extracts each field in one subsequent Node process that first verifies the projection has exactly those six keys.

validate-desired calls validateDesiredState and prints nothing.

validate-plist-source uses `lstat` on `PHYSICAL_PLIST`, requires an absolute normalized regular non-symlink file, mode `0600`, and size 1 through `MAX_PLIST_SOURCE_BYTES`, then prints nothing. It is the only pre-plutil source gate used by install, diagnose, and uninstall.

diagnose catches validation errors and prints exactly:

~~~text
{ "valid": true or false }
~~~

It prints no path or parsed field. Unknown operation, wrong argc, read/parse error, and validation error exit 1 with no stack trace or input echo.

- [ ] **Step 8: Add module direct-execution guard**

Use pathToFileURL(process.argv[1]).href equality. Unit-test importing the module causes no CLI execution. Unit-test each operation with spaces/apostrophes in all path arguments.

### Task 5: Route Install, Diagnose, and Uninstall Through the Exact Boundary

**Files:**

- Modify: collector/install-macos.sh
- Modify: collector/diagnose-macos.sh
- Modify: collector/uninstall-macos.sh
- Modify: tests/collectorMacos.test.mjs

- [ ] **Step 1: Convert plist before any ownership decision**

Use the configured plutil only as:

~~~sh
"$node_bin" "$state_validator" validate-plist-source "$launch_agent_path" ||
  fail 'LaunchAgent is invalid'
"$plutil_bin" -convert json -o - "$launch_agent_path" >"$plist_json_path" ||
  fail 'LaunchAgent is invalid'
chmod 600 "$plist_json_path"
~~~

plist_json_path is inside the mode-0700 scratch directory. It contains no secret and is removed on successful cleanup. Never grep plist text for ownership.

- [ ] **Step 2: Validate/extract the old installation once**

When installRoot exists:

~~~text
require manifest/config/plist/settings presence without following symlinks
-> convert plist to scratch JSON
-> run extract-installed once
-> parse exact six-key projection
-> assign installed_backup_path, installed_status_line_command,
   installed_node_path, installed_codex_path, installed_controlled_path,
   installed_ingest_url
~~~

All names use installed_ prefix. No desired_ value participates. A projection extraction failure produces a generic refusal and zero product mutation.

Presence matrix before prompt: when installRoot is absent, manifest/config beneath it must be absent and the fixed LaunchAgent plist must also be absent; an orphan plist is always foreign and rejected. Existing Claude settings may remain, but a statusLine is accepted only under the separately documented explicit fresh-install replacement rule. When installRoot exists, exact manifest, config, fixed plist, settings owned statusLine, and conditional backup must all exist and validate together. Root-only, manifest-only, config-only, plist-only, missing-settings, missing-backup, and every other partial combination reject before prompt and leave all bytes/loaded state unchanged.

- [ ] **Step 3: Build desired state separately**

After current executable preflight:

~~~text
desired_node_path = current resolved Node
desired_codex_path = current resolved Codex
desired_controlled_path = derived current PATH
desired_status_line_command = quoteShellWords(current paths)
desired_backup_path = installed backup or newly exclusive backup
desired_ingest_url = current validated CLI URL
~~~

All names use desired_ prefix. Before swap, validate-desired checks the complete staged state.

- [ ] **Step 4: Diagnose without consuming unvalidated fields**

diagnose-macos.sh computes all logical paths/current account itself. It creates a private scratch directory, converts plist only if present, and calls the validator diagnose operation.

Output fields are metadata only:

~~~text
nodeAvailable, nodeVersionClass, manifestValid, configPresent,
keychainPresent, statusLineOwned, launchAgentPresent,
launchAgentLoaded, lastUploadPresent
~~~

Rules:

- manifestValid is true only when the complete installed state validates.
- statusLineOwned is true only when exact settings validation succeeded.
- keychainPresent is queried with the fixed service and computed current account only after full installed validation. It never uses identity text from the manifest.
- launchAgentLoaded uses launchctl print with the fixed label.
- adapter operational error yields keychainPresent false plus overall diagnose exit nonzero; item absence yields false with exit zero.
- output never contains a path, URL, account, or exception text.

- [ ] **Step 5: Make destructive callers use only the exact projection**

Install replacement and uninstall must call extract-installed immediately before the first mutation. They may use only its six validated fields plus computed fixed paths. They do not parse the manifest again, require JSON as a module, or run ad hoc Node snippets against it.

- [ ] **Step 6: Verify and commit M2**

~~~powershell
node --test tests/collectorMacos.test.mjs
& "$env:ProgramFiles\Git\bin\bash.exe" -n collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh
git diff --check
git add collector/macos-install-state.mjs collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh tests/collectorMacos.test.mjs
git commit -m "Enforce exact macOS collector ownership"
~~~

Expected: all missing/extra/tampered/symlink/foreign cases fail closed, old/new runtime paths are handled separately, and no Keychain transport behavior has changed yet.

---

## Commit M3 — Security.framework and Transactional Install/Uninstall

### Task 6: Add Transaction, xtrace, TTY, Signal, and Secret-Surface Tests

**Files:**

- Modify: tests/collectorMacos.test.mjs
- Modify: tests/collectorUpload.test.mjs
- Create: tests/fixtures/run-macos-tty-interrupt.py
- Create: tests/fixtures/sanitize-macos-upload-evidence.mjs
- Create: tests/fixtures/scan-macos-secret-surfaces.mjs

- [ ] **Step 1: Add token-surface coverage**

Use sentinel SENTINEL_MAC_TOKEN_DO_NOT_LOG only as SpawnSync input. Never place it in argv or env.

~~~js
test('inherited xtrace cannot expose the stdin-only token', (t) => {
  const sentinel = 'SENTINEL_MAC_TOKEN_DO_NOT_LOG';
  const fx = macosFixture({ token: sentinel, inheritedXtrace: true });
  t.after(() => fx.cleanup());
  fx.queueFreshInstallConversions();
  fx.requirePreparedOnPut();
  const result = fx.install();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fx.plutilConversions().length, 2);
  assert.equal(fx.plutilQueueDepth(), 0);
  for (const item of fx.observableText([result])) {
    assert.equal(item.text.includes(sentinel), false, item.label);
  }
  assert.deepEqual(fx.adapterCalls().filter((call) => call.operation === 'put'), [{
    command: 'osascript',
    operation: 'put',
    service: 'KindleLLMDashboard.ingest',
    account: fx.account,
    stdinPresent: true,
    stdinBytes: Buffer.byteLength(sentinel),
  }]);
});
~~~

Add equivalent negative scans for failed put, failed bootstrap, signal exit, reinstall, diagnose, and uninstall. observableText is the only scan helper.

Add the acceptance-only upload-evidence sanitizer with this exact interface before any real-Mac use:

~~~text
node tests/fixtures/sanitize-macos-upload-evidence.mjs success
  stdin: one bounded last-upload JSON document, 1..1048576 bytes
  stdout: exactly {"status":"success","timestamp":ISO,"providers":["claude","codex"]}\n

node tests/fixtures/sanitize-macos-upload-evidence.mjs failed
  stdin: empty
  stdout: exactly {"status":"failed","timestamp":null,"providers":[]}\n

wrong argv, overflow, malformed JSON, noncanonical timestamp, missing/extra provider name:
  stdout empty; generic nonzero
~~~

The module exports `sanitizeUploadEvidence({ status, state })` and has a direct-execution guard. It selects only the three exact result keys and never serializes provider values, unknown source keys, errors, paths, or source text. Add automated tests that provide a usage-window sentinel, token/authorization-like sentinel source keys, and private-origin sentinel source value; require byte-exact allowlisted stdout and require none of the sentinels appear. Add negative tests for every generic-nonzero case and assert stdout/stderr contain no input. These tests are part of the M3 RED/green gate, so the Task 10 sanitizer schema cannot be invented or relaxed during manual acceptance.

~~~js
test('upload evidence sanitizer emits only the exact allowlist', () => {
  const source = {
    version: 2,
    collectedAt: '2026-07-13T00:00:00.000Z',
    privateOrigin: 'SENTINEL_PRIVATE_ORIGIN',
    authorization: 'SENTINEL_AUTHORIZATION',
    providers: {
      claude: { windows: { fiveHour: { usedPercent: 17 } } },
      codex: { windows: { sevenDay: { usedPercent: 23 } } },
    },
  };
  const result = spawnSync(process.execPath, [evidenceSanitizerPath, 'success'], {
    input: JSON.stringify(source),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout,
    '{"status":"success","timestamp":"2026-07-13T00:00:00.000Z","providers":["claude","codex"]}\n');
  assert.doesNotMatch(result.stdout + result.stderr,
    /SENTINEL_PRIVATE_ORIGIN|SENTINEL_AUTHORIZATION|usedPercent/);
});
~~~

Create and test one reusable stdin-only secret scanner before real-Mac acceptance:

~~~text
node tests/fixtures/scan-macos-secret-surfaces.mjs ROOT [ROOT...]
stdin: secret bytes, length 1..16384, no argv/env/file fallback
stdout on a complete scan: exactly {"filesScanned":N,"secretMatches":N}\n
exit 0 only when N >= 1 and secretMatches is 0
exit 1 when one or more regular files contain the bytes
operational/read/symlink/missing-root/invalid-input failure: generic nonzero, stdout/stderr empty
~~~

The scanner requires every root to exist without following symlinks, recursively visits every directory entry, and streams every regular file regardless of size with `createReadStream`. It retains only the final `secret.length - 1` bytes between chunks so a cross-chunk match is detected; it never loads a whole scanned file. It counts files and files-with-matches only, continues through all roots after a match, and never emits bytes or filenames. Automated tests cover empty/16,385-byte stdin rejection, exact 16,384-byte input, zero-length and multi-megabyte files, cross-chunk matches, a nested symlink refusal, missing/read-error refusal, and the exact backup passed as a separate root.

- [ ] **Step 2: Add installation failure matrix with exact conversion consumption**

Use these names for one installer invocation:

~~~text
I0 = initial installed plist conversion
D0 = staged desired plist conversion
I1 = final pre-mutation installed plist recheck
D1 = final installed-path conversion checked against desiredExpected

fresh full queue:     D0,D1       (2 entries)
reinstall full queue: I0,D0,I1,D1 (4 entries)
~~~

Every Task 6 test that invokes fresh install enqueues the full two-entry queue; every test that invokes reinstall enqueues the full four-entry queue, even when its injected failure is expected to stop early. Start reinstall cases with `installedMacosFixture`, capture valid `installed` before tampering, select the desired runtime, then call `queueReinstallConversions({ installed, desired })`. Start fresh cases with `queueFreshInstallConversions({ desired })`. Immediately before invocation capture `conversionStart = fx.plutilConversions().length`; afterward assert the exact consumed prefix and exact remaining queue depth. A test that deliberately makes a converted object malformed replaces only that named queue entry. The fake exits 74 on any unplanned extra conversion, and the installer must propagate the failure; no test or production path may catch an empty-queue result, retry, reuse the prior conversion, or synthesize fallback plist state.

| Failure point / injected timing | Fresh consumed; remaining | Reinstall consumed; remaining | Required result |
| --- | --- | --- | --- |
| URL/path/executable preflight | none; 2 | none; 4 | no prompt, scratch, adapter, launchctl, or mutation |
| initial plist source/lint rejection | not applicable | none; 4 | no mutation; plutil conversion is never called |
| initial plutil operational failure before queue claim | not applicable | none; 4 | no mutation; failure is propagated |
| initial converted object rejected by extract-installed | not applicable | I0; 3 | no mutation |
| backup exclusive creation | none; 2 | not applicable | exact original absence/state |
| staged source/lint rejection | none; 2 | I0; 3 | exact previous state |
| staged plutil operational failure before queue claim | none; 2 | I0; 3 | exact previous state; failure is propagated |
| staged converted object/config/manifest/settings rejection | D0; 1 | I0,D0; 2 | exact previous state |
| second launch-state query mismatch/error | D0; 1 | I0,D0; 2 | zero product mutation |
| final pre-mutation plist source/lint rejection | D0; 1 (no prior-plist call exists) | I0,D0; 2 | zero product mutation |
| final pre-mutation plutil failure before queue claim | D0; 1 (no prior-plist call exists) | I0,D0; 2 | zero product mutation; failure is propagated |
| final pre-mutation installed object/snapshot mismatch | D0; 1 (fresh absence/settings recheck) | I0,D0,I1; 1 | zero product mutation |
| old LaunchAgent bootout | not applicable | I0,D0,I1; 1 | exact previous loaded state or rollback-failed result |
| install-root swap | D0; 1 | I0,D0,I1; 1 | old install restored |
| settings atomic replace | D0; 1 | I0,D0,I1; 1 | old settings or exact absence restored |
| plist swap | D0; 1 | I0,D0,I1; 1 | old plist or exact absence restored |
| new LaunchAgent bootstrap | D0; 1 | I0,D0,I1; 1 | files/settings/root and prior loaded state restored |
| final installed-path plutil failure before queue claim | D0; 1 | I0,D0,I1; 1 | all prepared product state rolls back; failure is propagated |
| final installed-path object rejected against desiredExpected | D0,D1; 0 | I0,D0,I1,D1; 0 | all prepared product state rolls back |
| final Keychain put | D0,D1; 0 | I0,D0,I1,D1; 0 | prior Keychain presence and prior product state are preserved |
| rollback bootout/bootstrap/rename failure | same prefix as its triggering primary failure | same prefix as its triggering primary failure | exit 2, generic rollback-incomplete message, scratch retained, no blind deletion |
| INT/HUP/TERM before prompt | none; 2 | I0; 3 | matching 130/129/143 exit and no mutation |
| INT/HUP/TERM after staged validation but before mutation | D0; 1 | I0,D0; 2 | same rollback as ordinary failure |
| INT/HUP/TERM during product preparation | D0; 1 | I0,D0,I1; 1 | same rollback as the matching preparation failure |
| signal after Keychain mutation but before adapter return | D0,D1; 0 | I0,D0,I1,D1; 0 | committed product state is not rolled back |

Fresh install has no physical prior plist to re-convert: its final pre-mutation gate rechecks exact absence and settings bytes after D0, leaving D1 queued. Use fake command failure flags for adapter/launchctl/plutil failures. Use macOS-only filesystem cases for rename/mode failures. Do not add production file-operation seams.

Each row ends with these assertions, with `expectedPrefix` and `fullQueueLength` taken from the table:

~~~js
const calls = fx.plutilConversions().slice(conversionStart);
assert.equal(calls.length, expectedConsumedCount);
assert.equal(fx.plutilQueueDepth(), fullQueueLength - expectedConsumedCount);
assert.notEqual(result.status, 0);
assert.deepEqual(fx.ownedSnapshot(), expectedOwnedSnapshot);
~~~

The queue order itself establishes the consumed prefix; conversion logs contain paths/operation metadata only and never plist content. The owned-snapshot equality assertion applies to every fail-before-commit row whose rollback completes. Rollback-incomplete rows instead assert the exact retained recovery state, and signal-after-Keychain-mutation rows assert the complete desired snapshot. Successful fresh and reinstall controls assert conversion counts two and four respectively, queue depth zero, and status zero.

- [ ] **Step 3: Prove loaded/unloaded restoration**

Run each reinstall failure twice:

~~~text
case A: initialLaunchLoaded true  -> rollback ends loaded
case B: initialLaunchLoaded false -> rollback ends unloaded
~~~

For a fresh failed install, rollback ends unloaded and no plist exists. For a successful install, LaunchAgent is loaded. Re-running rollback cleanup after the first failure makes no further change and must not invoke a second destructive command.

- [ ] **Step 4: Add real pseudo-TTY interruption test**

tests/fixtures/run-macos-tty-interrupt.py has this exact protocol:

~~~text
argv: INSTALL_SCRIPT plus non-secret installer arguments
environment: receives only fixture paths and fake-command seams
stdout: one JSON object
exit: zero only when all assertions pass

result:
{
  "promptSeen": true,
  "echoBefore": true,
  "echoDisabledAtPrompt": true,
  "echoAfter": true,
  "childExit": 130
}
~~~

Implementation uses only os, pty, select, signal, subprocess, sys, termios, time, and json from Python 3 standard library:

1. pty.openpty.
2. Read ECHO flag from slave with termios.tcgetattr.
3. Popen installer with stdin/stdout/stderr attached to slave and start_new_session true.
4. Read master with select until Dashboard ingest token prompt, with a 10-second monotonic deadline.
5. Assert slave ECHO is now disabled.
6. os.killpg(child.pid, signal.SIGINT) without sending a token.
7. Wait at most 10 seconds; kill and fail on timeout.
8. Assert ECHO is restored on slave and child return code maps to 130.
9. Emit the exact JSON object. Never echo pty content.

The Node test runs this helper only when process.platform is darwin. Windows/Linux record a named skip; source/shell tests still run there.

- [ ] **Step 5: Add runtime Keychain-read regressions**

In tests/collectorUpload.test.mjs, use the existing resolveIngestToken dependency injection:

- /usr/bin/security argv contains only find-generic-password, -w, fixed service, -a, current account;
- stdout becomes Node memory return value only;
- stderr/stdout from a failed command never enters the thrown error;
- successful upload logs, request diagnostics, config, and state do not contain the token;
- empty stdout, nonzero status, wrong source, missing service, and wrong platform all produce only Collector ingest credential is unavailable.

Do not change the allowed runtime read into the write/delete adapter. The adapter intentionally never returns the password.

- [ ] **Step 6: Run and confirm RED**

~~~powershell
node --test --test-name-pattern="xtrace|transaction|rollback|TTY|signal|Keychain" tests/collectorMacos.test.mjs tests/collectorUpload.test.mjs
~~~

Expected: the current installer leaks the token through security argv, reads the prior password, mutates Keychain before files, does not model loaded state, and has incomplete rollback failure handling.

### Task 7: Implement the Bounded JXA Security.framework Adapter

**Files:**

- Create: collector/macos-keychain-adapter.js
- Modify: tests/collectorMacos.test.mjs
- Modify: .github/workflows/ci.yml

**CLI contract:**

~~~text
/usr/bin/osascript -l JavaScript macos-keychain-adapter.js OP SERVICE ACCOUNT

OP put:
  stdin length 1..16384 bytes
  stdout empty
  success 0; generic nonzero on any failure

OP exists:
  stdin unused
  stdout exactly true or false
  success 0 for both present and absent
  generic nonzero only for operational failure

OP delete:
  stdin unused
  stdout empty
  success 0 when deleted or already absent
  generic nonzero on operational failure
~~~

- [ ] **Step 1: Implement fixed identity and current-account checks**

At run entry require exactly three argv values. Require service to equal KindleLLMDashboard.ingest. Derive the process's current account inside JXA with Foundation NSUserName and ObjC.unwrap. Require the supplied account to equal that exact value and reject empty/NUL/CR/LF. This cross-check is mandatory even though the shell computed the account.

All caught errors become one generic keychain operation failed error. No query, account, status detail, NSData, or input is returned.

- [ ] **Step 2: Build only generic-password queries**

Private functions:

~~~text
dictionary(entries) -> NSMutableDictionary
baseQuery(service, account) -> kSecClassGenericPassword query
boundedStdinData() -> NSData with 1..16384 bytes
put(query) -> void
exists(query) -> boolean
remove(query) -> void
run(argv) -> empty string or "true"/"false"
~~~

baseQuery includes exactly kSecClass, kSecAttrService, and kSecAttrAccount. Add uses kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly. Update/delete queries do not broaden service/account.

- [ ] **Step 3: Bound stdin before Security.framework mutation**

Use a bounded loop, never `readDataToEndOfFile`: allocate one `NSMutableData`, then repeatedly call `readDataOfLength(MAX_SECRET_BYTES + 1 - total)`. Zero bytes means EOF; otherwise append, recompute total, and reject immediately above 16,384. When total reaches 16,384, perform one final one-byte read to distinguish exact length from overflow. The function accepts only final total 1 through 16,384. No single read or aggregate allocation exceeds 16,385 bytes. Never convert NSData to NSString/JavaScript string and never write it to a file or output.

The macOS bridge gate in Step 6 pipes fragmented writes, exact 16,384 bytes, and 16,385 bytes to prove the loop handles partial pipe reads and EOF deterministically; any mismatch blocks the PR rather than relaxing the limit.

- [ ] **Step 4: Implement atomic create-or-update**

Use SecItemUpdate first. On errSecItemNotFound, construct an add dictionary from a mutable copy of the exact query plus kSecValueData and accessibility, then call SecItemAdd. On errSecDuplicateItem, retry the exact SecItemUpdate once to close the create race. Any other status fails.

There is one Security.framework item mutation per successful path. The adapter never reads the old value and provides no rollback API.

- [ ] **Step 5: Implement a true boolean exists bridge**

Copy the exact query, add kSecMatchLimitOne and kSecReturnAttributes true, allocate a JXA Ref result, and call SecItemCopyMatching.

~~~text
errSecSuccess      -> return true
errSecItemNotFound -> return false
anything else      -> generic failure
~~~

Do not implement exists as an exception for absence. Do not use the command's stdout password. The result reference is used only to prove the Security.framework bridge call completed; its attributes are never serialized or returned.

remove calls SecItemDelete with the exact query. Success and item-not-found are success; every other status fails.

- [ ] **Step 6: Add the required macOS true/false bridge gate**

In the existing macos-test-build job, after npm ci and before npm test:

1. Enable fail-fast shell behavior, set xtrace off, and compute account with /usr/bin/id -un.
2. Register fixed-status EXIT/HUP/INT/TERM cleanup handlers that call adapter delete with fixed service/current account and discard output.
3. Call delete once to establish absence on the ephemeral runner; call exists and require exact stdout false.
4. Pipe 32 random bytes encoded by a Node process directly to adapter put. The secret is never assigned to a shell variable, argv, env, file, or log. Require exists exact true.
5. Pipe a deterministic 4,097-byte producer that writes 257-byte chunks on separate `setImmediate` turns, with a final short chunk. Require put success and exists exact true. This is the fragmented-producer proof; one read per logical input is not acceptable.
6. Pipe exactly 16,384 deterministic bytes to put. Require success and exists exact true.
7. Pipe zero bytes to put. Require failure and exists still exact true, proving prior presence was not deleted.
8. Pipe exactly 16,385 deterministic bytes to put. Require failure and exists still exact true, proving the rejected overflow did not replace/delete the prior item.
9. In the Security.framework call-spy test, assert zero-byte and 16,385-byte inputs cause zero SecItemUpdate/SecItemAdd calls; this proves prior bytes are untouched without reading them back from Keychain.
10. Pass wrong service and wrong account; require generic failure and exists still exact true.
11. Call delete; require success; call exists and require exact stdout false.
12. Run cleanup again to prove idempotence and require the workflow step exits zero only after every assertion.

This is not a syntax-only test. PR 3 cannot merge if the real Security.framework put/true-exists/delete/false-exists sequence is not green on the recorded macOS runner.

### Task 8: Implement the Installation State Machine and Idempotent Trap

**Files:**

- Modify: collector/install-macos.sh
- Modify: tests/collectorMacos.test.mjs

- [ ] **Step 1: Disable inherited xtrace before reading any input**

Immediately after set -eu:

~~~sh
case "$-" in
  *x*) set +x ;;
esac
~~~

Do not restore xtrace. The installer is a subprocess, and restoring it creates no user benefit. Tests invoke bash -x and require the sentinel to remain absent from stderr and fake logs.

- [ ] **Step 2: Initialize every trap variable before installing traps**

After preflight computes logical paths but before prompt, scratch creation, lstat-changing operation, stty, launchctl, Keychain, or product mutation, initialize every variable:

~~~sh
terminal_echo_disabled=0
cleanup_started=0
transaction_committed=0
rollback_failed=0
scratch_root=''
new_install_root=''
old_install_root=''
new_plist_path=''
old_plist_path=''
old_settings_path=''
new_settings_path=''
created_backup_path=''
installed_projection_path=''
installed_plist_json_path=''
desired_plist_json_path=''
settings_existed=0
old_install_present=0
old_install_moved=0
new_install_placed=0
old_plist_present=0
old_plist_moved=0
new_plist_placed=0
settings_snapshot_created=0
new_settings_placed=0
new_launch_bootstrapped=0
launch_was_loaded=0
launch_state_checked=0
backup_created=0
ingest_token=''
~~~

No trap reads an uninitialized variable under set -u.

- [ ] **Step 3: Install terminal, signal, and EXIT traps**

Define:

~~~text
restore_terminal
  if terminal_echo_disabled is 1, run stty echo; on failure set rollback_failed
  set terminal_echo_disabled to 0 unconditionally

rollback_install
  reverse only operations whose flags are 1
  continue through all restoration steps
  mark rollback_failed on any failed step
  never delete scratch when rollback_failed is 1

on_exit(original_status)
  clear EXIT/HUP/INT/TERM traps first
  if cleanup_started is already 1, exit original_status
  set cleanup_started 1 and set +e
  restore terminal
  when transaction_committed is 0, call rollback_install
  clear ingest_token
  when committed or rollback succeeded, best-effort remove ingest-token-free private scratch without printing its path/content
  if rollback_failed is 1, print one generic rollback incomplete line and exit 2
  otherwise exit original_status

on_hup -> exit 129
on_int -> exit 130
on_term -> exit 143
~~~

Install all four traps before stty -echo. rollback_install is idempotent because each completed reverse step clears its corresponding flag before attempting the next step. A second entry sees no active flags.

- [ ] **Step 4: Create private scratch and validate old state before prompting**

Create scratch with mktemp -d under HOME/Library/Application Support, require
its lstat type directory/non-symlink, chmod 0700, convert the existing plist
when present, and run extract-installed. Record exact old root/plist/settings
presence and launchctl loaded state. An invalid old state or launchctl
operational error exits before a token prompt and before product mutation.

The fixture supplies `KINDLE_LLM_TEST_MODE=1` plus a deterministic `KINDLE_LLM_SCRATCH_PARENT`. The script honors the parent only when test mode is exactly `1` and `osascript`, `launchctl`, `plutil`, `id`, and Node paths all resolve below the fixture root; otherwise it ignores both variables and uses the computed Application Support parent. This lets the token-blind fake validate the uninstaller's copied adapter path without weakening the real computed scratch boundary.

Then prompt through the real TTY boundary:

~~~text
print prompt to stderr
if stdin is a TTY:
  stty -echo
  set terminal_echo_disabled 1 only after success
read one line with IFS= read -r
restore terminal immediately
print one newline to stderr only for TTY
require nonempty token
require UTF-8 byte length 1..16384 through Node without putting token in argv
~~~

For the byte-length check, pipe printf %s of the shell variable into a fixed Node -e program that reads fd 0 with a 16,385-byte maximum. xtrace is already disabled. Do not use command substitution that captures the token.

- [ ] **Step 5: Build all new state in the validated private scratch**

Build:

~~~text
scratch/new-install               complete new install tree
scratch/new-settings.json         complete next settings
scratch/new-launch-agent.plist    complete next plist
scratch/desired-plist.json        plutil conversion
scratch/old-settings.json         exact byte snapshot if settings existed
scratch/installed-state.json      exact safe projection on reinstall
scratch/installed-plist.json      converted old plist on reinstall
~~~

All scratch regular files are 0600. The token never enters scratch.

For a fresh install with existing settings, reserve the persistent backup with exclusive creation, copy exact settings bytes, chmod 0600, lstat-verify, and set backup_created only after success. For reinstall, reuse only installedExpected.backupPath.

Build new settings by preserving all current non-statusLine keys and setting the exact desired statusLine. If a foreign statusLine exists on fresh install, require the explicit replace flag. If an installation manifest already exists, a foreign/missing owned statusLine is an ownership failure even when replace is supplied.

- [ ] **Step 6: Validate desired staged state before swap**

Run plutil -lint on staged plist, convert it to desired-plist JSON, then call validate-desired with physical staged paths and logical final values. requirePreparedOnPut in the fake confirms config, manifest, settings, plist, and logs exist at their final paths before put, but desired validation happens while staged.

- [ ] **Step 7: Reconfirm the prior LaunchAgent loaded state**

Immediately before the first product mutation, query again:

~~~text
launchctl print fixed gui UID/label success -> launch_was_loaded 1
documented not-found status -> launch_was_loaded 0
other operational error -> fail before mutation
~~~

Require the result to equal the state recorded before the prompt; otherwise
fail and clean scratch/created backup. Do not infer loaded state from plist
presence. The fake and macOS tests cover both states.

Immediately after this launch-state check and immediately before bootout, run `validate-plist-source`, convert the physical plist again, and run `extract-installed` again. Require the six-key projection to byte-equal the first projection; require fresh lstat identity/size/mode plus SHA-256 for manifest, config, plist, settings, and non-null backup to equal the first snapshot. Any difference exits with zero product mutation. Fresh installs re-check that installRoot and plist remain absent and that current settings still equal the first snapshot. This is the final pre-mutation gate and consumes the second installed plist queue entry on reinstall.

- [ ] **Step 8: Perform product preparation in this exact order**

~~~text
1. bootout old owned LaunchAgent only when launch_was_loaded is 1
2. when present, move old installRoot to scratch/old-install; set old_install_moved
3. move staged new-install to logical installRoot; set new_install_placed
4. when present, move old plist to scratch/old-plist; set old_plist_moved
5. move staged plist to logical plist; set new_plist_placed
6. after preserving the old bytes/absence, atomically replace settings;
   set new_settings_placed
7. bootstrap new LaunchAgent; set new_launch_bootstrapped
8. re-run complete installed-state extraction against final paths
9. require its safe projection to equal desiredExpected
10. pipe ingest_token to adapter put
11. clear ingest_token
12. set transaction_committed 1
~~~

If there was no old installRoot/plist/settings, flags record exact prior absence. Do not use rm -rf on a logical product path during rollback; move newly placed state into scratch, then restore old state or absence.

- [ ] **Step 9: Make Keychain put the final product commit**

Invocation:

~~~sh
trap '' HUP INT TERM
if ! printf '%s' "$ingest_token" |
  "$osascript_bin" -l JavaScript "$keychain_adapter" \
    put "$keychain_service" "$keychain_account" >/dev/null; then
  ingest_token=''
  trap on_hup HUP
  trap on_int INT
  trap on_term TERM
  fail 'Unable to store the ingest token'
fi
ingest_token=''
transaction_committed=1
trap on_hup HUP
trap on_int INT
trap on_term TERM
~~~

There is no old-password read and no Keychain rollback branch. Failure is atomic and triggers file/settings/LaunchAgent rollback. After transaction_committed becomes 1, do only best-effort scratch deletion and print the fixed installed JSON result.

Ignoring HUP/INT/TERM only across the external atomic mutation and the adjacent
commit-flag assignment closes the otherwise unavoidable signal gap. The fake
adapter sends each signal after mutating but before returning; all three cases
must commit without file rollback. The same signals before this boundary still
produce 129/130/143 and rollback.

- [ ] **Step 10: Implement reverse rollback exactly**

Rollback order:

~~~text
new_launch_bootstrapped -> bootout new, clear flag on success
new_settings_placed     -> move current new settings to scratch;
                           restore snapshot when settings_existed,
                           otherwise restore exact absence
new_plist_placed        -> move new plist to scratch
old_plist_moved         -> restore exact old plist
new_install_placed      -> move new root to scratch
old_install_moved       -> restore exact old root
backup_created          -> move created backup to scratch
launch_was_loaded       -> bootstrap restored old plist
prior unloaded          -> require fixed label remains unloaded
~~~

If any reverse operation fails:

- continue remaining safe reverse operations;
- set rollback_failed;
- retain scratch;
- do not retry the failed destructive step automatically;
- exit 2 with no private path or command output;
- report manual recovery is required in the phase handoff.

### Task 9: Make Diagnose and Uninstall Use the Adapter, Then Make Uninstall Transactional

**Files:**

- Modify: collector/diagnose-macos.sh
- Modify: collector/uninstall-macos.sh
- Modify: tests/collectorMacos.test.mjs
- Modify: docs/MACOS-COLLECTOR.md

- [ ] **Step 1: Route diagnose through boolean exists**

After exact installed-state validation, call adapter exists with fixed service and computed current account.

~~~text
stdout true  -> keychainPresent true
stdout false -> keychainPresent false
other stdout or nonzero -> operational failure; generic stderr and diagnose nonzero
~~~

Never treat an adapter bridge error as simple absence. Never use service/account read from raw manifest.

- [ ] **Step 2: Add uninstall transaction tests before implementation**

For an installed fixture with user-edited non-statusLine settings, assert successful uninstall:

- preserves all current non-statusLine keys;
- restores only the original statusLine from backup, or removes it if original had none;
- removes owned install root, plist, persistent backup, and Keychain item;
- leaves LaunchAgent unloaded;
- emits no token/private state.

Failure matrix:

| Failure point | Required result |
| --- | --- |
| exact extraction/tamper/symlink/foreign settings | zero mutation |
| bootout | exact prior state or rollback-incomplete |
| settings restoration | old installed state restored |
| move plist/root/backup to scratch | all moved resources restored |
| final adapter delete | Keychain remains present; files/settings/loaded state restored |
| delete when item already absent | commit succeeds |
| rollback bootstrap/rename failure | exit 2, scratch retained, no foreign deletion |
| repeated uninstall after success | alreadyAbsent true and no adapter delete |

Queue exactly two installed plist conversions: initial extraction and final pre-mutation recheck. Capture ownedSnapshot before every failure and compare after rollback.

- [ ] **Step 3: Initialize a separate uninstall trap/state machine**

uninstall-macos.sh uses the same trap discipline but separate names:

~~~text
cleanup_started, uninstall_committed, rollback_failed, scratch_root,
launch_was_loaded, launch_booted_out, settings_swapped,
plist_moved, install_root_moved, backup_moved
~~~

Initialize all before traps. Disable inherited xtrace. Trap HUP/INT/TERM with 129/130/143. No token variable exists in uninstall.

- [ ] **Step 4: Validate and stage uninstall without deleting product state**

Order:

~~~text
1. compute fixed paths/current account
2. if root and plist are both absent, print alreadyAbsent and exit 0
3. create private scratch and stable copy of adapter
4. convert plist and extract installedExpected in one validator process
5. re-check exact settings ownership and lstat backup
6. build staged restored settings:
   preserve current non-statusLine keys;
   restore backup's original statusLine if it had one;
   otherwise remove statusLine
7. validate staged settings JSON and modes
8. record launch_was_loaded using launchctl print
~~~

The adapter is copied into scratch before installRoot can move, so delete remains available even when uninstall is invoked from a path inside installRoot. Require source adapter to be a regular non-symlink and copy mode 0600.

Immediately before Step 5, run `validate-plist-source`, convert the physical plist again, rerun `extract-installed`, and require the projection plus lstat identity/size/mode/SHA-256 of manifest, config, plist, settings, and backup to equal the initial snapshot. Re-query loaded state and require equality. Any mismatch removes only new scratch and exits before bootout/settings/move/delete.

- [ ] **Step 5: Prepare absence/restoration, then delete Keychain last**

Exact product order:

~~~text
1. bootout only when launch_was_loaded
2. atomically replace settings with staged restored settings
3. move plist to scratch/old-plist
4. move installRoot to scratch/old-install
5. move non-null backup to scratch/old-backup
6. verify logical root/plist/backup absence and restored settings
7. call adapter delete with fixed service/current account
8. set uninstall_committed 1
~~~

Adapter delete treats item-not-found as success. Any operational failure happens before commit and triggers exact reverse restoration. After commit, only best-effort scratch deletion and fixed JSON output remain.

As with install, temporarily ignore HUP/INT/TERM for only the adapter delete plus
the adjacent uninstall_committed assignment, then restore the handlers. Fake
delete sends each signal after deletion but before return to prove no
post-Keychain file rollback can occur.

- [ ] **Step 6: Roll back uninstall in exact reverse order**

~~~text
backup_moved      -> restore exact backup
install_root_moved-> restore exact install root
plist_moved       -> restore exact plist
settings_swapped  -> restore exact pre-uninstall settings bytes
launch_was_loaded -> bootstrap exact restored plist
prior unloaded    -> leave unloaded
~~~

Clear each flag only after successful restoration. Continue safe steps after a failure, retain scratch, and exit 2. Never issue Keychain put as uninstall rollback because delete failure is atomic and occurs before commit; after delete success there are no product mutations to fail.

- [ ] **Step 7: Verify and commit M3**

~~~powershell
node --test tests/collectorMacos.test.mjs tests/collectorUpload.test.mjs
& "$env:ProgramFiles\Git\bin\bash.exe" -n collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh
git diff --check
git add collector/macos-keychain-adapter.js collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh collector/lib/collectorSecret.mjs tests/collectorMacos.test.mjs tests/collectorUpload.test.mjs tests/fixtures/run-macos-tty-interrupt.py tests/fixtures/sanitize-macos-upload-evidence.mjs tests/fixtures/scan-macos-secret-surfaces.mjs .github/workflows/ci.yml docs/MACOS-COLLECTOR.md
git commit -m "Secure macOS Keychain transactions"
~~~

Expected: M3 is independently revertible; every automated security/transaction contract is green; real-Mac product acceptance remains outstanding and Beta.

---

## Task 10: Execute the Exact Real-Mac Beta Acceptance

**Files:**

- Modify: docs/MACOS-COLLECTOR.md
- Create during acceptance only: an untracked, credential-free evidence directory outside the repository

**Authority and safety:**

- A real-Mac run immediately after PR 3 is optional preliminary evidence only. It is labeled `PRELIMINARY_PR3`, cannot satisfy Phase 4, cannot change macOS Beta status, and uses a clean checkout at the separately approved PR 3 head/merge SHA.
- The normative sequence below runs as `PHASE4_FINAL` only after PR 10 is merged, its final 40-character merge SHA is explicitly approved by the user, and the clean checkout HEAD byte-equals that approved SHA. PR 3 code plus preliminary evidence is insufficient.
- If a real Mac is unavailable, the checkout is dirty, the approved final PR 10 merge SHA is unavailable/invalid, or HEAD differs, record `NOT RUN — macOS remains Beta` and stop before Step 2. Do not substitute another branch, PR head, deployment SHA, or local commit.
- Use a disposable standard macOS user with an unlocked login Keychain. Never use the user's primary account.
- Do not record the typed ingest token, authenticated URL, browser cookie, shell environment dump, or full process environment.
- Keep macOS labeled Beta whether this gate is unperformed, preliminary, or partially performed. A `PHASE4_FINAL` pass supports only the recorded version/architecture and does not promote general support.

- [ ] **Step 1: Record immutable test identity**

Start a clean terminal, disable xtrace, set umask 077, and validate Phase 4 authority before creating scratch, touching Keychain, or mutating product state. The approved SHA is non-secret but must come from the user-approved Phase 4 handoff:

~~~sh
set -eu
set +x
umask 077
printf '%s' 'Approved final PR 10 merge SHA (40 lowercase hex): ' >&2
IFS= read -r approved_final_pr10_sha
case "$approved_final_pr10_sha" in
  *[!0-9a-f]*|'') exit 1 ;;
esac
test "${#approved_final_pr10_sha}" -eq 40
test -z "$(git status --porcelain --untracked-files=all)"
actual_head=$(git rev-parse HEAD)
test "$actual_head" = "$approved_final_pr10_sha"
run_class='PHASE4_FINAL'
evidence_root="$HOME/macos-beta-evidence-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$evidence_root"
printf '%s\n' "$run_class" >"$evidence_root/run-class.txt"
printf '%s\n' "$approved_final_pr10_sha" >"$evidence_root/approved-final-pr10-sha.txt"
sw_vers >"$evidence_root/sw-vers.txt"
/usr/bin/uname -a >"$evidence_root/uname.txt"
/usr/bin/uname -m >"$evidence_root/architecture.txt"
/usr/bin/id -un >"$evidence_root/account.txt"
git rev-parse HEAD >"$evidence_root/git-head.txt"
node --version >"$evidence_root/node-version.txt"
codex --version >"$evidence_root/codex-version.txt"
claude --version >"$evidence_root/claude-version.txt"
~~~

Confirm `git-head.txt`, `approved-final-pr10-sha.txt`, and the approved Phase 4 SHA are identical; the checkout remains clean because evidence is outside it. Confirm Node is 20.9 or newer and official Codex/Claude Code commands work for the disposable account. Any failed assertion is `NOT RUN`, not FAIL/PASS, because no acceptance operation has started; retain macOS Beta.

- [ ] **Step 2: Run the adapter bridge independently**

This proves the actual JXA/Security.framework bridge, including true and false exists. Random values flow directly between processes and are never assigned to shell variables:

~~~sh
set -eu
set +x
account=$(/usr/bin/id -un)
adapter="$PWD/collector/macos-keychain-adapter.js"
service='KindleLLMDashboard.ingest'
cleanup_adapter() {
  /usr/bin/osascript -l JavaScript "$adapter" delete "$service" "$account" >/dev/null 2>&1 || true
}
bridge_exit() {
  bridge_status=$?
  trap - EXIT HUP INT TERM
  cleanup_adapter
  exit "$bridge_status"
}
bridge_signal_exit() {
  bridge_status=$1
  trap - EXIT HUP INT TERM
  cleanup_adapter
  exit "$bridge_status"
}
trap bridge_exit EXIT
trap 'bridge_signal_exit 129' HUP
trap 'bridge_signal_exit 130' INT
trap 'bridge_signal_exit 143' TERM
cleanup_adapter

test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = false
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" |
  /usr/bin/osascript -l JavaScript "$adapter" put "$service" "$account" >/dev/null
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = true

node -e "
let remaining = 4097;
function writeChunk() {
  if (remaining === 0) return;
  const length = Math.min(257, remaining);
  remaining -= length;
  process.stdout.write(Buffer.alloc(length, 0x66), () => setImmediate(writeChunk));
}
writeChunk();
" | /usr/bin/osascript -l JavaScript "$adapter" put "$service" "$account" >/dev/null
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = true

node -e "process.stdout.write('e'.repeat(16384))" |
  /usr/bin/osascript -l JavaScript "$adapter" put "$service" "$account" >/dev/null
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = true

if printf '' |
  /usr/bin/osascript -l JavaScript "$adapter" put "$service" "$account" >/dev/null 2>&1; then
  exit 1
fi
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = true

if node -e "process.stdout.write('x'.repeat(16385))" |
  /usr/bin/osascript -l JavaScript "$adapter" put "$service" "$account" >/dev/null 2>&1; then
  exit 1
fi
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = true

if printf 'x' |
  /usr/bin/osascript -l JavaScript "$adapter" put 'wrong.service' "$account" >/dev/null 2>&1; then
  exit 1
fi
if printf 'x' |
  /usr/bin/osascript -l JavaScript "$adapter" put "$service" 'wrong-account' >/dev/null 2>&1; then
  exit 1
fi
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = true

cleanup_adapter
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = false
trap - EXIT HUP INT TERM
exit 0
~~~

Record only PASS/FAIL and command exit codes, never random input or Security.framework object output. `set -eu` makes every unexpected command failure fail closed. EXIT always deletes the disposable item while preserving the failing status; HUP/INT/TERM each delete it and exit exactly 129/130/143 rather than returning to the interrupted sequence.

- [ ] **Step 3: Install from a scrubbed PATH through a real TTY**

Resolve non-secret paths:

~~~sh
node_path=$(command -v node)
codex_path=$(command -v codex)
node_dir=$(dirname "$node_path")
dashboard_origin=$(
  printf '%s' 'Canonical private dashboard HTTPS origin (no path/query/token): ' >&2
  IFS= read -r origin_input
  printf '%s' "$origin_input" |
    "$node_path" -e '
const fs = require("node:fs");
const value = fs.readFileSync(0, "utf8");
let parsed;
try { parsed = new URL(value); } catch { process.exit(1); }
if (
  !value ||
  parsed.protocol !== "https:" ||
  parsed.username ||
  parsed.password ||
  parsed.pathname !== "/" ||
  parsed.search ||
  parsed.hash ||
  value !== parsed.origin
) process.exit(1);
process.stdout.write(parsed.origin);
'
)
test -n "$dashboard_origin"
~~~

The validator receives the candidate through stdin only. Exact equality with `URL.origin` rejects whitespace, trailing slash, non-default spelling/port normalization, credentials, path, query, and fragment; the canonical private origin remains only in process memory and is never written to evidence.

Run installer in the foreground with a scrubbed environment. The installer prompts for the disposable ingest token through the TTY; paste it only at that prompt:

~~~sh
env -i \
  HOME="$HOME" \
  USER="$account" \
  PATH="$node_dir:/usr/bin:/bin:/usr/sbin:/sbin" \
  /bin/sh collector/install-macos.sh \
    --ingest-url "$dashboard_origin/api/usage" \
    --codex-command "$codex_path"
~~~

Do not use echo, command-line token flags, environment token variables, or a token file. Record installer exit code and fixed JSON output only. Step 4 follows immediately; before its scan, only the fail-closed read-only checks needed to identify and validate the exact backup may run.

- [ ] **Step 4: Verify installed ownership and Keychain metadata**

Run:

~~~sh
install_root="$HOME/Library/Application Support/KindleLLMDashboard"
launch_agent_path="$HOME/Library/LaunchAgents/com.kindle-llm-dashboard.sync.plist"
settings_path="$HOME/.claude/settings.json"
/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account"
/bin/launchctl print "gui/$(/usr/bin/id -u)/com.kindle-llm-dashboard.sync" \
  >"$evidence_root/launchctl-after-install.txt"
/bin/sh collector/diagnose-macos.sh >"$evidence_root/diagnose-after-install.json"
/usr/bin/plutil -lint "$HOME/Library/LaunchAgents/com.kindle-llm-dashboard.sync.plist" \
  >"$evidence_root/plutil-lint.txt"

backup_path=$("$node_path" -e '
const fs = require("node:fs");
const path = require("node:path");
const manifestPath = process.argv[1];
const expected = ["backupPath", "claudeSettingsPath", "installRoot", "keychainAccount",
  "keychainService", "launchAgentPath", "owner", "schemaVersion", "statusLineCommand"];
const manifestStat = fs.lstatSync(manifestPath);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) process.exit(1);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expected)) process.exit(1);
if (typeof manifest.backupPath !== "string" || !path.isAbsolute(manifest.backupPath)) process.exit(1);
const backupStat = fs.lstatSync(manifest.backupPath);
if (!backupStat.isFile() || backupStat.isSymbolicLink() || (backupStat.mode & 0o777) !== 0o600) process.exit(1);
process.stdout.write(manifest.backupPath);
' "$install_root/install-manifest.json")
test -n "$backup_path"

surface_scanner="$PWD/tests/fixtures/scan-macos-secret-surfaces.mjs"
test -f "$surface_scanner"
test ! -L "$surface_scanner"
scan_echo_disabled=0
restore_scan_terminal() {
  if [ "$scan_echo_disabled" -eq 1 ]; then stty echo >/dev/null 2>&1 || true; fi
  scan_echo_disabled=0
}
scan_signal_exit() {
  scan_signal_status=$1
  trap - EXIT HUP INT TERM
  restore_scan_terminal
  exit "$scan_signal_status"
}
scan_token_surfaces() {
  scan_label=$1
  case "$scan_label" in
    initial-install|normal-reinstall|failed-put-attempt|final-installed) ;;
    *) return 1 ;;
  esac
  set +x
  trap restore_scan_terminal EXIT
  trap 'scan_signal_exit 129' HUP
  trap 'scan_signal_exit 130' INT
  trap 'scan_signal_exit 143' TERM
  printf '%s' 'Re-enter the just-used disposable token for immediate absence scan: ' >&2
  stty -echo
  scan_echo_disabled=1
  if ! IFS= read -r scan_token; then
    restore_scan_terminal
    trap - EXIT HUP INT TERM
    return 1
  fi
  restore_scan_terminal
  trap - EXIT HUP INT TERM
  printf '\n' >&2
  scan_status=0
  printf '%s' "$scan_token" |
    "$node_path" "$surface_scanner" \
      "$install_root" "$launch_agent_path" "$settings_path" \
      "$backup_path" "$evidence_root" \
      >"$evidence_root/secret-scan-$scan_label.json" || scan_status=$?
  scan_token=''
  unset scan_token
  test "$scan_status" -eq 0
}

scan_token_surfaces initial-install
~~~

Require exists true, diagnose success with manifestValid/configPresent/keychainPresent/statusLineOwned/launchAgentPresent/launchAgentLoaded all true, StartInterval 720, RunAtLoad true, KeepAlive false, absolute ProgramArguments, controlled PATH, and private diagnostic paths. `backup_path` is consumed only after canonical diagnose succeeds and is used solely as an explicit scanner root; this evidence helper makes no ownership decision. The disposable account must have a non-null exact backup, and the initial token scan runs before any collection/upload or reinstall action.

- [ ] **Step 5: Exercise actual Codex and Claude Code collection/upload**

Use each official client once in the disposable account so its normal local usage surface exists. Do not script credentials or prompts into evidence.

Before running the collector, fix the only evidence schema:

~~~text
success: { "status": "success", "timestamp": strict ISO string,
           "providers": ["claude", "codex"] }
failure: { "status": "failed", "timestamp": null, "providers": [] }
~~~

These are the only three keys. Provider names are sorted and contain no provider payload. Raw collector stdout/stderr and raw `last-upload.json` never enter the evidence directory. Then run one explicit collector cycle from installed state, discard its raw streams, and independently derive/validate only the allowlisted summary:

~~~sh
install_root="$HOME/Library/Application Support/KindleLLMDashboard"
manual_summary="$evidence_root/manual-upload-summary.json"
evidence_sanitizer="$PWD/tests/fixtures/sanitize-macos-upload-evidence.mjs"
test -f "$evidence_sanitizer"
test ! -L "$evidence_sanitizer"
manual_status=0
"$node_path" "$install_root/collector/upload.mjs" \
  --mode=scheduled-sync \
  "--config=$install_root/config.json" \
  >/dev/null 2>&1 || manual_status=$?
if [ "$manual_status" -ne 0 ]; then
  printf '' | "$node_path" "$evidence_sanitizer" failed >"$manual_summary"
  exit 1
fi
"$node_path" "$evidence_sanitizer" success \
  <"$install_root/state/last-upload.json" >"$manual_summary.tmp"
chmod 600 "$manual_summary.tmp"
mv "$manual_summary.tmp" "$manual_summary"
"$node_path" -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["providers", "status", "timestamp"])) process.exit(1);
if (value.status !== "success") process.exit(1);
if (new Date(value.timestamp).toISOString() !== value.timestamp) process.exit(1);
if (JSON.stringify(value.providers) !== JSON.stringify(["claude", "codex"])) process.exit(1);
' "$manual_summary"
/bin/sh collector/diagnose-macos.sh >"$evidence_root/diagnose-after-upload.json"
~~~

Require a valid Claude/Codex snapshot is acknowledged by the configured server and lastUploadPresent becomes true. The collector's raw streams go only to `/dev/null`; the already-tested M3 sanitizer reads bounded state through stdin and is the only process allowed to write manual-upload evidence. Evidence records status/timestamp/provider names only, never usage windows, an Authorization header, token, authenticated URL, or response body containing private data.

- [ ] **Step 6: Observe one full 720-second scheduled interval**

Capture the current last-upload mtime and launch state, wait at least 780 seconds without kickstart, then capture again:

~~~sh
/usr/bin/stat -f '%m' "$install_root/state/last-upload.json" \
  >"$evidence_root/last-upload-before.txt"
/bin/launchctl print "gui/$(/usr/bin/id -u)/com.kindle-llm-dashboard.sync" \
  >"$evidence_root/launchctl-before-interval.txt"
/bin/sleep 780
/usr/bin/stat -f '%m' "$install_root/state/last-upload.json" \
  >"$evidence_root/last-upload-after.txt"
/bin/launchctl print "gui/$(/usr/bin/id -u)/com.kindle-llm-dashboard.sync" \
  >"$evidence_root/launchctl-after-interval.txt"
~~~

Require the after timestamp is newer, the run completed, no overlapping persistent process exists, and logs contain no credential text.

- [ ] **Step 7: Exercise sleep/resume**

Record current upload timestamp, put the disposable test Mac to sleep through the macOS UI for at least two minutes, resume/unlock it, then wait one complete scheduling window or use launchctl kickstart only after separately recording the resume behavior.

Require:

- agent remains loaded after resume;
- one successful post-resume upload completes;
- no duplicate overlapping collector remains;
- diagnose stays credential-free and valid.

Record manual sleep/resume times and whether the upload was timer-triggered or explicitly kickstarted.

- [ ] **Step 8: Prove reinstall and failed-put rollback**

Before reinstall, record credential-free hashes/modes and loaded state:

~~~sh
find "$install_root" "$HOME/Library/LaunchAgents/com.kindle-llm-dashboard.sync.plist" \
  -type f -exec /usr/bin/shasum -a 256 {} \; | sort \
  >"$evidence_root/pre-reinstall-hashes.txt"
/bin/launchctl print "gui/$(/usr/bin/id -u)/com.kindle-llm-dashboard.sync" >/dev/null
printf '%s\n' "$?" >"$evidence_root/pre-reinstall-loaded.txt"
~~~

Run a normal foreground reinstall and type a new disposable token only at the installer prompt. Immediately after the installer returns successfully, before ownership rechecks, upload, hashing, or any other product action, re-enter that same just-used token only into the stdin scanner and run:

~~~sh
scan_token_surfaces normal-reinstall
~~~

Only after that zero-match result, require exact ownership, one backupPath retained, loaded state true, and upload success.

Then create a credential-free failure wrapper outside the repository:

~~~sh
failure_wrapper="$evidence_root/fail-put-osascript.sh"
cat >"$failure_wrapper" <<'SH'
#!/bin/sh
if [ "$4" = put ]; then
  /bin/dd of=/dev/null bs=16385 count=1 2>/dev/null
  exit 75
fi
exec /usr/bin/osascript "$@"
SH
chmod 700 "$failure_wrapper"
~~~

The wrapper never logs or stores stdin. Capture pre-failure
hashes/settings/loaded state, then run the exact foreground failure:

~~~sh
failed_put_status=0
KINDLE_LLM_OSASCRIPT_BIN="$failure_wrapper" \
  /bin/sh collector/install-macos.sh \
    --ingest-url "$dashboard_origin/api/usage" \
    --codex-command "$codex_path" || failed_put_status=$?
test "$failed_put_status" -ne 0
scan_token_surfaces failed-put-attempt
~~~

Type another disposable token only at the TTY prompt and require nonzero. Before recomputing state or running any other tool, re-enter that rejected attempted token only into `scan_token_surfaces`; the scan must report zero matches. Then recompute the snapshot and require byte-for-byte equality, same loaded state, and adapter exists still true. The old password is never read.

- [ ] **Step 9: Prove TTY interruption and exact refusal boundaries**

Run tests/fixtures/run-macos-tty-interrupt.py against the real shell plus non-mutating fake command seams. Require promptSeen, echoBefore, echoDisabledAtPrompt, and echoAfter true, with childExit 130.

In the installed disposable account:

1. Copy manifest and plist to mode-0600 files in evidence_root.
2. Add one extra manifest key; run diagnose, reinstall, and uninstall without entering a token when preflight refuses. Require no product hash/loaded/Keychain change. Restore exact manifest bytes.
3. Replace plist ProgramArguments with a foreign entrypoint and plutil-lint it; run the same refusal checks. Require no mutation. Restore exact plist bytes.
4. Replace settings statusLine with a foreign command; require reinstall/uninstall refusal and no mutation. Restore exact settings bytes.
5. Re-run diagnose and exact validation; require healthy state.

Do not leave a tampered product file between cases.

- [ ] **Step 10: Scan every observable local surface without putting the token in argv**

Run the reusable scanner once more for the currently installed token. The initial-install, normal-reinstall, and rejected failed-put tokens have already been scanned immediately after their respective prompt operations; no token entry may be deferred to this final scan.

~~~sh
scan_token_surfaces final-installed
~~~

Each scanner result contains counts only and every invocation includes the exact non-null backup as a separate required root. To inspect a running collector without persisting raw process data, kickstart the fixed LaunchAgent and poll under a 15-second monotonic-enough wall-clock deadline for exactly one PID whose command contains the owned upload entrypoint. Zero PIDs at the deadline, multiple PIDs at any poll, PID replacement/disappearance, either `ps` producing zero records, or any forbidden name fails the gate.

~~~sh
/bin/launchctl kickstart "gui/$(/usr/bin/id -u)/com.kindle-llm-dashboard.sync"
process_deadline=$(( $(date +%s) + 15 ))
pid=''
while :; do
  owned_pids=$(/usr/bin/pgrep -f "$install_root/collector/upload.mjs" || true)
  owned_count=$(printf '%s\n' "$owned_pids" | /usr/bin/awk 'NF { n++ } END { print n+0 }')
  test "$owned_count" -le 1
  if [ "$owned_count" -eq 1 ]; then
    pid=$(printf '%s\n' "$owned_pids" | /usr/bin/awk 'NF { print; exit }')
    break
  fi
  test "$(date +%s)" -lt "$process_deadline"
  /bin/sleep 0.05
done
test -n "$pid"
/bin/kill -0 "$pid"

argv_scan=$(/bin/ps -p "$pid" -o command= | /usr/bin/awk '
  function sensitive(field, name) {
    name = tolower(field)
    sub(/[=:].*$/, "", name)
    gsub(/^-+/, "", name)
    gsub(/[^[:alnum:]]/, "", name)
    return name == "auth" || name ~ /(token|secret|password|credential|cookie|authorization|oauth|bearer|apikey|accesskey|privatekey)/
  }
  { records++; for (i = 1; i <= NF; i++) if (sensitive($i)) bad++ }
  END { if (records < 1) exit 3; printf "%d:%d\n", records, bad+0 }
')
env_scan=$(/bin/ps eww -p "$pid" -o command= | /usr/bin/awk '
  function sensitive(field, name) {
    name = tolower(field)
    sub(/[=:].*$/, "", name)
    gsub(/^-+/, "", name)
    gsub(/[^[:alnum:]]/, "", name)
    return name == "auth" || name ~ /(token|secret|password|credential|cookie|authorization|oauth|bearer|apikey|accesskey|privatekey)/
  }
  { records++; for (i = 1; i <= NF; i++) if (sensitive($i)) bad++ }
  END { if (records < 1) exit 3; printf "%d:%d\n", records, bad+0 }
')
argv_records=${argv_scan%%:*}
argv_bad=${argv_scan#*:}
env_records=${env_scan%%:*}
env_bad=${env_scan#*:}
test "$argv_records" -ge 1
test "$env_records" -ge 1
test "$argv_bad" -eq 0
test "$env_bad" -eq 0
/bin/kill -0 "$pid"
owned_pids_after=$(/usr/bin/pgrep -f "$install_root/collector/upload.mjs" || true)
test "$(printf '%s\n' "$owned_pids_after" | /usr/bin/awk 'NF { n++ } END { print n+0 }')" -eq 1
test "$(printf '%s\n' "$owned_pids_after" | /usr/bin/awk 'NF { print; exit }')" = "$pid"
printf '{"argvRecords":%s,"forbiddenArgFields":%s,"envRecords":%s,"forbiddenEnvFields":%s}\n' \
  "$argv_records" "$argv_bad" "$env_records" "$env_bad" \
  >"$evidence_root/process-secret-scan.json"
~~~

The sensitive-name predicate is the complete approved case-insensitive family: exact normalized `auth`, or normalized names containing `token`, `secret`, `password`, `credential`, `cookie`, `authorization`, `oauth`, `bearer`, `apiKey`, `accessKey`, or `privateKey`. Both raw `ps` streams flow directly into `awk`; only the four numeric counters are written as evidence. At least one record from each real `ps` call is mandatory.

- [ ] **Step 11: Transactionally uninstall**

Before uninstall, add a harmless non-statusLine key to current Claude settings to prove preservation. Run:

~~~sh
/bin/sh collector/uninstall-macos.sh >"$evidence_root/uninstall.json"
/bin/sh collector/diagnose-macos.sh >"$evidence_root/diagnose-after-uninstall.json" || true
test ! -e "$install_root"
test ! -e "$HOME/Library/LaunchAgents/com.kindle-llm-dashboard.sync.plist"
test "$(/usr/bin/osascript -l JavaScript "$adapter" exists "$service" "$account")" = false
if /bin/launchctl print "gui/$(/usr/bin/id -u)/com.kindle-llm-dashboard.sync" >/dev/null 2>&1; then
  exit 1
fi
~~~

Require original statusLine restoration/removal, preservation of the harmless current key, removal of the exact backup, and a second uninstall result with alreadyAbsent true and no adapter delete.

- [ ] **Step 12: Record scoped result**

Before assigning any PASS, re-run the immutable checkout gate:

~~~sh
test "$run_class" = 'PHASE4_FINAL'
test -z "$(git status --porcelain --untracked-files=all)"
test "$(git rev-parse HEAD)" = "$approved_final_pr10_sha"
test "$(cat "$evidence_root/git-head.txt")" = "$approved_final_pr10_sha"
~~~

Write a result table with PASS, FAIL, or SKIPPED and an evidence filename for:

~~~text
OS/architecture/SHA
run class and approved final PR 10 merge SHA equality
adapter false/create/fragmented/exact-16384/zero+16385-preserve/delete/false
scrubbed-PATH install
exact manifest/config/plist/settings/backup ownership
real Codex and Claude collection/upload
720-second scheduled run
sleep/resume
normal reinstall
failed final put rollback
TTY interrupt echo restoration
tampered manifest refusal
foreign plist refusal
foreign settings refusal
secret-surface scan
transactional uninstall
~~~

`PASS` is permitted only when run class is `PHASE4_FINAL`, the checkout was and remains clean, and recorded HEAD equals the user-approved final PR 10 merge SHA. A PR 3 run is always reported as `PRELIMINARY_PR3`, never PASS. Any failed/skipped row, missing real Mac, missing approval, dirty checkout, or SHA mismatch produces `NOT RUN` or FAIL and keeps macOS Beta. A full scoped pass supports only the recorded OS/architecture; it does not authorize a broad production-ready claim.

---

## Task 11: Run the Master Fixed Gate, Review, and Stop Before Publication

**Files:**

- All PR 3 files only

- [ ] **Step 1: Run focused static gates**

~~~powershell
& "$env:ProgramFiles\Git\bin\bash.exe" -n collector/install-macos.sh collector/diagnose-macos.sh collector/uninstall-macos.sh
node -e "const fs=require('fs'); new Function(fs.readFileSync('collector/macos-keychain-adapter.js','utf8'));"
python -c "compile(open('tests/fixtures/run-macos-tty-interrupt.py', encoding='utf-8').read(), 'tests/fixtures/run-macos-tty-interrupt.py', 'exec')"
node --test tests/collectorMacos.test.mjs tests/collectorUpload.test.mjs
git diff --check
~~~

Also extract every `~~~sh` block under Task 10 and syntax-check without printing block content:

~~~powershell
@'
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const text = readFileSync('docs/superpowers/plans/2026-07-13-macos-beta-hardening.md', 'utf8');
const section = text.split('## Task 10:')[1].split('## Task 11:')[0];
const blocks = [...section.matchAll(/~~~sh\r?\n([\s\S]*?)\r?\n~~~/g)].map((match) => match[1]);
const shell = process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(existsSync)
  : '/bin/sh';
if (!shell || blocks.length === 0) throw new Error('Real-Mac runbook shell blocks unavailable');
for (const [index, block] of blocks.entries()) {
  const result = spawnSync(shell, ['-n'], { input: block, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Real-Mac shell block ${index + 1} is invalid`);
}
process.stdout.write(JSON.stringify({ realMacShellBlocks: blocks.length, valid: true }) + '\n');
'@ | node --input-type=module
~~~

The JavaScript parse check does not replace osascript parsing/Security.framework execution on macOS CI.

- [ ] **Step 2: Run the exact fixed gate from the master plan**

~~~powershell
npm.cmd test
npm.cmd run build
$env:KINDLE_LLM_NEXT_INTEGRATION_MODE = 'start'
try {
    node --test --test-name-pattern="dashboard route consumes two-window provider cards" tests/dashboardRoute.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Built Next integration smoke failed' }
} finally {
    Remove-Item Env:KINDLE_LLM_NEXT_INTEGRATION_MODE -ErrorAction SilentlyContinue
}
node --test --experimental-test-coverage
git diff --check
~~~

Record the fresh test count and require at least the 226-test baseline. Record coverage and require the repository baseline captured at execution start not to decrease.

- [ ] **Step 3: Review scope and credential safety without printing matches**

~~~powershell
git log --oneline -3
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
git status --short
~~~

Require exactly M1/M2/M3 and only approved PR 3 files. Confirm:

- no .recovery file is staged;
- no Kindle private env/device backup is staged;
- no token/cookie/password/private authenticated URL/Authorization value is staged;
- no full environment dump or real production hostname is staged;
- fake logs contain metadata only;
- no Keychain password read was added outside the already approved runtime memory read.

Secret scanning reports filenames/counts only and never matched text.

- [ ] **Step 4: Obtain independent Reviewer and Verifier results**

Reviewer checks:

- installedExpected versus desiredExpected separation;
- exact schemas and lstat/symlink/URL/path/quoting boundaries;
- atomic put/delete final-commit ordering;
- trap initialization, signal codes, xtrace, TTY restoration, rollback failure;
- loaded/unloaded state restoration;
- foreign-resource preservation;
- transactional settings merge on uninstall;
- no undefined fixture/helper or alternate manifest parser.

Verifier reruns Task 11 Steps 1-3, checks GitHub macOS bridge output after publication is authorized, and maps every Task 10 row to evidence or explicit outstanding Beta status.

All Critical, P1, and P2 findings must be resolved before publication.

- [ ] **Step 5: Stop for user review before push or PR**

Report:

~~~text
M1 SHA and focused evidence
M2 SHA and exact-validation evidence
M3 SHA and transaction/secret evidence
full fixed-gate test count, build, built-start smoke, coverage
independent review result
real-Mac acceptance: PRELIMINARY_PR3, PHASE4_FINAL with exact OS/architecture/final PR 10 merge SHA, or NOT RUN/outstanding
unresolved risks
rollback order: revert M3, then M2, then M1
confirmation that no secret/private artifact entered Git
~~~

Do not push or open PR 3 until the user explicitly approves. After approval, GitHub macOS CI must pass the real Security.framework bridge gate; a syntax-only adapter check is not sufficient. Merge requires all CI/preview checks, independent review, and the user's phase approval.

## Completion Definition

PR 3 is ready for user review only when:

1. M1, M2, and M3 are separate commits with the approved scope.
2. Every fixture helper/method and fake-command protocol used by tests is defined in this plan.
3. installedExpected validates old state and desiredExpected validates staged/new state.
4. Exact manifest/config/plist/settings/backup and lstat/symlink/URL/path/quoting tests are green.
5. Inherited xtrace, TTY interruption, all signals, loaded/unloaded rollback, and rollback-failure cases are green.
6. JXA input is bounded to 16,384 bytes, current account is independently checked, and real macOS CI proves exists false/true/false.
7. Install put and uninstall delete are their transaction's final product-state commits.
8. Runtime token read stays memory-only and error output stays generic.
9. The master fixed PR gate is green with no baseline regression.
10. Real-Mac evidence is explicitly `PRELIMINARY_PR3`, `PHASE4_FINAL` bound to the approved final PR 10 merge SHA and narrowly scoped, or `NOT RUN`/outstanding; macOS remains labeled Beta.
