# Task 4: Claude Status-Line Collector

Work only in the active feature/recovery worktree. Preserve Tasks 1-3. Do not modify dashboard, ingest, Blob, or provider contract files except to consume their public interfaces.

Create:

- `collector/lib/paths.mjs`
- `collector/lib/claudeStatus.mjs`
- `collector/lib/localState.mjs`
- `collector/claude-statusline.mjs`
- `tests/collectorClaude.test.mjs`
- `tests/collectorState.test.mjs`

Required exports:

- `parseClaudeStatus(input)`
- `formatClaudeStatusLine(snapshot)`
- `readJsonState(name)`
- `writeJsonStateAtomic(name, value)`

Read only these official status-line fields:

- `rate_limits.five_hour.used_percentage`
- `rate_limits.five_hour.resets_at`
- `rate_limits.seven_day.used_percentage`
- `rate_limits.seven_day.resets_at`

Persist only a sanitized payload containing `collectedAt` and normalized `windows.fiveHour` / `windows.sevenDay`. Never persist or print email, identity, transcript path, arbitrary input fields, raw JSON, tokens, secrets, or input-bearing error messages.

Requirements:

- Valid input yields a sanitized Claude snapshot.
- Missing rate limits exits successfully, preserves prior valid state, and prints `Claude quota | waiting for first response`.
- Valid input prints remaining percentages, for example `Claude quota | 5h 96% | 7d 89%`.
- Finite percentages are normalized and no output contains `NaN` or infinity.
- Reset timestamps use official Unix seconds and the shared quota contract semantics.
- Atomic writes use a sibling temporary file followed by rename; no temp file remains after success.
- State names cannot escape the state root or contain path traversal.
- Windows state root is `%LOCALAPPDATA%\KindleLLMDashboard\state`; other platforms use `$XDG_STATE_HOME/kindle-llm-dashboard` or `~/.local/state/kindle-llm-dashboard`.
- Malformed JSON returns a deterministic nonzero exit without echoing input.
- Child-process tests must prove sensitive sentinel values are absent from stdout, stderr, and spool files.

TDD and handoff:

1. Write focused failing tests first and record exact RED command/output in `docs/superpowers/task-4-report.md`.
2. Implement the smallest fix.
3. Run focused tests and `npm.cmd test` from the original feature worktree.
4. Commit only Task 4 files, then produce a review package from the recorded Task 4 base.
5. Obtain an independent reviewer approval before Task 5.
