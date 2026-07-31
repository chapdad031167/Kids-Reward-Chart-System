/**
 * Points → money.
 *
 * Stored in whole cents per point so nothing ever has to round a stored value;
 * formatting is the only place fractions appear. A rate of 0 means the family
 * has the feature off, and every caller is expected to check that rather than
 * render "$0.00" at a kid.
 */

/** "5¢" / "$1.00" — sub-dollar rates read better in cents. */
export function centsLabel(cents) {
  return cents < 100 ? `${cents}¢` : formatMoney(cents);
}

/** Whole cents → "$12.34". */
export function formatMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** What a pile of points is worth, or null when the feature is off. */
export function pointsToMoney(points, centsPerPoint) {
  if (!centsPerPoint) return null;
  return formatMoney(points * centsPerPoint);
}
