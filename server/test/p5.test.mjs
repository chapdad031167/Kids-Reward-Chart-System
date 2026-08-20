/**
 * Shared chores (turn-taking) and multi-category tasks.
 *
 * Driven over real HTTP like the P1 suite: the routes are where the turn
 * filter and the per-category completion slots live, so exercising the
 * service layer alone would miss exactly the bugs these features can grow.
 */
import express from 'express';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { kiosk } from '../src/routes/kiosk.js';
import { parent } from '../src/routes/parent.js';
import { todayStr, nextDay, prevDay } from '../src/dates.js';
import { scheduledCountBetween, turnKidOn, prevExpectedDay } from '../src/schedule.js';
import { check, requireScratchDb, makeKid, makeCategory, finish } from './helpers.mjs';

requireScratchDb();

const app = express();
app.use(express.json());
app.use('/api', kiosk);
app.use('/api/parent', parent);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const PIN = '1234';

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const asParent = (method, path, body) => req(method, path, body, { 'x-parent-pin': PIN });

const TODAY = todayStr();
const alice = makeKid('Alice');
const bob = makeKid('Bob');
const morning = makeCategory('Morning');
const evening = makeCategory('Evening');

// ------------------------------------------------------- rotation arithmetic
console.log('\nTurn rotation arithmetic');

check('no days elapsed → zero scheduled days', scheduledCountBetween(null, TODAY, TODAY) === 0);
check('a daily task counts every day', scheduledCountBetween(null, TODAY, nextDay(TODAY)) === 1);
check(
  'whole weeks use the closed form',
  scheduledCountBetween('135', '2026-01-04', '2026-02-01') === 12, // 4 weeks × Mon/Wed/Fri
  `${scheduledCountBetween('135', '2026-01-04', '2026-02-01')}`
);

// The example from the request: a daily chore shared by two kids alternates
// strictly, so the weekend days swap owners from one week to the next.
const dishwasher = { id: -1, days: null, rotation_anchor: '2026-08-16' }; // a Sunday
const week1 = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'];
const owners1 = week1.map((d) => turnKidOn(dishwasher, d, [1, 2]));
check('week 1 alternates Su/Tu/Th/Sa vs M/W/F', owners1.join('') === '1212121', owners1.join(''));
check(
  'week 2 flips: the second kid gets Sunday',
  turnKidOn(dishwasher, '2026-08-23', [1, 2]) === 2
);
check(
  'the rotation respects the days schedule, not the calendar',
  // Mon/Wed/Fri only: three turns a week, so kid 1 gets Mon+Fri, kid 2 Wed…
  ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-24'].map((d) =>
    turnKidOn({ id: -1, days: '135', rotation_anchor: '2026-08-17' }, d, [1, 2])
  ).join('') === '1212'
);

// ------------------------------------------------- shared chore over the API
console.log('\nShared chore: create, filter, tap');

const created = await asParent('POST', '/api/parent/tasks', {
  title: 'Load the dishwasher',
  category_ids: [morning],
  point_value: 2,
  icon: '🍽️',
  turn_kid_ids: [alice, bob],
});
check('a shared task is created', created.status === 201, `${created.status}`);
check('it reports its turn order', JSON.stringify(created.body.turn_kid_ids) === JSON.stringify([alice, bob]));
check('and is anchored today', created.body.rotation_anchor === TODAY, created.body.rotation_anchor);
check('a shared task belongs to no single kid', created.body.kid_id === null);
const sharedId = created.body.id;

const aliceToday = await req('GET', `/api/kids/${alice}/today`);
const bobToday = await req('GET', `/api/kids/${bob}/today`);
check(
  "it is on the first kid's chart today",
  aliceToday.body.tasks.some((t) => t.id === sharedId)
);
check(
  'flagged as shared so the kid screen can say "my turn"',
  aliceToday.body.tasks.find((t) => t.id === sharedId)?.shared === true
);
check(
  "and absent from the other kid's chart",
  !bobToday.body.tasks.some((t) => t.id === sharedId)
);

const wrongTurn = await req('POST', '/api/completions', { task_id: sharedId, kid_id: bob, client_id: 's1' });
check('the other kid cannot tap it', wrongTurn.status === 400, `${wrongTurn.status}`);
check('and is told why', wrongTurn.body.error === 'not_your_turn_today', wrongTurn.body.error);

const rightTurn = await req('POST', '/api/completions', { task_id: sharedId, kid_id: alice, client_id: 's2' });
check('the kid whose turn it is can tap it', rightTurn.status === 201, `${rightTurn.status}`);

// Streaks skip the other kid's days: approve today, then pretend the same
// kid also did their previous turn (two days ago) and recompute.
check(
  "the streak walk skips the other kid's turn days",
  prevExpectedDay(null, TODAY, alice, db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(sharedId)) ===
    prevDay(prevDay(TODAY)),
  prevExpectedDay(null, TODAY, alice, db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(sharedId))
);

// Validation: a rotation needs at least two distinct, real kids.
const lonely = await asParent('POST', '/api/parent/tasks', {
  title: 'X', category_ids: [morning], point_value: 1, turn_kid_ids: [alice],
});
check('a one-kid rotation is refused', lonely.status === 400, `${lonely.status}`);
const ghost = await asParent('POST', '/api/parent/tasks', {
  title: 'X', category_ids: [morning], point_value: 1, turn_kid_ids: [alice, 9999],
});
check('an unknown kid in the rotation is refused', ghost.status === 400, `${ghost.status}`);

// Editing an unrelated field must not reset whose turn it is.
const renamed = await asParent('PATCH', `/api/parent/tasks/${sharedId}`, { title: 'Load + start dishwasher' });
check('an unrelated edit keeps the anchor', renamed.body.rotation_anchor === TODAY, renamed.body.rotation_anchor);
check('and keeps the turn order', JSON.stringify(renamed.body.turn_kid_ids) === JSON.stringify([alice, bob]));

const solo = await asParent('PATCH', `/api/parent/tasks/${sharedId}`, { turn_kid_ids: [], kid_id: alice });
check('clearing the rotation makes it a normal task again', solo.body.turn_kid_ids.length === 0 && solo.body.kid_id === alice);

// ------------------------------------------------------ multi-category tasks
console.log('\nMulti-category tasks');

const teeth = await asParent('POST', '/api/parent/tasks', {
  title: 'Brush teeth',
  category_ids: [morning, evening],
  point_value: 1,
  icon: '🪥',
});
check('a task can sit in two categories', teeth.status === 201, `${teeth.status}`);
check(
  'and reports both',
  JSON.stringify([...teeth.body.category_ids].sort((a, b) => a - b)) ===
    JSON.stringify([morning, evening].sort((a, b) => a - b))
);
const teethId = teeth.body.id;

let kidView = await req('GET', `/api/kids/${alice}/today`);
const slots = kidView.body.tasks.filter((t) => t.id === teethId);
check('the kid sees one slot per category', slots.length === 2, `${slots.length}`);

const tapMorning = await req('POST', '/api/completions', {
  task_id: teethId, kid_id: alice, category_id: morning, client_id: 'm1',
});
check('tapping the morning slot works', tapMorning.status === 201, `${tapMorning.status}`);

kidView = await req('GET', `/api/kids/${alice}/today`);
const after = kidView.body.tasks.filter((t) => t.id === teethId);
check(
  'the morning slot is pending, the evening slot still open',
  after.find((t) => t.category_id === morning)?.status === 'pending' &&
    after.find((t) => t.category_id === evening)?.status == null
);

const dupe = await req('POST', '/api/completions', {
  task_id: teethId, kid_id: alice, category_id: morning, client_id: 'm2',
});
check('re-tapping the same slot is a duplicate', dupe.body.duplicate === true);

const tapEvening = await req('POST', '/api/completions', {
  task_id: teethId, kid_id: alice, category_id: evening, client_id: 'e1',
});
check('the evening slot is its own completion', tapEvening.status === 201 && tapEvening.body.duplicate === false);

const badSlot = await req('POST', '/api/completions', {
  task_id: teethId, kid_id: alice, category_id: 9999, client_id: 'e2',
});
check('a category the task is not in is refused', badSlot.status === 400, `${badSlot.status}`);

// Approving both slots pays twice but advances the streak once.
const pending = (await asParent('GET', '/api/parent/pending')).body.completions.filter(
  (c) => c.kid_id === alice && c.title === 'Brush teeth'
);
check('both slots reach the parent queue', pending.length === 2, `${pending.length}`);
check(
  'each labelled with its category',
  pending.every((c) => c.slot_count === 2) &&
    new Set(pending.map((c) => c.category_label)).size === 2,
  JSON.stringify(pending.map((c) => c.category_label))
);
for (const c of pending) await asParent('POST', `/api/parent/completions/${c.id}/approve`);

const balance = (await asParent('GET', '/api/parent/kids')).body.find((k) => k.id === alice).balances;
check('both approvals pay out', balance.checking >= 2);
const streak = db.prepare(`SELECT * FROM streaks WHERE task_id = ? AND kid_id = ?`).get(teethId, alice);
check('but the day counts once toward the streak', streak.current_streak === 1, `${streak.current_streak}`);

// An old client that sends no category falls back to the primary category.
const legacyTap = await req('POST', '/api/completions', { task_id: teethId, kid_id: bob, client_id: 'l1' });
check(
  'a category-less tap lands in the primary category',
  legacyTap.status === 201 && legacyTap.body.completion.category_id === morning,
  `${legacyTap.body.completion?.category_id}`
);

// Removing a category from the set shrinks the chart back down.
const shrunk = await asParent('PATCH', `/api/parent/tasks/${teethId}`, { category_ids: [evening] });
check('a category can be removed again', JSON.stringify(shrunk.body.category_ids) === JSON.stringify([evening]));
kidView = await req('GET', `/api/kids/${alice}/today`);
check(
  'and the kid is back to one slot',
  kidView.body.tasks.filter((t) => t.id === teethId).length === 1
);

const noCats = await asParent('PATCH', `/api/parent/tasks/${teethId}`, { category_ids: [] });
check('a task cannot be left with no category', noCats.status === 400, `${noCats.status}`);

// ------------------------------------------------------------------
server.close();
db.close();
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
finish('P5');
