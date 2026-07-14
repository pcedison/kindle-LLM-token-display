import { createHash, timingSafeEqual } from 'node:crypto';

export function safeTokenEqual(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  const left = createHash('sha256').update(String(actual)).digest();
  const right = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(left, right);
}

export function authorizeBearer(authorization, expected) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    return false;
  }

  return safeTokenEqual(authorization.slice('Bearer '.length), expected);
}

export function resolveDashboardViewAccess(
  url,
  env = {},
  { allowLocalFixture = false } = {},
) {
  const viewToken = typeof env.DASHBOARD_VIEW_TOKEN === 'string'
    ? env.DASHBOARD_VIEW_TOKEN
    : '';
  const fixtureRequested = env.DASHBOARD_PUBLIC_FIXTURE === 'true';

  if (fixtureRequested) {
    const fixtureAllowed = allowLocalFixture
      && !viewToken
      && !env.VERCEL_ENV
      && env.NODE_ENV !== 'production'
      && url.searchParams.get('managed') !== 'true';
    return fixtureAllowed ? 'fixture' : 'misconfigured';
  }

  if (!viewToken) return 'misconfigured';
  return safeTokenEqual(url.searchParams.get('key'), viewToken)
    ? 'authorized'
    : 'unauthorized';
}
