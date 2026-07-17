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

/** Settings PIN wins; else env PARENT_PIN; else the well-known default. */
export function getPin() {
  return getSetting('parent_pin') || process.env.PARENT_PIN || '1234';
}

export function setPin(pin) {
  setSetting('parent_pin', String(pin));
}

export function isConfigured() {
  return getSetting('household_configured') === '1';
}

export function markConfigured() {
  setSetting('household_configured', '1');
}
