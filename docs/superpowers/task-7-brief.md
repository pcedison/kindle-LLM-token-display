# Task 7: Open-Source v1 Documentation and Defaults

Preserve Tasks 1-6 and their review evidence. Update only the public documentation/default files needed to make a new user able to deploy, configure, install, recover, and uninstall without the original owner's Vercel project, D-drive paths, or secrets.

Document:

- official Claude status-line and Codex app-server prerequisites;
- local-only credential model: provider credentials stay in official local clients, and the uploader sends only sanitized percentages/reset timestamps;
- Vercel project linkage, private Blob setup, ingest/view environment variables, secret rotation, and production URL construction without printing values;
- Windows install, five-minute collector cadence, 12-minute Kindle refresh cadence, safe removal, cached dashboard, live dashboard, low-power, and wakeup workflow;
- supported profiles and exact PNG constraints;
- missing/stale/reset-complete behavior;
- threat model, data retention, logging redaction, troubleshooting, recovery, uninstall, and known provider/plan limitations;
- simulated/manual data setup without confusing it with live data.

Remove hard-coded owner-specific URLs, usernames, local paths, and secrets from public instructions. Keep examples obviously fake and safe. Add a concise configuration checklist and a release status section that distinguishes implemented, reviewed, deployed, and Kindle-accepted states.

Run repository searches for owner-specific identifiers, URLs, credentials, and stale five-hour-only instructions. Run npm.cmd test and npm.cmd run build after documentation/default changes. Commit only documentation/default changes and obtain independent review before Task 8.
