const TZ = process.env.TZ || 'America/New_York';

/** Today's date in the household's local timezone, as YYYY-MM-DD. */
export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** The day before a YYYY-MM-DD date string. */
export function prevDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The day after a YYYY-MM-DD date string. */
export function nextDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Day of week (0=Sunday … 6=Saturday) for a YYYY-MM-DD string. */
export function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}
