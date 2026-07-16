import { Router } from 'express';
import { db, balances } from '../db.js';
import { todayStr, nowIso } from '../dates.js';
import { expireStalePending, displayStreak, transferPoints } from '../service.js';

export const kiosk = Router();

kiosk.get('/kids', (req, res) => {
  const kids = db.prepare(`SELECT id, name, avatar_icon, theme, age FROM kids ORDER BY id`).all();
  res.json(kids);
});

/** Everything the kid home screen needs in one call. */
kiosk.get('/kids/:id/today', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });

  expireStalePending();
  const today = todayStr();

  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.category, t.point_value, t.icon,
              c.id AS completion_id, c.status
       FROM tasks t
       LEFT JOIN completions c ON c.task_id = t.id AND c.kid_id = ? AND c.date = ?
       WHERE t.active = 1 AND (t.kid_id IS NULL OR t.kid_id = ?)
       ORDER BY t.category, t.id`
    )
    .all(kid.id, today, kid.id);

  const streakRows = db.prepare(`SELECT * FROM streaks WHERE kid_id = ?`).all(kid.id);
  const streaksByTask = new Map(streakRows.map((s) => [s.task_id, s]));
  for (const t of tasks) t.streak = displayStreak(streaksByTask.get(t.id));

  const doneCount = tasks.filter((t) => t.status === 'pending' || t.status === 'approved').length;
  const earnedToday = tasks
    .filter((t) => t.status === 'approved')
    .reduce((sum, t) => sum + t.point_value, 0);

  const pendingRedemptions = db
    .prepare(
      `SELECT r.id, r.cost_paid, rc.title, rc.icon
       FROM redemptions r JOIN rewards_catalog rc ON rc.id = r.reward_id
       WHERE r.kid_id = ? AND r.status = 'pending'
       ORDER BY r.id DESC`
    )
    .all(kid.id);

  res.json({
    kid: {
      id: kid.id,
      name: kid.name,
      avatar_icon: kid.avatar_icon,
      theme: kid.theme,
      vault_mode: kid.vault_mode,
    },
    balances: balances(kid.id),
    tasks,
    progress: {
      doneCount,
      totalTasks: tasks.length,
      earnedToday,
      possibleToday: tasks.reduce((sum, t) => sum + t.point_value, 0),
    },
    pendingRedemptions,
  });
});

/**
 * Kid taps a task. Idempotent per (task, kid, day) and per client_id so
 * the kiosk offline queue can retry safely.
 */
kiosk.post('/completions', (req, res) => {
  const { task_id, kid_id, client_id } = req.body || {};
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND active = 1`).get(task_id);
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(kid_id);
  if (!task || !kid) return res.status(400).json({ error: 'invalid_task_or_kid' });
  if (task.kid_id !== null && task.kid_id !== kid.id) {
    return res.status(400).json({ error: 'task_not_assigned_to_kid' });
  }

  const today = todayStr();
  const existing = db
    .prepare(`SELECT * FROM completions WHERE task_id = ? AND kid_id = ? AND date = ?`)
    .get(task_id, kid_id, today);
  if (existing) return res.json({ completion: existing, duplicate: true });

  try {
    const info = db
      .prepare(
        `INSERT INTO completions (task_id, kid_id, date, status, completed_at, client_id)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(task_id, kid_id, today, nowIso(), client_id || null);
    const completion = db.prepare(`SELECT * FROM completions WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ completion, duplicate: false });
  } catch (err) {
    // A concurrent retry with the same client_id landed first — treat as success.
    const byClient = client_id
      ? db.prepare(`SELECT * FROM completions WHERE client_id = ?`).get(client_id)
      : null;
    if (byClient) return res.json({ completion: byClient, duplicate: true });
    throw err;
  }
});

/** Reward catalog for one kid, with an affordability flag per reward. */
kiosk.get('/kids/:id/rewards', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });

  const bal = balances(kid.id);
  const pendingSpend = db
    .prepare(
      `SELECT rc.bucket_required AS bucket, COALESCE(SUM(r.cost_paid), 0) AS total
       FROM redemptions r JOIN rewards_catalog rc ON rc.id = r.reward_id
       WHERE r.kid_id = ? AND r.status = 'pending' GROUP BY rc.bucket_required`
    )
    .all(kid.id);
  const held = { checking: 0, savings: 0 };
  for (const p of pendingSpend) held[p.bucket] = p.total;

  const rewards = db
    .prepare(
      `SELECT id, title, cost, bucket_required, icon FROM rewards_catalog
       WHERE active = 1 AND (kid_id IS NULL OR kid_id = ?) ORDER BY cost, id`
    )
    .all(kid.id)
    .map((r) => ({
      ...r,
      affordable: bal[r.bucket_required] - held[r.bucket_required] >= r.cost,
    }));

  res.json({ balances: bal, rewards });
});

/** Kid requests a redemption — goes to the parent pending queue. */
kiosk.post('/redemptions', (req, res) => {
  const { kid_id, reward_id } = req.body || {};
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(kid_id);
  const reward = db.prepare(`SELECT * FROM rewards_catalog WHERE id = ? AND active = 1`).get(reward_id);
  if (!kid || !reward) return res.status(400).json({ error: 'invalid_kid_or_reward' });
  if (reward.kid_id !== null && reward.kid_id !== kid.id) {
    return res.status(400).json({ error: 'reward_not_available_to_kid' });
  }

  const bal = balances(kid.id);
  if (bal[reward.bucket_required] < reward.cost) {
    return res.status(400).json({ error: 'insufficient_points' });
  }

  const info = db
    .prepare(
      `INSERT INTO redemptions (kid_id, reward_id, cost_paid, redeemed_at, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(kid_id, reward_id, reward.cost, nowIso());
  res.status(201).json(db.prepare(`SELECT * FROM redemptions WHERE id = ?`).get(info.lastInsertRowid));
});

/** Kid-initiated vault transfer (manual mode): checking → savings only. */
kiosk.post('/kids/:id/transfer', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const amount = Number(req.body?.amount);
  const result = transferPoints(kid.id, 'checking', 'savings', amount);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true, balances: balances(kid.id) });
});
