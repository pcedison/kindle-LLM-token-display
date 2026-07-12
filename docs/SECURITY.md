# Security

## Trust Boundary

Claude Code and Codex authentication remains in the official local clients. The collector does not open OAuth files, API-key files, browser cookies, or app databases. Claude Code supplies status-line JSON to the configured child process, and the collector requests rate-limit JSON from the official Codex app-server. Inputs are parsed in memory; all fields outside the quota allowlist are discarded. The collector does not persist or upload prompts, transcripts, repository paths, account identity, or raw provider responses.

Vercel never receives provider OAuth credentials and never logs in to Claude or ChatGPT. It receives a signed sanitized snapshot and renders the latest accepted state. The Kindle receives the rendered PNG plus a cache-disabled two-line device configuration containing only a version and allowlisted refresh interval.

## Upload Contract

The accepted schema is version 2, with backward-compatible version 1 migration. Only `claude` and `codex` providers are accepted. Each provider may contain only `fiveHour` and `sevenDay`; each window is reduced to finite `usedPercent`, a bounded Unix-seconds `resetsAt`, and an ISO `collectedAt`.

Credential-like field names are rejected recursively. Request bodies are limited to 8 KiB. Collection timestamps more than 10 minutes ahead of server receive time are rejected. Private Blob updates use cache-bypassing reads, ETag conditions, and bounded retries.

## Secrets

Three secrets have independent roles: the admin token changes display settings,
the view token reads the private dashboard/device configuration, and the ingest
token uploads sanitized provider quota snapshots. Never reuse one value for
another role.

- `DASHBOARD_ADMIN_TOKEN` is accepted only as an exact Bearer token by
  `/api/config`. The browser keeps it in React memory and clears it on Lock.
- `DASHBOARD_VIEW_TOKEN` optionally protects both `/api/dashboard` and
  `/api/device-config` through the private Kindle query URL.
- `DASHBOARD_INGEST_TOKEN` authorizes sanitized quota uploads only.

Uploaded artwork is untrusted input. The browser accepts PNG, JPEG, or WebP,
normalizes it to an opaque `104 x 96` PNG, and the server independently checks
media type, encoded size, PNG structure, dimensions, decoding, and opacity
before private storage. SVG and remote image URLs are rejected.

- `BLOB_READ_WRITE_TOKEN` is managed by Vercel for private Blob access.

Never put these values in Git, screenshots, query examples, logs, or support messages. Windows stores the ingest token in a per-user ACL-restricted config file. macOS stores it as the project-owned `KindleLLMDashboard.ingest` generic password in the user's Keychain. Scheduled tasks and LaunchAgents receive only a config path; config on macOS records the Keychain source, not the value.

All computers enrolled to one dashboard may share the ingest token. Losing a computer requires rotating `DASHBOARD_INGEST_TOKEN` in Vercel and reinstalling or updating the remaining collectors. A changed view token also requires updating the private Kindle URL.

## Storage and Logs

Private Blob stores the latest normalized quota snapshot and one managed display configuration per profile. A display configuration contains provider visibility, refresh cadence, and the two normalized artwork PNG data URLs; it contains no provider credentials. Server errors do not log bodies or credentials. Local diagnostics report booleans and version classes only. Installers back up Claude settings before adding the owned status line; those local backups can contain pre-existing settings and must be treated as sensitive.

Uninstall removes project-owned runtime, scheduling, and credential entries while preserving unrelated settings and timestamped backups. Deleting the corresponding Blob objects or store removes the latest server snapshot and managed display settings without affecting provider accounts.

Report vulnerabilities privately to the repository owner. Do not include live credentials or provider payloads in a report.
