// One place for the scheduled promotion window.
// Stripe promotion codes have an expiry and no start time, so Checkout
// omits allow_promotion_codes until this window opens and after it ends.
// Wall times are America/Los_Angeles. Nov 27–30 2026 are PST (UTC−8).
// The converter uses the zone, so an edit that lands in PDT keeps the real offset.

export const PROMO_TIME_ZONE = 'America/Los_Angeles';
export const PROMO_CODE = 'HOLIDAY15';

export const PROMO_WINDOW = {
  timeZone: PROMO_TIME_ZONE,
  start: { year: 2026, month: 11, day: 27, hour: 0, minute: 0, second: 0 },
  end: { year: 2026, month: 11, day: 30, hour: 23, minute: 59, second: 59 },
};

// Saturday of the sale, noon Pacific. Tests pin this so they do not follow the clock.
export const PROMO_WINDOW_SAMPLE_ISO = '2026-11-28T20:00:00.000Z';

function wallParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  let day = Number(map.day);
  let month = Number(map.month);
  let year = Number(map.year);
  // A few ICU builds report midnight as 24:00 on the previous calendar day.
  if (hour === 24) {
    hour = 0;
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + 1);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

// Milliseconds to add to a UTC instant to get the zone's wall clock read as UTC.
// Negative for America/Los_Angeles (PST −8h, PDT −7h).
export function timeZoneOffsetMs(utcMs, timeZone) {
  const parts = wallParts(new Date(utcMs), timeZone);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallAsUtc - utcMs;
}

export function zonedWallTimeToUtcMs(parts, timeZone = PROMO_TIME_ZONE) {
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let utc = wallAsUtc - timeZoneOffsetMs(wallAsUtc, timeZone);
  const adjusted = wallAsUtc - timeZoneOffsetMs(utc, timeZone);
  if (adjusted !== utc) utc = wallAsUtc - timeZoneOffsetMs(adjusted, timeZone);
  return utc;
}

export function promoWindowBounds(window = PROMO_WINDOW) {
  const startMs = zonedWallTimeToUtcMs(window.start, window.timeZone);
  const endSecondMs = zonedWallTimeToUtcMs(window.end, window.timeZone);
  // The end wall time names a second. The window stays open through that second.
  return { startMs, endMs: endSecondMs + 999 };
}

export function promoWindowOpen(now = new Date(), window = PROMO_WINDOW) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(t)) return false;
  const { startMs, endMs } = promoWindowBounds(window);
  return t >= startMs && t <= endMs;
}

export function saleBannerText(window = PROMO_WINDOW, code = PROMO_CODE) {
  const endMs = zonedWallTimeToUtcMs(window.end, window.timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timeZone,
    weekday: 'short',
  }).format(new Date(endMs));
  const hour = window.end.hour ?? 0;
  const hour12 = hour % 12 || 12;
  const minute = String(window.end.minute ?? 0).padStart(2, '0');
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `Black Friday: 15% off everything with code ${code} · ends ${weekday} ${window.end.month}/${window.end.day} ${hour12}:${minute} ${suffix} PT`;
}
