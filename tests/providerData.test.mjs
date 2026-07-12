import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderCards,
  getWindowDisplay,
  providerEnvTemplate,
} from '../app/api/dashboard/providerData.mjs';

test('provider cards keep Gemini as a manual-only card and show two missing windows', () => {
  const cards = getProviderCards({ env: {} });

  assert.equal(cards.length, 3);
  assert.equal(cards[0].queryKey, 'claude');
  assert.equal(cards[0].displayName, 'Anthropic Claude Code');
  assert.equal(cards[0].vendorLabel, 'ANTHROPIC');
  assert.equal(cards[0].source, 'missing');
  assert.equal(cards[0].windows.fiveHour.remaining, '--%');
  assert.equal(cards[0].windows.fiveHour.reset, 'WAITING FOR LOCAL SYNC');
  assert.equal(cards[0].windows.sevenDay.label, '7 DAYS');
  assert.equal(cards[1].displayName, 'Codex');
  assert.equal(cards[2].queryKey, 'gemini');
  assert.equal(cards[2].source, 'missing');
});

test('provider cards display live Claude and Codex windows in Asia/Taipei', () => {
  const cards = getProviderCards({
    snapshot: {
      version: 1,
      collectedAt: '2026-07-10T09:30:00.000Z',
      providers: {
        claude: {
          windows: {
            fiveHour: { usedPercent: 17, resetsAt: 1783678020 },
            sevenDay: { usedPercent: 19, resetsAt: 1784242800 },
          },
        },
        codex: { windows: { fiveHour: { usedPercent: 50, resetsAt: 1783678020 } } },
        gemini: { windows: { fiveHour: { usedPercent: 20, resetsAt: 1783678020 } } },
      },
    },
    now: Date.parse('2026-07-10T09:45:00.000Z'),
    timeZone: 'Asia/Taipei',
  });

  assert.equal(cards[0].source, 'live');
  assert.equal(cards[0].stale, false);
  assert.deepEqual(cards[0].windows.fiveHour, {
    label: '5 HOURS', remaining: '83%', progress: 83, reset: 'RESET 18:07',
  });
  assert.deepEqual(cards[0].windows.sevenDay, {
    label: '7 DAYS', remaining: '81%', progress: 81, reset: 'RESET 07/17 07:00',
  });
  assert.equal(cards[1].queryKey, 'openai');
  assert.equal(cards[1].source, 'live');
  assert.equal(cards[1].windows.fiveHour.remaining, '50%');
  assert.equal(cards[1].windows.sevenDay.remaining, '--%');
  assert.equal(cards[2].source, 'missing');
});

test('provider cards retain manual two-window data and legacy five-hour fallbacks', () => {
  const cards = getProviderCards({
    env: {
      CLAUDE_FIVE_HOUR_REMAINING: '12%',
      CLAUDE_FIVE_HOUR_RESET_LABEL: 'Reset 2026-08-01',
      CLAUDE_SEVEN_DAY_REMAINING: '88%',
      CLAUDE_SEVEN_DAY_RESET_LABEL: 'Reset 2026-08-07',
      OPENAI_STATUS_VALUE: '$18.42',
      OPENAI_RESET_LABEL: 'Reset 2026-08-02',
      OPENAI_PROGRESS_VALUE: '28',
      GEMINI_STATUS_VALUE: '4.5k / 5k',
      GEMINI_RESET_LABEL: 'Window 24h',
    },
  });

  assert.equal(cards[0].source, 'manual');
  assert.equal(cards[0].windows.fiveHour.remaining, '12%');
  assert.equal(cards[0].windows.sevenDay.remaining, '88%');
  assert.equal(cards[1].source, 'manual');
  assert.equal(cards[1].windows.fiveHour.remaining, '$18.42');
  assert.equal(cards[1].windows.fiveHour.progress, 28);
  assert.equal(cards[1].windows.sevenDay.remaining, '--%');
  assert.equal(cards[2].source, 'manual');
  assert.equal(cards[2].windows.fiveHour.remaining, '4.5k / 5k');
});

test('window display marks expired data unknown and delayed data with a sync time', () => {
  assert.deepEqual(getWindowDisplay(
    {
      usedPercent: 17,
      resetsAt: 1783678020,
      collectedAt: '2026-07-10T09:30:00.000Z',
    },
    { windowKey: 'fiveHour', now: Date.parse('2026-07-10T10:08:00.000Z') },
  ), {
    label: '5 HOURS', remaining: '--%', progress: 0, reset: 'SYNC PENDING',
  });

  const cards = getProviderCards({
    snapshot: {
      version: 2,
      collectedAt: '2026-07-10T09:29:00.000Z',
      providers: { claude: { windows: { fiveHour: {
        usedPercent: 25,
        resetsAt: 1784242800,
        collectedAt: '2026-07-10T09:29:00.000Z',
      } } } },
    },
    now: Date.parse('2026-07-10T10:00:00.000Z'),
    timeZone: 'Asia/Taipei',
  });

  assert.equal(cards[0].stale, true);
  assert.equal(cards[0].syncLabel, 'SYNC 17:29');
  assert.equal(cards[0].windows.fiveHour.remaining, '75%');
});

test('provider freshness wins over a newer global upload timestamp', () => {
  const cards = getProviderCards({
    snapshot: {
      version: 1,
      collectedAt: '2026-07-10T09:59:00.000Z',
      providers: {
        codex: {
          collectedAt: '2026-07-09T09:00:00.000Z',
          windows: { fiveHour: { usedPercent: 25, resetsAt: 1784242800 } },
        },
      },
    },
    now: Date.parse('2026-07-10T10:00:00.000Z'),
  });

  assert.equal(cards[1].source, 'live');
  assert.equal(cards[1].stale, true);
});

test('window display preserves fractional remaining quota in its label and progress', () => {
  assert.deepEqual(getWindowDisplay(
    { usedPercent: 17.5, resetsAt: 1783678020 },
    { windowKey: 'fiveHour', now: Date.parse('2026-07-10T09:45:00.000Z') },
  ), {
    label: '5 HOURS', remaining: '82.5%', progress: 82.5, reset: 'RESET 18:07',
  });
});

test('provider env template lists dual-window names with legacy five-hour fallbacks', () => {
  assert.deepEqual(providerEnvTemplate(), [
    'CLAUDE_FIVE_HOUR_REMAINING', 'CLAUDE_FIVE_HOUR_RESET_LABEL',
    'CLAUDE_SEVEN_DAY_REMAINING', 'CLAUDE_SEVEN_DAY_RESET_LABEL',
    'CLAUDE_STATUS_VALUE', 'CLAUDE_RESET_LABEL', 'CLAUDE_PROGRESS_VALUE',
    'OPENAI_FIVE_HOUR_REMAINING', 'OPENAI_FIVE_HOUR_RESET_LABEL',
    'OPENAI_SEVEN_DAY_REMAINING', 'OPENAI_SEVEN_DAY_RESET_LABEL',
    'OPENAI_STATUS_VALUE', 'OPENAI_RESET_LABEL', 'OPENAI_PROGRESS_VALUE',
    'GEMINI_FIVE_HOUR_REMAINING', 'GEMINI_FIVE_HOUR_RESET_LABEL',
    'GEMINI_SEVEN_DAY_REMAINING', 'GEMINI_SEVEN_DAY_RESET_LABEL',
    'GEMINI_STATUS_VALUE', 'GEMINI_RESET_LABEL', 'GEMINI_PROGRESS_VALUE',
  ]);
});
