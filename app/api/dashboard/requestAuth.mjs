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

export function authorizeDashboardView(url, expected) {
  return !expected || safeTokenEqual(url.searchParams.get('key'), expected);
}
