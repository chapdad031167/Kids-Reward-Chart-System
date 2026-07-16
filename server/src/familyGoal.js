import { db } from './db.js';
import { nowIso } from './dates.js';
import { getSetting, setSetting } from './vacation.js';

/**
 * Family goal: one cooperative target both kids contribute to ("100
 * family points → pizza & movie night"). Kids see only the combined
 * bar — never each other's share — which keeps the no-comparison
 * guardrail intact. Progress counts genuinely earned points (tasks,
 * mysteries, awards, badge bonuses) since the goal was set; transfers
 * and manual adjustments don't count.
 */

export function getFamilyGoal() {
  const raw = getSetting('family_goal');
  if (!raw) return null;
  let goal;
  try {
    goal = JSON.parse(raw);
  } catch {
    return null;
  }
  const progress = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger
       WHERE direction = 'earn' AND source != 'transfer' AND source != 'adjustment'
         AND created_at >= ?`
    )
    .get(goal.started_at).n;
  return { ...goal, progress: Math.min(progress, goal.target), reached: progress >= goal.target };
}

/** Set (title/icon/target) or clear (null) the family goal. */
export function setFamilyGoal(input) {
  if (input === null) {
    setSetting('family_goal', '');
    return null;
  }
  const title = String(input.title || '').trim();
  const target = Number(input.target);
  if (!title || !Number.isInteger(target) || target <= 0) return { error: 'invalid_goal' };
  setSetting(
    'family_goal',
    JSON.stringify({ title, icon: input.icon || '🎉', target, started_at: nowIso() })
  );
  return getFamilyGoal();
}
