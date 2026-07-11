import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeBearer,
  authorizeDashboardView,
} from '../app/api/dashboard/requestAuth.mjs';

test('accepts only an exact bearer ingest token', () => {
  assert.equal(authorizeBearer('Bearer abc', 'abc'), true);
  assert.equal(authorizeBearer('Bearer ab', 'abc'), false);
  assert.equal(authorizeBearer('bearer abc', 'abc'), false);
  assert.equal(authorizeBearer(undefined, 'abc'), false);
});

test('dashboard remains public when no view token is configured', () => {
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard'), undefined), true);
});

test('dashboard requires an exact configured view key', () => {
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard?key=view-secret'), 'view-secret'), true);
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard?key=wrong'), 'view-secret'), false);
  assert.equal(authorizeDashboardView(new URL('https://x/api/dashboard'), 'view-secret'), false);
});
