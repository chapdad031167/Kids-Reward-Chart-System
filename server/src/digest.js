import { db } from './db.js';
import { todayStr, prevDay } from './dates.js';
import { isScheduledOn } from './schedule.js';
import { isVacationDay } from './vacation.js';
import { displayStreak } from './service.js';
import { notifyParent } from './notify.js';

/**
 * Weekly parent digest, pushed via ntfy on Sunday evenings: points and
 * tasks per kid, live streaks, new badges, and the most-skipped tasks —
 * the tuning signal for which chores are mispriced or unrealistic.
 */

function lastDays(n) {
  const days = [];
  let day = todayStr();
  for (let i = 0; i < n; i++) {
    days.push(day);
    day = prevDay(day);
  }
  return days;
}

export function buildDigest() {
  const days = lastDays(7);
  const since = days[days.length - 1];
  const sinceIso = `${since}T00:00:00`;
  const kids = db.prepare(`SELECT * FROM kids ORDER BY id`).all();
  const lines = [];

  for (const kid of kids) {
    const earned = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger
         WHERE kid_id = ? AND direction = 'earn'
           AND source != 'transfer' AND source != 'adjustment' AND created_at >= ?`
      )
      .get(kid.id, sinceIso).n;
    const approved = db
      .prepare(`SELECT COUNT(*) AS n FROM completions WHERE kid_id = ? AND status = 'approved' AND date >= ?`)
      .get(kid.id, since).n;
    const newBadges = db
      .prepare(`SELECT COUNT(*) AS n FROM badges WHERE kid_id = ? AND earned_at >= ?`)
      .get(kid.id, sinceIso).n;
    const liveStreaks = db
      .prepare(`SELECT s.*, t.days AS task_days FROM streaks s JOIN tasks t ON t.id = s.task_id WHERE s.kid_id = ?`)
      .all(kid.id)
      .filter((s) => displayStreak(s, s.task_days) >= 3).length;

    lines.push(
      `${kid.avatar_icon} ${kid.name}: +${earned} pts · ${approved} tasks · ` +
        `${liveStreaks} streak${liveStreaks === 1 ? '' : 's'} going (3+ days)` +
        (newBadges ? ` · ${newBadges} new badge${newBadges === 1 ? '' : 's'} 🏅` : '')
    );
  }

  // Most-skipped tasks: scheduled days (excluding today and vacation) with
  // no completion — the "is this chore mispriced?" signal.
  const tasks = db.prepare(`SELECT * FROM tasks WHERE active = 1 AND is_bonus = 0`).all();
  const completionLookup = db.prepare(
    `SELECT status FROM completions WHERE task_id = ? AND kid_id = ? AND date = ?`
  );
  const missed = [];
  for (const task of tasks) {
    let misses = 0;
    for (const kid of kids) {
      if (task.kid_id !== null && task.kid_id !== kid.id) continue;
      for (const day of days) {
        if (day === todayStr()) continue; // today isn't over yet
        if (!isScheduledOn(task.days, day) || isVacationDay(day)) continue;
        const c = completionLookup.get(task.id, kid.id, day);
        if (!c || c.status === 'expired' || c.status === 'rejected') misses++;
      }
    }
    if (misses > 0) missed.push({ title: task.title, misses });
  }
  missed.sort((a, b) => b.misses - a.misses);
  if (missed.length > 0) {
    lines.push('', 'Most skipped this week:');
    for (const m of missed.slice(0, 3)) lines.push(`• ${m.title} (${m.misses}x)`);
  }

  const pendingNow = db
    .prepare(`SELECT COUNT(*) AS n FROM completions WHERE status = 'pending' AND date = ?`)
    .get(todayStr()).n;
  if (pendingNow > 0) lines.push('', `⏳ ${pendingNow} completion${pendingNow === 1 ? '' : 's'} waiting for approval right now.`);

  return lines.join('\n');
}

export function sendDigest() {
  const text = buildDigest();
  notifyParent('Weekly reward chart digest', text, 'bar_chart');
  return text;
}

/** Sundays at 18:00 local (container TZ). No-op delivery when NTFY_URL is unset. */
export function scheduleDigest() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(18, 0, 0, 0);
  const daysUntilSunday = (7 - next.getDay()) % 7;
  next.setDate(next.getDate() + daysUntilSunday);
  if (next <= now) next.setDate(next.getDate() + 7);
  setTimeout(function tick() {
    try {
      sendDigest();
    } catch (err) {
      console.warn(`Digest failed: ${err.message}`);
    }
    setTimeout(tick, 7 * 24 * 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
}
