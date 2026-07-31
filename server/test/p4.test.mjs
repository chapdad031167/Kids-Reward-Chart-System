/**
 * Regression checks for the P4 work.
 *
 * The theme check is the interesting one: the theme list lives on both sides
 * of the wire (the server validates keys, the client renders them) and there
 * is no runtime link between them — the client source isn't even in the
 * production image. This test is the only thing standing between us and a
 * theme that's pickable in the UI but rejected by the API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_KEYS } from '../src/themes.js';
import { check, requireScratchDb, finish } from './helpers.mjs';

requireScratchDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_THEMES = path.join(__dirname, '..', '..', 'client', 'src', 'themes.js');

console.log('\nP4 — theme keys stay in step across client and server');

const clientThemes = await import(CLIENT_THEMES);
const clientKeys = Object.keys(clientThemes.THEMES);

check(
  'the server accepts exactly the themes the client can render',
  JSON.stringify([...THEME_KEYS].sort()) === JSON.stringify([...clientKeys].sort()),
  `server=${THEME_KEYS.join(',')} client=${clientKeys.join(',')}`
);

// Every theme must be complete, or it half-renders: a missing meter falls back
// to the plain bar, a missing cheer pool throws when the celebration fires.
const REQUIRED_TERMS = [
  'celebration', 'celebrationSub', 'cheers', 'streak', 'progress', 'checking',
  'savings', 'allDone', 'rewards', 'pendingBanner', 'rejectedBanner',
  'mysteryTitle', 'mysteryTap', 'bonus', 'goalTitle', 'goalReached', 'badges',
  'familyGoal', 'levelTitles', 'vacationTitle', 'vacationBody',
];
const REQUIRED_COLORS = [
  'bg', 'card', 'cardText', 'accent', 'accentText', 'meterFill', 'chip',
  'headerText', 'texture',
];
const REQUIRED_ICONS = ['mascot', 'streak', 'savings', 'checking', 'mystery'];

// The meters actually implemented in ProgressMeter.jsx.
const METER_STYLES = ['egg', 'pitch', 'rocket', 'track', 'castle', 'voyage'];
const meterSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'src', 'components', 'ProgressMeter.jsx'),
  'utf8'
);
const celebrationSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'src', 'components', 'Celebration.jsx'),
  'utf8'
);
const soundSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'src', 'sounds.js'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'src', 'index.css'),
  'utf8'
);

for (const key of clientKeys) {
  const t = clientThemes.THEMES[key];
  const missingTerms = REQUIRED_TERMS.filter((k) => t.terms?.[k] === undefined);
  const missingColors = REQUIRED_COLORS.filter((k) => t.colors?.[k] === undefined);
  const missingIcons = REQUIRED_ICONS.filter((k) => t.icons?.[k] === undefined);

  check(`${key}: has every term`, missingTerms.length === 0, missingTerms.join(','));
  check(`${key}: has every colour`, missingColors.length === 0, missingColors.join(','));
  check(`${key}: has every icon`, missingIcons.length === 0, missingIcons.join(','));
  check(`${key}: has a human-facing label`, typeof t.label === 'string' && t.label.length > 0);
  check(
    `${key}: has at least two cheer variants`,
    Array.isArray(t.terms?.cheers) && t.terms.cheers.length >= 2,
    `${t.terms?.cheers?.length}`
  );
  check(
    `${key}: has nine level titles`,
    Array.isArray(t.terms?.levelTitles) && t.terms.levelTitles.length === 9,
    `${t.terms?.levelTitles?.length}`
  );

  // The parts that live in components rather than data.
  check(`${key}: its progress meter is implemented`, METER_STYLES.includes(t.progressStyle), t.progressStyle);
  check(`${key}: its meter is wired into the METERS map`, meterSource.includes(`${t.progressStyle}:`));
  check(
    `${key}: its celebration scene exists`,
    celebrationSource.includes(`theme.celebration === '${t.celebration}'`),
    t.celebration
  );
  check(`${key}: its sound exists`, new RegExp(`\\n  ${t.sound}\\(c\\)`).test(soundSource), t.sound);
  check(`${key}: its avatar tile is styled`, cssSource.includes(`.avatar-btn.${key}`));
}

// The pickers are derived, so they can't fall behind the theme list.
check(
  'every theme appears in the shared picker options',
  clientThemes.THEME_OPTIONS.length === clientKeys.length,
  `${clientThemes.THEME_OPTIONS.length} vs ${clientKeys.length}`
);

finish('P4');
