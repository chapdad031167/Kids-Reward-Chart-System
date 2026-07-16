import { db, balances } from './db.js';
import { todayStr, nowIso } from './dates.js';
import { isScheduledOn } from './schedule.js';

/**
 * Badges & levels. Badge definitions live here; earned badges are stored
 * (kid_id, badge_key) so they're permanent even if history later changes.
 * Streak badges carry a bonus-point award, credited to checking with a
 * 'badge:<key>' ledger source (excluded from lifetime-earned so badge
 * bonuses can't cascade into more badges).
 */

export const BADGES = [
  { key: 'first_point', icon: '🌱', title: 'First Points!', test: (s) => s.lifetime >= 1 },
  { key: 'points_100', icon: '💯', title: '100 Points Earned', test: (s) => s.lifetime >= 100 },
  { key: 'points_250', icon: '💎', title: '250 Points Earned', test: (s) => s.lifetime >= 250 },
  { key: 'points_500', icon: '👑', title: '500 Points Earned', test: (s) => s.lifetime >= 500 },
  { key: 'streak_3', icon: '🔥', title: '3-Day Streak', bonus: 2, test: (s) => s.maxStreak >= 3 },
  { key: 'streak_7', icon: '⚡', title: '7-Day Streak', bonus: 3, test: (s) => s.maxStreak >= 7 },
  { key: 'streak_14', icon: '🌟', title: '2-Week Streak', bonus: 5, test: (s) => s.maxStreak >= 14 },
  { key: 'streak_30', icon: '🏆', title: '30-Day Streak', bonus: 10, test: (s) => s.maxStreak >= 30 },
  { key: 'mystery_1', icon: '❓', title: 'Mystery Solved', test: (s) => s.mysteries >= 1 },
  { key: 'mystery_5', icon: '🗝️', title: '5 Mysteries Solved', test: (s) => s.mysteries >= 5 },
  { key: 'perfect_day', icon: '✨', title: 'Perfect Day', test: (s) => s.perfectDay },
  { key: 'saver_25', icon: '🏦', title: 'Super Saver', test: (s) => s.savings >= 25 },
];

/** Lifetime points earned (tasks, awards — not transfers/adjustments/badge bonuses). */
export function lifetimeEarned(kidId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger
       WHERE kid_id = ? AND direction = 'earn'
         AND source != 'transfer' AND source != 'adjustment' AND source NOT LIKE 'badge:%'`
    )
    .get(kidId).n;
}

function statsFor(kidId) {
  const maxStreak =
    db.prepare(`SELECT COALESCE(MAX(longest_streak), 0) AS n FROM streaks WHERE kid_id = ?`).get(kidId).n;
  const mysteries = db
    .prepare(
      `SELECT COUNT(*) AS n FROM completions c JOIN tasks t ON t.id = c.task_id
       WHERE c.kid_id = ? AND c.status = 'approved' AND t.is_bonus = 1`
    )
    .get(kidId).n;

  // Perfect day = every task scheduled for today is approved (and there was at least one).
  const today = todayStr();
  const todayTasks = db
    .prepare(
      `SELECT t.id, t.days, c.status
       FROM tasks t
       LEFT JOIN completions c ON c.task_id = t.id AND c.kid_id = ? AND c.date = ?
       WHERE t.active = 1 AND t.is_bonus = 0 AND (t.kid_id IS NULL OR t.kid_id = ?)`
    )
    .all(kidId, today, kidId)
    .filter((t) => isScheduledOn(t.days, today));
  const perfectDay = todayTasks.length > 0 && todayTasks.every((t) => t.status === 'approved');

  return {
    lifetime: lifetimeEarned(kidId),
    maxStreak,
    mysteries,
    savings: balances(kidId).savings,
    perfectDay,
  };
}

/**
 * Detect newly earned badges, store them, credit any bonus points.
 * Returns the newly earned badge definitions (usually empty).
 */
export function checkBadges(kidId) {
  const earned = new Set(
    db.prepare(`SELECT badge_key FROM badges WHERE kid_id = ?`).all(kidId).map((b) => b.badge_key)
  );
  const remaining = BADGES.filter((b) => !earned.has(b.key));
  if (remaining.length === 0) return [];

  const stats = statsFor(kidId);
  const fresh = remaining.filter((b) => b.test(stats));
  for (const badge of fresh) {
    db.prepare(`INSERT INTO badges (kid_id, badge_key, earned_at, seen) VALUES (?, ?, ?, 0)`).run(
      kidId,
      badge.key,
      nowIso()
    );
    if (badge.bonus) {
      db.prepare(
        `INSERT INTO points_ledger (kid_id, amount, direction, bucket, source, created_at)
         VALUES (?, ?, 'earn', 'checking', ?, ?)`
      ).run(kidId, badge.bonus, `badge:${badge.key}`, nowIso());
    }
  }
  return fresh;
}

/** Everything the kid UI needs: earned badges + the not-yet-seen ones. */
export function badgeState(kidId) {
  const rows = db.prepare(`SELECT * FROM badges WHERE kid_id = ?`).all(kidId);
  const byKey = new Map(rows.map((r) => [r.badge_key, r]));
  const earned = BADGES.filter((b) => byKey.has(b.key)).map((b) => ({
    key: b.key,
    icon: b.icon,
    title: b.title,
    bonus: b.bonus || 0,
    earned_at: byKey.get(b.key).earned_at,
  }));
  const locked = BADGES.filter((b) => !byKey.has(b.key)).map((b) => ({
    key: b.key,
    icon: b.icon,
    title: b.title,
    bonus: b.bonus || 0,
  }));
  const newUnseen = earned.filter((b) => byKey.get(b.key).seen === 0);
  return { earned, locked, newUnseen };
}

export function markBadgesSeen(kidId) {
  db.prepare(`UPDATE badges SET seen = 1 WHERE kid_id = ?`).run(kidId);
}

/**
 * Level from lifetime points: reaching level L takes 15·L·(L−1)/2 total.
 * (L2 at 15, L3 at 45, L4 at 90, L5 at 150 — a solid week of chores per level
 * early on, slowing as they climb.)
 */
export function levelFor(kidId) {
  const lifetime = lifetimeEarned(kidId);
  let level = 1;
  while (15 * (level * (level + 1)) / 2 <= lifetime) level++;
  const floor = 15 * ((level - 1) * level) / 2;
  const next = 15 * (level * (level + 1)) / 2;
  return { n: level, lifetime, floor, next };
}
