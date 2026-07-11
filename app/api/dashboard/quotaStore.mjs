import { BlobPreconditionFailedError, get, put } from '@vercel/blob';

import { mergeQuotaSnapshots, normalizeQuotaSnapshot } from './quotaSnapshot.mjs';

const QUOTA_BLOB_PATHNAME = 'usage/latest.json';
const MAX_MERGE_ATTEMPTS = 4;

function isBlobWriteConflict(error, { initialCreate }) {
  if (error instanceof BlobPreconditionFailedError
    || error?.name === 'BlobPreconditionFailedError') {
    return true;
  }
  if (!initialCreate) return false;
  return /^(?:Blob)?(?:AlreadyExists|Conflict)Error$/.test(error?.name)
    || error?.status === 409
    || error?.status === 412
    || error?.statusCode === 409
    || error?.statusCode === 412;
}

export class QuotaStoreConflictError extends Error {
  constructor() {
    super('Quota snapshot changed during merge');
    this.name = 'QuotaStoreConflictError';
  }
}

export function createBlobQuotaStore({
  token = process.env.BLOB_READ_WRITE_TOKEN,
  blob = { get, put },
} = {}) {
  async function readVersioned() {
    if (!token) {
      return { snapshot: null, etag: null };
    }

    const result = await blob.get(QUOTA_BLOB_PATHNAME, {
      access: 'private',
      token,
      useCache: false,
    });
    if (!result?.stream) {
      return { snapshot: null, etag: null };
    }

    const etag = result.blob?.etag || result.headers?.get?.('etag');
    if (!etag) {
      throw new Error('Blob storage did not return an ETag');
    }

    return {
      snapshot: JSON.parse(await new Response(result.stream).text()),
      etag,
    };
  }

  async function writeVersioned(snapshot, { etag = null } = {}) {
    if (!token) {
      throw new Error('Blob storage is not configured');
    }

    const options = {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: Boolean(etag),
      contentType: 'application/json',
      token,
    };
    if (etag) {
      options.ifMatch = etag;
    }

    try {
      await blob.put(QUOTA_BLOB_PATHNAME, JSON.stringify(snapshot), options);
    } catch (error) {
      if (isBlobWriteConflict(error, { initialCreate: !etag })) {
        throw new QuotaStoreConflictError();
      }
      throw error;
    }
  }

  return {
    async read() {
      return (await readVersioned()).snapshot;
    },
    async write(snapshot) {
      const { etag } = await readVersioned();
      await writeVersioned(snapshot, { etag });
    },
    readVersioned,
    writeVersioned,
  };
}

export async function readQuotaSnapshot({ store = createBlobQuotaStore() } = {}) {
  try {
    const snapshot = await store.read();
    return snapshot ? normalizeQuotaSnapshot(snapshot) : null;
  } catch {
    return null;
  }
}

export async function writeMergedQuotaSnapshot(incoming, { store = createBlobQuotaStore() } = {}) {
  if (typeof store.readVersioned !== 'function'
    || typeof store.writeVersioned !== 'function') {
    const merged = mergeQuotaSnapshots(await store.read(), incoming);
    await store.write(merged);
    return merged;
  }

  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
    const { snapshot, etag } = await store.readVersioned();
    const merged = mergeQuotaSnapshots(snapshot, incoming);

    try {
      await store.writeVersioned(merged, { etag });
      return merged;
    } catch (error) {
      if (!(error instanceof QuotaStoreConflictError)
        || attempt === MAX_MERGE_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new QuotaStoreConflictError();
}
