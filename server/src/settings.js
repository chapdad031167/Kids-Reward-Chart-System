import { db } from './db.js';

/** Key/value app settings, persisted in the `settings` table. */
export function getSetting(key) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
