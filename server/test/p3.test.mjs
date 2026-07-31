/**
 * Regression checks for the P3 work: notification action tokens (§7) and the
 * backup download/restore endpoints (F2).
 *
 * The token is the one piece of this project that authorises a state change
 * without the PIN, so it gets adversarial coverage rather than a happy path.
 */
import express from 'express';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { kiosk } from '../src/routes/kiosk.js';
import { parent } from '../src/routes/parent.js';
import { mintToken, readToken } from '../src/actionToken.js';
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
const PIN = '1234';

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
    parsed = null;
  }
  return { status: res.status, text, body: parsed };
}
const asParent = (m, p, b) => req(m, p, b, { 'x-parent-pin': PIN });

const today = new Date().toLocaleDateString('en-CA');
const iso = new Date().toISOString();
const cat = makeCategory();

function pendingCompletion(kidId, taskId) {
  return db
    .prepare(
      `INSERT INTO completions (task_id, kid_id, date, status, completed_at)
       VALUES (?, ?, ?, 'pending', ?)`
    )
    .run(taskId, kidId, today, iso).lastInsertRowid;
}

// ------------------------------------------------------------------ tokens
console.log('\n§7 — notification action tokens');

const t = mintToken('completion', 42, 'approve');
const decoded = readToken(t);
check('a fresh token decodes to its claims', decoded?.kind === 'completion' && decoded?.id === 42 && decoded?.act === 'approve', JSON.stringify(decoded));

check('a garbage string is rejected', readToken('not-a-token') === null);
check('an empty string is rejected', readToken('') === null);
check('a non-string is rejected', readToken(null) === null);

// Tamper with the payload but keep the original signature.
const [payload, sig] = t.split('.');
const forgedPayload = Buffer.from(JSON.stringify({ k: 'completion', i: 999, a: 'approve', e: Date.now() + 60000 })).toString('base64url');
check('a swapped payload with a stale signature is rejected', readToken(`${forgedPayload}.${sig}`) === null);

// Tamper with the signature.
check('a mangled signature is rejected', readToken(`${payload}.${'a'.repeat(sig.length)}`) === null);
check('a truncated signature is rejected', readToken(`${payload}.${sig.slice(0, -4)}`) === null);
check('an unsigned token is rejected', readToken(payload) === null);

// Expiry is enforced.
const shortLived = mintToken('completion', 7, 'approve', Date.now(), 1000);
check('a token inside its window is accepted', readToken(shortLived, Date.now()) !== null);
check('the same token is rejected once expired', readToken(shortLived, Date.now() + 5000) === null);

// The claim set is closed.
const badKind = Buffer.from(JSON.stringify({ k: 'settings', i: 1, a: 'approve', e: Date.now() + 60000 })).toString('base64url');
check('an unknown record kind is rejected even if signed', readToken(`${badKind}.${sig}`) === null);

// ------------------------------------------------------------------ endpoint
console.log('\n§7 — the action endpoint');

const kid = makeKid('Tok');
const task = makeTask(cat, 'Feed the cat');
const c1 = pendingCompletion(kid, task);

check(
  'a bogus token is refused',
  (await req('POST', '/api/action/nonsense')).status === 403
);
check(
  'a token for another id cannot touch this one',
  db.prepare(`SELECT status FROM completions WHERE id = ?`).get(c1).status === 'pending'
);

const approveTok = mintToken('completion', Number(c1), 'approve');
const used = await req('POST', `/api/action/${approveTok}`);
check('a valid token approves the completion', used.status === 200, `${used.status}`);
check(
  'and the row really moved to approved',
  db.prepare(`SELECT status FROM completions WHERE id = ?`).get(c1).status === 'approved'
);
check('the kid was actually paid', db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE kid_id = ?`).get(kid).n > 0);

// Replaying is harmless rather than a second payout.
const before = db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE kid_id = ?`).get(kid).n;
const replay = await req('POST', `/api/action/${approveTok}`);
check('replaying the token is a no-op, not a double payout', replay.status === 200 && db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE kid_id = ?`).get(kid).n === before);

// A reject token cannot be repurposed to approve.
const c2 = pendingCompletion(kid, makeTask(cat, 'Water the plants'));
await req('POST', `/api/action/${mintToken('completion', Number(c2), 'reject')}`);
check(
  'a reject token rejects — it cannot approve',
  db.prepare(`SELECT status FROM completions WHERE id = ?`).get(c2).status === 'rejected'
);

// Redemptions go down the same path.
const buyer = makeKid('Buyer', { checking: 50 });
const reward = makeReward('Ice cream', 10);
const r1 = db
  .prepare(
    `INSERT INTO redemptions (kid_id, reward_id, cost_paid, redeemed_at, status)
     VALUES (?, ?, ?, ?, 'pending')`
  )
  .run(buyer, reward, 10, iso).lastInsertRowid;
await req('POST', `/api/action/${mintToken('redemption', Number(r1), 'approve')}`);
check(
  'a redemption token approves the redemption',
  db.prepare(`SELECT status FROM redemptions WHERE id = ?`).get(r1).status === 'approved'
);

// The token grants nothing beyond its one action.
check(
  'the token is not a session — parent routes still need the PIN',
  (await req('GET', '/api/parent/kids', undefined, { 'x-parent-pin': approveTok })).status === 401
);

// ------------------------------------------------------------------ backups
console.log('\nF2 — backup download');

const made = await asParent('POST', '/api/parent/backups');
check('a backup can be taken', made.status === 200, `${made.status}`);
const list = await asParent('GET', '/api/parent/backups');
check('and it appears in the list', Array.isArray(list.body) && list.body.length > 0);

const name = list.body[0].file;
const dl = await fetch(`${base}/api/parent/backups/${encodeURIComponent(name)}/download`, {
  headers: { 'x-parent-pin': PIN },
});
check('it downloads', dl.status === 200, `${dl.status}`);
const bytes = Buffer.from(await dl.arrayBuffer());
check('the download is a real SQLite file', bytes.subarray(0, 15).toString() === 'SQLite format 3', bytes.subarray(0, 15).toString());

check(
  'download needs the PIN',
  (await fetch(`${base}/api/parent/backups/${encodeURIComponent(name)}/download`)).status === 401
);

// Path traversal must not escape the backup directory.
for (const evil of ['../../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'sub/dir.db']) {
  const res = await fetch(`${base}/api/parent/backups/${encodeURIComponent(evil)}/download`, {
    headers: { 'x-parent-pin': PIN },
  });
  check(`traversal attempt is refused: ${evil}`, res.status >= 400, `${res.status}`);
}

// ------------------------------------------------------------------
server.close();
db.close();
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
finish('P3');
