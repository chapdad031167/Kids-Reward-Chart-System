/**
 * Brute-force guard for the parent PIN.
 *
 * A 4-digit PIN is only 10,000 combinations — a script in the kiosk tablet's
 * own browser console can exhaust that over the LAN in well under a minute,
 * which is comfortably within reach of a motivated kid. Failures are counted
 * per client address; past the threshold that client is locked out for a
 * doubling window.
 *
 * Deliberately in-memory: a restart clears it, which is the right trade for a
 * single-household app (no schema, no cleanup job, and a power-cycle is not a
 * plausible attack step for someone already sitting at the tablet).
 */

const MAX_FAILURES = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
/** Forget an idle client so one honest typo doesn't linger for days. */
const FORGET_AFTER_MS = 60 * 60_000;

const clients = new Map(); // key -> { failures, lockedUntil, lastSeen }

function entryFor(key, now) {
  const found = clients.get(key);
  // Lockouts cap well below FORGET_AFTER_MS, so an expiring entry can never
  // discard an active lockout.
  if (found && now - found.lastSeen < FORGET_AFTER_MS) return found;
  const fresh = { failures: 0, lockedUntil: 0, lastSeen: now };
  clients.set(key, fresh);
  return fresh;
}

/** Milliseconds left on a lockout, or 0 when this client may try again. */
export function lockoutRemaining(key, now = Date.now()) {
  return Math.max(0, entryFor(key, now).lockedUntil - now);
}

/** Count a wrong PIN. Returns the ms this client must now wait (0 if none). */
export function recordFailure(key, now = Date.now()) {
  const e = entryFor(key, now);
  e.failures += 1;
  e.lastSeen = now;
  if (e.failures >= MAX_FAILURES) {
    const over = e.failures - MAX_FAILURES;
    const wait = Math.min(BASE_LOCKOUT_MS * 2 ** over, MAX_LOCKOUT_MS);
    e.lockedUntil = now + wait;
    console.warn(
      `Parent PIN: ${e.failures} failed attempts from ${key} — locked out for ${Math.round(wait / 1000)}s`
    );
  }
  return Math.max(0, e.lockedUntil - now);
}

/** A correct PIN clears the client's history. */
export function recordSuccess(key) {
  clients.delete(key);
}

/** Identify the caller. LAN-only app, so the socket address is enough. */
export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Test hook. */
export function resetGuard() {
  clients.clear();
}
