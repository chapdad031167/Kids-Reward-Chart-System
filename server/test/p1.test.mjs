/**
 * Regression checks for the P1 audit findings (B4, B5).
 *
 * These two live in the route layer rather than the service, so the app is
 * mounted on an ephemeral port and driven over real HTTP — testing the helper
 * functions alone would not catch a route that forgets to call them, which is
 * exactly what B5 was.
 */
import express from 'express';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { kiosk } from '../src/routes/kiosk.js';
import { parent } from '../src/routes/parent.js';
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
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const asParent = (method, path, body) => req(method, path, body, { 'x-parent-pin': PIN });

// ------------------------------------------------------------------ B5
// The rewards list already subtracts pending redemption holds, but POST
// /redemptions checked the raw balance — so a kid with 20 points could queue
// two 15-point rewards and the second would only fail later, confusingly, at
// parent approval time.
console.log('\nB5 — redemption requests respect pending holds');
const spender = makeKid('Spender', { checking: 20 });
const reward15 = makeReward('Ice cream', 15);

const first = await req('POST', '/api/redemptions', { kid_id: spender, reward_id: reward15 });
check('the first affordable request is accepted', first.status === 201, `${first.status}`);

const second = await req('POST', '/api/redemptions', { kid_id: spender, reward_id: reward15 });
check('a second request the holds cannot cover is refused', second.status === 400, `${second.status}`);
check('and it says why', second.body.error === 'insufficient_points', JSON.stringify(second.body));

const queued = db
  .prepare(`SELECT COUNT(*) AS n FROM redemptions WHERE kid_id = ? AND status = 'pending'`)
  .get(spender).n;
check('only one request is queued', queued === 1, `${queued}`);

// The list endpoint and the POST must agree on what is affordable.
const list = await req('GET', `/api/kids/${spender}/rewards`);
const listed = list.body.rewards.find((r) => r.id === reward15);
check('the rewards list marks it unaffordable too', listed.affordable === false);

// Holds are released when the parent rules on the request.
const pendingId = db.prepare(`SELECT id FROM redemptions WHERE kid_id = ?`).get(spender).id;
await asParent('POST', `/api/parent/redemptions/${pendingId}/reject`);
const afterReject = await req('POST', '/api/redemptions', { kid_id: spender, reward_id: reward15 });
check('rejecting the hold frees the points again', afterReject.status === 201, `${afterReject.status}`);

// A kid with plenty of points is unaffected by the stricter check.
const rich = makeKid('Rich', { checking: 100 });
const a1 = await req('POST', '/api/redemptions', { kid_id: rich, reward_id: reward15 });
const a2 = await req('POST', '/api/redemptions', { kid_id: rich, reward_id: reward15 });
check('two requests still fit inside a large balance', a1.status === 201 && a2.status === 201);

// Savings holds must not block a checking purchase.
const saver = makeKid('Saver', { checking: 20, savings: 20 });
const savingsReward = makeReward('Big toy', 20, 'savings');
await req('POST', '/api/redemptions', { kid_id: saver, reward_id: savingsReward });
const crossBucket = await req('POST', '/api/redemptions', { kid_id: saver, reward_id: reward15 });
check('a savings hold does not block a checking reward', crossBucket.status === 201, `${crossBucket.status}`);

// ------------------------------------------------------------------ B4
// UNIQUE (task_id, kid_id, date) meant a rejected completion blocked that task
// for the rest of the day, with no way back short of Reset Day.
console.log('\nB4 — a rejected task can be re-opened');
const kid = makeKid('Redo');
const cat = makeCategory();
const task = makeTask(cat, 'Make the bed');

const tap = await req('POST', '/api/completions', { task_id: task, kid_id: kid, client_id: 'c1' });
check('the kid can tap the task', tap.status === 201, `${tap.status}`);
const completionId = tap.body.completion.id;

await asParent('POST', `/api/parent/completions/${completionId}/reject`);
check(
  'rejecting leaves the row in place',
  db.prepare(`SELECT status FROM completions WHERE id = ?`).get(completionId)?.status === 'rejected'
);

// Re-tapping doesn't error — it comes back as a duplicate of the rejected
// row, so the kid gets no new pending work no matter how often they tap.
const blocked = await req('POST', '/api/completions', { task_id: task, kid_id: kid, client_id: 'c2' });
check('re-tapping just returns the rejected row', blocked.body.duplicate === true, JSON.stringify(blocked.body));
check(
  'so no new pending work is created',
  db.prepare(`SELECT COUNT(*) AS n FROM completions WHERE task_id = ? AND kid_id = ? AND status = 'pending'`)
    .get(task, kid).n === 0
);

const shownRejected = (await asParent('GET', '/api/parent/pending')).body.rejected || [];
check('the parent queue surfaces the rejection', shownRejected.some((r) => r.id === completionId));

const reopened = await asParent('POST', `/api/parent/completions/${completionId}/reopen`);
check('the parent can re-open it', reopened.status === 200, `${reopened.status}`);
check(
  'the blocking row is gone',
  db.prepare(`SELECT id FROM completions WHERE id = ?`).get(completionId) === undefined
);

const retap = await req('POST', '/api/completions', { task_id: task, kid_id: kid, client_id: 'c3' });
check('so the kid can redo the work and tap again', retap.status === 201, `${retap.status}`);
check('and it is a real new tap, not a duplicate', retap.body.duplicate === false);
check(
  'and the fresh tap is pending, not auto-approved',
  db.prepare(`SELECT status FROM completions WHERE id = ?`).get(retap.body.completion.id)?.status === 'pending'
);

// Re-open only applies to rejections.
const notRejected = await asParent('POST', `/api/parent/completions/${retap.body.completion.id}/reopen`);
check('re-opening a pending completion is refused', notRejected.status === 400, `${notRejected.status}`);
check('re-opening an unknown id is refused', (await asParent('POST', '/api/parent/completions/99999/reopen')).status === 400);

// ------------------------------------------------------------------
server.close();
db.close();
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
finish('P1');
