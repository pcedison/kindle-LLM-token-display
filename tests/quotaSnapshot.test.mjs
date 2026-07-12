import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeQuotaSnapshots,
  normalizeQuotaSnapshot,
} from '../app/api/dashboard/quotaSnapshot.mjs';

test('normalizes only approved Claude and Codex quota fields', () => {
  const snapshot = normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: {
        windows: { fiveHour: { usedPercent: 17, resetsAt: 1783678020 } },
      },
      codex: {
        windows: { sevenDay: { usedPercent: 19, resetsAt: 1784250000 } },
      },
      gemini: { windows: { fiveHour: { usedPercent: 50, resetsAt: 1783678020 } } },
    },
  });

  assert.deepEqual(snapshot, {
    version: 2,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T09:30:00.000Z',
        windows: { fiveHour: {
          usedPercent: 17,
          resetsAt: 1783678020,
          collectedAt: '2026-07-10T09:30:00.000Z',
        } },
      },
      codex: {
        collectedAt: '2026-07-10T09:30:00.000Z',
        windows: { sevenDay: {
          usedPercent: 19,
          resetsAt: 1784250000,
          collectedAt: '2026-07-10T09:30:00.000Z',
        } },
      },
    },
  });
});

test('upgrades v1 and merges each quota window by its own timestamp', () => {
  const current = normalizeQuotaSnapshot({
    version: 2,
    collectedAt: '2026-07-12T08:10:00.000Z',
    providers: {
      claude: {
        windows: {
          fiveHour: {
            usedPercent: 20,
            resetsAt: 1783843200,
            collectedAt: '2026-07-12T08:10:00.000Z',
          },
          sevenDay: {
            usedPercent: 30,
            resetsAt: 1784250000,
            collectedAt: '2026-07-12T08:00:00.000Z',
          },
        },
      },
    },
  });
  const incoming = {
    version: 1,
    collectedAt: '2026-07-12T08:05:00.000Z',
    providers: {
      claude: {
        windows: {
          fiveHour: { usedPercent: 90, resetsAt: 1783843200 },
          sevenDay: { usedPercent: 40, resetsAt: 1784250000 },
        },
      },
    },
  };

  const merged = mergeQuotaSnapshots(current, incoming);

  assert.equal(merged.version, 2);
  assert.equal(merged.providers.claude.windows.fiveHour.usedPercent, 20);
  assert.equal(merged.providers.claude.windows.fiveHour.collectedAt, '2026-07-12T08:10:00.000Z');
  assert.equal(merged.providers.claude.windows.sevenDay.usedPercent, 40);
  assert.equal(merged.providers.claude.windows.sevenDay.collectedAt, '2026-07-12T08:05:00.000Z');
});

test('rejects credential-like fields anywhere in an ingest snapshot', () => {
  for (const sensitiveKey of ['authToken', 'apiKey', 'api_key', 'x-api-key']) {
    assert.throws(() => normalizeQuotaSnapshot({
      version: 1,
      collectedAt: '2026-07-10T09:30:00.000Z',
      providers: { claude: { [sensitiveKey]: 'not-allowed' } },
    }), /sensitive field/i, sensitiveKey);
  }
});

test('clamps percentages and rejects invalid reset epochs', () => {
  const snapshot = normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: { windows: { fiveHour: { usedPercent: 150, resetsAt: 1783678020 } } },
      codex: { windows: { sevenDay: { usedPercent: -4, resetsAt: 1784250000 } } },
    },
  });

  assert.equal(snapshot.providers.claude.windows.fiveHour.usedPercent, 100);
  assert.equal(snapshot.providers.codex.windows.sevenDay.usedPercent, 0);
  assert.throws(() => normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: { claude: { windows: { fiveHour: { usedPercent: 1, resetsAt: 0 } } } },
  }), /reset epoch/i);
});

test('accepts reset epochs at the supported boundaries only', () => {
  const minimum = Date.UTC(2020, 0, 1) / 1000;
  const maximum = Date.UTC(2100, 0, 1) / 1000;

  const snapshot = normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: { windows: { fiveHour: { usedPercent: 1, resetsAt: minimum } } },
      codex: { windows: { sevenDay: { usedPercent: 99, resetsAt: maximum } } },
    },
  });

  assert.equal(snapshot.providers.claude.windows.fiveHour.resetsAt, minimum);
  assert.equal(snapshot.providers.codex.windows.sevenDay.resetsAt, maximum);
  for (const resetsAt of [minimum - 1, maximum + 1]) {
    assert.throws(() => normalizeQuotaSnapshot({
      version: 1,
      collectedAt: '2026-07-10T09:30:00.000Z',
      providers: { claude: { windows: { fiveHour: { usedPercent: 1, resetsAt } } } },
    }), /reset epoch/i);
  }
});

test('merges only incoming windows without erasing previous provider data', () => {
  const current = {
    version: 1,
    collectedAt: '2026-07-10T09:00:00.000Z',
    providers: {
      claude: { windows: { fiveHour: { usedPercent: 17, resetsAt: 1783678020 } } },
      codex: { windows: { sevenDay: { usedPercent: 19, resetsAt: 1784250000 } } },
    },
  };
  const incoming = {
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: { windows: { sevenDay: { usedPercent: 21, resetsAt: 1784242800 } } },
    },
  };

  assert.deepEqual(mergeQuotaSnapshots(current, incoming), {
    version: 2,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T09:30:00.000Z',
        windows: {
          fiveHour: {
            usedPercent: 17,
            resetsAt: 1783678020,
            collectedAt: '2026-07-10T09:00:00.000Z',
          },
          sevenDay: {
            usedPercent: 21,
            resetsAt: 1784242800,
            collectedAt: '2026-07-10T09:30:00.000Z',
          },
        },
      },
      codex: {
        collectedAt: '2026-07-10T09:00:00.000Z',
        windows: { sevenDay: {
          usedPercent: 19,
          resetsAt: 1784250000,
          collectedAt: '2026-07-10T09:00:00.000Z',
        } },
      },
    },
  });
});

test('preserves provider freshness and does not refresh an absent provider during merge', () => {
  const current = normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-09T09:00:00.000Z',
    providers: {
      codex: { windows: { fiveHour: { usedPercent: 19, resetsAt: 1784250000 } } },
    },
  });
  const incoming = normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T09:29:00.000Z',
        windows: { sevenDay: { usedPercent: 21, resetsAt: 1784242800 } },
      },
    },
  });

  const merged = mergeQuotaSnapshots(current, incoming);

  assert.equal(merged.providers.codex.collectedAt, '2026-07-09T09:00:00.000Z');
  assert.equal(merged.providers.claude.collectedAt, '2026-07-10T09:29:00.000Z');
  assert.equal(merged.collectedAt, '2026-07-10T09:29:00.000Z');
});

test('rejects an older provider update while accepting a newer sibling provider', () => {
  const current = {
    version: 1,
    collectedAt: '2026-07-10T10:00:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T10:00:00.000Z',
        windows: { fiveHour: { usedPercent: 80, resetsAt: 1783678200 } },
      },
    },
  };
  const incoming = {
    version: 1,
    collectedAt: '2026-07-10T11:00:00.000Z',
    providers: {
      claude: {
        collectedAt: '2026-07-10T09:00:00.000Z',
        windows: { fiveHour: { usedPercent: 20, resetsAt: 1783678200 } },
      },
      codex: {
        collectedAt: '2026-07-10T11:00:00.000Z',
        windows: { sevenDay: { usedPercent: 12, resetsAt: 1784250000 } },
      },
    },
  };

  const merged = mergeQuotaSnapshots(current, incoming);

  assert.equal(merged.providers.claude.collectedAt, '2026-07-10T10:00:00.000Z');
  assert.equal(merged.providers.claude.windows.fiveHour.usedPercent, 80);
  assert.equal(merged.providers.codex.collectedAt, '2026-07-10T11:00:00.000Z');
  assert.equal(merged.collectedAt, '2026-07-10T11:00:00.000Z');
});

test('merges complementary windows collected at the same provider timestamp', () => {
  const collectedAt = '2026-07-10T10:00:00.000Z';
  const merged = mergeQuotaSnapshots({
    version: 1,
    collectedAt,
    providers: {
      claude: {
        collectedAt,
        windows: { fiveHour: { usedPercent: 30, resetsAt: 1783678200 } },
      },
    },
  }, {
    version: 1,
    collectedAt,
    providers: {
      claude: {
        collectedAt,
        windows: { sevenDay: { usedPercent: 40, resetsAt: 1784250000 } },
      },
    },
  });

  assert.deepEqual(Object.keys(merged.providers.claude.windows).sort(), ['fiveHour', 'sevenDay']);
  assert.equal(merged.providers.claude.collectedAt, collectedAt);
});

test('rejects an invalid provider collectedAt', () => {
  assert.throws(() => normalizeQuotaSnapshot({
    version: 1,
    collectedAt: '2026-07-10T09:30:00.000Z',
    providers: {
      claude: {
        collectedAt: 'not-a-date',
        windows: { fiveHour: { usedPercent: 1, resetsAt: 1783678020 } },
      },
    },
  }), /collectedAt/i);
});
