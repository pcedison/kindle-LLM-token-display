function getParam(searchParams, key) {
  if (!searchParams) return undefined;
  if (typeof searchParams.get === 'function') return searchParams.get(key) ?? undefined;
  return searchParams[key];
}

export function parseBatteryLevel(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!/^\d{1,3}%?$/.test(normalized)) return undefined;
  const level = Number.parseInt(normalized, 10);
  return level >= 0 && level <= 100 ? level : undefined;
}

export function getBatteryStatus(searchParams) {
  const level = parseBatteryLevel(getParam(searchParams, 'battery'));
  return {
    level,
    label: level === undefined ? '--%' : `${level}%`,
    fillPercent: level ?? 0,
    available: level !== undefined,
  };
}
