import { getSetting, setSetting } from './settings.js';

/**
 * Instance configuration: app name, parent PIN, and whether first-run
 * setup is complete. All persist in the settings table so a self-hoster
 * configures everything from the UI — no env editing required — while
 * env vars still work as defaults for scripted deploys.
 */

const DEFAULT_APP_NAME = 'Reward Chart';

export function getAppName() {
  return getSetting('app_name') || process.env.APP_NAME || DEFAULT_APP_NAME;
}

export function setAppName(name) {
  setSetting('app_name', String(name).trim().slice(0, 60));
}

/**
 * The well-known fallback. Published in the README and docker-compose, so any
 * household still on it effectively has no parent lock at all.
 */
export const DEFAULT_PIN = '1234';

/** Settings PIN wins; else env PARENT_PIN; else the well-known default. */
export function getPin() {
  return getSetting('parent_pin') || process.env.PARENT_PIN || DEFAULT_PIN;
}

/**
 * True when the effective PIN is still the published default — whether it was
 * never set (installs predating the setup wizard get marked configured
 * automatically) or a family deliberately chose 1234. Either way it's worth
 * saying so out loud in Settings.
 */
export function isDefaultPin() {
  return getPin() === DEFAULT_PIN;
}

export function setPin(pin) {
  setSetting('parent_pin', String(pin));
}

/**
 * Base URL a parent's phone can actually reach this server on — typically the
 * Tailscale address (see "Remote access" in the README). Only used to build
 * the approve/reject buttons in push notifications; when it's unset the
 * notifications still send, just without buttons, because a button pointing
 * at an unreachable host is worse than no button.
 */
export function getPublicUrl() {
  const raw = getSetting('public_url') || process.env.PUBLIC_URL || '';
  return raw.trim().replace(/\/+$/, '');
}

export function setPublicUrl(url) {
  setSetting('public_url', String(url).trim().replace(/\/+$/, '').slice(0, 200));
}

/**
 * Quiet hours: a window in which the kiosk stays silent. Celebrations still
 * animate — a kid who earned a fanfare should still see one — but nothing
 * makes noise.
 *
 * Stored on the server rather than per-browser so it holds for every tablet
 * and phone in the house. A per-device setting would have to be re-done on
 * each one and would silently not apply to the next device someone picked up.
 *
 * Times are local "HH:MM" strings, and the window may wrap past midnight —
 * which is the normal case, since the whole point is "after bedtime, before
 * a reasonable morning".
 */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function getQuietHours() {
  const raw = getSetting('quiet_hours');
  if (!raw) return { on: false, start: '19:30', end: '07:00' };
  try {
    const parsed = JSON.parse(raw);
    if (!TIME_RE.test(parsed.start) || !TIME_RE.test(parsed.end)) throw new Error('bad');
    return { on: !!parsed.on, start: parsed.start, end: parsed.end };
  } catch {
    // A corrupt value shouldn't silence the app forever.
    return { on: false, start: '19:30', end: '07:00' };
  }
}

/** Returns the stored state, or null when the input isn't a valid window. */
export function setQuietHours({ on, start, end }) {
  if (!TIME_RE.test(String(start)) || !TIME_RE.test(String(end))) return null;
  // A window that starts and ends at the same minute is either "always" or
  // "never" depending on how you read it, so refuse it rather than guess.
  if (start === end) return null;
  setSetting('quiet_hours', JSON.stringify({ on: !!on, start, end }));
  return getQuietHours();
}

export function isConfigured() {
  return getSetting('household_configured') === '1';
}

export function markConfigured() {
  setSetting('household_configured', '1');
}
