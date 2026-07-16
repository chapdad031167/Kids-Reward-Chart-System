/**
 * Optional push notifications via ntfy (https://ntfy.sh or self-hosted).
 * Set NTFY_URL to the full topic URL (e.g. http://chappynas:8093/reward-chart)
 * to enable; leave unset to disable. Fire-and-forget — a down ntfy server
 * never blocks or fails the kid-facing flow.
 */
const NTFY_URL = process.env.NTFY_URL || '';

export function notifyParent(title, message, tags = '') {
  if (!NTFY_URL) return;
  fetch(NTFY_URL, {
    method: 'POST',
    body: message,
    headers: { Title: title, Tags: tags },
  }).catch((err) => console.warn(`ntfy notification failed: ${err.message}`));
}
