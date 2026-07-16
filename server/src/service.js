import { db, balances } from './db.js';
import { todayStr, prevDay, nowIso } from './dates.js';

/**
 * Lazy daily housekeeping: pending completions from prior days expire.
 * The row stays in `completions` for parent visibility; it just can no
 * longer be approved or earn points.
 */
export function expireStalePending() {
  db.prepare(`UPDATE completions SET status = 'expired' WHERE status = 'pending' AND date < ?`).run(
    todayStr()
  );
}

/**
 * The streak a kid should currently see for a task. A stored streak whose
 * last approved day is before yesterday is broken — display 0.
 */
export function displayStreak(streakRow) {
  if (!streakRow || !streakRow.last_completed_date) return 0;
  const today = todayStr();
  if (streakRow.last_completed_date === today || streakRow.last_completed_date === prevDay(today)) {
    return streakRow.current_streak;
  }
  return 0;
}

/** Split an earned amount into buckets per the kid's vault config. */
export function splitEarnings(kid, amount) {
  if (kid.vault_mode !== 'auto_split') return { checking: amount, savings: 0 };
  const savings = Math.round(amount * (1 - kid.auto_split_ratio));
  return { checking: amount - savings, savings };
}

function insertLedger(kidId, amount, direction, bucket, source) {
  if (amount <= 0) return null;
  const info = db
    .prepare(
      `INSERT INTO points_ledger (kid_id, amount, direction, bucket, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(kidId, amount, direction, bucket, source, nowIso());
  return info.lastInsertRowid;
}

function recordAction(type, payload) {
  db.prepare(`INSERT INTO parent_actions (type, payload, created_at) VALUES (?, ?, ?)`).run(
    type,
    JSON.stringify(payload),
    nowIso()
  );
}

/**
 * Approve one pending completion: credit points, advance the streak,
 * and snapshot everything needed to undo. Returns the undo payload,
 * or null if the completion wasn't pending.
 */
function approveCompletionInner(completionId) {
  const completion = db.prepare(`SELECT * FROM completions WHERE id = ?`).get(completionId);
  if (!completion || completion.status !== 'pending') return null;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(completion.task_id);
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(completion.kid_id);

  db.prepare(`UPDATE completions SET status = 'approved', reviewed_at = ? WHERE id = ?`).run(
    nowIso(),
    completionId
  );

  const split = splitEarnings(kid, task.point_value);
  const ledgerIds = [];
  const source = `completion:${completionId}`;
  const checkingId = insertLedger(kid.id, split.checking, 'earn', 'checking', source);
  if (checkingId) ledgerIds.push(checkingId);
  const savingsId = insertLedger(kid.id, split.savings, 'earn', 'savings', source);
  if (savingsId) ledgerIds.push(savingsId);

  const prevStreak =
    db.prepare(`SELECT * FROM streaks WHERE task_id = ? AND kid_id = ?`).get(task.id, kid.id) || null;

  let current = 1;
  if (prevStreak && prevStreak.last_completed_date === prevDay(completion.date)) {
    current = prevStreak.current_streak + 1;
  } else if (prevStreak && prevStreak.last_completed_date === completion.date) {
    current = prevStreak.current_streak;
  }
  const longest = Math.max(current, prevStreak ? prevStreak.longest_streak : 0);

  db.prepare(
    `INSERT INTO streaks (task_id, kid_id, current_streak, longest_streak, last_completed_date)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_id, kid_id) DO UPDATE SET
       current_streak = excluded.current_streak,
       longest_streak = excluded.longest_streak,
       last_completed_date = excluded.last_completed_date`
  ).run(task.id, kid.id, current, longest, completion.date);

  return { completionId, ledgerIds, prevStreak, taskId: task.id, kidId: kid.id };
}

export const approveCompletion = db.transaction((completionId) => {
  const undo = approveCompletionInner(completionId);
  if (!undo) return false;
  recordAction('approve_completion', { items: [undo] });
  return true;
});

export const rejectCompletion = db.transaction((completionId) => {
  const info = db
    .prepare(`UPDATE completions SET status = 'rejected', reviewed_at = ? WHERE id = ? AND status = 'pending'`)
    .run(nowIso(), completionId);
  return info.changes > 0;
});

/**
 * Approve one pending redemption: charge the required bucket. Fails
 * (returns {ok:false}) if the kid can no longer afford it.
 */
function approveRedemptionInner(redemptionId) {
  const redemption = db.prepare(`SELECT * FROM redemptions WHERE id = ?`).get(redemptionId);
  if (!redemption || redemption.status !== 'pending') return { ok: false, reason: 'not_pending' };

  const reward = db.prepare(`SELECT * FROM rewards_catalog WHERE id = ?`).get(redemption.reward_id);
  const bucket = reward.bucket_required;
  const bal = balances(redemption.kid_id);
  if (bal[bucket] < redemption.cost_paid) return { ok: false, reason: 'insufficient_points' };

  db.prepare(`UPDATE redemptions SET status = 'approved', reviewed_at = ? WHERE id = ?`).run(
    nowIso(),
    redemptionId
  );
  const ledgerId = insertLedger(
    redemption.kid_id,
    redemption.cost_paid,
    'spend',
    bucket,
    `redemption:${redemptionId}`
  );
  return { ok: true, undo: { redemptionId, ledgerIds: ledgerId ? [ledgerId] : [] } };
}

export const approveRedemption = db.transaction((redemptionId) => {
  const result = approveRedemptionInner(redemptionId);
  if (result.ok) recordAction('approve_redemption', { items: [result.undo] });
  return result;
});

export const rejectRedemption = db.transaction((redemptionId) => {
  const info = db
    .prepare(`UPDATE redemptions SET status = 'rejected', reviewed_at = ? WHERE id = ? AND status = 'pending'`)
    .run(nowIso(), redemptionId);
  return info.changes > 0;
});

/** Approve every pending completion for today, as one undoable action. */
export const approveAllToday = db.transaction(() => {
  const pending = db
    .prepare(`SELECT id FROM completions WHERE status = 'pending' AND date = ?`)
    .all(todayStr());
  const items = [];
  for (const row of pending) {
    const undo = approveCompletionInner(row.id);
    if (undo) items.push(undo);
  }
  if (items.length > 0) recordAction('approve_completion', { items });
  return items.length;
});

/**
 * Undo the most recent (not yet undone) approval action. Reverts the
 * completion/redemption to pending, deletes the ledger rows it created,
 * and restores the prior streak state.
 */
export const undoLastAction = db.transaction(() => {
  const action = db
    .prepare(`SELECT * FROM parent_actions WHERE undone = 0 ORDER BY id DESC LIMIT 1`)
    .get();
  if (!action) return { ok: false, reason: 'nothing_to_undo' };

  const payload = JSON.parse(action.payload);
  const deleteLedger = db.prepare(`DELETE FROM points_ledger WHERE id = ?`);

  for (const item of payload.items) {
    for (const ledgerId of item.ledgerIds) deleteLedger.run(ledgerId);

    if (action.type === 'approve_completion') {
      db.prepare(`UPDATE completions SET status = 'pending', reviewed_at = NULL WHERE id = ?`).run(
        item.completionId
      );
      if (item.prevStreak) {
        db.prepare(
          `UPDATE streaks SET current_streak = ?, longest_streak = ?, last_completed_date = ?
           WHERE task_id = ? AND kid_id = ?`
        ).run(
          item.prevStreak.current_streak,
          item.prevStreak.longest_streak,
          item.prevStreak.last_completed_date,
          item.taskId,
          item.kidId
        );
      } else {
        db.prepare(`DELETE FROM streaks WHERE task_id = ? AND kid_id = ?`).run(item.taskId, item.kidId);
      }
    } else if (action.type === 'approve_redemption') {
      db.prepare(`UPDATE redemptions SET status = 'pending', reviewed_at = NULL WHERE id = ?`).run(
        item.redemptionId
      );
    }
  }

  db.prepare(`UPDATE parent_actions SET undone = 1 WHERE id = ?`).run(action.id);
  return { ok: true, type: action.type, count: payload.items.length };
});

/** Kid-initiated (or parent-initiated) transfer between buckets. */
export const transferPoints = db.transaction((kidId, from, to, amount) => {
  if (!['checking', 'savings'].includes(from) || !['checking', 'savings'].includes(to) || from === to) {
    return { ok: false, reason: 'invalid_buckets' };
  }
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
  const bal = balances(kidId);
  if (bal[from] < amount) return { ok: false, reason: 'insufficient_points' };
  insertLedger(kidId, amount, 'spend', from, 'transfer');
  insertLedger(kidId, amount, 'earn', to, 'transfer');
  return { ok: true };
});
