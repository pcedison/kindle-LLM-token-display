import { authorizeBearer } from '../dashboard/requestAuth.mjs';
import {
  normalizeDashboardConfig,
  publicDashboardConfig,
} from './dashboardConfig.mjs';
import {
  readDashboardConfig,
  writeDashboardConfig,
} from './dashboardConfigStore.mjs';

const MAX_CONFIG_BODY_BYTES = 300 * 1024;

function jsonResponse(body, status) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function storageError(logger, error) {
  logger?.error?.('dashboard_config_error', 500, error?.constructor?.name || 'Error');
  return jsonResponse({ error: 'Storage unavailable' }, 500);
}

function declaredBodyIsTooLarge(value) {
  return typeof value === 'string'
    && /^\d+$/.test(value)
    && Number(value) > MAX_CONFIG_BODY_BYTES;
}

async function readLimitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      length += value.byteLength;
      if (length > MAX_CONFIG_BODY_BYTES) {
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

export function createConfigHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const logger = dependencies.logger || console;
  const now = dependencies.now || (() => new Date());
  const store = dependencies.store;
  const read = dependencies.readDashboardConfig || ((profile) => readDashboardConfig(
    profile,
    store ? { store, now } : { now },
  ));
  const write = dependencies.writeDashboardConfig || ((profile, input, options = {}) => (
    writeDashboardConfig(
      profile,
      input,
      store
        ? { store, now: options.now || now }
        : { now: options.now || now },
    )
  ));

  return async function configHandler(request) {
    const adminToken = env.DASHBOARD_ADMIN_TOKEN;
    if (!adminToken) {
      return jsonResponse({ error: 'Configuration unavailable' }, 503);
    }

    if (!authorizeBearer(request.headers.get('authorization'), adminToken)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let profile;
    try {
      profile = new URL(request.url).searchParams.get('profile');
      normalizeDashboardConfig({}, { profile, now });
    } catch {
      return jsonResponse({ error: 'Invalid request' }, 400);
    }

    if (request.method === 'GET') {
      try {
        const config = await read(profile);
        return jsonResponse(publicDashboardConfig(config), 200);
      } catch (error) {
        return storageError(logger, error);
      }
    }

    if (request.method === 'PUT') {
      if (declaredBodyIsTooLarge(request.headers.get('content-length'))) {
        return jsonResponse({ error: 'Payload too large' }, 413);
      }

      let config;
      try {
        const body = await readLimitedBody(request);
        if (!body) {
          return jsonResponse({ error: 'Payload too large' }, 413);
        }
        const parsed = JSON.parse(new TextDecoder().decode(body));
        config = normalizeDashboardConfig(parsed, { profile, now });
      } catch {
        return jsonResponse({ error: 'Invalid request' }, 400);
      }

      try {
        const saved = await write(profile, config, {
          now: () => config.updatedAt,
        });
        return jsonResponse(publicDashboardConfig(saved), 200);
      } catch (error) {
        return storageError(logger, error);
      }
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  };
}

export const configHandler = createConfigHandler();
