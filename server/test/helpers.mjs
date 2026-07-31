/** Shared fixture builders and assertions for the audit regression tests. */
import { db } from '../src/db.js';

export const state = { failures: 0 };

export function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else {
    state.failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function requireScratchDb() {
  if (!process.env.DATA_DIR) {
    console.error('Refusing to run without DATA_DIR set — use `npm test`.');
    process.exit(1);
  }
}

export function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

export function makeKid(name, extra = {}) {
  // A real theme key, not a placeholder: PATCH /kids validates the theme it
  // reads back off the row, so a fixture with a made-up one fails every
  // unrelated field update with invalid_theme.
  const id = db
    .prepare(`INSERT INTO kids (name, avatar_icon, theme, age) VALUES (?, '🙂', 'soccer', 8)`)
    .run(name).lastInsertRowid;
  if (extra.checking) credit(id, extra.checking, 'checking');
  if (extra.savings) credit(id, extra.savings, 'savings');
  return id;
}

export function credit(kidId, amount, bucket = 'checking') {
  db.prepare(
    `INSERT INTO points_ledger (kid_id, amount, direction, bucket, source, created_at)
     VALUES (?, ?, 'earn', ?, 'test', ?)`
  ).run(kidId, amount, bucket, new Date().toISOString());
}

export function makeCategory(label = 'Chores') {
  return db.prepare(`INSERT INTO categories (label) VALUES (?)`).run(label).lastInsertRowid;
}

export function makeTask(categoryId, title = 'T', points = 5) {
  return db
    .prepare(
      `INSERT INTO tasks (title, category_id, point_value, days, active)
       VALUES (?, ?, ?, '0,1,2,3,4,5,6', 1)`
    )
    .run(title, categoryId, points).lastInsertRowid;
}

export function makeReward(title, cost, bucket = 'checking') {
  return db
    .prepare(
      `INSERT INTO rewards_catalog (title, cost, bucket_required, active) VALUES (?, ?, ?, 1)`
    )
    .run(title, cost, bucket).lastInsertRowid;
}

export function finish(label) {
  console.log(state.failures === 0 ? `\nAll ${label} checks passed.\n` : `\n${state.failures} check(s) failed.\n`);
  process.exit(state.failures === 0 ? 0 : 1);
}
