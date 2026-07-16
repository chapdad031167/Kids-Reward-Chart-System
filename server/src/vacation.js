import { db } from './db.js';
import { todayStr, prevDay, nextDay } from './dates.js';

/**
 * Vacation mode: a household-wide pause. While on, the daily task list is
 * paused (no completions, no mystery challenges) and streaks freeze —
 * vacation days don't count as "missed" when checking consecutive days.
 *
 * The current stretch is stored as settings (mode flag + start date);
 * when the mode turns off, the covered days are written to vacation_days
 * so streak math keeps skipping them forever after.
 */

export function getSetting(key) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function vacationState() {
  const on = getSetting('vacation_mode') === '1';
  return { on, since: on ? getSetting('vacation_since') : null };
}

export const setVacation = db.transaction((on) => {
  const state = vacationState();
  if (on === state.on) return state;
  if (on) {
    setSetting('vacation_mode', '1');
    setSetting('vacation_since', todayStr());
  } else {
    // Persist the finished stretch: start .. yesterday. Today is a normal
    // day again (routines resume the day the switch is flipped off).
    const end = todayStr();
    let day = state.since;
    let guard = 0;
    const insert = db.prepare(`INSERT OR IGNORE INTO vacation_days (date) VALUES (?)`);
    while (day && day < end && guard++ < 400) {
      insert.run(day);
      day = nextDay(day);
    }
    setSetting('vacation_mode', '0');
    setSetting('vacation_since', '');
  }
  return vacationState();
});

export function isVacationDay(date) {
  if (db.prepare(`SELECT 1 FROM vacation_days WHERE date = ?`).get(date)) return true;
  const state = vacationState();
  return state.on && !!state.since && date >= state.since;
}

/**
 * The most recent day before `date` that was NOT a vacation day — the day
 * a streak actually needs to have been completed on to stay alive.
 */
export function prevActiveDay(date) {
  let day = prevDay(date);
  let guard = 0;
  while (isVacationDay(day) && guard++ < 400) day = prevDay(day);
  return day;
}
