const DEFAULT_PROVIDER_COUNT = 2;

function boundedProviderCount(value) {
  const count = Number.parseInt(String(value), 10);
  return Number.isFinite(count) && count > 0 ? count : DEFAULT_PROVIDER_COUNT;
}

export function getQuotaFillPercent(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(Math.max(progress, 0), 100);
}

export function getQuotaLayout({ width, height, providerCount = DEFAULT_PROVIDER_COUNT }) {
  const count = boundedProviderCount(providerCount);
  const compactCanvas = width < 700 || height < 900;
  const denseCards = count > 2;
  const compact = compactCanvas || denseCards;
  const outerPadding = compactCanvas ? 18 : 22;
  const headerHeight = compactCanvas ? 52 : 58;
  const headerGap = compactCanvas ? 12 : 16;
  const cardGap = compact ? 10 : 14;
  const cardBorder = compact ? 3 : 4;
  const cardPadding = denseCards ? 12 : compactCanvas ? 16 : 22;
  const titleHeight = denseCards ? 58 : compactCanvas ? 84 : 96;
  const barHeight = compact ? 24 : 28;
  const barBorder = compact ? 3 : 4;
  const remainingWidth = denseCards ? 96 : compactCanvas ? 130 : 150;
  const barGap = denseCards ? 10 : compactCanvas ? 12 : 16;
  const rowBarTop = denseCards ? 34 : compactCanvas ? 46 : 58;
  const labelTop = denseCards ? 6 : compactCanvas ? 9 : 12;
  const labelFontSize = denseCards ? 14 : compactCanvas ? 16 : 18;
  const resetFontSize = denseCards ? 12 : compactCanvas ? 14 : 16;
  const remainingTop = denseCards ? 26 : compactCanvas ? 39 : 44;
  const remainingFontSize = denseCards ? 36 : compactCanvas ? 50 : 58;
  const cardTop = outerPadding + headerHeight + headerGap;
  const cardWidth = width - outerPadding * 2;
  const cardsHeight = height - outerPadding - cardTop - cardGap * (count - 1);
  const cardHeight = cardsHeight / count;

  const cards = Array.from({ length: count }, (_, index) => {
    const top = cardTop + index * (cardHeight + cardGap);
    const contentLeft = outerPadding + cardBorder + cardPadding;
    const contentTop = top + cardBorder + cardPadding;
    const contentWidth = cardWidth - (cardBorder + cardPadding) * 2;
    const contentHeight = cardHeight - (cardBorder + cardPadding) * 2;
    const quotaHeight = Math.max((contentHeight - titleHeight) / 2, 0);
    const barWidth = Math.max(contentWidth - remainingWidth - barGap, 0);

    const quotaRows = Array.from({ length: 2 }, (_, rowIndex) => {
      const rowTop = contentTop + titleHeight + rowIndex * quotaHeight;
      const barTop = rowTop + rowBarTop;
      return {
        top: rowTop,
        height: quotaHeight,
        bottom: rowTop + quotaHeight,
        remainingWidth,
        barHeight,
        label: {
          top: rowTop + labelTop,
          height: labelFontSize,
          bottom: rowTop + labelTop + labelFontSize,
          fontSize: labelFontSize,
        },
        reset: {
          top: rowTop + labelTop,
          height: resetFontSize,
          bottom: rowTop + labelTop + resetFontSize,
          fontSize: resetFontSize,
        },
        remaining: {
          top: rowTop + remainingTop,
          height: remainingFontSize,
          bottom: rowTop + remainingTop + remainingFontSize,
          width: remainingWidth,
          fontSize: remainingFontSize,
        },
        bar: {
          left: contentLeft + remainingWidth + barGap,
          top: barTop,
          width: barWidth,
          height: barHeight,
          innerLeft: contentLeft + remainingWidth + barGap + barBorder,
          innerTop: barTop + barBorder,
          innerWidth: Math.max(barWidth - barBorder * 2, 0),
          innerHeight: Math.max(barHeight - barBorder * 2, 0),
          bottom: barTop + barHeight,
        },
      };
    });

    return {
      left: outerPadding,
      top,
      width: cardWidth,
      height: cardHeight,
      bottom: top + cardHeight,
      border: cardBorder,
      padding: cardPadding,
      content: {
        left: contentLeft,
        top: contentTop,
        width: contentWidth,
        height: contentHeight,
      },
      title: {
        top: contentTop,
        height: titleHeight,
        bottom: contentTop + titleHeight,
      },
      quotaRows,
    };
  });

  return {
    width,
    height,
    outerPadding,
    compact,
    showPikachu: !compact,
    header: {
      left: outerPadding,
      top: outerPadding,
      width: width - outerPadding * 2,
      height: headerHeight,
      bottom: outerPadding + headerHeight,
    },
    cardGap,
    cardBorder,
    cardPadding,
    barBorder,
    rowBorder: compact ? 2 : 3,
    titleFont: denseCards
      ? { long: 36, short: 48 }
      : { long: 48, short: 64 },
    cards,
  };
}
