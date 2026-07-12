import { readDashboardConfig } from '../config/dashboardConfigStore.mjs';
import { resolveDashboardProfile } from '../dashboard/kindleProfiles.mjs';
import { authorizeDashboardView } from '../dashboard/requestAuth.mjs';

const NO_STORE = 'no-store, max-age=0, must-revalidate';

export function createDeviceConfigHandler({
  env = process.env,
  readDashboardConfig: readConfig = readDashboardConfig,
} = {}) {
  return async function deviceConfigHandler(request) {
    const url = new URL(request.url);
    if (!authorizeDashboardView(url, env.DASHBOARD_VIEW_TOKEN)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'Cache-Control': NO_STORE },
      });
    }

    const profile = resolveDashboardProfile(url.searchParams);
    const config = await readConfig(profile.key);
    return new Response(
      `version=${config.version}\nrefresh_interval_seconds=${config.refreshIntervalSeconds}\n`,
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': NO_STORE,
        },
      },
    );
  };
}

export const deviceConfigGET = createDeviceConfigHandler();
