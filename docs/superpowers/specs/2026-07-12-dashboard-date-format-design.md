# Dashboard MM/DD Date Format Design

## Goal

Render the Kindle dashboard header timestamp as `MM/DD / HH:mm` in the
`Asia/Taipei` time zone. For example, July 12 at 10:50 must render as
`07/12 / 10:50`.

## Approach

Build the label from named `Intl.DateTimeFormat().formatToParts()` values.
Explicitly concatenate `month`, `day`, `hour`, and `minute` so locale-specific
date ordering cannot change the display.

## Scope

- Keep the existing 24-hour time and Taipei time zone.
- Keep the current font size, alignment, spacing, and header geometry.
- Do not change provider reset-time formatting.

## Verification

- Add a unit test using July 12, where `MM/DD` and `DD/MM` are distinguishable.
- Run the full test suite and production build.
- Render and inspect a 758 x 1024 DP75SDI preview.
