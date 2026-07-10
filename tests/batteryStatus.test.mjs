import assert from 'node:assert/strict';
import test from 'node:test';
import { getBatteryStatus, parseBatteryLevel } from '../app/api/dashboard/batteryStatus.mjs';

test('accepts Kindle battery percentages from zero through one hundred', () => {
  assert.equal(parseBatteryLevel('0'), 0);
  assert.equal(parseBatteryLevel('82'), 82);
  assert.equal(parseBatteryLevel('100'), 100);
  assert.equal(parseBatteryLevel('82%'), 82);
});

test('rejects missing malformed and out-of-range battery values', () => {
  for (const value of [undefined, '', '-1', '101', 'battery 82', 'NaN']) {
    assert.equal(parseBatteryLevel(value), undefined);
  }
});

test('builds render data and a quiet unavailable fallback', () => {
  assert.deepEqual(getBatteryStatus(new URLSearchParams({ battery: '37' })), {
    level: 37,
    label: '37%',
    fillPercent: 37,
    available: true,
  });
  assert.deepEqual(getBatteryStatus(new URLSearchParams()), {
    level: undefined,
    label: '--%',
    fillPercent: 0,
    available: false,
  });
});
