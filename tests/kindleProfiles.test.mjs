import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLayoutMetrics,
  resolveDashboardProfile,
} from '../app/api/dashboard/kindleProfiles.mjs';

test('defaults to the DP75SDI/Paperwhite 2 safe portrait profile', () => {
  const profile = resolveDashboardProfile(new URLSearchParams());

  assert.equal(profile.key, 'dp75sdi');
  assert.equal(profile.width, 758);
  assert.equal(profile.height, 1024);
  assert.equal(profile.isCustomSize, false);
});

test('resolves Paperwhite 3 aliases to the high-resolution portrait profile', () => {
  for (const alias of ['pw3', 'kpw3', 'paperwhite3']) {
    const profile = resolveDashboardProfile(new URLSearchParams({ profile: alias }));

    assert.equal(profile.key, 'kpw3');
    assert.equal(profile.width, 1072);
    assert.equal(profile.height, 1448);
  }
});

test('allows explicit width and height overrides for real-device probing', () => {
  const profile = resolveDashboardProfile(
    new URLSearchParams({ profile: 'dp75sdi', w: '600', h: '800' }),
  );

  assert.equal(profile.key, 'dp75sdi');
  assert.equal(profile.width, 600);
  assert.equal(profile.height, 800);
  assert.equal(profile.isCustomSize, true);
});

test('ignores unsafe custom dimensions instead of emitting unusable images', () => {
  const profile = resolveDashboardProfile(
    new URLSearchParams({ width: '120', height: '99999' }),
  );

  assert.equal(profile.width, 758);
  assert.equal(profile.height, 1024);
  assert.equal(profile.isCustomSize, false);
});

test('layout metrics keep padding inside the rendered canvas', () => {
  const small = getLayoutMetrics({ width: 600, height: 800 });
  const defaultSize = getLayoutMetrics({ width: 758, height: 1024 });
  const large = getLayoutMetrics({ width: 1072, height: 1448 });

  assert.ok(small.padding < defaultSize.padding);
  assert.ok(large.padding > defaultSize.padding);
  assert.ok(small.padding * 2 < 600);
  assert.ok(large.padding * 2 < 1072);
});
