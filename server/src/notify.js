/**
 * Optional push notifications via ntfy (https://ntfy.sh or self-hosted).
 * Set NTFY_URL to the full topic URL (e.g. http://your-server:8093/reward-chart)
 * to enable; leave unset to disable. Fire-and-forget — a down ntfy server
 * never blocks or fails the kid-facing flow.
 */
import { mintToken } from './actionToken.js';
import { getPublicUrl } from './config.js';

const NTFY_URL = process.env.NTFY_URL || '';

export function notifyParent(title, message, tags = '', actions = '') {
  if (!NTFY_URL) return;
  const headers = { Title: title, Tags: tags };
  if (actions) headers.Actions = actions;
  fetch(NTFY_URL, {
    method: 'POST',
    body: message,
    headers,
  }).catch((err) => console.warn(`ntfy notification failed: ${err.message}`));
}

/**
 * Approve/reject buttons for the notification itself, so a parent can act on
 * it without opening the dashboard and typing the PIN.
 *
 * Returns '' when no public URL is configured — a button pointing at a host
 * the phone can't reach is worse than no button at all. See "Remote access"
 * in the README for how to make one reachable.
 */
export function reviewActions(kind, id) {
  const base = getPublicUrl();
  if (!base) return '';
  const url = (act) => `${base}/api/action/${mintToken(kind, id, act)}`;
  // ntfy's Actions syntax; `clear=true` dismisses the notification on tap.
  return [
    `http, ✅ Approve, ${url('approve')}, method=POST, clear=true`,
    `http, ❌ Not yet, ${url('reject')}, method=POST, clear=true`,
  ].join('; ');
}
