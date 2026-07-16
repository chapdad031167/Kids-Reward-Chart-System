import fs from 'node:fs';
import path from 'node:path';
import { db, DB_PATH } from './db.js';
import { todayStr } from './dates.js';

/**
 * Automated backups: a consistent SQLite snapshot (via the online backup
 * API, safe while the app runs) lands in <data>/backups/ on every boot
 * and nightly at 03:15 local time. Oldest copies are pruned beyond
 * BACKUP_KEEP (default 14). Restore = stop container, replace
 * reward-chart.db with a backup file, start.
 */

const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');

export async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `reward-chart-${todayStr()}.db`;
  await db.backup(path.join(BACKUP_DIR, file));

  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^reward-chart-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
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
    .filter((f) => /^reward-chart-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: stat.size, modified: stat.mtime.toISOString() };
    });
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
