import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderCards,
  providerEnvTemplate,
} from '../app/api/dashboard/providerData.mjs';

test('provider cards show setup placeholders when no env values are configured', () => {
  const cards = getProviderCards({});

  assert.equal(cards.length, 3);
  assert.equal(cards[0].queryKey, 'claude');
  assert.equal(cards[0].remaining, 'SETUP');
  assert.equal(cards[0].reset, 'Set CLAUDE_RESET_LABEL');
  assert.equal(cards[1].remaining, 'SETUP');
  assert.equal(cards[2].remaining, 'SETUP');
});

test('provider cards read display values from Vercel environment variables', () => {
  const cards = getProviderCards({
    CLAUDE_STATUS_VALUE: '12%',
    CLAUDE_RESET_LABEL: 'Reset 2026-08-01',
    OPENAI_STATUS_VALUE: '$18.42',
    OPENAI_RESET_LABEL: 'Reset 2026-07-31',
    GEMINI_STATUS_VALUE: '4.5k / 5k',
    GEMINI_RESET_LABEL: 'Window 24h',
  });

  assert.equal(cards[0].remaining, '12%');
  assert.equal(cards[0].reset, 'Reset 2026-08-01');
  assert.equal(cards[1].remaining, '$18.42');
  assert.equal(cards[1].reset, 'Reset 2026-07-31');
  assert.equal(cards[2].remaining, '4.5k / 5k');
  assert.equal(cards[2].reset, 'Window 24h');
});

test('provider env template lists the only values required before real API wiring', () => {
  assert.deepEqual(providerEnvTemplate(), [
    'CLAUDE_STATUS_VALUE',
    'CLAUDE_RESET_LABEL',
    'OPENAI_STATUS_VALUE',
    'OPENAI_RESET_LABEL',
    'GEMINI_STATUS_VALUE',
    'GEMINI_RESET_LABEL',
  ]);
});
