/**
 * Valid theme keys, in one place.
 *
 * This list was previously copy-pasted into both route files, so adding a
 * theme meant remembering to edit two unrelated validators — the kind of
 * duplication that silently rejects a perfectly good theme on one endpoint
 * and accepts it on another.
 *
 * The full theme data (colours, wording, icons, meters) lives client-side in
 * client/src/themes.js, since that's the only place it's rendered. The server
 * only needs to know which keys are legal. `npm test` asserts the two stay in
 * step — see test/p4.test.mjs.
 */
export const THEME_KEYS = ['soccer', 'dino', 'space', 'fantasy', 'racing', 'ocean'];

export function isValidTheme(key) {
  return THEME_KEYS.includes(key);
}
