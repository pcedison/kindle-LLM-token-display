const WINDOWS = { five_hour: 'fiveHour', seven_day: 'sevenDay' };
const MIN_RESET_EPOCH = Date.UTC(2020, 0, 1) / 1000;
const MAX_RESET_EPOCH = Date.UTC(2100, 0, 1) / 1000;

function finitePercent(value) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Number(value))) : null;
}

function normalizeWindow(value, collectedAt) {
  if (!value || typeof value !== 'object') return null;
  const usedPercent = finitePercent(value.used_percentage);
  const resetsAt = Number(value.resets_at);
  if (usedPercent === null || !Number.isInteger(resetsAt) || resetsAt < MIN_RESET_EPOCH || resetsAt > MAX_RESET_EPOCH) return null;
  return { usedPercent, resetsAt, collectedAt };
}

export function parseClaudeStatus(input, { now = Date.now } = {}) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  const source = parsed?.rate_limits;
  const collectedAt = new Date(now()).toISOString();
  const windows = {};
  for (const [official, normalized] of Object.entries(WINDOWS)) {
    const window = normalizeWindow(source?.[official], collectedAt);
    if (window) windows[normalized] = window;
  }
  return { collectedAt, windows };
}

function percentage(value) {
  const remaining = 100 - value;
  return Number.isFinite(remaining) ? `${Number(remaining.toFixed(2))}%` : '--%';
}

export function formatClaudeStatusLine(snapshot) {
  const fiveHour = snapshot?.windows?.fiveHour;
  const sevenDay = snapshot?.windows?.sevenDay;
  if (!fiveHour && !sevenDay) return 'Claude quota | waiting for first response';
  return `Claude quota | 5h ${fiveHour ? percentage(fiveHour.usedPercent) : '--%'} | 7d ${sevenDay ? percentage(sevenDay.usedPercent) : '--%'}`;
}
