# Task 5 Final Re-review

Base: `e6a5051`
Head: `bb633d8`

## Verdict

**APPROVED**

No Critical or Important findings remain in the Task 5 changes.

## Verification

- `collector/lib/codexRateLimits.mjs` keeps a persistent carry buffer across stdout chunks, parses only complete JSONL lines, sends the official `initialize`, `initialized`, and `account/rateLimits/read` sequence, maps by `windowDurationMins`, prefers `rateLimitsByLimitId.codex`, and falls back to `rateLimits`.
- Codex timeout now rejects deterministically with a credential-free timeout error and the `finally` path terminates the child, ends stdin, and clears the timer. The added open-stdout test proves this does not hang.
- `uploadSnapshot` now calls the shared `normalizeQuotaSnapshot` at the upload boundary. Unknown fields are omitted from the transmitted/state snapshot and sensitive keys are rejected before fetch or state persistence.
- The abort timer remains active through fetch and response-body consumption, including stalled streamed bodies. Response size remains bounded at 4096 bytes.
- The uploader resolves a per-user default config path when no CLI path is supplied.
- Exclusive `upload.lock` creation, `finally` release, no-provider no-op, and bounded five-minute-to-60-minute backoff behavior remain intact in source. Successful uploads clear backoff state.
- HTTPS is required except for the explicitly recognized localhost addresses; bearer auth and JSON content type are used without persisting the token, raw response, or child stderr.
- Task 4's `claude.json` state shape is consumed and merged with `last-upload.json` without dropping the other valid provider.

## Test Evidence

Fresh commands run in the requested worktree:

- `npm.cmd test -- tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs`: **11 passed, 0 failed**.
- `npm.cmd test`: **71 passed, 11 failed**. The 11 failures are existing Kindle shell/Windows-environment tests (`tests/kindleScripts.test.mjs`), failing because the Linux-targeted shell commands cannot execute in this Windows host. All Task 5 tests passed.
- `npm.cmd run build`: **succeeded**.
- `git diff --check e6a5051 bb633d8`: **succeeded**.

The full-suite environment failures are outside Task 5 and do not identify a regression in the reviewed changes.
