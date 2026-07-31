import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { db, DB_PATH } from './db.js';
import { todayStr, nowIso } from './dates.js';

/**
 * Automated backups: a consistent SQLite snapshot (via the online backup
 * API, safe while the app runs) lands in <data>/backups/ on every boot
 * and nightly at 03:15 local time. Oldest copies are pruned beyond
 * BACKUP_KEEP (default 14).
 *
 * Restoring is at the bottom of this file. It deliberately requires the
 * process to restart afterwards — see restoreBackup() for why.
 */

const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');

/**
 * Dated nightly snapshots, and the suffixed ones taken before a destructive
 * action (pre-fresh-start, pre-restore).
 *
 * Suffixed backups used to be written and then never shown, which made the
 * safety net invisible — the one file you want after a bad restore was the
 * one file the dashboard wouldn't list.
 */
const BACKUP_RE = /^reward-chart-\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?\.db$/;
const DATED_RE = /^reward-chart-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * A filename for a safety copy that is guaranteed not to already exist.
 *
 * The timestamp alone isn't enough: two restores in the same second would
 * collide, and a safety copy that overwrites an earlier safety copy is
 * exactly the bug this naming exists to prevent. Checking the directory is
 * cheap and doesn't depend on clock resolution.
 */
function uniqueSafetyName(suffix) {
  const d = new Date();
  const clock = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('');
  const base = `reward-chart-${todayStr()}-${clock}-${suffix}`;
  let name = `${base}.db`;
  for (let n = 2; fs.existsSync(path.join(BACKUP_DIR, name)); n++) name = `${base}-${n}.db`;
  return name;
}

export async function runBackup(suffix = '') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // Nightly snapshots are per-day on purpose (one file per date, rotated).
  // Safety copies must never collide: they used to be named per-day too,
  // which meant restoring a pre-restore copy began by overwriting that very
  // file with the current data — the undo destroyed the thing it was undoing
  // to, then quietly succeeded at doing nothing.
  const file = suffix ? uniqueSafetyName(suffix) : `reward-chart-${todayStr()}.db`;
  await db.backup(path.join(BACKUP_DIR, file));

  // Only the plain dated ones are pruned; a safety copy taken before a
  // destructive action has to outlive the rotation that follows it.
  const backups = fs.readdirSync(BACKUP_DIR).filter((f) => DATED_RE.test(f)).sort();
  while (backups.length > KEEP) {
    fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
  }
  console.log(`Backup written: ${file} (keeping last ${KEEP})`);
  return file;
}

/** List backups, newest first (parent dashboard shows these). */
export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => BACKUP_RE.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        file: f,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        // Surfaced so the dashboard can label it: "before restore" is a very
        // different thing from "Tuesday night".
        safety: !DATED_RE.test(f),
      };
    });
}

/**
 * Absolute path of a backup the parent may download, or null.
 *
 * Resolved by exact match against what `listBackups()` already exposes rather
 * than by sanitising the input — an allowlist can't be walked out of, so
 * `../../etc/passwd` and friends simply aren't in the set.
 */
export function backupFilePath(name) {
  const known = listBackups().some((b) => b.file === name);
  return known ? path.join(BACKUP_DIR, name) : null;
}

/**
 * Tables a restore candidate must contain before we'll swap it in. Not a
 * full schema check — migrations run on boot and will add anything missing —
 * but enough to reject a file that is a perfectly valid SQLite database of
 * something else entirely.
 */
const REQUIRED_TABLES = ['kids', 'tasks', 'completions', 'points_ledger', 'settings'];

/**
 * Is this file safe to restore from? Opens it read-only in its own
 * connection, so a corrupt or foreign file can't disturb the live one.
 *
 * Returns null when fine, or a reason string.
 */
export function inspectBackup(file) {
  let probe;
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return 'not_a_database';
  }
  try {
    // integrity_check reads the whole file; on a family-sized database that's
    // milliseconds, and it's the difference between restoring a backup and
    // restoring a corrupt one.
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return 'corrupt';

    const names = new Set(
      probe.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
    if (missing.length) return `not_a_reward_chart:${missing.join(',')}`;
    return null;
  } catch (err) {
    // Opening a file succeeds without reading it — SQLite only looks at the
    // header on the first query — so "this is a text file" arrives here
    // rather than at the constructor above. Worth naming precisely: the
    // dashboard says something different for "not a database" than for
    // "damaged", and those are the two most likely things a parent picks.
    const message = String(err.message || '').toLowerCase();
    if (message.includes('not a database') || message.includes('file is encrypted')) {
      return 'not_a_database';
    }
    if (message.includes('malformed') || message.includes('corrupt')) return 'corrupt';
    return 'unreadable';
  } finally {
    probe.close();
  }
}

/**
 * Replace the live database with a backup.
 *
 * The process must restart afterwards, and that is a design decision rather
 * than a limitation worked around. Twenty `db.transaction(...)` wrappers
 * across service.js, streakFreeze.js, seed.js and vacation.js are built at
 * module load and close over the connection object that existed then;
 * reopening the file would leave every one of them pointing at a closed
 * handle. Restructuring all of that — in the one operation you run precisely
 * because your data has already gone wrong — buys a couple of seconds and
 * costs a great deal of new surface area at the worst possible moment.
 *
 * The WAL matters as much as the main file. In WAL mode the database is
 * three files, and dropping a restored .db next to a live -wal lets SQLite
 * replay the old journal over it: a restore that appears to work and quietly
 * isn't. So the live connection is checkpointed and closed, and the sidecars
 * are removed along with the swap.
 */
export async function restoreBackup(name) {
  const source = backupFilePath(name);
  if (!source) return { ok: false, reason: 'unknown_backup' };

  const problem = inspectBackup(source);
  if (problem) return { ok: false, reason: problem };

  // A restore is destructive, so the thing being destroyed gets saved first.
  // This is the file you want if the backup turns out to be the wrong one.
  let safety;
  try {
    safety = await runBackup('pre-restore');
  } catch (err) {
    return { ok: false, reason: `safety_backup_failed:${err.message}` };
  }

  try {
    // Fold the WAL back into the main file and stop writing, so nothing is
    // holding pages that the swap is about to invalidate.
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (err) {
    return { ok: false, reason: `could_not_close:${err.message}`, safety };
  }

  try {
    fs.copyFileSync(source, DB_PATH);
    // Any surviving sidecar belongs to the database we just replaced.
    for (const sidecar of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
  } catch (err) {
    // The old database is closed and possibly half-overwritten; the safety
    // copy is the way back and the caller has to be told its name.
    return { ok: false, reason: `copy_failed:${err.message}`, safety };
  }

  console.log(`Restored ${name} over ${DB_PATH} (safety copy: ${safety}) — restarting.`);
  return { ok: true, restored: name, safety, at: nowIso() };
}

/**
 * What to do once a restore has landed. Set by index.js, which is where the
 * process's restart policy belongs — the router shouldn't decide to exit,
 * and a test mounting the router shouldn't have its runner killed.
 */
let restartHandler = null;

export function setRestartHandler(fn) {
  restartHandler = fn;
}

export function requestRestart() {
  if (restartHandler) restartHandler();
  return !!restartHandler;
}

export function scheduleBackups() {
  const safeRun = () => runBackup().catch((err) => console.warn(`Backup failed: ${err.message}`));
  safeRun(); // one on every boot

  // then nightly at 03:15 local time (container TZ)
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 15, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(function tick() {
    safeRun();
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
}
