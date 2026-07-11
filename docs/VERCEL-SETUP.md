# Vercel Setup

## Deploy

Import your fork into Vercel or link it with the official Vercel CLI. Use Node.js 20.9 or newer. Create a private Vercel Blob store and connect it to the project.

Set Production, Preview, and Development values as appropriate:

- `BLOB_READ_WRITE_TOKEN`: supplied by the connected private Blob store.
- `DASHBOARD_INGEST_TOKEN`: a long random secret shared only with the local uploader.
- `DASHBOARD_VIEW_TOKEN`: optional random secret protecting `/api/dashboard`.
- Manual fallback names from `.env.example`: optional fixtures/demo data.

Redeploy after environment changes. Do not paste secret values into GitHub issues, screenshots, or URLs. The ingest token belongs in the protected Windows config. A view token is appended only to the private Kindle URL as `key=...`; the Kindle downloader validates HTTPS certificates and does not retry with certificate checks disabled.

## Verify

Without a view token:

```text
https://your-project.vercel.app/api/dashboard?profile=dp75sdi&claude=true&openai=true&gemini=false
```

With a view token, a request without the correct `key` must return 401. An upload with a wrong bearer token must also return 401. A successful PNG must be 758x1024 for `dp75sdi`, opaque 8-bit grayscale, non-interlaced, nonblank, and sent with `Cache-Control: no-store`. Concurrent provider uploads are merged through cache-bypassing reads and ETag conditional writes rather than last-write-wins overwrites.

## Rotation and Removal

Rotate ingest/view tokens in Vercel, redeploy, then update the Windows collector or private Kindle URL. Disconnect or delete the Blob store to remove its latest sanitized snapshot. The renderer falls back to manual fixtures or waiting placeholders when live storage is unavailable.
