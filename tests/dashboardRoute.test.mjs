import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { createDashboardHandler } from '../app/api/dashboard/dashboardHandler.mjs';
import { getQuotaLayout } from '../app/api/dashboard/layoutModel.mjs';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const FIXED_NOW = Date.parse('2026-07-10T09:45:00.000Z');
const FIXED_NOW_SECONDS = Math.floor(FIXED_NOW / 1000);
const PIKACHU_DATA_URL = `data:image/png;base64,${readFileSync(
  new URL('../public/pikachu-line.png', import.meta.url),
).toString('base64')}`;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function parseGrayscalePng(bytes) {
  const data = Buffer.from(bytes);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const idat = [];
  let ihdr;
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = chunk;
    if (type === 'IDAT') idat.push(chunk);
    offset += 12 + length;
    if (type === 'IEND') break;
  }

  assert.ok(ihdr, 'PNG should include IHDR');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const scanlines = inflateSync(Buffer.concat(idat));
  const rows = Array.from({ length: height }, (_, y) =>
    scanlines.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)),
  );

  return {
    width,
    height,
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    interlace: ihdr[12],
    pixelAt(x, y) {
      return rows[y][x];
    },
    countNonwhite(top, bottom) {
      return rows
        .slice(top, bottom)
        .reduce((count, row) => count + row.reduce((sum, pixel) => sum + (pixel < 250), 0), 0);
    },
    countDark({ left, top, right, bottom }, threshold = 64) {
      let count = 0;
      for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
        for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
          count += rows[y][x] < threshold ? 1 : 0;
        }
      }
      return count;
    },
    countDifferences(other, { left, top, right, bottom }) {
      let count = 0;
      for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
        for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
          count += rows[y][x] !== other.pixelAt(x, y) ? 1 : 0;
        }
      }
      return count;
    },
  };
}

function liveSnapshot(overrides = {}) {
  return {
    version: 1,
    collectedAt: new Date(FIXED_NOW).toISOString(),
    providers: {
      claude: {
        windows: {
          fiveHour: { usedPercent: 17.5, resetsAt: FIXED_NOW_SECONDS + 3600 },
          sevenDay: { usedPercent: 19, resetsAt: FIXED_NOW_SECONDS + 7 * 86400 },
        },
      },
      codex: {
        windows: {
          fiveHour: { usedPercent: 4, resetsAt: FIXED_NOW_SECONDS + 5400 },
          sevenDay: { usedPercent: 11, resetsAt: FIXED_NOW_SECONDS + 7 * 86400 },
        },
      },
    },
    ...overrides,
  };
}

async function renderFixture({ snapshot = null, env = {}, query = '' } = {}) {
  const handler = createDashboardHandler({
    env,
    now: () => FIXED_NOW,
    readQuotaSnapshot: async () => snapshot,
    resolvePikachuSrc: () => PIKACHU_DATA_URL,
  });
  const response = await handler(new Request(`https://dashboard.test/api/dashboard?${query}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  return parseGrayscalePng(await response.arrayBuffer());
}

function assertPngMetadata(png, width, height) {
  assert.deepEqual(
    { width: png.width, height: png.height, bitDepth: png.bitDepth, colorType: png.colorType, interlace: png.interlace },
    { width, height, bitDepth: 8, colorType: 0, interlace: 0 },
  );
  assert.ok(png.countNonwhite(0, height) > 1_000, 'rendered PNG should be nonblank');
}

function assertBarProgress(png, bar, progress) {
  const y = Math.floor(bar.innerTop + bar.innerHeight / 2);
  if (progress === 0) {
    assert.ok(png.pixelAt(Math.floor(bar.innerLeft + bar.innerWidth / 2), y) > 240);
    return;
  }
  const boundary = bar.innerLeft + bar.innerWidth * progress / 100;
  assert.ok(png.pixelAt(Math.max(bar.innerLeft, Math.floor(boundary - 2)), y) < 32);
  if (progress < 100) {
    assert.ok(png.pixelAt(Math.min(bar.innerLeft + bar.innerWidth - 1, Math.ceil(boundary + 2)), y) > 240);
  }
}

async function waitForServer(origin, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${origin}/api/dashboard?profile=dp75sdi`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Next server did not start\n${output()}`);
}

test('preview helper never echoes a malformed URL or its view key', () => {
  const sentinel = 'fixture-supersecret-do-not-echo';
  const result = spawnSync(
    process.execPath,
    ['scripts/save-dashboard-preview.mjs', `not a url?key=${sentinel}`],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DASHBOARD_PREVIEW_URL: '' },
    },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(output, new RegExp(sentinel));
  assert.doesNotMatch(output, /not a url/);
});

test('view authorization runs before quota storage access', async () => {
  let reads = 0;
  const handler = createDashboardHandler({
    env: { DASHBOARD_VIEW_TOKEN: 'fixture-view-token' },
    readQuotaSnapshot: async () => {
      reads += 1;
      throw new Error('storage must not be reached');
    },
  });

  const response = await handler(new Request('https://dashboard.test/api/dashboard?key=wrong'));
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

test('live snapshot renders fractional quota and RESET COMPLETE without geometry intrusion', async () => {
  const expired = liveSnapshot();
  expired.providers.claude.windows.sevenDay = {
    usedPercent: 73,
    resetsAt: FIXED_NOW_SECONDS - 60,
  };
  const future = structuredClone(expired);
  future.providers.claude.windows.sevenDay = {
    usedPercent: 0,
    resetsAt: FIXED_NOW_SECONDS + 7200,
  };

  const [expiredPng, futurePng] = await Promise.all([
    renderFixture({ snapshot: expired }),
    renderFixture({ snapshot: future }),
  ]);
  assertPngMetadata(expiredPng, 758, 1024);
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });
  assertBarProgress(expiredPng, layout.cards[0].quotaRows[0].bar, 82.5);
  assertBarProgress(expiredPng, layout.cards[0].quotaRows[1].bar, 100);

  const resetRow = layout.cards[0].quotaRows[1];
  assert.ok(expiredPng.countDifferences(futurePng, {
    left: layout.cards[0].content.left + 260,
    top: resetRow.reset.top - 2,
    right: layout.cards[0].content.left + layout.cards[0].content.width,
    bottom: resetRow.reset.bottom + 4,
  }) > 20, 'RESET COMPLETE should produce distinct rendered reset-label pixels');
  assert.equal(expiredPng.countDark({
    left: layout.cards[0].content.left + resetRow.remaining.width,
    top: resetRow.remaining.top,
    right: resetRow.bar.left,
    bottom: resetRow.remaining.bottom,
  }), 0, '100% should leave a clean gap before the bar');
});

test('missing snapshot renders visible placeholders with empty progress tracks', async () => {
  const png = await renderFixture();
  assertPngMetadata(png, 758, 1024);
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });

  for (const card of layout.cards) {
    for (const row of card.quotaRows) {
      assertBarProgress(png, row.bar, 0);
      assert.ok(png.countDark({
        left: card.content.left,
        top: row.remaining.top,
        right: card.content.left + row.remaining.width,
        bottom: row.remaining.bottom,
      }) > 10, 'missing percentage placeholder should render');
      assert.ok(png.countDark({
        left: card.content.left + 260,
        top: row.reset.top - 2,
        right: card.content.left + card.content.width,
        bottom: row.reset.bottom + 4,
      }) > 10, 'missing reset placeholder should render');
    }
  }
});

test('stale live snapshot adds a rendered marker without changing card geometry', async () => {
  const fresh = liveSnapshot();
  const stale = liveSnapshot({ collectedAt: new Date(FIXED_NOW - 25 * 3600_000).toISOString() });
  const [freshPng, stalePng] = await Promise.all([
    renderFixture({ snapshot: fresh }),
    renderFixture({ snapshot: stale }),
  ]);
  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });
  const card = layout.cards[0];

  assertPngMetadata(stalePng, 758, 1024);
  assert.ok(stalePng.countDifferences(freshPng, {
    left: card.content.left + 95,
    top: card.title.top - 2,
    right: card.content.left + 210,
    bottom: card.title.top + 20,
  }) > 10, 'STALE marker should add distinct vendor-line pixels');
});

test('visibility variants render valid one-card, empty-card, and Basic three-card PNGs', async () => {
  const cases = [
    { query: 'claude=true&openai=false&gemini=false', width: 758, height: 1024, count: 1 },
    { query: 'claude=false&openai=false&gemini=false', width: 758, height: 1024, count: 1 },
    { query: 'profile=basic&gemini=true', width: 600, height: 800, count: 3 },
  ];

  for (const fixture of cases) {
    const png = await renderFixture({ snapshot: liveSnapshot(), query: fixture.query });
    assertPngMetadata(png, fixture.width, fixture.height);
    const layout = getQuotaLayout({
      width: fixture.width,
      height: fixture.height,
      providerCount: fixture.count,
    });
    for (const card of layout.cards) {
      assert.ok(png.countNonwhite(Math.floor(card.top), Math.ceil(card.bottom)) > 1_000);
    }
  }
});

test('KPW3 and Voyage profiles render exact opaque grayscale dimensions', async () => {
  for (const fixture of [
    { profile: 'kpw3', width: 1072, height: 1448 },
    { profile: 'voyage', width: 1080, height: 1440 },
  ]) {
    const png = await renderFixture({ snapshot: liveSnapshot(), query: `profile=${fixture.profile}` });
    assertPngMetadata(png, fixture.width, fixture.height);
    const layout = getQuotaLayout({ width: fixture.width, height: fixture.height, providerCount: 2 });
    for (const card of layout.cards) {
      assert.ok(png.countNonwhite(Math.floor(card.top), Math.ceil(card.bottom)) > 10_000);
    }
  }
});

test('dashboard route consumes two-window provider cards and renders a valid Kindle PNG', { timeout: 60_000 }, async (t) => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  let serverOutput = '';
  const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BLOB_READ_WRITE_TOKEN: '',
      DASHBOARD_VIEW_TOKEN: 'fixture-view-token',
      CLAUDE_FIVE_HOUR_REMAINING: '100%',
      CLAUDE_FIVE_HOUR_RESET_LABEL: 'RESET COMPLETE',
      CLAUDE_SEVEN_DAY_REMAINING: '81%',
      CLAUDE_SEVEN_DAY_RESET_LABEL: 'RESET 07/17 07:00',
      OPENAI_FIVE_HOUR_REMAINING: '96%',
      OPENAI_FIVE_HOUR_RESET_LABEL: 'RESET 19:10',
      OPENAI_SEVEN_DAY_REMAINING: '89%',
      OPENAI_SEVEN_DAY_RESET_LABEL: 'RESET 07/17 07:00',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.on('data', (chunk) => { serverOutput += chunk; });
  t.after(() => child.kill());

  await waitForServer(origin, () => serverOutput);

  const unauthorized = await fetch(`${origin}/api/dashboard?profile=dp75sdi`);
  assert.equal(unauthorized.status, 401);

  const response = await fetch(
    `${origin}/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false&battery=82&key=fixture-view-token`,
  );
  assert.equal(response.status, 200, serverOutput);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control') || '', /no-store/);

  const png = parseGrayscalePng(await response.arrayBuffer());
  assert.deepEqual(
    { width: png.width, height: png.height, bitDepth: png.bitDepth, colorType: png.colorType, interlace: png.interlace },
    { width: 758, height: 1024, bitDepth: 8, colorType: 0, interlace: 0 },
  );
  assert.ok(png.countNonwhite(96, 542) > 10_000, 'upper provider card should be nonblank');
  assert.ok(png.countNonwhite(556, 1002) > 10_000, 'lower provider card should be nonblank');

  const layout = getQuotaLayout({ width: 758, height: 1024, providerCount: 2 });
  for (const { providerIndex, rowIndex, progress } of [
    { providerIndex: 0, rowIndex: 0, progress: 100 },
    { providerIndex: 0, rowIndex: 1, progress: 81 },
    { providerIndex: 1, rowIndex: 0, progress: 96 },
    { providerIndex: 1, rowIndex: 1, progress: 89 },
  ]) {
    const bar = layout.cards[providerIndex].quotaRows[rowIndex].bar;
    const y = Math.floor(bar.innerTop + bar.innerHeight / 2);
    const boundary = bar.innerLeft + bar.innerWidth * progress / 100;
    assert.ok(png.pixelAt(Math.floor(boundary - 2), y) < 32, 'expected black quota fill');
    if (progress < 100) {
      assert.ok(png.pixelAt(Math.ceil(boundary + 2), y) > 240, 'expected white quota track');
    }
  }

  const firstCard = layout.cards[0];
  const firstRow = firstCard.quotaRows[0];
  assert.equal(png.countDark({
    left: firstCard.content.left + firstRow.remainingWidth,
    top: firstRow.top + 40,
    right: firstRow.bar.left,
    bottom: firstRow.top + 112,
  }), 0, '100% label must not intrude into the reserved gap before the bar');
});
