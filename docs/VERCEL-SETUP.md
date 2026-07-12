# Vercel Setup

## Deploy

Import your fork into Vercel or link it with the official Vercel CLI. Use Node.js 20.9 or newer. Create a private Vercel Blob store and connect it to the project.

Set Production, Preview, and Development values as appropriate:

- `BLOB_READ_WRITE_TOKEN`: supplied by the connected private Blob store.
- `DASHBOARD_INGEST_TOKEN`: a long random secret shared only with the local uploader.
- `DASHBOARD_VIEW_TOKEN`: optional random secret protecting `/api/dashboard`.
- `DASHBOARD_ADMIN_TOKEN`: a separate long random secret used only to unlock
  the root configuration editor and authorize `/api/config` GET/PUT requests.
- Manual fallback names from `.env.example`: optional fixtures/demo data.

Redeploy after environment changes. Do not paste secret values into GitHub issues, screenshots, or URLs. The ingest token belongs in the protected Windows config or the project-owned macOS Keychain item. A view token is appended only to the private Kindle URL as `key=...`; the Kindle downloader validates HTTPS certificates and does not retry with certificate checks disabled.

Vercel stores and renders sanitized state; it does not poll subscriptions. Provider OAuth remains local to each official client. The dashboard remains available from the last accepted snapshot while all enrolled computers are off, but mobile activity is corrected only at the next observable desktop event.

## Managed Settings

After adding `DASHBOARD_ADMIN_TOKEN`, redeploy and open the project root. Select
the Kindle profile, enter the admin token, configure visible providers, upload
separate Claude/Codex artwork, and choose the refresh interval. The token is
sent as a Bearer header and remains only in page memory; it is never included
in the managed PNG or device-config URLs.

The editor accepts PNG, JPEG, and WebP source images through 5 MiB and converts
each to an opaque white-background `104 x 96` PNG. Intervals of 10-50 seconds
are high-power test modes; 1-15 minutes are available for normal configuration,
with 12 minutes recommended. Settings are stored in private Blob documents at
`dashboard-config/<profile>.json`.

## Verify

Without a view token:

```text
https://your-project.vercel.app/api/dashboard?profile=dp75sdi&managed=true
```

With a view token, a request without the correct `key` must return 401. An upload with a wrong bearer token must also return 401. A successful PNG must be 758x1024 for `dp75sdi`, opaque 8-bit grayscale, non-interlaced, nonblank, and sent with `Cache-Control: no-store`. Concurrent provider uploads are merged per 5-hour or 7-day window through cache-bypassing reads and ETag conditional writes rather than last-write-wins overwrites. Version 1 clients remain accepted during migration, while stored state converges to version 2.

## Rotation and Removal

Rotate ingest/view tokens in Vercel, redeploy, then update every Windows and macOS collector or the private Kindle URL as applicable. Disconnect or delete the Blob store to remove its latest sanitized snapshot. The renderer falls back to manual fixtures or waiting placeholders when live storage is unavailable.
