import { prevDay, dayOfWeek } from './dates.js';
import { isVacationDay } from './vacation.js';
import { isFrozenDay, isBreakDay } from './streakFreeze.js';

/**
 * Task scheduling: tasks.days is a string of weekday digits (0=Sun…6=Sat)
 * the task appears on, or NULL for every day. Streaks only count days a
 * task was actually expected — unscheduled days and vacation days are
 * skipped when walking the consecutive-day chain.
 */

export function isScheduledOn(days, dateStr) {
  if (!days) return true;
  return days.includes(String(dayOfWeek(dateStr)));
}

/**
 * The most recent day before `date` on which this task was expected:
 * skips vacation days, school break days, days outside the task's schedule,
 * and — when a kid is given — any day that kid's streak freeze covered.
 *
 * `kidId` is optional so existing callers that genuinely have no kid in hand
 * keep working; passing it is what makes a spent freeze actually protect the
 * chain rather than just being recorded.
 */
export function prevExpectedDay(days, date, kidId = null) {
  let day = prevDay(date);
  let guard = 0;
  while (
    (isVacationDay(day) ||
      isBreakDay(day) ||
      isFrozenDay(kidId, day) ||
      !isScheduledOn(days, day)) &&
    guard++ < 400
  ) {
    day = prevDay(day);
  }
  return day;
}

/** Human summary for the parent task table ("Every day", "Mon–Fri", …). */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
