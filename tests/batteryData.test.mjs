import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBatteryDisplay,
  parseBatteryPercent,
} from '../app/api/dashboard/batteryData.mjs';

test('accepts valid battery percentages and rounds decimals to integers', () => {
  assert.equal(parseBatteryPercent('82'), 82);
  assert.equal(parseBatteryPercent('82.8'), 83);
  assert.equal(parseBatteryPercent('0'), 0);
  assert.equal(parseBatteryPercent('100'), 100);
});

test('rejects missing, malformed, negative, and over-100 battery values', () => {
  for (const value of [undefined, '', 'unknown', '-1', '101']) {
    assert.equal(parseBatteryPercent(value), undefined);
  }
});

test('returns a fallback label when the Kindle battery value is unavailable', () => {
  assert.deepEqual(getBatteryDisplay(new URLSearchParams()), {
    percent: undefined,
    label: '--%',
  });
});

test('battery display exposes the exact label used by the header', () => {
  assert.deepEqual(getBatteryDisplay(new URLSearchParams({ battery: '17' })), {
    percent: 17,
    label: '17%',
  });
});
