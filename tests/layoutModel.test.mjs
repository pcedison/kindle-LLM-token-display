import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getQuotaFillPercent,
  getQuotaLayout,
} from '../app/api/dashboard/layoutModel.mjs';

test('dp75sdi two-provider layout allocates two equal non-overlapping cards', () => {
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });

  assert.equal(layout.outerPadding, 22);
  assert.equal(layout.header.height, 58);
  assert.equal(layout.cards.length, 2);
  assert.equal(layout.cards[0].height, layout.cards[1].height);
  assert.ok(layout.cards[0].bottom < layout.cards[1].top);
  assert.ok(layout.cards[1].bottom <= 1002);
});

test('quota rows have fixed tracks for three-digit and missing labels', () => {
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });

  assert.equal(layout.cards[0].title.height, 96);
  assert.equal(layout.cards[0].quotaRows.length, 2);
  assert.ok(layout.cards[0].quotaRows.every((row) => row.barHeight >= 24));
  assert.ok(layout.cards[0].quotaRows.every((row) => row.remainingWidth >= 126));
  assert.ok(layout.cards[0].quotaRows[0].bottom <= layout.cards[0].quotaRows[1].top);
});

test('compact profiles hide Pikachu before shrinking quota bars', () => {
  const layout = getQuotaLayout({ width: 600, height: 800, providerCount: 2 });

  assert.equal(layout.showPikachu, false);
  assert.ok(layout.cards[0].quotaRows.every((row) => row.barHeight >= 24));
});

test('basic three-provider layout keeps every card row and progress bar non-overlapping', () => {
  const layout = getQuotaLayout({ width: 600, height: 800, providerCount: 3 });

  assert.equal(layout.showPikachu, false);
  assert.equal(layout.cards.length, 3);

  for (let index = 0; index < layout.cards.length; index += 1) {
    const card = layout.cards[index];
    const [firstRow, secondRow] = card.quotaRows;
    assert.ok(card.title.bottom <= firstRow.top);
    assert.ok(firstRow.bottom <= secondRow.top);
    assert.ok(secondRow.bottom <= card.content.top + card.content.height + 0.001);

    for (const row of card.quotaRows) {
      assert.ok(row.barHeight >= 24);
      assert.ok(row.remaining?.top >= row.top);
      assert.ok(row.remaining?.bottom <= row.bottom);
      assert.ok(row.bar.top >= row.top);
      assert.ok(row.bar.top + row.bar.height <= row.bottom);
    }

    if (index < layout.cards.length - 1) {
      assert.ok(card.bottom < layout.cards[index + 1].top);
    }
  }
});

test('quota fill percentages remain exact, finite, and bounded', () => {
  assert.equal(getQuotaFillPercent(82.5), 82.5);
  assert.equal(getQuotaFillPercent(120), 100);
  assert.equal(getQuotaFillPercent(-1), 0);
  assert.equal(getQuotaFillPercent(undefined), 0);
});
