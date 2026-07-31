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

export function isConfigured() {
  return getSetting('household_configured') === '1';
}

export function markConfigured() {
  setSetting('household_configured', '1');
}
