import { Router } from 'express';
import { db, balances } from '../db.js';
import { todayStr } from '../dates.js';
import {
  expireStalePending,
  approveCompletion,
  rejectCompletion,
  approveRedemption,
  rejectRedemption,
  approveAllToday,
  undoLastAction,
  transferPoints,
  resetKidDay,
  adjustBalance,
} from '../service.js';

const PARENT_PIN = process.env.PARENT_PIN || '1234';

export const parent = Router();

parent.post('/verify', (req, res) => {
  res.json({ ok: (req.body?.pin ?? '') === PARENT_PIN });
});

// Every route below requires the PIN header.
parent.use((req, res, next) => {
  if (req.get('x-parent-pin') !== PARENT_PIN) return res.status(401).json({ error: 'bad_pin' });
  next();
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
       WHERE c.status = 'pending' AND c.date = ?
       ORDER BY c.completed_at`
    )
    .all(todayStr());
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
  res.json({ completions, redemptions });
});

parent.post('/completions/:id/approve', (req, res) => {
  const ok = approveCompletion(Number(req.params.id));
  if (!ok) return res.status(400).json({ error: 'not_pending' });
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
  res.json({ ok: true, approved: approveAllToday() });
});

parent.post('/undo', (req, res) => {
  const result = undoLastAction();
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json(result);
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
    body.point_value > 0
  );
}

parent.post('/tasks', (req, res) => {
  if (!validTaskBody(req.body)) return res.status(400).json({ error: 'invalid_task' });
  const { title, category_id, point_value, icon, kid_id, is_bonus } = req.body;
  const info = db
    .prepare(
      `INSERT INTO tasks (title, category_id, point_value, icon, active, kid_id, is_bonus)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(title.trim(), category_id, point_value, icon || '⭐', kid_id || null, is_bonus ? 1 : 0);
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
  };
  if (!validTaskBody(merged)) return res.status(400).json({ error: 'invalid_task' });
  db.prepare(
    `UPDATE tasks SET title = ?, category_id = ?, point_value = ?, icon = ?, active = ?, kid_id = ?, is_bonus = ? WHERE id = ?`
  ).run(merged.title.trim(), merged.category_id, merged.point_value, merged.icon, merged.active, merged.kid_id, merged.is_bonus, task.id);
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
  const { title, cost, bucket_required, icon, kid_id } = req.body;
  const info = db
    .prepare(
      `INSERT INTO rewards_catalog (kid_id, title, cost, bucket_required, icon, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(kid_id || null, title.trim(), cost, bucket_required, icon || '🎁');
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
  };
  if (!validRewardBody(merged)) return res.status(400).json({ error: 'invalid_reward' });
  db.prepare(
    `UPDATE rewards_catalog SET title = ?, cost = ?, bucket_required = ?, icon = ?, active = ?, kid_id = ? WHERE id = ?`
  ).run(merged.title.trim(), merged.cost, merged.bucket_required, merged.icon, merged.active, merged.kid_id, reward.id);
  res.json(db.prepare(`SELECT * FROM rewards_catalog WHERE id = ?`).get(reward.id));
});

// ---- Kid / vault config ----

parent.get('/kids', (req, res) => {
  const kids = db.prepare(`SELECT * FROM kids ORDER BY id`).all();
  res.json(kids.map((k) => ({ ...k, balances: balances(k.id) })));
});

parent.patch('/kids/:id', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const vault_mode = req.body.vault_mode ?? kid.vault_mode;
  const ratio = req.body.auto_split_ratio ?? kid.auto_split_ratio;
  if (!['manual', 'auto_split'].includes(vault_mode) || typeof ratio !== 'number' || ratio <= 0 || ratio >= 1) {
    return res.status(400).json({ error: 'invalid_vault_config' });
  }
  // secret_code: emoji string enables the kid lock; null/'' disables it.
  let secret_code = kid.secret_code;
  if (req.body.secret_code !== undefined) {
    const code = req.body.secret_code;
    if (code === null || code === '') secret_code = null;
    else if (typeof code === 'string' && code.length <= 24) secret_code = code;
    else return res.status(400).json({ error: 'invalid_secret_code' });
  }
  db.prepare(`UPDATE kids SET vault_mode = ?, auto_split_ratio = ?, secret_code = ? WHERE id = ?`).run(
    vault_mode,
    ratio,
    secret_code,
    kid.id
  );
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
