# Security

## Trust Boundary

Claude Code and Codex authentication remains in the official local clients. The collector does not open OAuth files, API-key files, or cookie stores. Claude Code supplies status-line JSON to the configured child process, and the collector requests rate-limit JSON from the Codex app-server. Those inputs may contain fields outside this project's quota contract; they are parsed in memory and discarded after normalization.

The collector does not persist or upload unapproved input fields. The only accepted upload schema is version 1 with `collectedAt` and optional `claude` / `codex` providers. Each provider may contain only `fiveHour` and `sevenDay`; each window contains only finite `usedPercent` and a bounded Unix-seconds `resetsAt`. Credential-like fields are rejected recursively.

## Secrets

- `DASHBOARD_INGEST_TOKEN` authenticates local uploads to `/api/usage`.
- `DASHBOARD_VIEW_TOKEN` optionally protects the PNG URL.
- `BLOB_READ_WRITE_TOKEN` is managed by Vercel for private Blob access.

Never put these values in Git, screenshots, query examples, task command lines, logs, or support messages. The Windows installer writes the ingest token only to a per-user ACL-restricted config file. The scheduled task receives the config path, not the token.

Rotate a compromised ingest or view token in Vercel, update the protected local config or reinstall the collector, redeploy, and update the private Kindle URL when the view token changes. Rotate Blob credentials from Vercel and redeploy.

## Storage and Logs

Private Blob stores only the latest normalized snapshot at a stable object name. Server errors do not log request bodies or credentials. Local diagnostics report booleans and version classes only. The installer reads Claude settings to create a local backup and register the status-line command; that backup can contain the user's pre-existing settings, remains local, and must be treated as sensitive. Remove the Blob object or store to delete the latest server snapshot; uninstall the collector to remove project state after restoring the owned settings change.

Report vulnerabilities privately to the repository owner. Do not include live credentials or provider payloads in a report.
