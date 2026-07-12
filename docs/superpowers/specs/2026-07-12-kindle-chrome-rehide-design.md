# Kindle Chrome Re-Hide Design

## Problem

The Vercel PNG contains only the dashboard header. The photographed Wi-Fi,
Kindle battery icon, and Chinese system time are Kindle Pillow chrome drawn on
top of that PNG. The daemon hides Pillow only once during startup, while the
one-shot refresh path does not hide it at all. KUAL or a top-edge interaction
can therefore leave native chrome visible over later dashboard draws.

## Desired Behavior

Every dashboard draw must first disable Kindle Pillow chrome. This applies to
the long-running 12-minute refresh loop, `Refresh Dashboard Now`, and
`Display Cached Dashboard`. `Stop Dashboard / Restore Kindle` must continue to
resume the window manager and restore Pillow unconditionally.

## Approach

Split the existing reversible chrome control into two ownership levels instead
of stopping the full Kindle framework:

- Source `local/chrome-control.sh` from `local/display-once.sh`.
- Add `hide_kindle_pillow`, which disables Pillow but never pauses `awesome`.
- Call `hide_kindle_pillow` after the KUAL settle delay and before one-shot
  `eips` draws. A standalone action has no cleanup or power-button watcher, so
  it must retain a functioning window manager.
- Call `hide_kindle_chrome` at the start of `show_dashboard_png` so every daemon
  refresh repairs chrome that reappeared after startup. The daemon owns cleanup
  and a power-button watcher, so it may also pause `awesome`.

Repeated Pillow disable and daemon-owned `SIGSTOP` requests are idempotent on
the target Kindle. No standalone path leaves `awesome` stopped. No new
long-running process or wake behavior is introduced.

## Alternatives Rejected

- Always stopping the Kindle framework is heavier and previously caused blank
  screens and recovery risk.
- Keeping the native status bar would duplicate the dashboard battery and time
  and contradict the portrait display design.
- Fixing only `Refresh Dashboard Now` would leave automatic refresh unable to
  repair chrome exposed by a later user interaction.

## Verification

- Add shell tests proving one-shot hide never pauses `awesome`, while daemon
  draws still use the fully reversible chrome hide before `eips`.
- Run the full Node test suite and production build.
- Run shell syntax validation.
- Copy only the changed Kindle runtime files after the device is mounted, while
  preserving `local/env.sh`.
- On device, run `Start LLM Token Dashboard`, then `Refresh Dashboard Now`, and
  verify the native Wi-Fi, battery, and Chinese clock are absent.
