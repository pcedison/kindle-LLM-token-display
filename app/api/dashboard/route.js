import { ImageResponse } from 'next/og';
import { getLayoutMetrics, resolveDashboardProfile } from './kindleProfiles.mjs';
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
  const barHeight = cardHeight > 210 ? 22 : 17;
  const fillWidth = `${Math.max(provider.progress, provider.progress === 0 ? 2 : provider.progress)}%`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        marginTop: cardHeight > 210 ? '16px' : '10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: '#333',
          fontSize: cardHeight > 210 ? 16 : 14,
          fontWeight: 700,
          lineHeight: 1,
          marginBottom: '7px',
        }}
      >
        <span>USAGE METER</span>
        <span>{provider.progress}%</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          height: `${barHeight}px`,
          border: '3px solid #111',
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
          marginTop: '4px',
        }}
      >
        {renderProgressTicks()}
      </div>
    </div>
  );
}

function renderProviderCard(provider, metrics, cardHeight, index, totalCards) {
  const valueFont = cardHeight > 300 ? metrics.valueFont + 14 : metrics.valueFont + 2;
  const titleFont = cardHeight > 300 ? metrics.cardTitleFont + 6 : metrics.cardTitleFont + 2;

  return (
    <div
      key={provider.queryKey}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: `${cardHeight}px`,
        border: `${metrics.border + 1}px solid #111`,
        boxSizing: 'border-box',
        padding: `${Math.round(metrics.cardPadding * 1.05)}px`,
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            lineHeight: 1,
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
            {String(index + 1).padStart(2, '0')} / {provider.queryKey.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: titleFont,
              fontWeight: 900,
              lineHeight: 1.08,
              marginTop: '5px',
            }}
          >
            {provider.name}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            border: '2px solid #111',
            padding: '5px 9px',
            fontSize: metrics.resetFont - 2,
            fontWeight: 800,
            color: '#111',
            lineHeight: 1,
          }}
        >
          {provider.detail}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: cardHeight > 300 ? '24px' : '12px',
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: valueFont,
            fontWeight: 900,
            lineHeight: 0.95,
            letterSpacing: 0,
          }}
        >
          {provider.remaining}
        </span>
        <span
          style={{
            fontSize: metrics.resetFont - 1,
            color: '#333',
            lineHeight: 1.1,
            paddingBottom: `${Math.round(valueFont * 0.08)}px`,
            fontWeight: 700,
          }}
        >
          {provider.reset}
        </span>
      </div>
      {renderProgressBar(provider, cardHeight)}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'stretch',
          width: '100%',
          marginTop: 'auto',
          paddingTop: cardHeight > 300 ? '24px' : '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '48%',
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
            RESET TIME
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: '#111',
              lineHeight: 1.1,
              marginTop: '8px',
            }}
          >
            {provider.reset}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '48%',
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
            DISPLAY VALUE
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: '#111',
              lineHeight: 1.1,
              marginTop: '8px',
            }}
          >
            {provider.remaining}
          </span>
        </div>
      </div>
    </div>
  );
}

function renderAbstractMark() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '118px',
        height: '88px',
        border: '3px solid #111',
        padding: '10px',
        boxSizing: 'border-box',
        backgroundColor: '#fff',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', width: '22px', height: '22px', border: '3px solid #111' }} />
        <div style={{ display: 'flex', width: '52px', height: '8px', backgroundColor: '#111', marginTop: '7px' }} />
      </div>
      <div style={{ display: 'flex', width: '82px', height: '3px', backgroundColor: '#111', marginTop: '13px' }} />
      <div style={{ display: 'flex', width: '58px', height: '3px', backgroundColor: '#777', marginTop: '8px' }} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: '74px',
          marginTop: '12px',
        }}
      >
        <div style={{ display: 'flex', width: '9px', height: '9px', backgroundColor: '#111' }} />
        <div style={{ display: 'flex', width: '9px', height: '9px', backgroundColor: '#111' }} />
        <div style={{ display: 'flex', width: '9px', height: '9px', backgroundColor: '#111' }} />
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
            name: 'No providers',
            detail: 'Hidden',
            remaining: '--',
            reset: 'Update URL query',
          },
        ];
  const cardHeight = cards.length > 2 ? 250 : 410;

  return new ImageResponse(
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
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: `${metrics.border * 2 + 1}px solid #111`,
            paddingBottom: '14px',
            marginBottom: '18px',
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
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
              LLM TOKEN BOARD / PORTRAIT E-INK
            </span>
            <span
              style={{
                fontSize: metrics.headerFont + 4,
                fontWeight: 900,
                lineHeight: 1,
                marginTop: '8px',
              }}
            >
              TOKEN STATUS
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#333',
                lineHeight: 1,
                marginTop: '8px',
              }}
            >
              Usage limits and reset windows
            </span>
          </div>
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
                marginRight: '14px',
              }}
            >
              <span
                style={{
                  fontSize: metrics.metaFont,
                  fontWeight: 900,
                  lineHeight: 1,
                }}
              >
                {todayLabel()}
              </span>
            </div>
            {renderAbstractMark()}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
          }}
        >
          {cards.map((provider, index) => renderProviderCard(provider, metrics, cardHeight, index, cards.length))}
        </div>
      </div>
    ),
    {
      width: profile.width,
      height: profile.height,
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
      },
    },
  );
}
