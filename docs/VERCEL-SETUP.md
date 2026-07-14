# Vercel Setup

## Deploy

Import your fork into Vercel or link it with the official Vercel CLI. Use Node.js 20.9 or newer. Create a private Vercel Blob store and connect it to the project.

Set the required values in Production, Preview, and Development:

- `BLOB_READ_WRITE_TOKEN`: supplied by the connected private Blob store.
- `DASHBOARD_INGEST_TOKEN`: a long random secret shared only with the local uploader.
- `DASHBOARD_VIEW_TOKEN`: a separate long random secret required by
  `/api/dashboard` and `/api/device-config`.
- `DASHBOARD_ADMIN_TOKEN`: a separate long random secret used only to unlock
  the root configuration editor and authorize `/api/config` GET/PUT requests.
- Manual fallback names from `.env.example`: optional authenticated display
  values; they never make a deployment public.

Never set `DASHBOARD_PUBLIC_FIXTURE` in Vercel. It is only for an explicit,
unmanaged local `next dev` fixture without a view token. It cannot read Blob,
managed configuration, device configuration, or live quota state; conflicting
configuration returns 503.

Redeploy after environment changes, then use `vercel inspect` to obtain the
deployment origin. Do not paste secret values into GitHub issues, screenshots,
or tracked URLs. The ingest token belongs in the protected Windows config or
the project-owned macOS Keychain item. A view token is appended only to the
private Kindle URL as `key=...`; the Kindle downloader validates HTTPS
certificates and does not retry with certificate checks disabled.

Vercel stores and renders sanitized state; it does not poll subscriptions. Provider OAuth remains local to each official client. The dashboard remains available from the last accepted snapshot while all enrolled computers are off, but mobile activity is corrected only at the next observable desktop event.

## Managed Settings

After adding `DASHBOARD_ADMIN_TOKEN`, redeploy and open the project root. The
editor shell can load anonymously, but it does not request or expose private
configuration, artwork, Blob state, quota data, or tokens until a valid admin
Bearer token unlocks `/api/config`. Select the Kindle profile, enter the admin
token, configure visible providers, upload separate Claude/Codex artwork, and
choose the refresh interval. The token remains only in page memory; it is never
included in the managed PNG or device-config URLs.

The editor accepts PNG, JPEG, and WebP source images through 5 MiB and converts
each to an opaque white-background `104 x 96` PNG. Intervals of 10-50 seconds
are high-power test modes; 1-15 minutes are available for normal configuration,
with 12 minutes recommended. Settings are stored in private Blob documents at
`dashboard-config/<profile>.json`.

## Verify

All Vercel environments require DASHBOARD_VIEW_TOKEN. Missing configuration returns 503; a missing or wrong request key returns 401. Public fixture rendering is local-only, explicit, unmanaged, and disconnected from Blob, managed configuration, device configuration, and live quota state.

Do not remove the token from a live deployment to exercise the 503 case; verify
that behavior in an isolated test or preview. Resolve the current deployment
origin with `vercel inspect`, then verify that the exact private Kindle request
returns a PNG. An upload with a wrong bearer token must also return 401. A
successful PNG must be 758x1024 for `dp75sdi`, opaque 8-bit grayscale,
non-interlaced, nonblank, and sent with `Cache-Control: no-store`. Concurrent
provider uploads are merged per 5-hour or 7-day window through cache-bypassing
reads and ETag conditional writes rather than last-write-wins overwrites.
Version 1 clients remain accepted during migration, while stored state
converges to version 2.

## Rotation and Removal

Rotate ingest/view tokens in Vercel, redeploy, then update every Windows and
macOS collector or the private Kindle URL as applicable. Disconnect or delete
the Blob store to remove its latest sanitized snapshot. After authorization,
the renderer falls back to configured manual display values or waiting
placeholders when live storage is unavailable; authorization still fails closed
before any storage read.
