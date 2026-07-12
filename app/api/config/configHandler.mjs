import { authorizeBearer } from '../dashboard/requestAuth.mjs';
import {
  normalizeDashboardConfig,
  publicDashboardConfig,
} from './dashboardConfig.mjs';
import {
  readDashboardConfig,
  writeDashboardConfig,
} from './dashboardConfigStore.mjs';

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

export function createConfigHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const logger = dependencies.logger || console;
  const now = dependencies.now || (() => new Date());
  const read = dependencies.readDashboardConfig || readDashboardConfig;
  const write = dependencies.writeDashboardConfig || writeDashboardConfig;

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
      let config;
      try {
        config = normalizeDashboardConfig(await request.json(), { profile, now });
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
