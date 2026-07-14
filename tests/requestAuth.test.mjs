import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeBearer,
  authorizeDashboardView,
  resolveDashboardViewAccess,
} from '../app/api/dashboard/requestAuth.mjs';

test('accepts only an exact bearer ingest token', () => {
  assert.equal(authorizeBearer('Bearer abc', 'abc'), true);
  assert.equal(authorizeBearer('Bearer ab', 'abc'), false);
  assert.equal(authorizeBearer('bearer abc', 'abc'), false);
  assert.equal(authorizeBearer(undefined, 'abc'), false);
});

test('dashboard view access fails closed and isolates the local fixture', () => {
  const url = new URL('https://x/api/dashboard');
  assert.equal(resolveDashboardViewAccess(url, {}), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { VERCEL_ENV: 'production' }), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { VERCEL_ENV: 'preview' }), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { VERCEL_ENV: 'development' }), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { DASHBOARD_VIEW_TOKEN: 'view' }), 'unauthorized');
  assert.equal(resolveDashboardViewAccess(
    new URL('https://x/api/dashboard?key=view'),
    { DASHBOARD_VIEW_TOKEN: 'view' },
  ), 'authorized');

  const fixtureEnv = { DASHBOARD_PUBLIC_FIXTURE: 'true', NODE_ENV: 'development' };
  assert.equal(resolveDashboardViewAccess(url, fixtureEnv, { allowLocalFixture: true }), 'fixture');
  assert.equal(resolveDashboardViewAccess(url, fixtureEnv), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(
    new URL('https://x/api/dashboard?managed=true'),
    fixtureEnv,
    { allowLocalFixture: true },
  ), 'misconfigured');

  for (const env of [
    { ...fixtureEnv, VERCEL_ENV: 'production' },
    { ...fixtureEnv, VERCEL_ENV: 'preview' },
    { ...fixtureEnv, VERCEL_ENV: 'development' },
    { ...fixtureEnv, NODE_ENV: 'production' },
    { ...fixtureEnv, DASHBOARD_VIEW_TOKEN: 'view' },
  ]) {
    assert.equal(resolveDashboardViewAccess(url, env, { allowLocalFixture: true }), 'misconfigured');
  }
});

test('dashboard requires an exact configured view key', () => {
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard?key=view-secret'), 'view-secret'), true);
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard?key=wrong'), 'view-secret'), false);
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard'), 'view-secret'), false);
});
