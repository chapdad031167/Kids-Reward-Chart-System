import { Router } from 'express';
import { db, balances } from '../db.js';
import {
  expireStalePending,
  approveCompletion,
  rejectCompletion,
  reopenCompletion,
  approveRedemption,
  rejectRedemption,
  approveAllPending,
  oldestApprovableDate,
  undoLastAction,
  transferPoints,
  resetKidDay,
  adjustBalance,
  awardPoints,
  clearBadges,
  deleteKid,
  freshStart,
} from '../service.js';

import { vacationState, setVacation } from '../vacation.js';
import { listBackups, runBackup, backupFilePath } from '../backup.js';
import { checkBadges } from '../badges.js';
import { getFamilyGoal, setFamilyGoal } from '../familyGoal.js';
import { buildDigest, sendDigest, digestData } from '../digest.js';
import {
  getPin,
  setPin,
  getAppName,
  setAppName,
  isDefaultPin,
  getPublicUrl,
  setPublicUrl,
  getQuietHours,
  setQuietHours,
} from '../config.js';
import { clientKey, lockoutRemaining, recordFailure, recordSuccess } from '../pinGuard.js';
import { isValidTheme } from '../themes.js';
import {
  grantFreezeToken,
  freezeHistory,
  listBreakDays,
  setBreakDay,
} from '../streakFreeze.js';

export const parent = Router();

function lockedOut(req, res) {
  const wait = lockoutRemaining(clientKey(req));
  if (wait <= 0) return false;
  res.status(429).json({ error: 'too_many_attempts', retry_after_s: Math.ceil(wait / 1000) });
  return true;
}

parent.post('/verify', (req, res) => {
  if (lockedOut(req, res)) return;
  const key = clientKey(req);
  if ((req.body?.pin ?? '') === getPin()) {
    recordSuccess(key);
    return res.json({ ok: true });
  }
  const wait = recordFailure(key);
  res.json({ ok: false, ...(wait > 0 ? { retry_after_s: Math.ceil(wait / 1000) } : {}) });
});

// Every route below requires the PIN header. The same guard applies here, so
// the throttle can't be sidestepped by skipping /verify and hammering the
// header against a real endpoint.
parent.use((req, res, next) => {
  if (lockedOut(req, res)) return;
  const key = clientKey(req);
  if (req.get('x-parent-pin') !== getPin()) {
    recordFailure(key);
    return res.status(401).json({ error: 'bad_pin' });
  }
  recordSuccess(key);
  next();
});

// ---- Instance settings ----

parent.get('/settings', (req, res) => {
  res.json({
    appName: getAppName(),
    usingDefaultPin: isDefaultPin(),
    publicUrl: getPublicUrl(),
    quietHours: getQuietHours(),
  });
});

parent.post('/settings', (req, res) => {
  if (typeof req.body?.appName === 'string' && req.body.appName.trim().length > 0) {
    setAppName(req.body.appName);
  }
  // Empty string is meaningful here: it turns the notification buttons off.
  if (typeof req.body?.publicUrl === 'string') {
    const url = req.body.publicUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      return res.status(400).json({ error: 'invalid_public_url' });
    }
    setPublicUrl(url);
  }
  if (req.body?.quietHours !== undefined) {
    if (!setQuietHours(req.body.quietHours || {})) {
      return res.status(400).json({ error: 'invalid_quiet_hours' });
    }
  }
  res.json({
    ok: true,
    appName: getAppName(),
    publicUrl: getPublicUrl(),
    quietHours: getQuietHours(),
  });
});

parent.post('/pin', (req, res) => {
  if (!/^\d{4}$/.test(String(req.body?.pin ?? ''))) {
    return res.status(400).json({ error: 'invalid_pin' });
  }
  setPin(String(req.body.pin));
  res.json({ ok: true });
});

/** Today's pending completions plus all pending redemptions. */
parent.get('/pending', (req, res) => {
  expireStalePending();
  const completions = db
    .prepare(
      `SELECT c.id, c.date, c.completed_at, k.name AS kid_name, k.id AS kid_id,
              t.title, t.icon, t.point_value, t.is_bonus
       FROM completions c
       JOIN kids k ON k.id = c.kid_id
       JOIN tasks t ON t.id = c.task_id
       WHERE c.status = 'pending' AND c.date >= ?
       ORDER BY c.date, c.completed_at`
    )
    .all(oldestApprovableDate());
  const redemptions = db
    .prepare(
      `SELECT r.id, r.cost_paid, r.redeemed_at, k.name AS kid_name, k.id AS kid_id,
              rc.title, rc.icon, rc.bucket_required
       FROM redemptions r
       JOIN kids k ON k.id = r.kid_id
       JOIN rewards_catalog rc ON rc.id = r.reward_id
       WHERE r.status = 'pending'
       ORDER BY r.redeemed_at`
    )
    .all();
  // Approved but not yet delivered — the follow-through list.
  const toDeliver = db
    .prepare(
      `SELECT r.id, r.cost_paid, r.reviewed_at, k.name AS kid_name, k.id AS kid_id,
              rc.title, rc.icon
       FROM redemptions r
       JOIN kids k ON k.id = r.kid_id
       JOIN rewards_catalog rc ON rc.id = r.reward_id
       WHERE r.status = 'approved' AND r.fulfilled_at IS NULL
       ORDER BY r.reviewed_at`
    )
    .all();
  // Recently rejected, so "do it again" has somewhere to be undone from.
  const rejected = db
    .prepare(
      `SELECT c.id, c.date, c.reviewed_at, k.name AS kid_name, k.id AS kid_id,
              t.title, t.icon, t.point_value
       FROM completions c
       JOIN kids k ON k.id = c.kid_id
       JOIN tasks t ON t.id = c.task_id
       WHERE c.status = 'rejected' AND c.date >= ?
       ORDER BY c.reviewed_at`
    )
    .all(oldestApprovableDate());
  res.json({ completions, redemptions, toDeliver, rejected });
});

/**
 * Undo a rejection. Removes the completion so the task returns to the kid's
 * chart and they can redo the work and tap again.
 */
parent.post('/completions/:id/reopen', (req, res) => {
  if (!reopenCompletion(Number(req.params.id))) {
    return res.status(400).json({ error: 'not_rejected' });
  }
  res.json({ ok: true });
});

/** Mark an approved reward as actually delivered to the kid. */
parent.post('/redemptions/:id/fulfill', (req, res) => {
  const info = db
    .prepare(
      `UPDATE redemptions SET fulfilled_at = ? WHERE id = ? AND status = 'approved' AND fulfilled_at IS NULL`
    )
    .run(new Date().toISOString(), req.params.id);
  if (info.changes === 0) return res.status(400).json({ error: 'not_deliverable' });
  res.json({ ok: true });
});

/** Bonus award: points to one or more kids outside the task system. */
parent.post('/award', (req, res) => {
  const { kid_ids, amount, note } = req.body || {};
  const result = awardPoints(kid_ids, Number(amount), note);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  for (const kidId of kid_ids) checkBadges(kidId);
  res.json({ ok: true });
});

// ---- Family goal ----

parent.get('/family-goal', (req, res) => {
  res.json(getFamilyGoal());
});

parent.post('/family-goal', (req, res) => {
  const input = req.body?.clear ? null : req.body;
  const result = setFamilyGoal(input);
  if (result?.error) return res.status(400).json(result);
  res.json(result);
});

parent.post('/completions/:id/approve', (req, res) => {
  const completion = db.prepare(`SELECT kid_id FROM completions WHERE id = ?`).get(req.params.id);
  const ok = approveCompletion(Number(req.params.id));
  if (!ok) return res.status(400).json({ error: 'not_pending' });
  if (completion) checkBadges(completion.kid_id);
  res.json({ ok: true });
});

parent.post('/completions/:id/reject', (req, res) => {
  const ok = rejectCompletion(Number(req.params.id));
  if (!ok) return res.status(400).json({ error: 'not_pending' });
  res.json({ ok: true });
});

parent.post('/redemptions/:id/approve', (req, res) => {
  const result = approveRedemption(Number(req.params.id));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true });
});

parent.post('/redemptions/:id/reject', (req, res) => {
  const ok = rejectRedemption(Number(req.params.id));
  if (!ok) return res.status(400).json({ error: 'not_pending' });
  res.json({ ok: true });
});

parent.post('/approve-all', (req, res) => {
  const approved = approveAllPending();
  for (const kid of db.prepare(`SELECT id FROM kids`).all()) checkBadges(kid.id);
  res.json({ ok: true, approved });
});

parent.post('/undo', (req, res) => {
  const result = undoLastAction();
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json(result);
});

/**
 * Fresh start: safety backup first, then wipe all activity while keeping
 * kids, tasks, rewards, categories, and settings.
 */
parent.post('/fresh-start', async (req, res) => {
  try {
    const backup = await runBackup('pre-fresh-start');
    freshStart();
    res.json({ ok: true, backup });
  } catch (err) {
    res.status(500).json({ error: 'fresh_start_failed', message: err.message });
  }
});

// ---- Weekly digest ----

parent.get('/digest', (req, res) => {
  // Both shapes: `text` is what ntfy would send, `data` is what the dashboard
  // charts. Same numbers either way — they come from one builder.
  res.json({ text: buildDigest(), data: digestData() });
});

parent.post('/digest', (req, res) => {
  res.json({ ok: true, text: sendDigest() });
});

/** A daily cap of 0, '' or nonsense means "no cap" — stored as NULL. */
function dailyLimit(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---- Streak freezes ----

/**
 * Hand a kid a streak-freeze token. Deliberately parent-granted rather than
 * purchasable: a token a kid can buy with points is just a discount on
 * quitting, whereas one a parent gives is a reward for a good run.
 */
parent.post('/kids/:id/freeze-tokens', (req, res) => {
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const delta = Number(req.body?.delta ?? 1);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10) {
    return res.status(400).json({ error: 'invalid_delta' });
  }
  res.json({ ok: true, tokens: grantFreezeToken(kid.id, delta), history: freezeHistory(kid.id) });
});

// ---- Break days (school calendar) ----

parent.get('/break-days', (req, res) => {
  res.json(listBreakDays());
});

/**
 * Mark a date as a break day: tasks still appear, but missing them doesn't
 * break a streak. Vacation mode pauses the chart entirely; this is the
 * lighter tool for a school holiday where the routine is just looser.
 */
parent.post('/break-days', (req, res) => {
  const { date, label, on } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
    return res.status(400).json({ error: 'invalid_date' });
  }
  res.json({ ok: true, days: setBreakDay(date, label, on !== false) });
});

// ---- CSV export ----

/** RFC-4180-ish quoting: double the quotes, wrap anything risky. */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, filename, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.type('text/csv').send(body);
}

/**
 * Everything the chart knows, as spreadsheets. The data is the family's; it
 * shouldn't take a SQLite client to get at it.
 */
parent.get('/export/ledger.csv', (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.created_at, k.name AS kid, l.direction, l.bucket, l.amount, l.source
       FROM points_ledger l JOIN kids k ON k.id = l.kid_id
       ORDER BY l.id`
    )
    .all();
  sendCsv(
    res,
    'reward-chart-ledger.csv',
    ['when', 'kid', 'direction', 'bucket', 'points', 'source'],
    rows.map((r) => [r.created_at, r.kid, r.direction, r.bucket, r.amount, r.source])
  );
});

parent.get('/export/completions.csv', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.date, k.name AS kid, t.title, t.point_value, c.status, c.completed_at, c.reviewed_at
       FROM completions c JOIN kids k ON k.id = c.kid_id JOIN tasks t ON t.id = c.task_id
       ORDER BY c.date, c.id`
    )
    .all();
  sendCsv(
    res,
    'reward-chart-completions.csv',
    ['date', 'kid', 'task', 'points', 'status', 'tapped', 'reviewed'],
    rows.map((r) => [r.date, r.kid, r.title, r.point_value, r.status, r.completed_at, r.reviewed_at])
  );
});

// ---- Backups ----

parent.get('/backups', (req, res) => {
  res.json(listBackups());
});

parent.post('/backups', async (req, res) => {
  try {
    const file = await runBackup();
    res.json({ ok: true, file });
  } catch (err) {
    res.status(500).json({ error: 'backup_failed', message: err.message });
  }
});

/**
 * Download a backup. Getting a copy off the box previously meant shelling in,
 * which makes the backups a lot less reassuring than they look — a snapshot
 * that only exists on the machine that might die isn't really a backup.
 */
parent.get('/backups/:name/download', (req, res) => {
  const file = backupFilePath(req.params.name);
  if (!file) return res.status(404).json({ error: 'no_such_backup' });
  res.download(file, req.params.name);
});

// ---- Vacation mode ----

parent.get('/vacation', (req, res) => {
  res.json(vacationState());
});

parent.post('/vacation', (req, res) => {
  res.json(setVacation(!!req.body?.on));
});

// ---- Category management ----

parent.get('/categories', (req, res) => {
  res.json(db.prepare(`SELECT * FROM categories ORDER BY position, id`).all());
});

function validCategoryBody(body) {
  return body && typeof body.label === 'string' && body.label.trim().length > 0;
}

parent.post('/categories', (req, res) => {
  if (!validCategoryBody(req.body)) return res.status(400).json({ error: 'invalid_category' });
  const position = (db.prepare(`SELECT MAX(position) AS p FROM categories`).get().p || 0) + 1;
  const info = db
    .prepare(`INSERT INTO categories (label, icon, position) VALUES (?, ?, ?)`)
    .run(req.body.label.trim(), req.body.icon || '📋', position);
  res.status(201).json(db.prepare(`SELECT * FROM categories WHERE id = ?`).get(info.lastInsertRowid));
});

parent.patch('/categories/:id', (req, res) => {
  const category = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  if (!category) return res.status(404).json({ error: 'category_not_found' });
  const merged = {
    label: req.body.label ?? category.label,
    icon: req.body.icon ?? category.icon,
  };
  if (!validCategoryBody(merged)) return res.status(400).json({ error: 'invalid_category' });
  db.prepare(`UPDATE categories SET label = ?, icon = ? WHERE id = ?`).run(
    merged.label.trim(),
    merged.icon,
    category.id
  );
  res.json(db.prepare(`SELECT * FROM categories WHERE id = ?`).get(category.id));
});

// ---- Task management ----

parent.get('/tasks', (req, res) => {
  res.json(db.prepare(`SELECT * FROM tasks ORDER BY active DESC, category_id, id`).all());
});

function validTaskBody(body) {
  return (
    body &&
    typeof body.title === 'string' &&
    body.title.trim().length > 0 &&
    db.prepare(`SELECT id FROM categories WHERE id = ?`).get(body.category_id) !== undefined &&
    Number.isInteger(body.point_value) &&
    body.point_value > 0 &&
    (body.days == null || /^[0-6]{1,7}$/.test(body.days))
  );
}

parent.post('/tasks', (req, res) => {
  if (!validTaskBody(req.body)) return res.status(400).json({ error: 'invalid_task' });
  const { title, category_id, point_value, icon, kid_id, is_bonus, days } = req.body;
  const info = db
    .prepare(
      `INSERT INTO tasks (title, category_id, point_value, icon, active, kid_id, is_bonus, days)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .run(title.trim(), category_id, point_value, icon || '⭐', kid_id || null, is_bonus ? 1 : 0, days || null);
  res.status(201).json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid));
});

parent.patch('/tasks/:id', (req, res) => {
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  const merged = {
    title: req.body.title ?? task.title,
    category_id: req.body.category_id ?? task.category_id,
    point_value: req.body.point_value ?? task.point_value,
    icon: req.body.icon ?? task.icon,
    active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : task.active,
    kid_id: req.body.kid_id !== undefined ? req.body.kid_id : task.kid_id,
    is_bonus: req.body.is_bonus !== undefined ? (req.body.is_bonus ? 1 : 0) : task.is_bonus,
    days: req.body.days !== undefined ? req.body.days || null : task.days,
  };
  if (!validTaskBody(merged)) return res.status(400).json({ error: 'invalid_task' });
  db.prepare(
    `UPDATE tasks SET title = ?, category_id = ?, point_value = ?, icon = ?, active = ?, kid_id = ?, is_bonus = ?, days = ? WHERE id = ?`
  ).run(merged.title.trim(), merged.category_id, merged.point_value, merged.icon, merged.active, merged.kid_id, merged.is_bonus, merged.days, task.id);
  res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(task.id));
});

// ---- Rewards management ----

parent.get('/rewards', (req, res) => {
  res.json(db.prepare(`SELECT * FROM rewards_catalog ORDER BY active DESC, cost, id`).all());
});

function validRewardBody(body) {
  return (
    body &&
    typeof body.title === 'string' &&
    body.title.trim().length > 0 &&
    Number.isInteger(body.cost) &&
    body.cost > 0 &&
    ['checking', 'savings'].includes(body.bucket_required)
  );
}

parent.post('/rewards', (req, res) => {
  if (!validRewardBody(req.body)) return res.status(400).json({ error: 'invalid_reward' });
  const { title, cost, bucket_required, icon, kid_id, limit_per_day } = req.body;
  const info = db
    .prepare(
      `INSERT INTO rewards_catalog (kid_id, title, cost, bucket_required, icon, active, limit_per_day)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
    .run(kid_id || null, title.trim(), cost, bucket_required, icon || '🎁', dailyLimit(limit_per_day));
  res.status(201).json(db.prepare(`SELECT * FROM rewards_catalog WHERE id = ?`).get(info.lastInsertRowid));
});

parent.patch('/rewards/:id', (req, res) => {
  const reward = db.prepare(`SELECT * FROM rewards_catalog WHERE id = ?`).get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'reward_not_found' });
  const merged = {
    title: req.body.title ?? reward.title,
    cost: req.body.cost ?? reward.cost,
    bucket_required: req.body.bucket_required ?? reward.bucket_required,
    icon: req.body.icon ?? reward.icon,
    active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : reward.active,
    kid_id: req.body.kid_id !== undefined ? req.body.kid_id : reward.kid_id,
    limit_per_day:
      req.body.limit_per_day !== undefined ? dailyLimit(req.body.limit_per_day) : reward.limit_per_day,
  };
  if (!validRewardBody(merged)) return res.status(400).json({ error: 'invalid_reward' });
  db.prepare(
    `UPDATE rewards_catalog SET title = ?, cost = ?, bucket_required = ?, icon = ?, active = ?, kid_id = ?, limit_per_day = ? WHERE id = ?`
  ).run(merged.title.trim(), merged.cost, merged.bucket_required, merged.icon, merged.active, merged.kid_id, merged.limit_per_day, reward.id);
  res.json(db.prepare(`SELECT * FROM rewards_catalog WHERE id = ?`).get(reward.id));
});

// ---- Kid / vault config ----

parent.get('/kids', (req, res) => {
  const kids = db.prepare(`SELECT * FROM kids ORDER BY id`).all();
  res.json(kids.map((k) => ({ ...k, balances: balances(k.id) })));
});

/** Add a kid to the household. */
parent.post('/kids', (req, res) => {
  const { name, age, theme, avatar_icon } = req.body || {};
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    !Number.isInteger(age) ||
    age < 1 ||
    age > 18 ||
    !isValidTheme(theme)
  ) {
    return res.status(400).json({ error: 'invalid_kid' });
  }
  const defaultAvatars = { soccer: '⚽', dino: '🦖', space: '🚀', fantasy: '🦄', racing: '🏎️' };
  const info = db
    .prepare(
      `INSERT INTO kids (name, avatar_icon, theme, age, vault_mode, auto_split_ratio)
       VALUES (?, ?, ?, ?, 'manual', 0.7)`
    )
    .run(name.trim(), avatar_icon || defaultAvatars[theme], theme, age);
  res.status(201).json(db.prepare(`SELECT * FROM kids WHERE id = ?`).get(info.lastInsertRowid));
});

/** Permanently remove a kid and all their data. */
parent.delete('/kids/:id', (req, res) => {
  const result = deleteKid(Number(req.params.id));
  if (!result.ok) return res.status(404).json({ error: result.reason });
  res.json(result);
});

/** Wipe a kid's badge collection (badges + their bonus points). */
parent.post('/kids/:id/clear-badges', (req, res) => {
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  res.json({ ok: true, cleared: clearBadges(kid.id) });
});

parent.patch('/kids/:id', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const vault_mode = req.body.vault_mode ?? kid.vault_mode;
  const ratio = req.body.auto_split_ratio ?? kid.auto_split_ratio;
  if (!['manual', 'auto_split'].includes(vault_mode) || typeof ratio !== 'number' || ratio <= 0 || ratio >= 1) {
    return res.status(400).json({ error: 'invalid_vault_config' });
  }
  const theme = req.body.theme ?? kid.theme;
  if (!isValidTheme(theme)) return res.status(400).json({ error: 'invalid_theme' });
  const avatar_icon = req.body.avatar_icon ?? kid.avatar_icon;
  // Points→money: cents per point, 0 turns the display off entirely. Capped
  // low on purpose — this is meant to make points feel concrete, not to turn
  // the chart into a payroll system.
  let cents_per_point = kid.cents_per_point;
  if (req.body.cents_per_point !== undefined) {
    const cents = Number(req.body.cents_per_point);
    if (!Number.isInteger(cents) || cents < 0 || cents > 1000) {
      return res.status(400).json({ error: 'invalid_cents_per_point' });
    }
    cents_per_point = cents;
  }
  // secret_code: emoji string enables the kid lock; null/'' disables it.
  let secret_code = kid.secret_code;
  if (req.body.secret_code !== undefined) {
    const code = req.body.secret_code;
    if (code === null || code === '') secret_code = null;
    else if (typeof code === 'string' && code.length <= 24) secret_code = code;
    else return res.status(400).json({ error: 'invalid_secret_code' });
  }
  db.prepare(
    `UPDATE kids SET vault_mode = ?, auto_split_ratio = ?, secret_code = ?, theme = ?, avatar_icon = ?, cents_per_point = ? WHERE id = ?`
  ).run(vault_mode, ratio, secret_code, theme, avatar_icon, cents_per_point, kid.id);
  res.json(db.prepare(`SELECT * FROM kids WHERE id = ?`).get(kid.id));
});

/** Parent can move points either direction between buckets. */
parent.post('/kids/:id/transfer', (req, res) => {
  const { from, to, amount } = req.body || {};
  const result = transferPoints(Number(req.params.id), from, to, Number(amount));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true, balances: balances(Number(req.params.id)) });
});

/** Wipe a kid's day: today's completions, their points, and streak effects. */
parent.post('/kids/:id/reset-day', (req, res) => {
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const cleared = resetKidDay(kid.id);
  res.json({ ok: true, cleared, balances: balances(kid.id) });
});

/** Directly correct a vault balance (positive adds, negative removes). */
parent.post('/kids/:id/adjust', (req, res) => {
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const result = adjustBalance(kid.id, req.body?.bucket, Number(req.body?.amount));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true, balances: balances(kid.id) });
});

// ---- History ----

parent.get('/kids/:id/history', (req, res) => {
  const kidId = Number(req.params.id);
  const completions = db
    .prepare(
      `SELECT c.id, c.date, c.status, c.completed_at, c.reviewed_at, t.title, t.icon, t.point_value
       FROM completions c JOIN tasks t ON t.id = c.task_id
       WHERE c.kid_id = ? ORDER BY c.completed_at DESC LIMIT 200`
    )
    .all(kidId);
  const ledger = db
    .prepare(
      `SELECT id, amount, direction, bucket, source, created_at
       FROM points_ledger WHERE kid_id = ? ORDER BY id DESC LIMIT 200`
    )
    .all(kidId);
  const redemptions = db
    .prepare(
      `SELECT r.id, r.cost_paid, r.redeemed_at, r.status, rc.title, rc.icon
       FROM redemptions r JOIN rewards_catalog rc ON rc.id = r.reward_id
       WHERE r.kid_id = ? ORDER BY r.redeemed_at DESC LIMIT 100`
    )
    .all(kidId);
  res.json({ completions, ledger, redemptions, balances: balances(kidId) });
});
