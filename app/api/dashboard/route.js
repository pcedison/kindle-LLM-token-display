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
  return new Date().toISOString().slice(0, 10);
}

function renderProviderCard(provider, metrics) {
  return (
    <div
      key={provider.queryKey}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: `${metrics.border}px solid #000`,
        boxSizing: 'border-box',
        padding: `${metrics.cardPadding}px`,
        marginBottom: `${metrics.cardGap}px`,
        width: '100%',
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
            fontSize: metrics.cardTitleFont,
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          {provider.name}
        </span>
        <span
          style={{
            fontSize: metrics.resetFont,
            color: '#333',
            lineHeight: 1.1,
          }}
        >
          {provider.detail}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: `${Math.round(metrics.cardPadding * 0.5)}px`,
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: metrics.valueFont,
            fontWeight: 900,
            lineHeight: 0.95,
          }}
        >
          {provider.remaining}
        </span>
        <span
          style={{
            fontSize: metrics.resetFont,
            color: '#333',
            lineHeight: 1.1,
            paddingBottom: `${Math.round(metrics.valueFont * 0.08)}px`,
          }}
        >
          {provider.reset}
        </span>
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
          backgroundColor: '#fff',
          color: '#000',
          fontFamily: 'Arial, Helvetica, sans-serif',
          padding: `${metrics.padding}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderBottom: `${metrics.border * 2}px solid #000`,
            paddingBottom: `${Math.round(metrics.padding * 0.35)}px`,
            marginBottom: `${metrics.cardGap}px`,
            width: '100%',
          }}
        >
          <span
            style={{
              fontSize: metrics.headerFont,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            TOKEN STATUS
          </span>
          <span
            style={{
              fontSize: metrics.metaFont,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {todayLabel()}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
          }}
        >
          {cards.map((provider) => renderProviderCard(provider, metrics))}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
            borderTop: `${metrics.border}px solid #000`,
            paddingTop: `${Math.round(metrics.padding * 0.35)}px`,
            width: '100%',
            color: '#333',
            fontSize: metrics.footerFont,
            lineHeight: 1,
          }}
        >
          <span>{profile.label}</span>
          <span>
            {profile.width}x{profile.height}
          </span>
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
