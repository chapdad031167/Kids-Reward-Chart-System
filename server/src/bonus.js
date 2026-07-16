import { db } from './db.js';
import { todayStr } from './dates.js';

/**
 * Mystery bonus tasks ("Fog of War"): on pseudo-random days (~4 of 7,
 * per kid), a themed mystery object appears on the kid's home screen.
 * Tapping it reveals a bonus task drawn from the parent-managed pool
 * (tasks flagged is_bonus), worth extra points. Day selection and task
 * pick are deterministic hashes of (date, kid) so restarts and multiple
 * devices agree; the pick is also stored so pool edits don't reshuffle
 * an already-assigned day.
 */

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function isMysteryDay(kidId, date) {
  return hashStr(`${date}:${kidId}:mystery`) % 7 < 4;
}

/**
 * The kid's mystery state for today:
 *   null                     — no mystery today (or empty pool)
 *   { revealed: false }      — mystery available, not opened yet
 *   { revealed: true, task, status, completion_id } — opened
 */
export function getBonusForToday(kidId) {
  const date = todayStr();
  if (!isMysteryDay(kidId, date)) return null;

  let assignment = db
    .prepare(`SELECT * FROM bonus_assignments WHERE kid_id = ? AND date = ?`)
    .get(kidId, date);

  if (!assignment) {
    const pool = db
      .prepare(
        `SELECT id FROM tasks WHERE active = 1 AND is_bonus = 1 AND (kid_id IS NULL OR kid_id = ?)`
      )
      .all(kidId);
    if (pool.length === 0) return null;
    const task = pool[hashStr(`${date}:${kidId}:pick`) % pool.length];
    db.prepare(
      `INSERT INTO bonus_assignments (kid_id, date, task_id, revealed) VALUES (?, ?, ?, 0)`
    ).run(kidId, date, task.id);
    assignment = { kid_id: kidId, date, task_id: task.id, revealed: 0 };
  }

  if (!assignment.revealed) return { revealed: false };

  const task = db
    .prepare(`SELECT id, title, icon, point_value FROM tasks WHERE id = ?`)
    .get(assignment.task_id);
  const completion = db
    .prepare(`SELECT id, status FROM completions WHERE task_id = ? AND kid_id = ? AND date = ?`)
    .get(task.id, kidId, date);
  return {
    revealed: true,
    task,
    status: completion ? completion.status : null,
    completion_id: completion ? completion.id : null,
  };
}

/** Kid opened the mystery. Idempotent. Returns the revealed state or null. */
export function revealBonus(kidId) {
  const state = getBonusForToday(kidId); // creates today's assignment if needed
  if (!state) return null;
  db.prepare(`UPDATE bonus_assignments SET revealed = 1 WHERE kid_id = ? AND date = ?`).run(
    kidId,
    todayStr()
  );
  return getBonusForToday(kidId);
}
