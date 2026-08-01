/**
 * Restoring a backup over the live database.
 *
 * This is the feature you only ever use when something has already gone
 * wrong, so the checks here are mostly about the ways a restore can appear
 * to succeed without having worked: a corrupt source, a valid-but-unrelated
 * SQLite file, a stale WAL replaying old pages over the restored file, and
 * the safety copy being invisible in the dashboard afterwards.
 *
 * Order matters. A successful restore closes the live connection — which is
 * the whole reason the process has to restart — and every parent route
 * reads the PIN from the database, so nothing can be driven over HTTP after
 * it. The destructive case therefore runs last, and runs through the route
 * so the endpoint and the restart hook are covered by it.
 */
import express from 'express';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';
import { db, DB_PATH } from '../src/db.js';
import { parent } from '../src/routes/parent.js';
import {
  runBackup,
  listBackups,
  inspectBackup,
  restoreBackup,
  setRestartHandler,
} from '../src/backup.js';
import { check, requireScratchDb, makeKid, finish } from './helpers.mjs';

requireScratchDb();

const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const app = express();
app.use(express.json());
app.use('/api/parent', parent);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function asParent(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-parent-pin': '1234' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Read kid names straight off the file, so it works after `db` is closed. */
function namesOnDisk(file = DB_PATH) {
  const conn = new Database(file, { readonly: true });
  const names = conn.prepare(`SELECT name FROM kids ORDER BY id`).all().map((k) => k.name);
  conn.close();
  return names.join();
}

// ------------------------------------------------------------- validation
console.log('\nValidating a candidate before touching anything');

makeKid('Original');
const snapshot = await runBackup();
check(
  'a backup of the real database passes inspection',
  inspectBackup(path.join(BACKUP_DIR, snapshot)) === null
);

// Back-to-back safety copies must be separate files even inside one second.
// The first fix here stamped the time and still collided when two restores
// landed in the same second, which is exactly what this suite does.
const rapid = [await runBackup('probe'), await runBackup('probe'), await runBackup('probe')];
check(
  'successive safety copies never overwrite each other',
  new Set(rapid).size === 3,
  rapid.join(' ')
);
check(
  'while nightly snapshots stay one-per-day',
  (await runBackup()) === (await runBackup()),
  'dated backups should reuse the same filename'
);
for (const f of rapid) fs.unlinkSync(path.join(BACKUP_DIR, f));

const junk = path.join(BACKUP_DIR, 'reward-chart-2020-01-01-junk.db');
fs.writeFileSync(junk, 'this is definitely not a database');
check('a non-database is rejected', inspectBackup(junk) === 'not_a_database', inspectBackup(junk));

// A perfectly valid SQLite file that simply isn't this app's.
const foreign = path.join(BACKUP_DIR, 'reward-chart-2020-01-02-foreign.db');
const other = new Database(foreign);
other.exec(`CREATE TABLE recipes (id INTEGER PRIMARY KEY, title TEXT)`);
other.close();
const foreignReason = inspectBackup(foreign);
check(
  'a valid SQLite file that is not a reward chart is rejected',
  foreignReason?.startsWith('not_a_reward_chart'),
  foreignReason
);

// Half a real database is what an interrupted copy looks like.
const truncated = path.join(BACKUP_DIR, 'reward-chart-2020-01-03-truncated.db');
const whole = fs.readFileSync(path.join(BACKUP_DIR, snapshot));
fs.writeFileSync(truncated, whole.subarray(0, Math.floor(whole.length / 2)));
const truncReason = inspectBackup(truncated);
check(
  'a truncated database is rejected rather than restored',
  truncReason !== null,
  `${truncReason}`
);

console.log('\nRefusing to restore what should not be restored');
for (const [name, expected] of [
  ['reward-chart-2020-01-01-junk.db', 'not_a_database'],
  ['reward-chart-2020-01-02-foreign.db', 'not_a_reward_chart'],
  ['nope.db', 'unknown_backup'],
  ['../../../etc/passwd', 'unknown_backup'],
]) {
  const r = await restoreBackup(name);
  check(`${name} → ${expected}`, r.ok === false && r.reason.startsWith(expected), JSON.stringify(r));
}
check('and the live database is untouched by any of that', namesOnDisk() === 'Original');

console.log('\nRoute-level refusals');
const missing = await asParent('POST', '/api/parent/backups/nope.db/restore');
check('restoring an unknown backup 404s', missing.status === 404, `${missing.status}`);

const traversal = await asParent(
  'POST',
  `/api/parent/backups/${encodeURIComponent('../../etc/passwd')}/restore`
);
check('a path-traversal name 404s rather than reading the file', traversal.status === 404, `${traversal.status}`);

const badFile = await asParent('POST', '/api/parent/backups/reward-chart-2020-01-01-junk.db/restore');
check('a junk file 400s with a reason', badFile.status === 400 && badFile.body.reason === 'not_a_database');

const unauth = await fetch(`${base}/api/parent/backups/${snapshot}/restore`, { method: 'POST' });
check('restore is PIN-gated like every other parent route', unauth.status === 401, `${unauth.status}`);

// --------------------------------------------------------- the real thing
// Everything past this point closes the live connection.
console.log('\nRestoring for real, through the route');

// Diverge the live database from the snapshot, so a successful restore is
// visible as data going *back* rather than merely as nothing changing.
makeKid('AddedAfterBackup');
check('the live database has moved on', namesOnDisk() === 'Original,AddedAfterBackup');

// The WAL trap: with pages sitting in the write-ahead log, dropping a
// restored .db beside a live -wal lets SQLite replay the old journal over
// it — a restore that reports success and quietly did nothing.
check('there are pages in the WAL to be trapped by', fs.existsSync(`${DB_PATH}-wal`));

let restartAsked = 0;
setRestartHandler(() => restartAsked++);

const done = await asParent('POST', `/api/parent/backups/${snapshot}/restore`);
check('the route reports success', done.status === 200 && done.body.ok === true, JSON.stringify(done.body));
check('and tells the dashboard a restart is coming', done.body.restarting === true);
check('and names the safety copy it took first', !!done.body.safety, JSON.stringify(done.body));

check('the WAL sidecar is gone', !fs.existsSync(`${DB_PATH}-wal`));
check('the SHM sidecar is gone', !fs.existsSync(`${DB_PATH}-shm`));
check(
  'the restored file holds the backup contents, not the newer ones',
  namesOnDisk() === 'Original',
  namesOnDisk()
);

// The response has to be flushed before the process goes away, or a family
// stares at a failed request with no idea whether the restore worked.
await new Promise((r) => setTimeout(r, 50));
check('a restart was requested, once', restartAsked === 1, `${restartAsked}`);

console.log('\nThe safety copy');
const safetyEntry = listBackups().find((b) => b.file === done.body.safety);
check(
  'the pre-restore copy is listed in the dashboard',
  !!safetyEntry,
  listBackups().map((b) => b.file).join(' ')
);
check('and is flagged as a safety copy rather than a nightly one', safetyEntry?.safety === true);
check(
  'and contains what was replaced',
  namesOnDisk(path.join(BACKUP_DIR, done.body.safety)) === 'Original,AddedAfterBackup',
  namesOnDisk(path.join(BACKUP_DIR, done.body.safety))
);

// The claim the confirm dialog makes is "this is undoable" — so undo it.
//
// This is the check that caught the real bug: safety copies were named
// per-day, so restoring one began by overwriting that very file with the
// current data. The undo destroyed its own source and reported success
// having changed nothing. Restoring once and stopping there never sees it.
// Run in a child process, because that is how it happens for real: the
// server restarts between the restore and the undo, and this process's
// connection is closed. Doing it in-process would be testing a situation
// that cannot occur.
console.log('\nUndoing the restore, which is the whole promise of the safety copy');
const child = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `const { restoreBackup } = await import('${path.resolve('src/backup.js')}');
     console.log(JSON.stringify(await restoreBackup(${JSON.stringify(done.body.safety)})));`,
  ],
  { env: { ...process.env, DATA_DIR: path.dirname(DB_PATH) }, encoding: 'utf8' }
);
const undone = JSON.parse(child.stdout.trim().split('\n').pop() || '{}');
check('the safety copy restores', undone.ok === true, `${child.stdout}${child.stderr}`);
check(
  'its own safety copy is a different file, not the one being restored',
  undone.safety && undone.safety !== done.body.safety,
  `${undone.safety} vs ${done.body.safety}`
);
check(
  'and the data that was replaced is actually back',
  namesOnDisk() === 'Original,AddedAfterBackup',
  namesOnDisk()
);

server.close();
finish('restore');
