# Task 4 Report: Claude Status-Line Collector

## Scope

Implemented only the Task 4 collector files and focused tests:

- `collector/lib/paths.mjs`
- `collector/lib/claudeStatus.mjs`
- `collector/lib/localState.mjs`
- `collector/claude-statusline.mjs`
- `tests/collectorClaude.test.mjs`
- `tests/collectorState.test.mjs`

## TDD Evidence

### RED

Command:

```text
npm.cmd test -- tests/collectorClaude.test.mjs tests/collectorState.test.mjs
```

Exact failure: both new test files failed before implementation with
`Error [ERR_MODULE_NOT_FOUND]` for `collector/lib/claudeStatus.mjs` and
`collector/lib/localState.mjs`; the run reported `tests 2`, `pass 0`, `fail 2`.

### GREEN

Focused command:

```text
npm.cmd test -- tests/collectorClaude.test.mjs tests/collectorState.test.mjs
```

Result: `tests 5`, `pass 5`, `fail 0`.

Covered behavior includes approved-field parsing, used-to-remaining formatting,
malformed-input nonzero exit without sentinel leakage, atomic state writes with
no temporary file, and state-name traversal rejection.

## Full Suite

Run from the recovery worktree after replacing the failed install with a
real in-root dependency copy:

```text
npm.cmd test
```

Result: `tests 71`, `pass 71`, `fail 0`.

The existing `MODULE_TYPELESS_PACKAGE_JSON` warning from
`app/api/usage/route.js` remains unchanged and is unrelated to Task 4.

## Re-review Fix Evidence

### RED before fixes

```text
npm.cmd test -- tests/collectorClaude.test.mjs tests/collectorState.test.mjs
```

The fix-focused run reported `tests 9`, `pass 5`, `fail 4`. Failures were the
new shared reset-bound tests, both partial-window child-process preservation
tests, and the durability seam test before their production implementations.
The original state test passed after its temporary-root isolation was added.

### GREEN after fixes

The same focused command reported `tests 9`, `pass 9`, `fail 0`.
The full suite in the recovery worktree with real in-root dependencies reported
`tests 71`, `pass 71`, `fail 0`.

Node syntax checks passed for all four collector modules, and `git diff --check`
passed.

## Security Notes

The collector reads only the two official Claude rate-limit windows, persists
only `collectedAt` and normalized `windows`, validates state names, and uses a
sibling temporary file followed by rename. Parse and child-process failures
use credential-free diagnostics without echoing input.

## Review / Commit

No push, deploy, merge, or independent reviewer approval was performed in this
recovery turn. Task 4 implementation commit: `6f03301`. Fix commit: `5bb98e5`.
