// Time helpers that work in SEPTA's time zone regardless of the server's own.
//
// GTFS times are seconds since the start of the "service day" and can run past
// 24:00:00 for trips that continue after midnight, so everything here is
// expressed relative to a service day rather than the wall clock.

export const AGENCY_TZ = 'America/New_York';

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TZ,
  hour: 'numeric',
  minute: '2-digit',
});

function zonedParts(ms) {
  const parts = {};
  for (const { type, value } of partsFormat.formatToParts(new Date(ms))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

function tzOffsetMs(ms) {
  const p = zonedParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Today's date in the agency time zone, as YYYYMMDD. */
export function localDateString(ms) {
  const p = zonedParts(ms);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/** Shift a YYYYMMDD date by a number of days. */
export function addDays(yyyymmdd, days) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return (
    `${date.getUTCFullYear()}` +
    `${String(date.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(date.getUTCDate()).padStart(2, '0')}`
  );
}

/**
 * Epoch milliseconds of the start of a GTFS service day (YYYYMMDD).
 * Per the GTFS spec that is local noon minus 12 hours, which keeps times
 * right on days when clocks change.
 */
export function serviceDayStart(yyyymmdd) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const noonGuess = Date.UTC(y, m - 1, d, 12);
  const localNoon = noonGuess - tzOffsetMs(noonGuess);
  return localNoon - 12 * 3600 * 1000;
}

/**
 * Work out which service day a trip belongs to when the feed doesn't say.
 * A trip that runs past midnight and is still inside its after-midnight tail
 * belongs to yesterday's service day.
 */
export function inferServiceDate(nowMs, lastArrivalSeconds) {
  const today = localDateString(nowMs);
  if (lastArrivalSeconds != null && lastArrivalSeconds >= 86400) {
    const secondsToday = (nowMs - serviceDayStart(today)) / 1000;
    if (secondsToday <= lastArrivalSeconds - 86400 + 3600) {
      return addDays(today, -1);
    }
  }
  return today;
}

/** "6:42 PM" for an instant, in the agency time zone. */
export function formatClock(ms) {
  return clockFormat.format(new Date(ms));
}

/** "6:42 PM" for a GTFS time given as seconds since the service day start. */
export function formatServiceSeconds(seconds) {
  const wrapped = ((Math.round(seconds) % 86400) + 86400) % 86400;
  const h = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
}
