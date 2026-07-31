/**
 * Regression checks for the P0 audit findings (B1, B3, S2).
 *
 * No test framework — the server is plain Node + SQLite, and a dependency-free
 * script keeps `npm test` runnable on the box the app is deployed to.
 *
 * Runs against a throwaway DB via DATA_DIR so it can never touch real family
 * data; `npm test` sets that up.
 */
import fs from 'node:fs';
import { db } from '../src/db.js';
import * as svc from '../src/service.js';
import { lockoutRemaining, recordFailure, recordSuccess, resetGuard } from '../src/pinGuard.js';

if (!process.env.DATA_DIR) {
  console.error('Refusing to run without DATA_DIR set — use `npm test`.');
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function balance(kidId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'earn' THEN amount ELSE -amount END), 0) AS n
       FROM points_ledger WHERE kid_id = ?`
    )
    .get(kidId).n;
}

function ledgerRows(kidId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE kid_id = ?`).get(kidId).n;
}

function makeKid(name) {
  return db
    .prepare(`INSERT INTO kids (name, avatar_icon, theme, age) VALUES (?, '🙂', 'default', 8)`)
    .run(name).lastInsertRowid;
}

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

const today = dayOffset(0);
const yesterday = dayOffset(-1);
const twoDaysAgo = dayOffset(-2);

// ------------------------------------------------------------------ B1
// A batch award that names an unknown kid must pay nobody. Before the fix the
// loop inserted as it went and bailed with a plain `return`, which commits in
// better-sqlite3 — so earlier kids in the list kept points from a failed award.
console.log('\nB1 — awardPoints is all-or-nothing');
const a = makeKid('A');
const b = makeKid('B');

const rejected = svc.awardPoints([a, b, 999999], 10, 'test');
check('a batch naming an unknown kid is rejected', rejected.ok === false && rejected.reason === 'kid_not_found');
check('no points reach the earlier kids in that batch', balance(a) === 0 && balance(b) === 0, `${balance(a)}/${balance(b)}`);
check('no partial ledger rows are left behind', ledgerRows(a) === 0 && ledgerRows(b) === 0);

check('a valid batch succeeds', svc.awardPoints([a, b], 10, 'test').ok === true);
check('both kids are credited', balance(a) === 10 && balance(b) === 10, `${balance(a)}/${balance(b)}`);

check('a non-positive amount is rejected', svc.awardPoints([a], 0, 'test').reason === 'invalid_amount');
check('the rejected amount wrote nothing', balance(a) === 10, `${balance(a)}`);

// ------------------------------------------------------------------ B3
// Yesterday's completions stay approvable, so a parent who checks the queue in
// the morning doesn't find the kids' work silently expired overnight.
console.log('\nB3 — one-day approval grace window');
check('the approval window opens at yesterday', svc.oldestApprovableDate() === yesterday, svc.oldestApprovableDate());

const catId = db.prepare(`INSERT INTO categories (label) VALUES ('Chores')`).run().lastInsertRowid;
const taskId = db
  .prepare(
    `INSERT INTO tasks (title, category_id, point_value, days, active)
     VALUES ('T', ?, 5, '0,1,2,3,4,5,6', 1)`
  )
  .run(catId).lastInsertRowid;

const pend = (kidId, date) =>
  db
    .prepare(
      `INSERT INTO completions (task_id, kid_id, date, status, completed_at)
       VALUES (?, ?, ?, 'pending', ?)`
    )
    .run(taskId, kidId, date, new Date().toISOString()).lastInsertRowid;
const statusOf = (id) => db.prepare(`SELECT status FROM completions WHERE id = ?`).get(id).status;
const streakOf = (kidId) => db.prepare(`SELECT * FROM streaks WHERE task_id = ? AND kid_id = ?`).get(taskId, kidId);

const stale = pend(a, twoDaysAgo);
const yPending = pend(a, yesterday);
svc.expireStalePending();
check('a two-day-old pending item still expires', statusOf(stale) === 'expired', statusOf(stale));
check("yesterday's pending item survives", statusOf(yPending) === 'pending', statusOf(yPending));

// Out-of-order approval: today gets approved first, then yesterday is backfilled.
// The backfill must not look like a second consecutive day.
svc.approveCompletion(pend(a, today));
check('approving today starts the streak at 1', streakOf(a).current_streak === 1, `${streakOf(a).current_streak}`);

svc.approveCompletion(yPending);
check('backfilling yesterday does not inflate the streak', streakOf(a).current_streak === 1, `${streakOf(a).current_streak}`);
check('backfilling yesterday does not rewind the anchor date', streakOf(a).last_completed_date === today, streakOf(a).last_completed_date);

const bYesterday = pend(b, yesterday);
const bToday = pend(b, today);
svc.approveAllPending();
check(
  'approve-all covers both days in the window',
  statusOf(bYesterday) === 'approved' && statusOf(bToday) === 'approved',
  `${statusOf(bYesterday)}/${statusOf(bToday)}`
);

// In-order approval on consecutive days must still build a streak.
const c = makeKid('C');
svc.approveCompletion(pend(c, yesterday));
check('approving yesterday first starts the streak at 1', streakOf(c).current_streak === 1, `${streakOf(c).current_streak}`);
svc.approveCompletion(pend(c, today));
check('then approving today advances the streak to 2', streakOf(c).current_streak === 2, `${streakOf(c).current_streak}`);

// ------------------------------------------------------------------ S2
console.log('\nS2 — parent PIN brute-force guard');
resetGuard();
const key = 'test-client';
check('a fresh client is not locked out', lockoutRemaining(key) === 0);
for (let i = 0; i < 4; i++) recordFailure(key);
check('four wrong guesses are still allowed', lockoutRemaining(key) === 0);

const fifth = recordFailure(key);
check('the fifth wrong guess locks the client out for ~30s', fifth > 29_000 && fifth <= 30_000, `${fifth}ms`);
check('the sixth doubles the wait to ~60s', (() => {
  const w = recordFailure(key);
  return w > 59_000 && w <= 60_000;
})());

recordSuccess(key);
check('the correct PIN clears the lockout', lockoutRemaining(key) === 0);

resetGuard();
for (let i = 0; i < 30; i++) recordFailure(key);
check('the lockout caps at 15 minutes', lockoutRemaining(key) <= 15 * 60_000, `${lockoutRemaining(key)}ms`);

resetGuard();
for (let i = 0; i < 6; i++) recordFailure('client-a');
check("one client's lockout does not affect another", lockoutRemaining('client-b') === 0);

// ------------------------------------------------------------------
db.close();
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
