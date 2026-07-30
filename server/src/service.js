import { db, balances } from './db.js';
import { todayStr, prevDay, nowIso } from './dates.js';
import { prevExpectedDay } from './schedule.js';
import { getSetting, setSetting } from './vacation.js';

/**
 * The oldest date still inside the approval grace window.
 *
 * Taps used to expire the instant the date rolled over, which punished the
 * kid for the parent's timing: bedtime chores tapped at 8pm, the parent falls
 * asleep before approving, and by morning the work is expired, invisible in
 * the queue, worth nothing, and the streak is broken. Yesterday's pending
 * work now stays approvable for the whole of today.
 */
export function oldestApprovableDate() {
  return prevDay(todayStr());
}

/**
 * Lazy daily housekeeping: pending completions older than the grace window
 * expire. The row stays in `completions` for parent visibility; it just can
 * no longer be approved or earn points.
 */
export function expireStalePending() {
  db.prepare(`UPDATE completions SET status = 'expired' WHERE status = 'pending' AND date < ?`).run(
    oldestApprovableDate()
  );
}

/**
 * The streak a kid should currently see for a task. A streak is alive if
 * its last approved day is today or the most recent day the task was
 * actually expected — vacation days and unscheduled days never count as
 * "missed".
 */
export function displayStreak(streakRow, taskDays = null) {
  if (!streakRow || !streakRow.last_completed_date) return 0;
  const today = todayStr();
  if (
    streakRow.last_completed_date === today ||
    streakRow.last_completed_date >= prevExpectedDay(taskDays, today)
  ) {
    return streakRow.current_streak;
  }
  return 0;
}

/**
 * Points already committed to redemptions the parent hasn't ruled on yet.
 *
 * A pending request is a hold, not a spend — nothing leaves the ledger until
 * approval. Anything deciding what a kid can afford has to subtract these, or
 * the same points get promised twice and the second approval fails at the
 * till.
 */
export function pendingHolds(kidId) {
  const rows = db
    .prepare(
      `SELECT rc.bucket_required AS bucket, COALESCE(SUM(r.cost_paid), 0) AS total
       FROM redemptions r JOIN rewards_catalog rc ON rc.id = r.reward_id
       WHERE r.kid_id = ? AND r.status = 'pending' GROUP BY rc.bucket_required`
    )
    .all(kidId);
  const held = { checking: 0, savings: 0 };
  for (const r of rows) held[r.bucket] = r.total;
  return held;
}

/** What a kid can actually commit right now: balance minus pending holds. */
export function spendableBalance(kidId) {
  const bal = balances(kidId);
  const held = pendingHolds(kidId);
  return { checking: bal.checking - held.checking, savings: bal.savings - held.savings };
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

  const last = prevStreak?.last_completed_date || null;
  let current;
  if (!last) {
    current = 1;
  } else if (last === completion.date) {
    // Re-approving the same day (e.g. after an undo) never advances it.
    current = prevStreak.current_streak;
  } else if (last > completion.date) {
    // Backfilling an older day after a newer one already landed — possible
    // now that yesterday stays approvable. The chain was already advanced by
    // the newer day, so leave it alone rather than counting the day twice.
    current = prevStreak.current_streak;
  } else if (last >= prevExpectedDay(task.days, completion.date)) {
    // Chain continues across vacation days and unscheduled days.
    current = prevStreak.current_streak + 1;
  } else {
    current = 1;
  }
  const longest = Math.max(current, prevStreak ? prevStreak.longest_streak : 0);
  // Never walk the anchor backwards when an older day is approved late.
  const anchor = last && last > completion.date ? last : completion.date;

  db.prepare(
    `INSERT INTO streaks (task_id, kid_id, current_streak, longest_streak, last_completed_date)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_id, kid_id) DO UPDATE SET
       current_streak = excluded.current_streak,
       longest_streak = excluded.longest_streak,
       last_completed_date = excluded.last_completed_date`
  ).run(task.id, kid.id, current, longest, anchor);

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
 * Undo a rejection so the kid can have another go.
 *
 * UNIQUE (task_id, kid_id, date) means a rejected row blocks that task for the
 * rest of the day, so "you missed a spot — do it again" had no path back short
 * of Reset Day, which wipes the kid's whole day. Deleting the row rather than
 * flipping it to pending is deliberate: it puts the task back on the kid's
 * chart to actually redo, instead of putting un-redone work in front of the
 * parent to approve.
 */
export const reopenCompletion = db.transaction((completionId) => {
  const info = db.prepare(`DELETE FROM completions WHERE id = ? AND status = 'rejected'`).run(completionId);
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

/**
 * Approve every completion still inside the approval window, as one undoable
 * action. Matches what the parent queue shows — including yesterday's
 * leftovers — so the button's count and its effect can't disagree.
 */
export const approveAllPending = db.transaction(() => {
  const pending = db
    .prepare(`SELECT id FROM completions WHERE status = 'pending' AND date >= ? ORDER BY date, id`)
    .all(oldestApprovableDate());
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

/**
 * Rebuild a task's streak row from its approved-completion history.
 * Used after a manual reset deletes completions, where the undo-style
 * snapshot approach can't apply.
 */
export function recomputeStreak(taskId, kidId) {
  const taskDays = db.prepare(`SELECT days FROM tasks WHERE id = ?`).get(taskId)?.days ?? null;
  const rows = db
    .prepare(
      `SELECT date FROM completions
       WHERE task_id = ? AND kid_id = ? AND status = 'approved' ORDER BY date`
    )
    .all(taskId, kidId);

  if (rows.length === 0) {
    db.prepare(`DELETE FROM streaks WHERE task_id = ? AND kid_id = ?`).run(taskId, kidId);
    return;
  }

  let chain = 0;
  let longest = 0;
  let prev = null;
  for (const { date } of rows) {
    chain = prev !== null && prev >= prevExpectedDay(taskDays, date) ? chain + 1 : 1;
    if (chain > longest) longest = chain;
    prev = date;
  }

  db.prepare(
    `INSERT INTO streaks (task_id, kid_id, current_streak, longest_streak, last_completed_date)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_id, kid_id) DO UPDATE SET
       current_streak = excluded.current_streak,
       longest_streak = excluded.longest_streak,
       last_completed_date = excluded.last_completed_date`
  ).run(taskId, kidId, chain, longest, prev);
}

/**
 * Wipe one kid's day: delete today's completions (any status), claw back
 * the points they earned, and rebuild affected streaks from history.
 * Clears the undo stack, since undo snapshots may reference deleted rows.
 */
export const resetKidDay = db.transaction((kidId) => {
  const today = todayStr();
  const completions = db
    .prepare(`SELECT * FROM completions WHERE kid_id = ? AND date = ?`)
    .all(kidId, today);

  const deleteLedger = db.prepare(`DELETE FROM points_ledger WHERE kid_id = ? AND source = ?`);
  const deleteCompletion = db.prepare(`DELETE FROM completions WHERE id = ?`);
  for (const c of completions) {
    deleteLedger.run(kidId, `completion:${c.id}`);
    deleteCompletion.run(c.id);
  }

  for (const taskId of new Set(completions.map((c) => c.task_id))) {
    recomputeStreak(taskId, kidId);
  }

  db.prepare(`UPDATE parent_actions SET undone = 1 WHERE undone = 0`).run();
  return completions.length;
});

/**
 * Direct parent correction of a vault balance. Positive adds, negative
 * removes (never below zero). Logged in the ledger as 'adjustment'.
 */
export const adjustBalance = db.transaction((kidId, bucket, amount) => {
  if (!['checking', 'savings'].includes(bucket)) return { ok: false, reason: 'invalid_bucket' };
  if (!Number.isInteger(amount) || amount === 0) return { ok: false, reason: 'invalid_amount' };
  if (amount < 0 && balances(kidId)[bucket] < -amount) {
    return { ok: false, reason: 'insufficient_points' };
  }
  insertLedger(kidId, Math.abs(amount), amount > 0 ? 'earn' : 'spend', bucket, 'adjustment');
  return { ok: true };
});

/**
 * Parent bonus award: credit points to one or more kids outside the task
 * system ("helped unload the camping gear"). Follows each kid's vault
 * rules (manual → checking, auto-split → split).
 */
export const awardPoints = db.transaction((kidIds, amount, note) => {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
  if (!Array.isArray(kidIds) || kidIds.length === 0) return { ok: false, reason: 'no_kids' };

  // Resolve every kid BEFORE writing anything. A plain `return` from inside a
  // better-sqlite3 transaction commits whatever was already inserted — only a
  // throw rolls back — so validating inside the insert loop used to pay the
  // earlier kids and still report the whole award as failed.
  const kids = [];
  for (const kidId of kidIds) {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(kidId);
    if (!kid) return { ok: false, reason: 'kid_not_found' };
    kids.push(kid);
  }

  const source = `award:${(note || '').trim().slice(0, 80) || 'bonus'}`;
  for (const kid of kids) {
    const split = splitEarnings(kid, amount);
    insertLedger(kid.id, split.checking, 'earn', 'checking', source);
    insertLedger(kid.id, split.savings, 'earn', 'savings', source);
  }
  return { ok: true };
});

/**
 * Wipe a kid's badge collection and claw back badge bonus points.
 * Threshold badges the kid still qualifies for will re-earn on their
 * next visit — this is a correction tool, not a progress reset.
 */
export const clearBadges = db.transaction((kidId) => {
  const cleared = db.prepare(`SELECT COUNT(*) AS n FROM badges WHERE kid_id = ?`).get(kidId).n;
  db.prepare(`DELETE FROM badges WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM points_ledger WHERE kid_id = ? AND source LIKE 'badge:%'`).run(kidId);
  return cleared;
});

/**
 * Permanently delete a kid and everything about them: completions,
 * streaks, ledger, badges, redemptions, mystery assignments, and any
 * kid-specific tasks/rewards. Clears the undo stack since its snapshots
 * may reference deleted rows.
 */
export const deleteKid = db.transaction((kidId) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(kidId);
  if (!kid) return { ok: false, reason: 'kid_not_found' };

  db.prepare(`DELETE FROM completions WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM streaks WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM points_ledger WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM badges WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM redemptions WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM bonus_assignments WHERE kid_id = ?`).run(kidId);
  // Kid-specific tasks/rewards: completions/redemptions referencing them
  // belonged only to this kid and are gone above.
  db.prepare(`DELETE FROM tasks WHERE kid_id = ?`).run(kidId);
  db.prepare(`DELETE FROM rewards_catalog WHERE kid_id = ?`).run(kidId);
  db.prepare(`UPDATE parent_actions SET undone = 1 WHERE undone = 0`).run();
  db.prepare(`DELETE FROM kids WHERE id = ?`).run(kidId);
  return { ok: true, name: kid.name };
});

/**
 * Fresh start: wipe every bit of activity (points, streaks, badges,
 * history, redemptions, mystery picks, undo stack, vacation history)
 * while keeping all configuration — kids, themes, secret codes, vault
 * settings, tasks, rewards, categories. A set family goal survives but
 * restarts its progress count from now.
 */
export const freshStart = db.transaction(() => {
  for (const table of [
    'completions',
    'streaks',
    'points_ledger',
    'badges',
    'redemptions',
    'bonus_assignments',
    'parent_actions',
    'vacation_days',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  setSetting('vacation_mode', '0');
  setSetting('vacation_since', '');
  const familyGoalRaw = getSetting('family_goal');
  if (familyGoalRaw) {
    try {
      const goal = JSON.parse(familyGoalRaw);
      setSetting('family_goal', JSON.stringify({ ...goal, started_at: nowIso() }));
    } catch {
      setSetting('family_goal', '');
    }
  }
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
