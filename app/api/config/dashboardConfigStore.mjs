import { get, put } from '@vercel/blob';

import { normalizeDashboardConfig } from './dashboardConfig.mjs';

function configPathname(profile) {
  return `dashboard-config/${profile}.json`;
}

export function createDashboardConfigStore({
  token = process.env.BLOB_READ_WRITE_TOKEN,
  blob = { get, put },
} = {}) {
  return {
    async read(profile) {
      if (!token) return null;

      const result = await blob.get(configPathname(profile), {
        access: 'private',
        token,
        useCache: false,
      });
      if (!result?.stream) return null;

      return JSON.parse(await new Response(result.stream).text());
    },

    async write(profile, config) {
      if (!token) {
        throw new Error('Blob storage is not configured');
      }

      await blob.put(configPathname(profile), JSON.stringify(config), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        token,
      });
    },
  };
}

export async function readDashboardConfig(profile, {
  store = createDashboardConfigStore(),
  now,
} = {}) {
  const stored = await store.read(profile);
  return stored === null
    ? normalizeDashboardConfig({}, { profile, now })
    : normalizeDashboardConfig(stored, {
      profile,
      now: () => stored.updatedAt,
    });
}

export async function writeDashboardConfig(profile, input, {
  store = createDashboardConfigStore(),
  now,
} = {}) {
  const config = normalizeDashboardConfig(input, { profile, now });
  await store.write(profile, config);
  return config;
}
