import { ImageResponse } from 'next/og';
import { getLayoutMetrics, resolveDashboardProfile } from './kindleProfiles.mjs';
import { makeOpaqueGrayscalePng } from './kindlePng.mjs';
import { getProviderCards } from './providerData.mjs';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function isVisible(searchParams, key, defaultVisible) {
  const value = searchParams.get(key);
  if (value === null) {
    return defaultVisible;
  }

  return value !== 'false' && value !== '0' && value !== 'off';
}

function todayLabel() {
  return new Date()
    .toLocaleString('sv-SE', {
      timeZone: 'Asia/Taipei',
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(' ', ' / ');
}

function renderProgressTicks() {
  return [0, 1, 2, 3, 4].map((tick) => (
    <div
      key={tick}
      style={{
        display: 'flex',
        width: '2px',
        height: tick === 0 || tick === 4 ? '18px' : '12px',
        backgroundColor: '#111',
        opacity: tick === 0 || tick === 4 ? 1 : 0.45,
      }}
    />
  ));
}

function renderProgressBar(provider, cardHeight) {
  const isTall = cardHeight > 300;
  const barHeight = isTall ? 32 : 22;
  const fillWidth = `${Math.max(provider.progress, provider.progress === 0 ? 2 : provider.progress)}%`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        marginTop: isTall ? '22px' : '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          color: '#333',
          fontWeight: 700,
          lineHeight: 1,
          marginBottom: isTall ? '10px' : '7px',
        }}
      >
        <span
          style={{
            fontSize: isTall ? 17 : 14,
            fontWeight: 900,
            letterSpacing: 0,
          }}
        >
          REMAINING LIMIT
        </span>
        <span
          style={{
            fontSize: isTall ? 34 : 24,
            fontWeight: 900,
            color: '#111',
            letterSpacing: 0,
          }}
        >
          {provider.remaining}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          height: `${barHeight}px`,
          border: isTall ? '4px solid #111' : '3px solid #111',
          boxSizing: 'border-box',
          backgroundColor: '#f7f7f2',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: fillWidth,
            minWidth: provider.progress > 0 ? '8px' : '4px',
            height: '100%',
            backgroundColor: '#111',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          width: '100%',
          marginTop: '5px',
        }}
      >
        {renderProgressTicks()}
      </div>
    </div>
  );
}

function renderPikachuMark(src, isCompact) {
  return (
    <img
      src={src}
      width={isCompact ? 112 : 145}
      height={isCompact ? 103 : 134}
      style={{
        display: 'flex',
        objectFit: 'contain',
      }}
      alt=""
    />
  );
}

function renderMetricTile(label, value, isTall) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '31%',
        borderTop: '3px solid #111',
        paddingTop: '10px',
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 900,
          color: '#333',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: isTall ? 22 : 17,
          fontWeight: 900,
          color: '#111',
          lineHeight: 1.1,
          marginTop: '8px',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function renderProviderCard(provider, metrics, cardHeight, index, totalCards, pikachuSrc) {
  const isCompact = cardHeight <= 320;
  const isTall = cardHeight > 300;
  const title = provider.displayName || provider.name;
  const titleFont = isCompact
    ? title.length > 14
      ? metrics.valueFont - 14
      : metrics.valueFont - 2
    : isTall
    ? title.length > 14
      ? metrics.valueFont - 7
      : metrics.valueFont + 8
    : title.length > 14
      ? metrics.cardTitleFont + 8
      : metrics.cardTitleFont + 14;
  const fillAvailable = totalCards <= 2;

  return (
    <div
      key={provider.queryKey}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: fillAvailable ? 'auto' : `${cardHeight}px`,
        flexGrow: fillAvailable ? 1 : 0,
        flexShrink: fillAvailable ? 1 : 0,
        flexBasis: fillAvailable ? 0 : `${cardHeight}px`,
        border: `${metrics.border + 1}px solid #111`,
        boxSizing: 'border-box',
        padding: `${Math.round(metrics.cardPadding * 1.02)}px`,
        marginBottom: index === totalCards - 1 ? '0' : `${Math.round(metrics.cardGap * 0.72)}px`,
        width: '100%',
        backgroundColor: '#fff',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: '#444',
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {String(index + 1).padStart(2, '0')} / {provider.vendorLabel || provider.queryKey.toUpperCase()}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginTop: isTall ? '14px' : '9px',
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: titleFont,
            fontWeight: 900,
            lineHeight: 0.98,
            letterSpacing: 0,
            maxWidth: '82%',
          }}
        >
          {title}
        </span>
        {cardHeight >= 300 ? renderPikachuMark(pikachuSrc, isCompact) : null}
      </div>
      {renderProgressBar(provider, cardHeight)}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'stretch',
          width: '100%',
          marginTop: 'auto',
          paddingTop: isTall ? '22px' : '12px',
        }}
      >
        {renderMetricTile('REMAINING', provider.remaining, isTall)}
        {renderMetricTile('RESET', provider.reset, isTall)}
        {renderMetricTile('METER', `${provider.progress}%`, isTall)}
      </div>
    </div>
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const profile = resolveDashboardProfile(searchParams);
  const metrics = getLayoutMetrics(profile);
  const visibleProviders = getProviderCards().filter((provider) =>
    isVisible(searchParams, provider.queryKey, provider.defaultVisible),
  );

  const cards =
    visibleProviders.length > 0
      ? visibleProviders
      : [
          {
            queryKey: 'empty',
            vendorLabel: 'EMPTY',
            name: 'No providers',
            detail: 'Hidden',
            displayName: 'No Providers',
            remaining: '--',
            reset: 'Update URL query',
            progress: 0,
          },
        ];
  const cardHeight = cards.length > 2 ? 250 : profile.height <= 800 ? 300 : 420;
  const pikachuSrc = new URL('/pikachu-line.png', request.url).toString();

  const imageResponse = new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          backgroundColor: '#f5f5ee',
          color: '#111',
          fontFamily: 'Arial, Helvetica, sans-serif',
          padding: `${Math.max(metrics.padding - 4, 22)}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'flex-end',
            borderBottom: `${metrics.border * 2 + 1}px solid #111`,
            paddingBottom: '8px',
            marginBottom: '16px',
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  lineHeight: 1,
                }}
              >
                {todayLabel()}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          {cards.map((provider, index) =>
            renderProviderCard(provider, metrics, cardHeight, index, cards.length, pikachuSrc),
          )}
        </div>
      </div>
    ),
    {
      width: profile.width,
      height: profile.height,
    },
  );

  const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
  const kindlePng = makeOpaqueGrayscalePng(imageBytes);

  return new Response(kindlePng, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
    },
  });
}
