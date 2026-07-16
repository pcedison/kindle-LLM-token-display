# Kindle DP75SDI Acceptance — 2026-07-16

## Scope

This record covers the physical Kindle acceptance that cannot be replaced by
portable shell tests. The device profile was `dp75sdi` at 758 x 1024. No
credential, authenticated URL, device identifier, or Authorization header was
recorded.

## Display acceptance

- `Display Test Frame` returned after KUAL closed and rendered the complete
  frame without a KUAL overlay.
- `Display Cached Dashboard` returned after KUAL closed and rendered the cached
  PNG without a KUAL overlay.
- A valid production PNG rendered successfully.
- A corrupt candidate was rejected without replacing the last valid cache.
- Multiple production refresh cycles completed at the remotely configured
  10-second acceptance cadence.

## Physical power-button root cause

The original daemon set `com.lab126.powerd preventScreenSaver` to `1` so the
panel could remain stable. On this Paperwhite 2 firmware, `powerd` records the
raw hardware press and then ignores it before emitting the normal
`goingToScreenSaver` transition. Watching only the LIPC screen-saver event could
therefore never release dashboard mode.

The accepted runtime watches the raw `powerd` log with follow-by-name when the
device `tail` supports it, and otherwise uses a bounded rotation-aware polling
fallback. The existing LIPC event remains a secondary source. Every watcher and
daemon signal is guarded by command, cwd, PPID where applicable, and a bounded
TERM-to-KILL sequence.

## Final physical run

After the final runtime synchronization and removal of any legacy daemon, KUAL
started the reviewed dashboard runtime. The device log recorded, in order:

1. rotation-aware power-button log monitoring enabled;
2. hardware and screen-saver watchers ready;
3. remote refresh interval accepted as 10 seconds;
4. a physical power-button press requested Kindle UI restoration;
5. the dashboard daemon stopped and requested the Kindle framework to start.

One final refresh raced between the press and the asynchronous stop at the
10-second test cadence. No refresh occurred after the stop completed, the
dashboard PID file was absent, and no candidate file remained.

## Integrity and cleanup

- The six synchronized runtime/menu files matched the reviewed source by
  SHA-256 after the physical run.
- During the final six-file runtime synchronization, the device-private
  environment file was not part of the copy set and matched its immediately
  preceding backup by SHA-256 afterward.
- The temporary live-power probe script, menu action, and active probe logs were
  removed after their evidence was backed up on the device.
- The final automated suite passed 257 tests and the Next.js production build;
  all modified Kindle shell scripts passed syntax validation and the final
  independent review reported no P0–P3 findings.

## Result

The DP75SDI/Paperwhite 2 path passes display, cache safety, remote cadence, and
physical power-button restoration acceptance. Real-Mac collector acceptance is
a separate Beta gate and was intentionally skipped for this run.
