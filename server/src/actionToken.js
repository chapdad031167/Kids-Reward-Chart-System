/**
 * Short-lived signed tokens for one-tap approve/reject from an ntfy
 * notification.
 *
 * The point of these is to close the loop the audit called a dead end: ntfy
 * already tells a parent their kid did their chores, but acting on it meant
 * opening the dashboard and typing the PIN. A token lets the notification's
 * own buttons do it.
 *
 * The security trade is deliberate and narrow. A token authorises exactly one
 * action on exactly one row, expires in hours, and is useless for anything
 * else — it is not a session and cannot reach the rest of the parent API. It
 * is only ever handed to the parent's own push channel.
 */
import crypto from 'node:crypto';
import { getSetting, setSetting } from './settings.js';

/** Long enough that the token, not the secret, is the weak link. */
const SECRET_BYTES = 32;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // through a night's sleep

/**
 * Per-install signing secret, generated once and persisted. Deliberately not
 * derived from the PIN: changing the PIN shouldn't silently invalidate
 * notifications already sitting on a phone, and the PIN is far too weak to
 * sign with.
 */
function secret() {
  let s = getSetting('action_secret');
  if (!s) {
    s = crypto.randomBytes(SECRET_BYTES).toString('hex');
    setSetting('action_secret', s);
  }
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/**
 * Mint a token authorising one action on one record.
 * `kind` is 'completion' or 'redemption'; `act` is 'approve' or 'reject'.
 */
export function mintToken(kind, id, act, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const payload = b64url(JSON.stringify({ k: kind, i: id, a: act, e: now + ttlMs }));
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify and decode. Returns null for anything malformed, mis-signed or
 * expired — callers should treat every failure identically so a probe can't
 * tell which it was.
 */
export function readToken(token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expected = sign(payloadB64);
  // Constant-time compare; timingSafeEqual throws on length mismatch.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims.e !== 'number' || claims.e < now) return null;
  if (claims.k !== 'completion' && claims.k !== 'redemption') return null;
  if (claims.a !== 'approve' && claims.a !== 'reject') return null;
  if (!Number.isInteger(claims.i)) return null;

  return { kind: claims.k, id: claims.i, act: claims.a };
}

/** Test hook: forget the signing secret so a fresh one is generated. */
export function resetSecret() {
  setSetting('action_secret', '');
}
