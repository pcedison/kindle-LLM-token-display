# Task 4 Independent Review

Verdict: NOT APPROVED

The implementation does not yet satisfy the shared quota contract or the
durability requirement. There are Important findings below, so this review
does not state APPROVED.

## Findings

### Important: reset epochs are not validated against the shared contract

`collector/lib/claudeStatus.mjs:10-11` accepts any positive integer reset
epoch. The shared contract in `app/api/dashboard/quotaSnapshot.mjs` requires
`MIN_RESET_EPOCH` through `MAX_RESET_EPOCH` (2020-01-01 through 2100-01-01).
Inputs such as `resets_at: 1` or a far-future epoch are therefore persisted and
printed as valid collector data, then rejected when Task 5 consumes the spool.
Add the same bounded epoch validation and focused boundary tests.

### Important: atomic replacement is not durable across power loss

`collector/lib/localState.mjs:23-24` writes and renames the temporary file but
never flushes the file (and does not flush the containing directory). Rename
provides replacement atomicity, but without file/directory sync a successful
write can still disappear or leave the old state after a machine crash. The
brief explicitly requires atomic write durability and cleanup. Use the Node
file-handle sync path appropriate for Windows and non-Windows, while retaining
the existing `finally` cleanup.

### Important: a partial status update erases a previously valid window

`collector/claude-statusline.mjs:10-11` chooses the new snapshot whenever it
contains either window. If the next official payload contains only
`five_hour`, the previously persisted `sevenDay` value is discarded instead
of being preserved. This violates the missing-field preservation requirement
and conflicts with the existing contract's merge-only-present-windows
semantics. Merge present windows into the prior sanitized state before writing,
and test both missing-window directions in a child-process flow.

### Important: the focused test suite is not green in this review worktree

`npm.cmd test -- tests/collectorClaude.test.mjs tests/collectorState.test.mjs`
reported 4 passing and 1 failing test. The state test calls
`writeJsonStateAtomic` without a temporary state-root override, so on this
Windows worktree it attempts to create
`%LOCALAPPDATA%\KindleLLMDashboard\state` and fails with
`EPERM`. The test must isolate its state root (or the implementation must
provide an equivalent test-safe mechanism), and the focused command must be
rerun successfully.

## Verification Evidence

- Focused tests: 4 pass, 1 fail (`EPERM` creating the default Windows state
  directory).
- Full `npm.cmd test`: 66 pass, 1 fail. The failing dashboard integration test
  could not start Next because Turbopack rejected the recovery worktree's
  cross-root `node_modules` junction (`Symlink [project]/node_modules is
  invalid, it points out of the filesystem root`). This is an environment
  limitation, not evidence that the dashboard test passed.
- The focused tests do cover basic official-field allowlisting, malformed
  input redaction, traversal rejection, and successful temp-file cleanup, but
  do not cover reset bounds, partial-state preservation, fsync durability,
  Windows/non-Windows path assertions, or spool-file sentinel absence.

## Report Bookkeeping

`docs/superpowers/task-4-report.md` records Task 4 commit `8b0f4bb`, but the
review package identifies the actual reviewed HEAD as `6f03301` and that SHA
is the commit containing the Task 4 changes in this worktree. Correct the
historical SHA and update the recorded test results before handoff; otherwise
future reviewers may inspect the wrong commit and believe the failed commands
were green.

No source files were edited by this review. No push, deploy, merge, or commit
was performed.
