# Required View Key UI Contract

## Context

Production View Protection makes `/api/dashboard` and `/api/device-config`
fail closed. A configured deployment returns `401` when the request key is
missing or wrong. The settings editor currently labels the view key as
optional and `buildManagedUrls()` emits apparently usable managed URLs when
the field is empty. Copying those URLs to a Kindle creates a deterministic
authorization failure.

## Goal

Require a nonblank view key before the settings editor produces private Kindle
URLs or requests the managed PNG preview.

## Non-Goals

- Do not store the view key in local storage, session storage, cookies, Blob,
  or the saved dashboard configuration.
- Do not change the admin-token flow or `/api/config` request contract.
- Do not rotate or reveal any Vercel secret.
- Do not alter Dashboard or device-config server authorization semantics.
- Do not add a frontend testing framework or dependency.

## Decision

`buildManagedUrls({ origin, profile, viewToken })` returns `null` when
`viewToken` is missing, not a string, empty, or contains only whitespace. For a
nonblank input, it trims surrounding whitespace and returns the existing
`dashboardUrl` and `deviceConfigUrl` object with the normalized key encoded in
both URLs. The helper continues to ignore any `adminToken` property supplied by
a caller.

Returning `null` is preferred over throwing because the editor's initial state
has no view key and is not exceptional. It is preferred over a page-only guard
because every helper caller then receives the same fail-closed contract.

## Editor Behavior

- Label the field `View key (required)` and mark the password input as
  `required`.
- While the trimmed field is blank, `managedUrls` is `null`.
- The Managed URLs section shows an instruction to enter the required view key
  and renders no URL text or open link.
- The Complete PNG preview section shows an instruction and renders no preview
  image.
- Entering a nonblank key immediately generates both private URLs and requests
  the authenticated managed PNG.
- Clearing the field or replacing it with whitespace immediately removes the
  URLs and preview image and clears any prior preview failure state.
- Lock continues to clear the in-memory view key.

## Data and Security Boundaries

The view key remains React in-memory state. It may appear only in the two
private managed URLs and their browser requests after the operator enters it.
It must never enter the configuration PUT body, tracked documentation,
screenshots, test output, browser persistence, or an admin Authorization
header. The admin token must never enter either managed URL.

## Testing

The change follows RED-GREEN TDD:

1. A unit test first requires `buildManagedUrls()` to return `null` for missing,
   empty, and whitespace-only keys; the current implementation must fail this
   test for the expected reason.
2. Existing encoded-key and admin-token-isolation assertions remain green.
3. A public-source contract test locks the required label, required input, and
   blank-state guidance so the page cannot silently regress to optional UI.
4. Focused tests cover `configClient` and the public-source contract.
5. The full PR gate reruns the Node suite, production build, built-start smoke,
   coverage baseline, diff checks, and secret-free scans.
6. The localhost-only Chrome acceptance harness proves that blank and
   whitespace-only states issue zero Dashboard preview requests, while a valid
   synthetic key loads the `758 x 1024` preview. It also rechecks upload,
   provider, interval, save, responsive layout, Lock, reload, storage, network,
   and cleanup behavior without contacting Vercel or Blob.

## Files

- `app/configClient.mjs`: nullable fail-closed URL helper.
- `app/page.js`: required label and blank-state instructions.
- `tests/configClient.test.mjs`: helper RED/GREEN regression coverage.
- `tests/openSourceRelease.test.mjs`: required editor source contract.
- `artifacts/settings-e2e.mjs`: ignored local acceptance harness update; never
  committed.

## Release Boundary

The fix is added to PR #22 as a separately reviewable commit. After local
verification, the branch is pushed, the P2 thread is answered and resolved,
and every GitHub and Vercel check must pass again. The new PR head may merge
only after those gates. Production verification must bind to the resulting
merge SHA, never to the feature-branch deployment.
