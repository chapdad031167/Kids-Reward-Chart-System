/**
 * Behavioural checks for the P4 feature batch: reward daily caps, streak
 * freezes, school break days, CSV export and points→money.
 *
 * Driven over real HTTP for anything that lives in a route, because the bug
 * these guard against is "the route forgot to call the helper" — a unit test
 * of the helper alone would pass right through it.
 */
import express from 'express';
import { db } from '../src/db.js';
import { kiosk } from '../src/routes/kiosk.js';
import { parent } from '../src/routes/parent.js';
import { todayStr, prevDay, nowIso } from '../src/dates.js';
import { prevExpectedDay } from '../src/schedule.js';
import { applyStreakFreezes, isFrozenDay, freezeTokens } from '../src/streakFreeze.js';
import {
  check,
  requireScratchDb,
  makeKid,
  makeCategory,
  makeTask,
  makeReward,
  finish,
} from './helpers.mjs';

requireScratchDb();

const app = express();
app.use(express.json());
app.use('/api', kiosk);
app.use('/api/parent', parent);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const PIN = '1234'; // fresh DB, no setting and no env override

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

const asParent = (method, path, body) => req(method, path, body, { 'x-parent-pin': PIN });

const TODAY = todayStr();
const YESTERDAY = prevDay(TODAY);

// ------------------------------------------------------- Reward daily caps
console.log('\nReward daily caps');

const capKid = makeKid('Cappy', { checking: 500 });
const capped = makeReward('30 min screen time', 5);
db.prepare(`UPDATE rewards_catalog SET limit_per_day = 1 WHERE id = ?`).run(capped);
const uncapped = makeReward('Sticker', 5);

const cap1 = await req('POST', '/api/redemptions', { kid_id: capKid, reward_id: capped });
check('the first request under the cap is accepted', cap1.status === 201, `${cap1.status}`);

const cap2 = await req('POST', '/api/redemptions', { kid_id: capKid, reward_id: capped });
check('a second request the same day is refused', cap2.status === 400, `${cap2.status}`);
check(
  'and says why, so the kid screen can word it as a cooldown not a shortfall',
  cap2.body.error === 'daily_limit_reached',
  cap2.body.error
);

// The whole point of counting pending: the first request above is still
// awaiting a parent, and the cap has to hold anyway.
const stillPending = db
  .prepare(`SELECT status FROM redemptions WHERE kid_id = ? AND reward_id = ?`)
  .get(capKid, capped).status;
check('the cap held while the first request was still pending', stillPending === 'pending', stillPending);

const catalogue = await req('GET', `/api/kids/${capKid}/rewards`);
const cappedRow = catalogue.body.rewards.find((r) => r.id === capped);
check('the catalogue marks a capped-out reward', cappedRow?.capped === true);
check(
  'and does not also call it unaffordable — the kid has the points, not the allowance',
  cappedRow?.affordable === false && catalogue.body.balances.checking >= cappedRow.cost
);

const uncappedRow = catalogue.body.rewards.find((r) => r.id === uncapped);
check('an uncapped reward is not marked capped', uncappedRow?.capped === false);
const un1 = await req('POST', '/api/redemptions', { kid_id: capKid, reward_id: uncapped });
const un2 = await req('POST', '/api/redemptions', { kid_id: capKid, reward_id: uncapped });
check('and can still be requested repeatedly', un1.status === 201 && un2.status === 201);

// A rejected request should give the allowance back — it never happened.
db.prepare(`UPDATE redemptions SET status = 'rejected' WHERE kid_id = ? AND reward_id = ?`).run(
  capKid,
  capped
);
const afterReject = await req('POST', '/api/redemptions', { kid_id: capKid, reward_id: capped });
check(
  'a rejected request does not burn the day’s allowance',
  afterReject.status === 201,
  `${afterReject.status} ${afterReject.body.error || ''}`
);

// ------------------------------------------------------------ Cap plumbing
console.log('\nCaps are settable through the parent API');

const created = await asParent('POST', '/api/parent/rewards', {
  title: 'Dessert',
  cost: 3,
  bucket_required: 'checking',
  limit_per_day: 2,
});
check('a cap survives reward creation', created.body.limit_per_day === 2, `${created.body.limit_per_day}`);

const uncappedSave = await asParent('PATCH', `/api/parent/rewards/${created.body.id}`, {
  limit_per_day: 0,
});
check(
  '0 clears the cap rather than capping at zero',
  uncappedSave.body.limit_per_day === null,
  `${uncappedSave.body.limit_per_day}`
);

const junkCap = await asParent('POST', '/api/parent/rewards', {
  title: 'Junk',
  cost: 3,
  bucket_required: 'checking',
  limit_per_day: 'lots',
});
check(
  'nonsense in the cap field means "no cap", not a crash',
  junkCap.status === 201 && junkCap.body.limit_per_day === null
);

// --------------------------------------------------------- Streak freezes
console.log('\nStreak freezes');

const cat = makeCategory('Chores');
const task = makeTask(cat, 'Brush teeth', 5);

/** A kid with a live streak who did nothing yesterday. */
function makeMisser(name, tokens) {
  const id = makeKid(name);
  db.prepare(`UPDATE kids SET freeze_tokens = ? WHERE id = ?`).run(tokens, id);
  db.prepare(
    `INSERT INTO streaks (task_id, kid_id, current_streak, longest_streak, last_completed_date)
     VALUES (?, ?, 9, 9, ?)`
  ).run(task, id, prevDay(YESTERDAY));
  return id;
}

const saved = makeMisser('Saved', 1);
applyStreakFreezes();
check('a token is spent to cover the missed day', freezeTokens(saved) === 0, `${freezeTokens(saved)}`);
check('and the day is recorded as frozen', isFrozenDay(saved, YESTERDAY));

const broke = makeMisser('Broke', 0);
applyStreakFreezes();
check('a kid with no tokens is not rescued', !isFrozenDay(broke, YESTERDAY));

// A token is a scarce thing — spending one on a kid who had no streak to lose
// is just taking it away from them.
const noStreak = makeKid('NoStreak');
db.prepare(`UPDATE kids SET freeze_tokens = 2 WHERE id = ?`).run(noStreak);
applyStreakFreezes();
check(
  'no token is spent when there was no streak to protect',
  freezeTokens(noStreak) === 2,
  `${freezeTokens(noStreak)}`
);

const showedUp = makeMisser('ShowedUp', 1);
db.prepare(
  `INSERT INTO completions (task_id, kid_id, date, status, completed_at)
   VALUES (?, ?, ?, 'pending', ?)`
).run(task, showedUp, YESTERDAY, nowIso());
applyStreakFreezes();
check(
  'a partial day still counts as showing up — no token spent',
  freezeTokens(showedUp) === 1,
  `${freezeTokens(showedUp)}`
);

// Running on every page load is the whole design; it must not drain tokens.
const repeat = makeMisser('Repeat', 3);
applyStreakFreezes();
applyStreakFreezes();
applyStreakFreezes();
check('repeated runs spend exactly one token', freezeTokens(repeat) === 2, `${freezeTokens(repeat)}`);

check(
  'the streak walk skips a frozen day for that kid',
  prevExpectedDay(null, TODAY, saved) === prevDay(YESTERDAY),
  prevExpectedDay(null, TODAY, saved)
);
check(
  'but not for a kid who did not spend a token',
  prevExpectedDay(null, TODAY, broke) === YESTERDAY,
  prevExpectedDay(null, TODAY, broke)
);
check(
  'and a caller with no kid in hand is unaffected',
  prevExpectedDay(null, TODAY) === YESTERDAY,
  prevExpectedDay(null, TODAY)
);

console.log('\nGranting freeze tokens');
const grant = await asParent('POST', `/api/parent/kids/${broke}/freeze-tokens`, { delta: 2 });
check('a parent can grant tokens', grant.body.tokens === 2, `${grant.body.tokens}`);
const takeBack = await asParent('POST', `/api/parent/kids/${broke}/freeze-tokens`, { delta: -1 });
check('and take one back', takeBack.body.tokens === 1, `${takeBack.body.tokens}`);
const floor = await asParent('POST', `/api/parent/kids/${broke}/freeze-tokens`, { delta: -10 });
check('the count never goes negative', floor.body.tokens === 0, `${floor.body.tokens}`);
const bogus = await asParent('POST', `/api/parent/kids/${broke}/freeze-tokens`, { delta: 9999 });
check('an absurd grant is refused', bogus.status === 400, `${bogus.status}`);
const noKid = await asParent('POST', '/api/parent/kids/99999/freeze-tokens', { delta: 1 });
check('granting to a kid who does not exist 404s', noKid.status === 404, `${noKid.status}`);

// -------------------------------------------------------------- Break days
console.log('\nSchool break days');

const breakDay = prevDay(prevDay(prevDay(TODAY)));
const setBreak = await asParent('POST', '/api/parent/break-days', {
  date: breakDay,
  label: 'Teacher workday',
});
check('a parent can mark a break day', setBreak.status === 200 && setBreak.body.days.length === 1);
check(
  'the streak walk skips it',
  prevExpectedDay(null, prevDay(prevDay(TODAY))) === prevDay(breakDay),
  prevExpectedDay(null, prevDay(prevDay(TODAY)))
);

const listed = await asParent('GET', '/api/parent/break-days');
check('and it comes back in the list with its label', listed.body[0]?.label === 'Teacher workday');

const cleared = await asParent('POST', '/api/parent/break-days', { date: breakDay, on: false });
check('removing it empties the list', cleared.body.days.length === 0);
check(
  'and the streak walk stops skipping it',
  prevExpectedDay(null, prevDay(prevDay(TODAY))) === breakDay
);

const badDate = await asParent('POST', '/api/parent/break-days', { date: 'someday' });
check('a bad date is refused', badDate.status === 400, `${badDate.status}`);

check(
  'break days are PIN-gated like everything else in the dashboard',
  (await req('GET', '/api/parent/break-days')).status === 401
);

// -------------------------------------------------------------- CSV export
console.log('\nCSV export');

// A comma and a quote in a task title are exactly what naive joining breaks on.
const nastyTask = db
  .prepare(
    `INSERT INTO tasks (title, category_id, point_value, days, active) VALUES (?, ?, 1, NULL, 1)`
  )
  .run('Tidy "the" room, properly', cat).lastInsertRowid;
db.prepare(
  `INSERT INTO completions (task_id, kid_id, date, status, completed_at)
   VALUES (?, ?, ?, 'approved', ?)`
).run(nastyTask, capKid, TODAY, nowIso());

const ledgerCsv = await asParent('GET', '/api/parent/export/ledger.csv');
check('the ledger export is served as CSV', /text\/csv/.test(ledgerCsv.headers.get('content-type')));
check(
  'as an attachment with a filename',
  /attachment; filename="reward-chart-ledger\.csv"/.test(ledgerCsv.headers.get('content-disposition'))
);
check(
  'with a header row',
  ledgerCsv.text.split('\r\n')[0] === 'when,kid,direction,bucket,points,source',
  ledgerCsv.text.split('\r\n')[0]
);
check('and one row per ledger entry', ledgerCsv.text.trim().split('\r\n').length > 1);

const completionsCsv = await asParent('GET', '/api/parent/export/completions.csv');
check(
  'the completions export quotes a title containing a comma and a quote',
  completionsCsv.text.includes('"Tidy ""the"" room, properly"'),
  completionsCsv.text.split('\r\n').find((l) => l.includes('Tidy'))
);
check(
  'exports are PIN-gated',
  (await req('GET', '/api/parent/export/ledger.csv')).status === 401
);

// ----------------------------------------------------------- Points→money
console.log('\nPoints → money');

const moneyKid = makeKid('Saver', { checking: 40 });
const setRate = await asParent('PATCH', `/api/parent/kids/${moneyKid}`, { cents_per_point: 5 });
check('a parent can set a conversion rate', setRate.body.cents_per_point === 5, `${setRate.body.cents_per_point}`);

const today = await req('GET', `/api/kids/${moneyKid}/today`);
check('the kid payload carries the rate', today.body.kid.cents_per_point === 5, `${today.body.kid.cents_per_point}`);
check('and the freeze count', today.body.kid.freeze_tokens === 0);

check(
  'the default is off, so nothing changes for families who never set it',
  (await req('GET', `/api/kids/${broke}/today`)).body.kid.cents_per_point === 0
);

for (const bad of [-1, 1001, 2.5, 'free']) {
  const r = await asParent('PATCH', `/api/parent/kids/${moneyKid}`, { cents_per_point: bad });
  // Assert the reason too — a fixture with a bogus theme once made every one
  // of these "pass" on invalid_theme without the rate ever being validated.
  check(
    `a rate of ${JSON.stringify(bad)} is refused`,
    r.status === 400 && r.body.error === 'invalid_cents_per_point',
    `${r.status} ${r.body.error}`
  );
}
check(
  'and a refused rate leaves the old one in place',
  db.prepare(`SELECT cents_per_point AS c FROM kids WHERE id = ?`).get(moneyKid).c === 5
);

// Changing the theme must not silently zero the rate — a PATCH that omits a
// field should leave it alone, which is the bug this shape invites.
await asParent('PATCH', `/api/parent/kids/${moneyKid}`, { theme: 'ocean' });
check(
  'an unrelated PATCH leaves the rate untouched',
  db.prepare(`SELECT cents_per_point AS c FROM kids WHERE id = ?`).get(moneyKid).c === 5
);

server.close();
finish('P4 feature');
