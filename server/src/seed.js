import { db } from './db.js';
import { SEED_TASKS, SEED_BONUS_TASKS, SEED_REWARDS, CATEGORY_IDS } from './seedData.js';

/**
 * Runs on every boot: gives databases created before the mystery-task
 * feature a starter bonus pool. No-op once any bonus task exists.
 */
const insertTaskCategory = db.prepare(
  `INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)`
);

export function ensureBonusPool() {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE is_bonus = 1`).get().n;
  if (count > 0) return false;
  const insert = db.prepare(
    `INSERT INTO tasks (title, category_id, point_value, icon, active, kid_id, is_bonus)
     VALUES (?, ?, ?, ?, 1, NULL, 1)`
  );
  const run = db.transaction(() => {
    for (const t of SEED_BONUS_TASKS) {
      const info = insert.run(t.title, CATEGORY_IDS[t.category], t.points, t.icon);
      insertTaskCategory.run(info.lastInsertRowid, CATEGORY_IDS[t.category]);
    }
  });
  run();
  return true;
}

/**
 * Load the generic starter library — daily tasks, mystery bonus pool, and
 * rewards — into a household. Opt-in from the setup wizard, so a fresh
 * install can also start completely empty. Each section is skipped if it
 * already has content, making this safe to call more than once.
 */
export function seedStarterContent() {
  const run = db.transaction(() => {
    if (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE is_bonus = 0`).get().n === 0) {
      const insertTask = db.prepare(
        `INSERT INTO tasks (title, category_id, point_value, icon, active, kid_id)
         VALUES (?, ?, ?, ?, 1, NULL)`
      );
      for (const t of SEED_TASKS) {
        const info = insertTask.run(t.title, CATEGORY_IDS[t.category], t.points, t.icon);
        insertTaskCategory.run(info.lastInsertRowid, CATEGORY_IDS[t.category]);
      }
    }
    ensureBonusPool();
    if (db.prepare(`SELECT COUNT(*) AS n FROM rewards_catalog`).get().n === 0) {
      const insertReward = db.prepare(
        `INSERT INTO rewards_catalog (kid_id, title, cost, bucket_required, icon, active)
         VALUES (NULL, ?, ?, ?, ?, 1)`
      );
      for (const r of SEED_REWARDS) insertReward.run(r.title, r.cost, r.bucket, r.icon);
    }
  });
  run();
}
