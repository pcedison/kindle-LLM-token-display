import assert from 'node:assert/strict';
import test from 'node:test';

test('dashboard timestamp renders month before day in Taipei time', async () => {
  const dashboard = await import('../app/api/dashboard/dashboardHandler.mjs');
  assert.equal(typeof dashboard.formatDashboardTimestamp, 'function');
  assert.equal(
    dashboard.formatDashboardTimestamp(Date.parse('2026-07-12T02:50:00.000Z')),
    '07/12 / 10:50',
  );
});

test('dashboard timestamp keeps 24-hour time across the Taipei date boundary', async () => {
  const { formatDashboardTimestamp } = await import('../app/api/dashboard/dashboardHandler.mjs');
  assert.equal(
    formatDashboardTimestamp(Date.parse('2026-07-12T14:50:00.000Z')),
    '07/12 / 22:50',
  );
  assert.equal(
    formatDashboardTimestamp(Date.parse('2026-07-11T16:05:00.000Z')),
    '07/12 / 00:05',
  );
});
