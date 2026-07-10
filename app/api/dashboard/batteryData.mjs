export function parseBatteryPercent(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  const number = Number(String(value).trim());
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    return undefined;
  }

  return Math.round(number);
}

export function getBatteryDisplay(searchParams) {
  const raw = typeof searchParams?.get === 'function' ? searchParams.get('battery') : undefined;
  const percent = parseBatteryPercent(raw);

  return {
    percent,
    label: percent === undefined ? '--%' : `${percent}%`,
  };
}
