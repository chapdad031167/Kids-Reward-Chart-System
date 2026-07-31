/**
 * The demo backend.
 *
 * docs/index.html is the real client bundle with this in front of it: a
 * fetch() override that answers /api/* out of an object in localStorage.
 * No server, no database, no network — the whole thing runs in the tab.
 *
 * Two rules keep it honest:
 *
 *   1. It is *source*, not build output. The old demo existed only as a
 *      minified blob, so nobody could tell what it did or update it, and it
 *      went stale for months. Anything that has to be maintained has to be
 *      readable.
 *
 *   2. It answers with the same shapes the real routes do. Where the real
 *      logic is small (streaks, badge thresholds, level curve) it is
 *      reimplemented here to match; where it is big (backups, ntfy, digest
 *      delivery, HMAC action tokens) the endpoint is stubbed and the demo
 *      says so rather than pretending.
 *
 * Deliberately not covered — a demo has no filesystem, no network egress and
 * no secrets to protect, so faking these would be theatre:
 *   /api/parent/backups*      nightly snapshots of a database that isn't there
 *   /api/parent/digest (POST) sending a push notification to nobody
 *   /api/parent/pin           there is no PIN gate in front of the demo
 *   /api/parent/export/*      handled here, but as a real client-side download
 *
 * State lives in localStorage under DEMO_KEY. Append ?reset to the URL (or
 * press the Reset button the demo banner adds) to start over.
 */
import {
  SEED_TASKS,
  SEED_BONUS_TASKS,
  SEED_REWARDS,
  SEED_CATEGORIES,
  CATEGORY_IDS,
} from '../../server/src/seedData.js';

const DEMO_KEY = 'reward-chart-demo-db';

// ---------------------------------------------------------------- dates

const todayStr = () => new Date().toLocaleDateString('en-CA');
const nowIso = () => new Date().toISOString();

function prevDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const dayOfWeek = (dateStr) => new Date(dateStr + 'T12:00:00Z').getUTCDay();

/** Mirrors server/src/schedule.js — `days` is a string of weekday digits. */
function isScheduledOn(days, dateStr) {
  if (!days) return true;
  return days.includes(String(dayOfWeek(dateStr)));
}

// ----------------------------------------------------------------- state

let db = null;
let nextId = 1;
const id = () => nextId++;

/**
 * Two kids on different themes, mid-week, with points banked and a couple of
 * days of history behind them — an empty chart shows none of what the app
 * actually does.
 */
function seed() {
  nextId = 1;
  const state = {
    settings: { appName: 'The Demo Family Chart', vacation: false, vacationSince: null, familyGoal: null },
    categories: SEED_CATEGORIES.map((c, i) => ({ id: i + 1, label: c.label, icon: c.icon, position: i + 1 })),
    kids: [],
    tasks: [],
    rewards: [],
    completions: [],
    redemptions: [],
    ledger: [],
    badges: [],
    streaks: [],
    bonus: [],
    breakDays: [],
    freezeDays: [],
    actions: [], // undo stack for parent approvals
  };
  nextId = 100;

  state.kids.push({
    id: 1,
    name: 'Maya',
    avatar_icon: '🦖',
    theme: 'dino',
    age: 9,
    vault_mode: 'manual',
    auto_split_ratio: 0.7,
    secret_code: null,
    goal_reward_id: null,
    freeze_tokens: 2,
    cents_per_point: 5,
  });
  state.kids.push({
    id: 2,
    name: 'Theo',
    avatar_icon: '⛵',
    theme: 'ocean',
    age: 6,
    vault_mode: 'auto_split',
    auto_split_ratio: 0.7,
    secret_code: null,
    goal_reward_id: null,
    freeze_tokens: 0,
    cents_per_point: 0,
  });

  for (const t of SEED_TASKS) {
    state.tasks.push({
      id: id(),
      title: t.title,
      category_id: CATEGORY_IDS[t.category],
      point_value: t.points,
      icon: t.icon,
      active: 1,
      kid_id: null,
      is_bonus: 0,
      days: null,
    });
  }
  for (const t of SEED_BONUS_TASKS) {
    state.tasks.push({
      id: id(),
      title: t.title,
      category_id: CATEGORY_IDS[t.category],
      point_value: t.points,
      icon: t.icon,
      active: 1,
      kid_id: null,
      is_bonus: 1,
      days: null,
    });
  }
  for (const r of SEED_REWARDS) {
    state.rewards.push({
      id: id(),
      kid_id: null,
      title: r.title,
      cost: r.cost,
      bucket_required: r.bucket,
      icon: r.icon,
      active: 1,
      // One capped reward, so the daily-limit behaviour is visible without
      // the visitor having to go and configure it first.
      limit_per_day: r.title.startsWith('30 minutes') ? 1 : null,
    });
  }

  db = state;

  // Banked points and a streak, so the meters, levels and badges have
  // something to show on first load.
  credit(1, 'earn', 'checking', 96, 'demo:history');
  credit(1, 'earn', 'savings', 44, 'demo:history');
  credit(2, 'earn', 'checking', 31, 'demo:history');
  credit(2, 'earn', 'savings', 12, 'demo:history');

  const dailies = state.tasks.filter((t) => !t.is_bonus);
  for (const kid of state.kids) {
    for (const task of dailies.slice(0, 6)) {
      state.streaks.push({
        task_id: task.id,
        kid_id: kid.id,
        current_streak: kid.id === 1 ? 6 : 2,
        longest_streak: kid.id === 1 ? 9 : 3,
        last_completed_date: prevDay(todayStr()),
      });
    }
  }

  // A couple of taps already waiting on a grown-up, so the Pending tab isn't
  // an empty box the first time you open it.
  for (const task of dailies.slice(0, 2)) tap(1, task.id);
  tap(2, dailies[0].id);

  for (const kid of state.kids) checkBadges(kid.id);
  return state;
}

function load() {
  const params = new URLSearchParams(location.search);
  if (params.has('reset')) localStorage.removeItem(DEMO_KEY);
  const raw = localStorage.getItem(DEMO_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      db = parsed.state;
      nextId = parsed.nextId;
      return;
    } catch {
      // Corrupt or from an older shape — reseeding beats a broken demo.
    }
  }
  seed();
  save();
}

function save() {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify({ state: db, nextId }));
  } catch {
    // Private mode, quota, whatever — the demo still works for this session.
  }
}

// ------------------------------------------------------------- primitives

const kidById = (kidId) => db.kids.find((k) => k.id === Number(kidId));

function balances(kidId) {
  const out = { checking: 0, savings: 0 };
  for (const row of db.ledger) {
    if (row.kid_id !== Number(kidId)) continue;
    out[row.bucket] += row.direction === 'earn' ? row.amount : -row.amount;
  }
  return out;
}

function credit(kidId, direction, bucket, amount, source) {
  db.ledger.push({
    id: id(),
    kid_id: Number(kidId),
    amount,
    direction,
    bucket,
    source,
    created_at: nowIso(),
  });
}

/** Points a kid can actually commit — balance minus pending redemption holds. */
function pendingHolds(kidId) {
  const held = { checking: 0, savings: 0 };
  for (const r of db.redemptions) {
    if (r.kid_id !== Number(kidId) || r.status !== 'pending') continue;
    const reward = db.rewards.find((x) => x.id === r.reward_id);
    if (reward) held[reward.bucket_required] += r.cost_paid;
  }
  return held;
}

function tasksFor(kidId, date) {
  return db.tasks
    .filter((t) => t.active && !t.is_bonus && (t.kid_id === null || t.kid_id === Number(kidId)))
    .filter((t) => isScheduledOn(t.days, date));
}

function completionFor(kidId, taskId, date) {
  return db.completions.find(
    (c) => c.kid_id === Number(kidId) && c.task_id === taskId && c.date === date
  );
}

function streakFor(kidId, taskId) {
  return db.streaks.find((s) => s.kid_id === Number(kidId) && s.task_id === taskId);
}

/** Mirrors service.js displayStreak — a chain only counts if it's still live. */
function displayStreak(row, days) {
  if (!row || !row.last_completed_date) return 0;
  const today = todayStr();
  if (row.last_completed_date === today) return row.current_streak;
  let expected = prevDay(today);
  let guard = 0;
  while (!isScheduledOn(days, expected) && guard++ < 400) expected = prevDay(expected);
  return row.last_completed_date >= expected ? row.current_streak : 0;
}

function tap(kidId, taskId) {
  const date = todayStr();
  const existing = completionFor(kidId, taskId, date);
  if (existing) return { completion: existing, duplicate: true };
  const completion = {
    id: id(),
    task_id: taskId,
    kid_id: Number(kidId),
    date,
    status: 'pending',
    completed_at: nowIso(),
    reviewed_at: null,
  };
  db.completions.push(completion);
  return { completion, duplicate: false };
}

/**
 * Approve a tap. Returns the undo record the real app stores in
 * parent_actions — enough to put the points, status and streak back exactly
 * as they were, which is what "Undo Last Approval" promises.
 */
function approveCompletion(completionId) {
  const c = db.completions.find((x) => x.id === Number(completionId));
  if (!c || c.status !== 'pending') return null;
  const task = db.tasks.find((t) => t.id === c.task_id);
  const kid = kidById(c.kid_id);
  c.status = 'approved';
  c.reviewed_at = nowIso();

  const ledgerIds = [];
  const creditAndRecord = (bucket, amount) => {
    credit(kid.id, 'earn', bucket, amount, 'task');
    ledgerIds.push(db.ledger[db.ledger.length - 1].id);
  };
  if (kid.vault_mode === 'auto_split') {
    const toChecking = Math.round(task.point_value * kid.auto_split_ratio);
    creditAndRecord('checking', toChecking);
    if (task.point_value - toChecking > 0) creditAndRecord('savings', task.point_value - toChecking);
  } else {
    creditAndRecord('checking', task.point_value);
  }

  // Streak bookkeeping, matching service.js: yesterday-or-the-last-expected-day
  // extends the chain, anything older restarts it.
  let row = streakFor(kid.id, task.id);
  const prevStreak = row ? { ...row } : null;
  if (!row) {
    row = { task_id: task.id, kid_id: kid.id, current_streak: 0, longest_streak: 0, last_completed_date: null };
    db.streaks.push(row);
  }
  if (row.last_completed_date !== c.date) {
    let expected = prevDay(c.date);
    let guard = 0;
    while (!isScheduledOn(task.days, expected) && guard++ < 400) expected = prevDay(expected);
    row.current_streak = row.last_completed_date >= expected ? row.current_streak + 1 : 1;
    row.longest_streak = Math.max(row.longest_streak, row.current_streak);
    row.last_completed_date = c.date;
  }
  checkBadges(kid.id);
  return { completionId: c.id, taskId: task.id, kidId: kid.id, ledgerIds, prevStreak };
}

/** Put the most recent approval back the way it was. */
function undoLastAction() {
  const action = db.actions.pop();
  if (!action) return { ok: false, reason: 'nothing_to_undo' };
  for (const item of action.items) {
    db.ledger = db.ledger.filter((l) => !item.ledgerIds.includes(l.id));
    if (action.type === 'approve_completion') {
      const c = db.completions.find((x) => x.id === item.completionId);
      if (c) {
        c.status = 'pending';
        c.reviewed_at = null;
      }
      const i = db.streaks.findIndex((s) => s.task_id === item.taskId && s.kid_id === item.kidId);
      if (i >= 0) {
        if (item.prevStreak) db.streaks[i] = item.prevStreak;
        else db.streaks.splice(i, 1);
      }
    } else {
      const r = db.redemptions.find((x) => x.id === item.redemptionId);
      if (r) {
        r.status = 'pending';
        r.reviewed_at = null;
      }
    }
  }
  return { ok: true, type: action.type, count: action.items.length };
}

function rejectCompletion(completionId) {
  const c = db.completions.find((x) => x.id === Number(completionId));
  if (!c || c.status !== 'pending') return false;
  c.status = 'rejected';
  c.reviewed_at = nowIso();
  return true;
}

// --------------------------------------------------------- badges & levels

const BADGES = [
  { key: 'first_point', icon: '🌱', title: 'First Points!', test: (s) => s.lifetime >= 1 },
  { key: 'points_100', icon: '💯', title: '100 Points Earned', test: (s) => s.lifetime >= 100 },
  { key: 'points_250', icon: '💎', title: '250 Points Earned', test: (s) => s.lifetime >= 250 },
  { key: 'points_500', icon: '👑', title: '500 Points Earned', test: (s) => s.lifetime >= 500 },
  { key: 'streak_3', icon: '🔥', title: '3-Day Streak', bonus: 2, test: (s) => s.maxStreak >= 3 },
  { key: 'streak_7', icon: '⚡', title: '7-Day Streak', bonus: 3, test: (s) => s.maxStreak >= 7 },
  { key: 'streak_14', icon: '🌟', title: '2-Week Streak', bonus: 5, test: (s) => s.maxStreak >= 14 },
  { key: 'streak_30', icon: '🏆', title: '30-Day Streak', bonus: 10, test: (s) => s.maxStreak >= 30 },
  { key: 'mystery_1', icon: '❓', title: 'Mystery Solved', test: (s) => s.mysteries >= 1 },
  { key: 'mystery_5', icon: '🗝️', title: '5 Mysteries Solved', test: (s) => s.mysteries >= 5 },
  { key: 'perfect_day', icon: '✨', title: 'Perfect Day', test: (s) => s.perfectDay },
  { key: 'saver_25', icon: '🏦', title: 'Super Saver', test: (s) => s.savings >= 25 },
];

function lifetimeEarned(kidId) {
  return db.ledger
    .filter(
      (r) =>
        r.kid_id === Number(kidId) &&
        r.direction === 'earn' &&
        r.source !== 'transfer' &&
        r.source !== 'adjustment' &&
        !r.source.startsWith('badge:')
    )
    .reduce((sum, r) => sum + r.amount, 0);
}

function statsFor(kidId) {
  const today = todayStr();
  const todays = tasksFor(kidId, today);
  return {
    lifetime: lifetimeEarned(kidId),
    maxStreak: db.streaks
      .filter((s) => s.kid_id === Number(kidId))
      .reduce((n, s) => Math.max(n, s.longest_streak), 0),
    mysteries: db.completions.filter(
      (c) =>
        c.kid_id === Number(kidId) &&
        c.status === 'approved' &&
        db.tasks.find((t) => t.id === c.task_id)?.is_bonus
    ).length,
    savings: balances(kidId).savings,
    perfectDay:
      todays.length > 0 && todays.every((t) => completionFor(kidId, t.id, today)?.status === 'approved'),
  };
}

function checkBadges(kidId) {
  const have = new Set(db.badges.filter((b) => b.kid_id === Number(kidId)).map((b) => b.badge_key));
  const stats = statsFor(kidId);
  const fresh = [];
  for (const badge of BADGES) {
    if (have.has(badge.key) || !badge.test(stats)) continue;
    db.badges.push({ kid_id: Number(kidId), badge_key: badge.key, earned_at: nowIso(), seen: 0 });
    if (badge.bonus) credit(kidId, 'earn', 'checking', badge.bonus, `badge:${badge.key}`);
    fresh.push(badge);
  }
  return fresh;
}

function badgeState(kidId) {
  const rows = db.badges.filter((b) => b.kid_id === Number(kidId));
  const byKey = new Map(rows.map((r) => [r.badge_key, r]));
  const shape = (b) => ({ key: b.key, icon: b.icon, title: b.title, bonus: b.bonus || 0 });
  const earned = BADGES.filter((b) => byKey.has(b.key)).map((b) => ({
    ...shape(b),
    earned_at: byKey.get(b.key).earned_at,
  }));
  return {
    earned,
    locked: BADGES.filter((b) => !byKey.has(b.key)).map(shape),
    newUnseen: earned.filter((b) => byKey.get(b.key).seen === 0),
  };
}

function levelFor(kidId) {
  const lifetime = lifetimeEarned(kidId);
  let level = 1;
  while ((15 * (level * (level + 1))) / 2 <= lifetime) level++;
  return {
    n: level,
    lifetime,
    floor: (15 * ((level - 1) * level)) / 2,
    next: (15 * (level * (level + 1))) / 2,
  };
}

// ---------------------------------------------------------------- mystery

/** Same idea as bonus.js: a stable per-kid, per-day pick, revealed on tap. */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function getBonusForToday(kidId) {
  if (db.settings.vacation) return null;
  const date = todayStr();
  // A mystery on roughly one day in three, decided by the same kind of hash
  // the server uses so it doesn't flicker on reload.
  if (hashStr(`${date}:${kidId}:day`) % 3 !== 0) return null;

  let assignment = db.bonus.find((b) => b.kid_id === Number(kidId) && b.date === date);
  if (!assignment) {
    const pool = db.tasks.filter((t) => t.active && t.is_bonus);
    if (pool.length === 0) return null;
    const task = pool[hashStr(`${date}:${kidId}:pick`) % pool.length];
    assignment = { kid_id: Number(kidId), date, task_id: task.id, revealed: 0 };
    db.bonus.push(assignment);
  }
  if (!assignment.revealed) return { revealed: false };

  const task = db.tasks.find((t) => t.id === assignment.task_id);
  const completion = completionFor(kidId, task.id, date);
  return {
    revealed: true,
    task: { id: task.id, title: task.title, icon: task.icon, point_value: task.point_value },
    status: completion ? completion.status : null,
    completion_id: completion ? completion.id : null,
  };
}

// ------------------------------------------------------------ family goal

function familyGoalState() {
  const goal = db.settings.familyGoal;
  if (!goal) return null;
  const progress = db.ledger
    .filter(
      (r) =>
        r.direction === 'earn' &&
        r.source !== 'transfer' &&
        r.source !== 'adjustment' &&
        r.created_at >= goal.started_at
    )
    .reduce((sum, r) => sum + r.amount, 0);
  return { ...goal, progress: Math.min(progress, goal.target), reached: progress >= goal.target };
}

// ------------------------------------------------------------------ CSV

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- routes

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const text = (body, type) => new Response(body, { status: 200, headers: { 'content-type': type } });

/**
 * [method, pattern, handler]. Patterns use :param segments and are matched in
 * order, so more specific paths come first.
 */
const ROUTES = [
  ['GET', '/api/setup-status', () => json({ configured: true, appName: db.settings.appName })],

  ['GET', '/api/kids', () => {
    const today = todayStr();
    return json(
      db.kids.map((kid) => {
        const tasks = tasksFor(kid.id, today);
        const done = tasks.filter((t) => completionFor(kid.id, t.id, today));
        return {
          id: kid.id,
          name: kid.name,
          avatar_icon: kid.avatar_icon,
          theme: kid.theme,
          age: kid.age,
          has_code: !!kid.secret_code,
          waiting: tasks.length - done.length,
          allDone: tasks.length > 0 && done.length === tasks.length,
          streak: tasks.reduce((best, t) => Math.max(best, displayStreak(streakFor(kid.id, t.id), t.days)), 0),
          level: levelFor(kid.id).n,
        };
      })
    );
  }],

  ['POST', '/api/kids/:id/verify-code', (p, body) => {
    const kid = kidById(p.id);
    return json({ ok: !kid?.secret_code || body.code === kid.secret_code });
  }],

  ['GET', '/api/kids/:id/today', (p) => {
    const kid = kidById(p.id);
    if (!kid) return json({ error: 'kid_not_found' }, 404);
    const today = todayStr();

    const tasks = tasksFor(kid.id, today).map((t) => {
      const c = completionFor(kid.id, t.id, today);
      return {
        id: t.id,
        title: t.title,
        category_id: t.category_id,
        point_value: t.point_value,
        icon: t.icon,
        days: t.days,
        completion_id: c?.id ?? null,
        status: c?.status ?? null,
        streak: displayStreak(streakFor(kid.id, t.id), t.days),
      };
    });

    const bonus = getBonusForToday(kid.id);
    checkBadges(kid.id);

    let goal = null;
    if (kid.goal_reward_id) {
      const reward = db.rewards.find((r) => r.id === kid.goal_reward_id && r.active);
      if (reward) {
        const bal = balances(kid.id)[reward.bucket_required];
        goal = {
          reward: {
            id: reward.id,
            title: reward.title,
            cost: reward.cost,
            bucket_required: reward.bucket_required,
            icon: reward.icon,
          },
          saved: Math.min(bal, reward.cost),
          needed: Math.max(0, reward.cost - bal),
          reached: bal >= reward.cost,
        };
      }
    }

    let earnedToday = tasks
      .filter((t) => t.status === 'approved')
      .reduce((sum, t) => sum + t.point_value, 0);
    if (bonus?.revealed && bonus.status === 'approved') earnedToday += bonus.task.point_value;

    return json({
      kid: {
        id: kid.id,
        name: kid.name,
        avatar_icon: kid.avatar_icon,
        theme: kid.theme,
        vault_mode: kid.vault_mode,
        has_code: !!kid.secret_code,
        freeze_tokens: kid.freeze_tokens,
        cents_per_point: kid.cents_per_point,
      },
      balances: balances(kid.id),
      tasks,
      categories: db.categories,
      bonus,
      goal,
      badges: badgeState(kid.id),
      level: levelFor(kid.id),
      familyGoal: familyGoalState(),
      vacation: db.settings.vacation,
      progress: {
        doneCount: tasks.filter((t) => t.status === 'pending' || t.status === 'approved').length,
        totalTasks: tasks.length,
        earnedToday,
        possibleToday: tasks.reduce((sum, t) => sum + t.point_value, 0),
      },
      pendingRedemptions: db.redemptions
        .filter((r) => r.kid_id === kid.id && r.status === 'pending')
        .map((r) => {
          const reward = db.rewards.find((x) => x.id === r.reward_id);
          return { id: r.id, cost_paid: r.cost_paid, title: reward.title, icon: reward.icon };
        }),
    });
  }],

  ['POST', '/api/completions', (p, body) => {
    const kid = kidById(body.kid_id);
    const task = db.tasks.find((t) => t.id === Number(body.task_id));
    if (!kid || !task) return json({ error: 'invalid_kid_or_task' }, 400);
    if (db.settings.vacation) return json({ error: 'vacation_mode' }, 400);
    return json(tap(kid.id, task.id), 201);
  }],

  ['POST', '/api/kids/:id/transfer', (p, body) => {
    const kid = kidById(p.id);
    const amount = Number(body.amount);
    if (!kid || !Number.isInteger(amount) || amount <= 0) return json({ error: 'invalid_amount' }, 400);
    if (balances(kid.id).checking < amount) return json({ error: 'insufficient_points' }, 400);
    credit(kid.id, 'spend', 'checking', amount, 'transfer');
    credit(kid.id, 'earn', 'savings', amount, 'transfer');
    checkBadges(kid.id);
    return json({ ok: true, balances: balances(kid.id) });
  }],

  ['GET', '/api/kids/:id/rewards', (p) => {
    const kid = kidById(p.id);
    const bal = balances(kid.id);
    const held = pendingHolds(kid.id);
    const today = todayStr();
    return json({
      balances: bal,
      rewards: db.rewards
        .filter((r) => r.active && (r.kid_id === null || r.kid_id === kid.id))
        .sort((a, b) => a.cost - b.cost || a.id - b.id)
        .map((r) => {
          const usedToday = db.redemptions.filter(
            (x) =>
              x.kid_id === kid.id &&
              x.reward_id === r.id &&
              (x.status === 'pending' || x.status === 'approved') &&
              x.redeemed_at.slice(0, 10) === today
          ).length;
          const capped = r.limit_per_day > 0 && usedToday >= r.limit_per_day;
          return {
            id: r.id,
            title: r.title,
            cost: r.cost,
            bucket_required: r.bucket_required,
            icon: r.icon,
            limit_per_day: r.limit_per_day,
            capped,
            affordable: !capped && bal[r.bucket_required] - held[r.bucket_required] >= r.cost,
          };
        }),
    });
  }],

  ['POST', '/api/redemptions', (p, body) => {
    const kid = kidById(body.kid_id);
    const reward = db.rewards.find((r) => r.id === Number(body.reward_id) && r.active);
    if (!kid || !reward) return json({ error: 'invalid_kid_or_reward' }, 400);
    const today = todayStr();
    if (reward.limit_per_day > 0) {
      const used = db.redemptions.filter(
        (x) =>
          x.kid_id === kid.id &&
          x.reward_id === reward.id &&
          (x.status === 'pending' || x.status === 'approved') &&
          x.redeemed_at.slice(0, 10) === today
      ).length;
      if (used >= reward.limit_per_day) {
        return json({ error: 'daily_limit_reached', limit: reward.limit_per_day }, 400);
      }
    }
    const spendable =
      balances(kid.id)[reward.bucket_required] - pendingHolds(kid.id)[reward.bucket_required];
    if (spendable < reward.cost) return json({ error: 'insufficient_points' }, 400);
    const redemption = {
      id: id(),
      kid_id: kid.id,
      reward_id: reward.id,
      cost_paid: reward.cost,
      redeemed_at: nowIso(),
      status: 'pending',
      reviewed_at: null,
      fulfilled_at: null,
    };
    db.redemptions.push(redemption);
    return json(redemption, 201);
  }],

  ['POST', '/api/kids/:id/goal', (p, body) => {
    const kid = kidById(p.id);
    kid.goal_reward_id = body.reward_id ? Number(body.reward_id) : null;
    return json({ ok: true });
  }],

  ['POST', '/api/kids/:id/bonus/reveal', (p) => {
    const date = todayStr();
    const assignment = db.bonus.find((b) => b.kid_id === Number(p.id) && b.date === date);
    if (!assignment) return json({ error: 'no_mystery_today' }, 400);
    assignment.revealed = 1;
    return json(getBonusForToday(p.id));
  }],

  ['POST', '/api/kids/:id/badges/seen', (p) => {
    for (const b of db.badges) if (b.kid_id === Number(p.id)) b.seen = 1;
    return json({ ok: true });
  }],

  // ---- Parent ----

  ['POST', '/api/parent/verify', () => json({ ok: true })],

  ['GET', '/api/parent/settings', () =>
    json({ appName: db.settings.appName, usingDefaultPin: false, publicUrl: '' })],

  ['POST', '/api/parent/settings', (p, body) => {
    if (typeof body.appName === 'string' && body.appName.trim()) db.settings.appName = body.appName.trim();
    return json({ appName: db.settings.appName, publicUrl: '' });
  }],

  ['POST', '/api/parent/pin', () =>
    json({ error: 'demo_no_pin', message: 'The demo has no PIN to change.' }, 400)],

  ['GET', '/api/parent/pending', () => {
    const cutoff = prevDay(todayStr());
    const kidName = (kidId) => kidById(kidId).name;
    const withTask = (c) => {
      const t = db.tasks.find((x) => x.id === c.task_id);
      return {
        id: c.id,
        date: c.date,
        completed_at: c.completed_at,
        reviewed_at: c.reviewed_at,
        kid_name: kidName(c.kid_id),
        kid_id: c.kid_id,
        title: t.title,
        icon: t.icon,
        point_value: t.point_value,
        is_bonus: t.is_bonus,
      };
    };
    const withReward = (r) => {
      const rc = db.rewards.find((x) => x.id === r.reward_id);
      return {
        id: r.id,
        cost_paid: r.cost_paid,
        redeemed_at: r.redeemed_at,
        reviewed_at: r.reviewed_at,
        kid_name: kidName(r.kid_id),
        kid_id: r.kid_id,
        title: rc.title,
        icon: rc.icon,
        bucket_required: rc.bucket_required,
      };
    };
    return json({
      completions: db.completions.filter((c) => c.status === 'pending' && c.date >= cutoff).map(withTask),
      redemptions: db.redemptions.filter((r) => r.status === 'pending').map(withReward),
      toDeliver: db.redemptions
        .filter((r) => r.status === 'approved' && !r.fulfilled_at)
        .map(withReward),
      rejected: db.completions.filter((c) => c.status === 'rejected' && c.date >= cutoff).map(withTask),
    });
  }],

  ['POST', '/api/parent/completions/:id/approve', (p) => {
    const item = approveCompletion(p.id);
    if (!item) return json({ error: 'not_pending' }, 400);
    db.actions.push({ type: 'approve_completion', items: [item] });
    return json({ ok: true });
  }],

  ['POST', '/api/parent/completions/:id/reject', (p) =>
    rejectCompletion(p.id) ? json({ ok: true }) : json({ error: 'not_pending' }, 400)],

  ['POST', '/api/parent/completions/:id/reopen', (p) => {
    const i = db.completions.findIndex((c) => c.id === Number(p.id) && c.status === 'rejected');
    if (i < 0) return json({ error: 'not_rejected' }, 400);
    db.completions.splice(i, 1);
    return json({ ok: true });
  }],

  // One undo entry for the whole sweep — undoing "approve all" one tap at a
  // time would be worse than not having undo.
  ['POST', '/api/parent/approve-all', () => {
    const items = [];
    for (const c of [...db.completions]) {
      if (c.status !== 'pending') continue;
      const item = approveCompletion(c.id);
      if (item) items.push(item);
    }
    if (items.length) db.actions.push({ type: 'approve_completion', items });
    return json({ ok: true, approved: items.length });
  }],

  ['POST', '/api/parent/undo', () => {
    const result = undoLastAction();
    return result.ok ? json(result) : json({ error: result.reason }, 400);
  }],

  ['POST', '/api/parent/redemptions/:id/approve', (p) => {
    const r = db.redemptions.find((x) => x.id === Number(p.id) && x.status === 'pending');
    if (!r) return json({ error: 'not_pending' }, 400);
    const reward = db.rewards.find((x) => x.id === r.reward_id);
    if (balances(r.kid_id)[reward.bucket_required] < r.cost_paid) {
      return json({ error: 'insufficient_points' }, 400);
    }
    r.status = 'approved';
    r.reviewed_at = nowIso();
    credit(r.kid_id, 'spend', reward.bucket_required, r.cost_paid, 'redemption');
    db.actions.push({
      type: 'approve_redemption',
      items: [{ redemptionId: r.id, ledgerIds: [db.ledger[db.ledger.length - 1].id] }],
    });
    return json({ ok: true });
  }],

  ['POST', '/api/parent/redemptions/:id/reject', (p) => {
    const r = db.redemptions.find((x) => x.id === Number(p.id) && x.status === 'pending');
    if (!r) return json({ error: 'not_pending' }, 400);
    r.status = 'rejected';
    r.reviewed_at = nowIso();
    return json({ ok: true });
  }],

  ['POST', '/api/parent/redemptions/:id/fulfill', (p) => {
    const r = db.redemptions.find((x) => x.id === Number(p.id) && x.status === 'approved');
    if (!r) return json({ error: 'not_approved' }, 400);
    r.fulfilled_at = nowIso();
    return json({ ok: true });
  }],

  ['GET', '/api/parent/tasks', () => json(db.tasks)],

  ['POST', '/api/parent/tasks', (p, body) => {
    const task = {
      id: id(),
      title: String(body.title).trim(),
      category_id: Number(body.category_id),
      point_value: Number(body.point_value),
      icon: body.icon || '⭐',
      active: 1,
      kid_id: body.kid_id ? Number(body.kid_id) : null,
      is_bonus: body.is_bonus ? 1 : 0,
      days: body.days ?? null,
    };
    db.tasks.push(task);
    return json(task, 201);
  }],

  ['PATCH', '/api/parent/tasks/:id', (p, body) => {
    const task = db.tasks.find((t) => t.id === Number(p.id));
    if (!task) return json({ error: 'not_found' }, 404);
    Object.assign(task, {
      title: body.title !== undefined ? String(body.title).trim() : task.title,
      category_id: body.category_id !== undefined ? Number(body.category_id) : task.category_id,
      point_value: body.point_value !== undefined ? Number(body.point_value) : task.point_value,
      icon: body.icon ?? task.icon,
      active: body.active !== undefined ? (body.active ? 1 : 0) : task.active,
      kid_id: body.kid_id !== undefined ? (body.kid_id ? Number(body.kid_id) : null) : task.kid_id,
      is_bonus: body.is_bonus !== undefined ? (body.is_bonus ? 1 : 0) : task.is_bonus,
      days: body.days !== undefined ? body.days : task.days,
    });
    return json(task);
  }],

  ['GET', '/api/parent/categories', () => json(db.categories)],

  ['POST', '/api/parent/categories', (p, body) => {
    const cat = {
      id: id(),
      label: String(body.label).trim(),
      icon: body.icon || '📋',
      position: db.categories.length + 1,
    };
    db.categories.push(cat);
    return json(cat, 201);
  }],

  ['PATCH', '/api/parent/categories/:id', (p, body) => {
    const cat = db.categories.find((c) => c.id === Number(p.id));
    if (!cat) return json({ error: 'not_found' }, 404);
    if (body.label !== undefined) cat.label = String(body.label).trim();
    if (body.icon !== undefined) cat.icon = body.icon;
    return json(cat);
  }],

  ['DELETE', '/api/parent/categories/:id', (p) => {
    const cid = Number(p.id);
    if (db.tasks.some((t) => t.category_id === cid)) return json({ error: 'category_in_use' }, 400);
    db.categories = db.categories.filter((c) => c.id !== cid);
    return json({ ok: true });
  }],

  ['GET', '/api/parent/rewards', () => json(db.rewards)],

  ['POST', '/api/parent/rewards', (p, body) => {
    const n = Number(body.limit_per_day);
    const reward = {
      id: id(),
      kid_id: body.kid_id ? Number(body.kid_id) : null,
      title: String(body.title).trim(),
      cost: Number(body.cost),
      bucket_required: body.bucket_required,
      icon: body.icon || '🎁',
      active: 1,
      limit_per_day: Number.isInteger(n) && n > 0 ? n : null,
    };
    db.rewards.push(reward);
    return json(reward, 201);
  }],

  ['PATCH', '/api/parent/rewards/:id', (p, body) => {
    const reward = db.rewards.find((r) => r.id === Number(p.id));
    if (!reward) return json({ error: 'not_found' }, 404);
    if (body.title !== undefined) reward.title = String(body.title).trim();
    if (body.cost !== undefined) reward.cost = Number(body.cost);
    if (body.bucket_required !== undefined) reward.bucket_required = body.bucket_required;
    if (body.icon !== undefined) reward.icon = body.icon;
    if (body.active !== undefined) reward.active = body.active ? 1 : 0;
    if (body.kid_id !== undefined) reward.kid_id = body.kid_id ? Number(body.kid_id) : null;
    if (body.limit_per_day !== undefined) {
      const n = Number(body.limit_per_day);
      reward.limit_per_day = Number.isInteger(n) && n > 0 ? n : null;
    }
    return json(reward);
  }],

  ['GET', '/api/parent/kids', () =>
    json(db.kids.map((k) => ({ ...k, balances: balances(k.id) })))],

  ['POST', '/api/parent/kids', (p, body) => {
    const kid = {
      id: id(),
      name: String(body.name).trim(),
      avatar_icon: body.avatar_icon || '🙂',
      theme: body.theme,
      age: Number(body.age),
      vault_mode: 'manual',
      auto_split_ratio: 0.7,
      secret_code: null,
      goal_reward_id: null,
      freeze_tokens: 0,
      cents_per_point: 0,
    };
    db.kids.push(kid);
    return json(kid, 201);
  }],

  ['POST', '/api/parent/kids/:id/freeze-tokens', (p, body) => {
    const kid = kidById(p.id);
    if (!kid) return json({ error: 'kid_not_found' }, 404);
    const delta = Number(body.delta ?? 1);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10) {
      return json({ error: 'invalid_delta' }, 400);
    }
    kid.freeze_tokens = Math.max(0, kid.freeze_tokens + delta);
    return json({
      ok: true,
      tokens: kid.freeze_tokens,
      history: db.freezeDays.filter((f) => f.kid_id === kid.id),
    });
  }],

  ['POST', '/api/parent/kids/:id/adjust', (p, body) => {
    const kid = kidById(p.id);
    const amount = Number(body.amount);
    const bucket = body.bucket;
    if (!kid || !Number.isInteger(amount) || amount === 0) return json({ error: 'invalid_amount' }, 400);
    if (amount < 0 && balances(kid.id)[bucket] < -amount) {
      return json({ error: 'insufficient_points' }, 400);
    }
    credit(kid.id, amount > 0 ? 'earn' : 'spend', bucket, Math.abs(amount), 'adjustment');
    return json({ ok: true, balances: balances(kid.id) });
  }],

  ['GET', '/api/parent/kids/:id/history', (p) => {
    const kidId = Number(p.id);
    return json({
      completions: db.completions
        .filter((c) => c.kid_id === kidId)
        .slice(-200)
        .reverse()
        .map((c) => {
          const t = db.tasks.find((x) => x.id === c.task_id);
          return {
            id: c.id,
            date: c.date,
            status: c.status,
            completed_at: c.completed_at,
            reviewed_at: c.reviewed_at,
            title: t.title,
            icon: t.icon,
            point_value: t.point_value,
          };
        }),
      ledger: db.ledger.filter((r) => r.kid_id === kidId).slice(-200).reverse(),
      redemptions: db.redemptions
        .filter((r) => r.kid_id === kidId)
        .slice(-100)
        .reverse()
        .map((r) => {
          const rc = db.rewards.find((x) => x.id === r.reward_id);
          return {
            id: r.id,
            cost_paid: r.cost_paid,
            redeemed_at: r.redeemed_at,
            status: r.status,
            title: rc.title,
            icon: rc.icon,
          };
        }),
      balances: balances(kidId),
    });
  }],

  ['POST', '/api/parent/kids/:id/reset-day', (p) => {
    const today = todayStr();
    const before = db.completions.length;
    db.completions = db.completions.filter((c) => !(c.kid_id === Number(p.id) && c.date === today));
    return json({ ok: true, cleared: before - db.completions.length });
  }],

  ['POST', '/api/parent/kids/:id/clear-badges', (p) => {
    const before = db.badges.length;
    db.badges = db.badges.filter((b) => b.kid_id !== Number(p.id));
    return json({ ok: true, cleared: before - db.badges.length });
  }],

  ['DELETE', '/api/parent/kids/:id', (p) => {
    const kidId = Number(p.id);
    db.kids = db.kids.filter((k) => k.id !== kidId);
    db.completions = db.completions.filter((c) => c.kid_id !== kidId);
    db.redemptions = db.redemptions.filter((r) => r.kid_id !== kidId);
    db.ledger = db.ledger.filter((l) => l.kid_id !== kidId);
    db.badges = db.badges.filter((b) => b.kid_id !== kidId);
    db.streaks = db.streaks.filter((s) => s.kid_id !== kidId);
    return json({ ok: true });
  }],

  ['PATCH', '/api/parent/kids/:id', (p, body) => {
    const kid = kidById(p.id);
    if (!kid) return json({ error: 'kid_not_found' }, 404);
    if (body.vault_mode !== undefined) kid.vault_mode = body.vault_mode;
    if (body.auto_split_ratio !== undefined) kid.auto_split_ratio = Number(body.auto_split_ratio);
    if (body.theme !== undefined) kid.theme = body.theme;
    if (body.avatar_icon !== undefined) kid.avatar_icon = body.avatar_icon;
    if (body.secret_code !== undefined) kid.secret_code = body.secret_code || null;
    if (body.cents_per_point !== undefined) {
      const cents = Number(body.cents_per_point);
      if (!Number.isInteger(cents) || cents < 0 || cents > 1000) {
        return json({ error: 'invalid_cents_per_point' }, 400);
      }
      kid.cents_per_point = cents;
    }
    return json(kid);
  }],

  ['POST', '/api/parent/award', (p, body) => {
    const amount = Number(body.amount);
    const kidIds = Array.isArray(body.kid_ids) ? body.kid_ids : [];
    if (!Number.isInteger(amount) || amount <= 0 || kidIds.length === 0) {
      return json({ error: 'invalid_award' }, 400);
    }
    for (const kidId of kidIds) if (!kidById(kidId)) return json({ error: 'kid_not_found' }, 400);
    for (const kidId of kidIds) {
      credit(kidId, 'earn', body.bucket || 'checking', amount, `award:${body.reason || 'bonus'}`);
      checkBadges(kidId);
    }
    return json({ ok: true });
  }],

  ['GET', '/api/parent/family-goal', () => json(familyGoalState())],

  ['POST', '/api/parent/family-goal', (p, body) => {
    if (!body || body.clear) {
      db.settings.familyGoal = null;
      return json(null);
    }
    db.settings.familyGoal = {
      title: String(body.title).trim(),
      icon: body.icon || '🎉',
      target: Number(body.target),
      started_at: nowIso(),
    };
    return json(familyGoalState());
  }],

  ['GET', '/api/parent/vacation', () =>
    json({ on: db.settings.vacation, since: db.settings.vacationSince })],

  ['POST', '/api/parent/vacation', (p, body) => {
    db.settings.vacation = !!body.on;
    db.settings.vacationSince = body.on ? nowIso() : null;
    return json({ on: db.settings.vacation, since: db.settings.vacationSince });
  }],

  ['GET', '/api/parent/break-days', () => json(db.breakDays)],

  ['POST', '/api/parent/break-days', (p, body) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? ''))) return json({ error: 'invalid_date' }, 400);
    db.breakDays = db.breakDays.filter((d) => d.date !== body.date);
    if (body.on !== false) db.breakDays.push({ date: body.date, label: body.label || null });
    db.breakDays.sort((a, b) => (a.date < b.date ? 1 : -1));
    return json({ ok: true, days: db.breakDays });
  }],

  ['GET', '/api/parent/export/ledger.csv', () =>
    text(
      csv(
        ['when', 'kid', 'direction', 'bucket', 'points', 'source'],
        db.ledger.map((r) => [r.created_at, kidById(r.kid_id)?.name, r.direction, r.bucket, r.amount, r.source])
      ),
      'text/csv'
    )],

  ['GET', '/api/parent/export/completions.csv', () =>
    text(
      csv(
        ['date', 'kid', 'task', 'points', 'status', 'tapped', 'reviewed'],
        db.completions.map((c) => {
          const t = db.tasks.find((x) => x.id === c.task_id);
          return [c.date, kidById(c.kid_id)?.name, t.title, t.point_value, c.status, c.completed_at, c.reviewed_at];
        })
      ),
      'text/csv'
    )],

  // Stubs: real in the app, meaningless without a server behind them.
  ['GET', '/api/parent/backups', () => json([])],
  ['POST', '/api/parent/backups', () =>
    json({ error: 'demo_no_backups', message: 'Backups need a real server and disk.' }, 400)],
  ['GET', '/api/parent/digest', () => json({ data: digestData() })],
  ['POST', '/api/parent/digest', () =>
    json({ error: 'demo_no_ntfy', message: 'The demo has nowhere to send a notification.' }, 400)],

  ['POST', '/api/parent/fresh-start', () => {
    localStorage.removeItem(DEMO_KEY);
    seed();
    return json({ ok: true, backup: null });
  }],
];

/** The structured half of the weekly digest — enough for the preview modal. */
function digestData() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  return {
    kids: db.kids.map((kid) => ({
      name: kid.name,
      approved: db.completions.filter(
        (c) => c.kid_id === kid.id && c.status === 'approved' && c.completed_at >= since
      ).length,
      earned: db.ledger
        .filter((r) => r.kid_id === kid.id && r.direction === 'earn' && r.created_at >= since)
        .reduce((sum, r) => sum + r.amount, 0),
      bestStreak: db.streaks
        .filter((s) => s.kid_id === kid.id)
        .reduce((n, s) => Math.max(n, s.current_streak), 0),
      badges: db.badges.filter((b) => b.kid_id === kid.id && b.earned_at >= since).length,
    })),
    familyGoal: familyGoalState(),
  };
}

// --------------------------------------------------------------- dispatch

function matchRoute(method, pathname) {
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = pathParts[i];
      else if (patternParts[i] !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler, params };
  }
  return null;
}

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const pathname = new URL(url, location.href).pathname;
  if (!pathname.startsWith('/api/')) return realFetch(input, init);

  const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
  const match = matchRoute(method, pathname);
  if (!match) {
    return json({ error: 'demo_endpoint_not_implemented', path: pathname }, 404);
  }

  let body = {};
  if (init.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = {};
    }
  }

  // A touch of latency, so loading states are visible rather than skipped.
  await new Promise((r) => setTimeout(r, 40));
  try {
    const res = match.handler(match.params, body);
    save();
    return res;
  } catch (err) {
    console.error('[demo] handler threw', pathname, err);
    return json({ error: 'demo_error', message: String(err) }, 500);
  }
};

load();

export { DEMO_KEY };
