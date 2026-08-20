import { db } from './db.js';
import { prevDay, dayOfWeek } from './dates.js';
import { isVacationDay } from './vacation.js';
import { isFrozenDay, isBreakDay } from './streakFreeze.js';

/**
 * Task scheduling: tasks.days is a string of weekday digits (0=Sun…6=Sat)
 * the task appears on, or NULL for every day. Streaks only count days a
 * task was actually expected — unscheduled days and vacation days are
 * skipped when walking the consecutive-day chain.
 *
 * Shared chores (task_turns rows) add a second dimension: on each scheduled
 * day the task belongs to exactly one of its kids, rotating through the
 * list one scheduled day at a time. A kid's "expected days" for a shared
 * task are only the days that were their turn.
 */

export function isScheduledOn(days, dateStr) {
  if (!days) return true;
  return days.includes(String(dayOfWeek(dateStr)));
}

/** Ordered kid ids sharing a task; empty when the task isn't shared. */
export function turnKidIds(taskId) {
  return db
    .prepare(`SELECT kid_id FROM task_turns WHERE task_id = ? ORDER BY position`)
    .all(taskId)
    .map((r) => r.kid_id);
}

/**
 * How many scheduled days fall in [from, to) for a weekly days pattern —
 * negative when `to` is before `from`, so a rotation extends backwards in
 * time as naturally as forwards. Closed-form over whole weeks so a
 * years-old anchor costs nothing.
 */
export function scheduledCountBetween(days, from, to) {
  if (to < from) return -scheduledCountBetween(days, to, from);
  const diff = Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);
  if (diff <= 0) return 0;
  const scheduled = new Set((days || '0123456').split('').filter((c) => /[0-6]/.test(c)));
  let count = Math.floor(diff / 7) * scheduled.size;
  const startDow = dayOfWeek(from);
  for (let i = 0; i < diff % 7; i++) {
    if (scheduled.has(String((startDow + i) % 7))) count++;
  }
  return count;
}

/**
 * Whose turn a shared task is on a date, or null when the task isn't
 * shared. The turn advances once per scheduled day from rotation_anchor
 * (whoever is listed first takes the anchor day), so two kids on a daily
 * chore alternate strictly: Sun/Tue/Thu/Sat one week, Mon/Wed/Fri/Sun the
 * next.
 */
export function turnKidOn(task, dateStr, kids = turnKidIds(task.id)) {
  if (kids.length === 0) return null;
  const anchor = task.rotation_anchor || dateStr;
  const turn = scheduledCountBetween(task.days, anchor, dateStr) % kids.length;
  return kids[(turn + kids.length) % kids.length];
}

/** Schedule plus turn: is this kid expected to do this task on this date? */
export function isExpectedFor(task, kidId, dateStr, kids = turnKidIds(task.id)) {
  if (!isScheduledOn(task.days, dateStr)) return false;
  const turn = turnKidOn(task, dateStr, kids);
  return turn === null || turn === kidId;
}

/**
 * The most recent day before `date` on which this task was expected:
 * skips vacation days, school break days, days outside the task's schedule,
 * and — when a kid is given — any day that kid's streak freeze covered.
 *
 * `kidId` is optional so existing callers that genuinely have no kid in hand
 * keep working; passing it is what makes a spent freeze actually protect the
 * chain rather than just being recorded.
 *
 * `task` (a row with at least id, days, rotation_anchor) is optional too:
 * with it, a shared task also skips the days that were another kid's turn,
 * so taking turns doesn't read as a broken streak.
 */
export function prevExpectedDay(days, date, kidId = null, task = null) {
  const turns = task ? turnKidIds(task.id) : [];
  let day = prevDay(date);
  let guard = 0;
  while (
    (isVacationDay(day) ||
      isBreakDay(day) ||
      isFrozenDay(kidId, day) ||
      !isScheduledOn(days, day) ||
      (turns.length > 0 && kidId !== null && turnKidOn(task, day, turns) !== kidId)) &&
    guard++ < 400
  ) {
    day = prevDay(day);
  }
  return day;
}

/** Human summary for the parent task table ("Every day", "Mon–Fri", …). */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
