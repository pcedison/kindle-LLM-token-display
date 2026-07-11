# Task 5: Codex App-Server Client and Signed Uploader

Work only in the active feature/recovery worktree. Preserve Tasks 1-4. Do not modify dashboard, ingest, Blob, or provider contract files except to consume their public interfaces.

Create:

- `collector/lib/codexRateLimits.mjs`
- `collector/lib/collectorConfig.mjs`
- `collector/lib/uploadClient.mjs`
- `collector/upload.mjs`
- `collector/config.example.json`
- `tests/collectorCodex.test.mjs`
- `tests/collectorUpload.test.mjs`

Required exports:

- `mapCodexRateLimits(result)`
- `readCodexRateLimits(options)`
- `buildMergedLocalSnapshot(options)`
- `uploadSnapshot(options)`

Use the official Codex app-server stdio protocol: spawn the configured command with `app-server --stdio`, send `initialize`, `initialized`, then `account/rateLimits/read`, read JSONL until the response id, and always terminate the child. Enforce a bounded timeout. Map windows by `windowDurationMins` (300 minutes to five-hour and 10080 minutes to seven-day), never by primary/secondary order. Prefer a `rateLimitsByLimitId.codex` entry when present and fall back to the official `rateLimits` object. Reduce stderr to a credential-free error class.

Merge requirements:

- Read the Task 4 Claude spool.
- Merge a valid provider with `last-upload.json` without erasing a valid provider when the other provider fails.
- Make no network request when neither provider is usable.
- Acquire `upload.lock` with exclusive creation and release it in finally.
- Backoff starts at five minutes, doubles to 60 minutes maximum, and clears on success.

Upload requirements:

- Config supports `ingestUrl`, `ingestToken`, optional `codexCommand`, `timeoutMs`, and `timeZone`.
- Require an ingest token.
- Require HTTPS except an explicitly recognized localhost development URL.
- POST only the normalized snapshot with JSON content type and bearer auth.
- Use an abort timeout and bounded response size.
- Never include token, config, raw snapshot, response body, identity, or child stderr in logs/errors/state.
- Example config contains placeholders only.

TDD and handoff:

1. Write focused failing tests first and record exact RED evidence in `docs/superpowers/task-5-report.md`.
2. Implement the smallest solution.
3. Test duration mapping, JSONL framing, child cleanup, merge preservation, no-provider no-op, lock/backoff, HTTPS validation, abort, non-2xx responses, bounded response, and secret absence.
4. Run focused tests and the full suite from the original feature worktree if the recovery dependency junction prevents Next/Turbopack.
5. Commit only Task 5 files and report; obtain independent review before Task 6.
