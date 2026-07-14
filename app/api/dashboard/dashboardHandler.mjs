import { ImageResponse } from 'next/og.js';
import { createElement as h } from 'react';

import { readDashboardConfig } from '../config/dashboardConfigStore.mjs';
import { getBatteryStatus } from './batteryStatus.mjs';
import { makeOpaqueGrayscalePng } from './kindlePng.mjs';
import { resolveDashboardProfile } from './kindleProfiles.mjs';
import { getQuotaFillPercent, getQuotaLayout } from './layoutModel.mjs';
import { getProviderCards } from './providerData.mjs';
import { readQuotaSnapshot } from './quotaStore.mjs';
import { resolveDashboardViewAccess } from './requestAuth.mjs';

function isVisible(searchParams, key, defaultVisible) {
  const value = searchParams.get(key);
  if (value === null) {
    return defaultVisible;
  }
  return value !== 'false' && value !== '0' && value !== 'off';
}

export function formatDashboardTimestamp(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${values.month}/${values.day} / ${values.hour}:${values.minute}`;
}

function renderBatteryIndicator(battery) {
  return h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center' } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            width: '42px',
            height: '20px',
            border: '3px solid #111',
            boxSizing: 'border-box',
            backgroundColor: '#fff',
          },
        },
        h('div', {
          style: {
            display: 'flex',
            width: `${battery.fillPercent}%`,
            height: '100%',
            backgroundColor: '#111',
          },
        }),
      ),
      h('div', {
        style: { display: 'flex', width: '4px', height: '10px', backgroundColor: '#111' },
      }),
    ),
    h('span', { style: { fontSize: 18, fontWeight: 900, lineHeight: 1 } }, battery.label),
  );
}

function renderQuotaRow(window, row, card, layout, rowIndex) {
  const fill = getQuotaFillPercent(window?.progress);
  const localBarLeft = row.bar.left - card.content.left;
  const localBarTop = row.bar.top - row.top;

  return h(
    'div',
    {
      key: rowIndex,
      style: {
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: `${row.height}px`,
        flexShrink: 0,
        boxSizing: 'border-box',
        borderTop: `${layout.rowBorder}px solid #111`,
      },
    },
    h(
      'span',
      {
        style: {
          position: 'absolute',
          left: 0,
          top: `${row.label.top - row.top}px`,
          fontSize: row.label.fontSize,
          fontWeight: 900,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        },
      },
      window?.label || '--',
    ),
    h(
      'span',
      {
        style: {
          position: 'absolute',
          right: 0,
          top: `${row.reset.top - row.top}px`,
          maxWidth: '68%',
          overflow: 'hidden',
          fontSize: row.reset.fontSize,
          fontWeight: 800,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          textAlign: 'right',
        },
      },
      window?.reset || 'WAITING FOR LOCAL SYNC',
    ),
    h(
      'span',
      {
        style: {
          position: 'absolute',
          left: 0,
          top: `${row.remaining.top - row.top}px`,
          width: `${row.remaining.width}px`,
          fontSize: row.remaining.fontSize,
          fontWeight: 900,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        },
      },
      window?.remaining || '--%',
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'absolute',
          left: `${localBarLeft}px`,
          top: `${localBarTop}px`,
          width: `${row.bar.width}px`,
          height: `${row.bar.height}px`,
          border: `${layout.barBorder}px solid #111`,
          boxSizing: 'border-box',
          backgroundColor: '#fff',
        },
      },
      h('div', {
        style: {
          display: 'flex',
          width: `${fill}%`,
          height: '100%',
          backgroundColor: '#111',
        },
      }),
    ),
  );
}

function renderProviderCard(provider, card, layout, index, artwork, defaultArtworkSrc) {
  const title = provider.displayName || provider.name;
  const titleFont = title.length > 10 ? layout.titleFont.long : layout.titleFont.short;
  const titleChildren = [
    h(
      'span',
      {
        key: 'vendor',
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          fontSize: 13,
          color: '#333',
          fontWeight: 900,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        },
      },
      `${String(index + 1).padStart(2, '0')} / ${provider.vendorLabel || provider.queryKey.toUpperCase()}${provider.syncLabel ? ` / ${provider.syncLabel}` : ''}`,
    ),
    h(
      'span',
      {
        key: 'title',
        style: {
          position: 'absolute',
          left: 0,
          bottom: layout.compact ? 8 : 6,
          maxWidth: layout.showPikachu ? '84%' : '100%',
          overflow: 'hidden',
          fontSize: titleFont,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: 0,
          whiteSpace: 'nowrap',
        },
      },
      title,
    ),
  ];
  if (layout.showPikachu) {
    titleChildren.push(h('img', {
      key: 'pikachu',
      src: artwork[provider.queryKey] || defaultArtworkSrc,
      width: 104,
      height: 96,
      style: {
        position: 'absolute',
        right: 0,
        top: 0,
        width: '104px',
        height: '96px',
        objectFit: 'contain',
      },
      alt: '',
    }));
  }

  return h(
    'div',
    {
      key: provider.queryKey,
      style: {
        display: 'flex',
        position: 'absolute',
        flexDirection: 'column',
        left: `${card.left}px`,
        top: `${card.top}px`,
        width: `${card.width}px`,
        height: `${card.height}px`,
        border: `${card.border}px solid #111`,
        boxSizing: 'border-box',
        padding: `${card.padding}px`,
        backgroundColor: '#fff',
        overflow: 'hidden',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'relative',
          width: '100%',
          height: `${card.title.height}px`,
          flexShrink: 0,
        },
      },
      ...titleChildren,
    ),
    renderQuotaRow(provider.windows?.fiveHour, card.quotaRows[0], card, layout, 0),
    renderQuotaRow(provider.windows?.sevenDay, card.quotaRows[1], card, layout, 1),
  );
}

function emptyProviderCard() {
  const missing = { label: '--', remaining: '--%', progress: 0, reset: 'UPDATE URL QUERY' };
  return {
    queryKey: 'empty',
    vendorLabel: 'EMPTY',
    displayName: 'No Providers',
    stale: false,
    windows: { fiveHour: missing, sevenDay: missing },
  };
}

function renderDashboard({ providers, layout, battery, artwork, defaultArtworkSrc, now }) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#f3f3ee',
        color: '#111',
        fontFamily: 'Arial, Helvetica, sans-serif',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'absolute',
          left: `${layout.header.left}px`,
          top: `${layout.header.top}px`,
          width: `${layout.header.width}px`,
          height: `${layout.header.height}px`,
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '5px solid #111',
          boxSizing: 'border-box',
          paddingBottom: '5px',
        },
      },
      renderBatteryIndicator(battery),
      h('span', { style: { fontSize: 18, fontWeight: 900, lineHeight: 1 } }, formatDashboardTimestamp(now)),
    ),
    ...providers.map((provider, index) =>
      renderProviderCard(
        provider,
        layout.cards[index],
        layout,
        index,
        artwork,
        defaultArtworkSrc,
      )),
  );
}

export function createDashboardHandler({
  env = process.env,
  now = Date.now,
  readQuotaSnapshot: readSnapshot = readQuotaSnapshot,
  readDashboardConfig: readConfig = readDashboardConfig,
  resolvePikachuSrc = (request) => new URL('/pikachu-line.png', request.url).toString(),
} = {}) {
  return async function dashboardHandler(request) {
    const url = new URL(request.url);
    const access = resolveDashboardViewAccess(url, env, { allowLocalFixture: true });
    if (access === 'misconfigured') {
      return new Response('Service unavailable', {
        status: 503,
        headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
      });
    }
    if (access === 'unauthorized') {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
      });
    }

    const snapshot = access === 'fixture' ? null : await readSnapshot();
    const renderNow = now();
    const cards = getProviderCards({ snapshot, env, now: renderNow });
    const profile = resolveDashboardProfile(url.searchParams);
    const managed = url.searchParams.get('managed') === 'true';
    const config = managed ? await readConfig(profile.key) : null;
    const visibleProviders = cards.filter((provider) =>
      managed
        ? config.providers[provider.queryKey].visible
        : isVisible(url.searchParams, provider.queryKey, provider.defaultVisible));
    const providers = visibleProviders.length > 0 ? visibleProviders : [emptyProviderCard()];
    const layout = getQuotaLayout({
      width: profile.width,
      height: profile.height,
      providerCount: providers.length,
    });
    const battery = getBatteryStatus(url.searchParams);
    const defaultArtworkSrc = resolvePikachuSrc(request);
    const artwork = managed
      ? {
        claude: config.providers.claude.imageDataUrl,
        openai: config.providers.openai.imageDataUrl,
      }
      : {};
    const imageResponse = new ImageResponse(
      renderDashboard({
        providers,
        layout,
        battery,
        artwork,
        defaultArtworkSrc,
        now: renderNow,
      }),
      { width: profile.width, height: profile.height },
    );
    const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
    const kindlePng = makeOpaqueGrayscalePng(imageBytes);

    return new Response(kindlePng, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
      },
    });
  };
}

export const dashboardGET = createDashboardHandler();
