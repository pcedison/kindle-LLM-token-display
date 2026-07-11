# Task 5 Report

## RED

Command:

```text
npm.cmd test -- tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs
```

The new split-frame and open-stdout timeout tests did not complete with the old implementation. The exact observed failure mode was a hung test process after the existing reader called `kill()` but continued awaiting stdout; the process had to be terminated. The old implementation also rejected/ignored split JSON fragments because it had no carry buffer.

## GREEN

Focused command:

```text
npm.cmd test -- tests/collectorCodex.test.mjs tests/collectorUpload.test.mjs
```

Result: 11 passed, 0 failed, 0 cancelled.

Coverage added: split JSONL chunks, `rateLimits` fallback, deterministic Codex timeout and cleanup, normalized upload boundary and secret absence, stalled response-body timeout, and default config path.

Full verification:

```text
npm.cmd test
```

Result: 82 total, 82 passed, 0 failed, 0 cancelled. Existing warning: `MODULE_TYPELESS_PACKAGE_JSON` for `app/api/usage/route.js`.

```text
npm.cmd run build
```

Result: completed successfully; Next routes compiled and generated.

```text
node --check collector/lib/codexRateLimits.mjs
node --check collector/lib/collectorConfig.mjs
node --check collector/lib/uploadClient.mjs
node --check collector/upload.mjs
git diff --check
```

Result: all commands exited 0.

## Review Fix Evidence

The review-fix focused run covered split JSONL chunks, official `rateLimits`
fallback, deterministic child timeout cleanup, upload-boundary normalization
and secret absence, stalled response-body abort, and default config resolution.

## Concerns

- Full-suite Kindle shell failures remain platform/environment limitations and were not modified.
- The existing module-type warning remains outside Task 5 scope.
- No provider credentials, tokens, raw provider payloads, or identity fields are stored or sent.

Initial implementation commit SHA: `e6a5051`.
Review-fix commit SHA: `bb633d8`.
