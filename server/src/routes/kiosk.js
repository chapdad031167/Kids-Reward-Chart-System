import { Router } from 'express';
import { db, balances } from '../db.js';
import { todayStr, nowIso } from '../dates.js';
import {
  expireStalePending,
  displayStreak,
  transferPoints,
  pendingHolds,
  spendableBalance,
  approveCompletion,
  rejectCompletion,
  approveRedemption,
  rejectRedemption,
} from '../service.js';
import { notifyParent, reviewActions } from '../notify.js';
import { readToken } from '../actionToken.js';
import { getBonusForToday, revealBonus } from '../bonus.js';
import { vacationState } from '../vacation.js';
import { isScheduledOn } from '../schedule.js';
import { checkBadges, badgeState, markBadgesSeen, levelFor } from '../badges.js';
import { getFamilyGoal } from '../familyGoal.js';
import { isConfigured, markConfigured, getAppName, setAppName, setPin } from '../config.js';
import { seedStarterContent } from '../seed.js';
import { isValidTheme } from '../themes.js';

const DEFAULT_AVATARS = {
  soccer: '⚽',
  dino: '🦖',
  space: '🚀',
  fantasy: '🦄',
  racing: '🏎️',
  ocean: '⛵',
};

export const kiosk = Router();

/** Public: does this instance still need first-run setup, and its name. */
kiosk.get('/setup-status', (req, res) => {
  res.json({ configured: isConfigured(), appName: getAppName() });
});

/**
 * Public first-run setup — only usable while unconfigured. Names the app,
 * sets the parent PIN, creates the first kid, and optionally loads the
 * starter task/reward library. Locks itself once configured.
 */
kiosk.post('/setup', (req, res) => {
  if (isConfigured()) return res.status(403).json({ error: 'already_configured' });
  const { app_name, pin, kid, load_starter } = req.body || {};
  if (typeof app_name !== 'string' || app_name.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_app_name' });
  }
  if (!/^\d{4}$/.test(String(pin ?? ''))) {
    return res.status(400).json({ error: 'invalid_pin' });
  }
  if (
    !kid ||
    typeof kid.name !== 'string' ||
    kid.name.trim().length === 0 ||
    !Number.isInteger(kid.age) ||
    kid.age < 1 ||
    kid.age > 18 ||
    !isValidTheme(kid.theme)
  ) {
    return res.status(400).json({ error: 'invalid_kid' });
  }

  db.prepare(
    `INSERT INTO kids (name, avatar_icon, theme, age, vault_mode, auto_split_ratio)
     VALUES (?, ?, ?, ?, 'manual', 0.7)`
  ).run(kid.name.trim(), kid.avatar_icon || DEFAULT_AVATARS[kid.theme], kid.theme, kid.age);

  setAppName(app_name);
  setPin(String(pin));
  if (load_starter) seedStarterContent();
  markConfigured();
  res.json({ ok: true });
});

kiosk.get('/kids', (req, res) => {
  const today = todayStr();
  const kids = db
    .prepare(`SELECT id, name, avatar_icon, theme, age, secret_code FROM kids ORDER BY id`)
    .all()
    .map(({ secret_code, ...kid }) => {
      // Teaser figures for the avatar screen — it's the app's front door and
      // was its emptiest screen. Cheap per kid, and it turns "pick a name"
      // into "you have 3 waiting and a 5-day streak".
      const tasks = db
        .prepare(
          `SELECT t.id, t.days, c.status
           FROM tasks t
           LEFT JOIN completions c ON c.task_id = t.id AND c.kid_id = ? AND c.date = ?
           WHERE t.active = 1 AND t.is_bonus = 0 AND (t.kid_id IS NULL OR t.kid_id = ?)`
        )
        .all(kid.id, today, kid.id)
        .filter((t) => isScheduledOn(t.days, today));

      const byTask = new Map(
        db.prepare(`SELECT * FROM streaks WHERE kid_id = ?`).all(kid.id).map((s) => [s.task_id, s])
      );
      const bestStreak = tasks.reduce(
        (best, t) => Math.max(best, displayStreak(byTask.get(t.id), t.days)),
        0
      );

      return {
        ...kid,
        has_code: !!secret_code,
        waiting: tasks.filter((t) => !t.status).length,
        allDone: tasks.length > 0 && tasks.every((t) => t.status),
        streak: bestStreak,
        level: levelFor(kid.id).n,
      };
    });
  res.json(kids);
});

/** Kid enters their secret emoji code. Kids with no code always pass. */
kiosk.post('/kids/:id/verify-code', (req, res) => {
  const kid = db.prepare(`SELECT secret_code FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  res.json({ ok: !kid.secret_code || (req.body?.code ?? '') === kid.secret_code });
});

/** Everything the kid home screen needs in one call. */
kiosk.get('/kids/:id/today', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });

  expireStalePending();
  const today = todayStr();

  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.category_id, t.point_value, t.icon, t.days,
              c.id AS completion_id, c.status
       FROM tasks t
       LEFT JOIN completions c ON c.task_id = t.id AND c.kid_id = ? AND c.date = ?
       WHERE t.active = 1 AND t.is_bonus = 0 AND (t.kid_id IS NULL OR t.kid_id = ?)
       ORDER BY t.category_id, t.id`
    )
    .all(kid.id, today, kid.id)
    .filter((t) => isScheduledOn(t.days, today));

  const categories = db.prepare(`SELECT * FROM categories ORDER BY position, id`).all();

  const streakRows = db.prepare(`SELECT * FROM streaks WHERE kid_id = ?`).all(kid.id);
  const streaksByTask = new Map(streakRows.map((s) => [s.task_id, s]));
  for (const t of tasks) t.streak = displayStreak(streaksByTask.get(t.id), t.days);

  const bonus = getBonusForToday(kid.id);
  checkBadges(kid.id); // lazy catch-up (e.g. saver badge after auto-split)

  const doneCount = tasks.filter((t) => t.status === 'pending' || t.status === 'approved').length;
  let earnedToday = tasks
    .filter((t) => t.status === 'approved')
    .reduce((sum, t) => sum + t.point_value, 0);
  if (bonus?.revealed && bonus.status === 'approved') earnedToday += bonus.task.point_value;

  // Savings goal: the reward this kid is saving toward, with progress.
  let goal = null;
  if (kid.goal_reward_id) {
    const reward = db
      .prepare(`SELECT id, title, cost, bucket_required, icon FROM rewards_catalog WHERE id = ? AND active = 1`)
      .get(kid.goal_reward_id);
    if (reward) {
      const bal = balances(kid.id)[reward.bucket_required];
      goal = {
        reward,
        saved: Math.min(bal, reward.cost),
        needed: Math.max(0, reward.cost - bal),
        reached: bal >= reward.cost,
      };
    }
  }

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
      has_code: !!kid.secret_code,
    },
    balances: balances(kid.id),
    tasks,
    categories,
    bonus,
    goal,
    badges: badgeState(kid.id),
    level: levelFor(kid.id),
    familyGoal: getFamilyGoal(),
    vacation: vacationState().on,
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
  if (vacationState().on) return res.status(400).json({ error: 'vacation_mode' });
  const { task_id, kid_id, client_id } = req.body || {};
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND active = 1`).get(task_id);
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(kid_id);
  if (!task || !kid) return res.status(400).json({ error: 'invalid_task_or_kid' });
  if (task.kid_id !== null && task.kid_id !== kid.id) {
    return res.status(400).json({ error: 'task_not_assigned_to_kid' });
  }

  const today = todayStr();
  if (!task.is_bonus && !isScheduledOn(task.days, today)) {
    return res.status(400).json({ error: 'not_scheduled_today' });
  }
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
    const kidName = db.prepare(`SELECT name FROM kids WHERE id = ?`).get(kid_id).name;
    notifyParent(
      'Task waiting for approval',
      `${kidName}: ${task.title} (+${task.point_value})`,
      'hourglass_flowing_sand',
      reviewActions('completion', completion.id)
    );
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
  const held = pendingHolds(kid.id);

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

  // Against spendable, not raw balance: the rewards list already greys out
  // what a kid can't afford after holds, so accepting it here anyway would
  // queue a request that can only fail later at parent approval.
  if (spendableBalance(kid.id)[reward.bucket_required] < reward.cost) {
    return res.status(400).json({ error: 'insufficient_points' });
  }

  const info = db
    .prepare(
      `INSERT INTO redemptions (kid_id, reward_id, cost_paid, redeemed_at, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(kid_id, reward_id, reward.cost, nowIso());
  notifyParent(
    'Reward request',
    `${kid.name} wants: ${reward.title} (${reward.cost} pts)`,
    'gift',
    reviewActions('redemption', Number(info.lastInsertRowid))
  );
  res.status(201).json(db.prepare(`SELECT * FROM redemptions WHERE id = ?`).get(info.lastInsertRowid));
});

/**
 * One-tap approve/reject from a push notification.
 *
 * Deliberately outside the PIN gate: the bearer token *is* the authorisation,
 * and it only ever authorises the single action it names. Replays are
 * harmless — approving an already-approved item is a no-op — so a token that
 * has been used simply reports that there was nothing left to do.
 */
kiosk.post('/action/:token', (req, res) => {
  const claim = readToken(req.params.token);
  if (!claim) return res.status(403).json({ error: 'invalid_or_expired' });

  const { kind, id, act } = claim;
  let ok = false;
  let note = '';

  if (kind === 'completion') {
    // Both return a plain boolean: false means it was no longer pending.
    ok = act === 'approve' ? approveCompletion(id) : rejectCompletion(id);
    if (ok && act === 'approve') {
      const row = db.prepare(`SELECT kid_id FROM completions WHERE id = ?`).get(id);
      if (row) checkBadges(row.kid_id);
    }
  } else if (act === 'approve') {
    // approveRedemption returns {ok, reason} — it can fail on affordability.
    const result = approveRedemption(id);
    ok = result.ok === true;
    if (!ok && result.reason === 'insufficient_points') {
      note = 'They can no longer afford this one.';
    }
  } else {
    ok = rejectRedemption(id) === true;
  }

  // A phone opening this shows the body, so answer in words rather than JSON.
  res
    .status(200)
    .type('text/plain')
    .send(ok ? `Done — ${act}d.` : note || 'Already handled — nothing to do.');
});

/** Kid dismissed the "new badge" celebration. */
kiosk.post('/kids/:id/badges/seen', (req, res) => {
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  markBadgesSeen(kid.id);
  res.json({ ok: true });
});

/** Kid picks (or clears) the reward they're saving toward. */
kiosk.post('/kids/:id/goal', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const rewardId = req.body?.reward_id ?? null;
  if (rewardId !== null) {
    const reward = db
      .prepare(`SELECT * FROM rewards_catalog WHERE id = ? AND active = 1`)
      .get(rewardId);
    if (!reward || (reward.kid_id !== null && reward.kid_id !== kid.id)) {
      return res.status(400).json({ error: 'invalid_reward' });
    }
  }
  db.prepare(`UPDATE kids SET goal_reward_id = ? WHERE id = ?`).run(rewardId, kid.id);
  res.json({ ok: true });
});

/** Kid opens today's mystery — reveals the bonus task. */
kiosk.post('/kids/:id/bonus/reveal', (req, res) => {
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'kid_not_found' });
  const state = revealBonus(kid.id);
  if (!state) return res.status(404).json({ error: 'no_mystery_today' });
  res.json(state);
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
