/**
 * Streak freezes — a token that buys a kid one missed day.
 *
 * Losing a 30-day streak to one sick day is the single most demoralising
 * thing a habit app can do, and it punishes exactly the kid who has been
 * trying hardest. A freeze spends itself automatically the morning after a
 * miss, so the kid finds their streak intact and a token gone rather than
 * having to notice and act in some window they'd never hit.
 *
 * Mechanically a frozen day is a vacation day scoped to one kid: the streak
 * walk already knows how to skip those, so nothing else has to change.
 */
import { db } from './db.js';
import { todayStr, prevDay, nowIso } from './dates.js';
import { isVacationDay } from './vacation.js';
import { isScheduledOn } from './schedule.js';

/** Is this specific kid's streak protected on this date? */
export function isFrozenDay(kidId, date) {
  if (!kidId) return false;
  return !!db
    .prepare(`SELECT 1 FROM streak_freeze_days WHERE kid_id = ? AND date = ?`)
    .get(kidId, date);
}

/** How many tokens this kid is holding. */
export function freezeTokens(kidId) {
  return db.prepare(`SELECT freeze_tokens AS n FROM kids WHERE id = ?`).get(kidId)?.n ?? 0;
}

export const grantFreezeToken = db.transaction((kidId, count = 1) => {
  db.prepare(`UPDATE kids SET freeze_tokens = MAX(0, freeze_tokens + ?) WHERE id = ?`).run(
    count,
    kidId
  );
  return freezeTokens(kidId);
});

/**
 * Spend tokens to cover yesterday, if it needs covering.
 *
 * Deliberately whole-day rather than per-task: "you missed yesterday and a
 * token saved it" is something a seven-year-old can hold in their head, where
 * "task 3 of 7 was frozen" is not. One token covers the whole day.
 *
 * Only fires when there was something to protect — a kid with no live streak
 * loses nothing by missing a day, so spending their token would be theft.
 *
 * Idempotent: safe to call on every page load, which is how it gets run.
 */
export const applyStreakFreezes = db.transaction(() => {
  const day = prevDay(todayStr());
  // Vacation and break days already protect streaks for free.
  if (isVacationDay(day) || isBreakDay(day)) return 0;

  let spent = 0;
  const kids = db.prepare(`SELECT id, freeze_tokens FROM kids WHERE freeze_tokens > 0`).all();

  for (const kid of kids) {
    if (isFrozenDay(kid.id, day)) continue;

    // Was anything actually expected of them?
    const scheduled = db
      .prepare(
        `SELECT days FROM tasks
         WHERE active = 1 AND is_bonus = 0 AND (kid_id IS NULL OR kid_id = ?)`
      )
      .all(kid.id)
      .some((t) => isScheduledOn(t.days, day));
    if (!scheduled) continue;

    // Did they do anything at all? A partial day still counts as showing up.
    const did = db
      .prepare(
        `SELECT 1 FROM completions
         WHERE kid_id = ? AND date = ? AND status IN ('pending', 'approved')`
      )
      .get(kid.id, day);
    if (did) continue;

    // Is there a streak worth saving?
    const live = db
      .prepare(`SELECT 1 FROM streaks WHERE kid_id = ? AND current_streak > 0`)
      .get(kid.id);
    if (!live) continue;

    db.prepare(
      `INSERT OR IGNORE INTO streak_freeze_days (kid_id, date, spent_at) VALUES (?, ?, ?)`
    ).run(kid.id, day, nowIso());
    db.prepare(`UPDATE kids SET freeze_tokens = freeze_tokens - 1 WHERE id = ?`).run(kid.id);
    spent++;
  }
  return spent;
});

/** A school-calendar day off: tasks still show, but a miss costs no streak. */
export function isBreakDay(date) {
  return !!db.prepare(`SELECT 1 FROM break_days WHERE date = ?`).get(date);
}

export function listBreakDays() {
  return db.prepare(`SELECT date, label FROM break_days ORDER BY date DESC LIMIT 90`).all();
}

export const setBreakDay = db.transaction((date, label, on) => {
  if (on) {
    db.prepare(`INSERT OR REPLACE INTO break_days (date, label) VALUES (?, ?)`).run(
      date,
      label || null
    );
  } else {
    db.prepare(`DELETE FROM break_days WHERE date = ?`).run(date);
  }
  return listBreakDays();
});

/** Freeze days a kid has actually used, newest first. */
export function freezeHistory(kidId) {
  return db
    .prepare(`SELECT date, spent_at FROM streak_freeze_days WHERE kid_id = ? ORDER BY date DESC LIMIT 30`)
    .all(kidId);
}
