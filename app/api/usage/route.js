import { authorizeBearer } from '../dashboard/requestAuth.mjs';
import { normalizeQuotaSnapshot } from '../dashboard/quotaSnapshot.mjs';
import { writeMergedQuotaSnapshot } from '../dashboard/quotaStore.mjs';

const MAX_BODY_BYTES = 8192;
const NO_STORE = 'no-store';

export const runtime = 'nodejs';

function response(body, status) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': NO_STORE,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function logStorageError(logger, error) {
  logger?.error?.('usage_ingest_error', 503, error?.constructor?.name || 'Error');
}

async function readLimitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The response is already determined by the body limit.
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function handleUsageIngest(request, dependencies = {}) {
  const env = dependencies.env || process.env;
  const logger = dependencies.logger || console;
  const write = dependencies.writeMergedQuotaSnapshot || writeMergedQuotaSnapshot;
  const now = dependencies.now || Date.now;
  const contentLength = Number(request.headers.get('content-length'));

  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response('Payload Too Large', 413);
  }

  if (!authorizeBearer(request.headers.get('authorization'), env.DASHBOARD_INGEST_TOKEN)) {
    return response('Unauthorized', 401);
  }

  const body = await readLimitedBody(request);
  if (!body) {
    return response('Payload Too Large', 413);
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return response('Invalid request', 400);
  }

  let snapshot;
  try {
    snapshot = normalizeQuotaSnapshot(parsed, { receivedAt: now() });
  } catch {
    return response('Invalid request', 400);
  }

  try {
    const merged = await write(snapshot, dependencies.store ? { store: dependencies.store } : undefined);
    return Response.json(
      { ok: true, collectedAt: merged.collectedAt },
      { headers: { 'Cache-Control': NO_STORE } },
    );
  } catch (error) {
    logStorageError(logger, error);
    return response('Storage unavailable', 503);
  }
}

export async function POST(request) {
  return handleUsageIngest(request);
}
