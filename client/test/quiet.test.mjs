/**
 * Quiet-hours window matching.
 *
 * This lives on the client because the window has to be judged at the moment
 * a sound would play — a tablet left open all evening would otherwise be
 * judged against whenever the page happened to load.
 *
 * The case worth testing is the wrap past midnight, because every realistic
 * setting wraps ("after bedtime until a reasonable morning") and the obvious
 * `start <= now < end` implementation is wrong for all of them.
 *
 * sounds.js is importable under Node because nothing at module scope touches
 * a browser global — the AudioContext and localStorage are only reached
 * inside functions.
 */
import { setQuietHours, isQuietNow } from '../src/sounds.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A local Date at h:m on an arbitrary fixed day. */
const at = (h, m = 0) => new Date(2026, 0, 5, h, m);

console.log('\nOff by default');
setQuietHours(null);
check('nothing is quiet when no window is set', !isQuietNow(at(3)));
setQuietHours({ on: false, start: '19:30', end: '07:00' });
check('a window that is off does not silence anything', !isQuietNow(at(3)));

console.log('\nA window that wraps midnight (the normal case)');
setQuietHours({ on: true, start: '19:30', end: '07:00' });
const wrapping = [
  [at(19, 29), false, 'a minute before it starts'],
  [at(19, 30), true, 'exactly at the start'],
  [at(23, 59), true, 'late evening'],
  [at(0, 0), true, 'midnight itself'],
  [at(3, 0), true, 'the small hours'],
  [at(6, 59), true, 'a minute before it ends'],
  [at(7, 0), false, 'exactly at the end — the end is exclusive'],
  [at(12, 0), false, 'the middle of the day'],
];
for (const [when, expected, label] of wrapping) {
  const got = isQuietNow(when);
  check(`${label} (${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}) → ${expected}`, got === expected, `got ${got}`);
}

console.log('\nA window inside one day');
setQuietHours({ on: true, start: '13:00', end: '15:00' });
check('before it', !isQuietNow(at(12, 59)));
check('at the start', isQuietNow(at(13, 0)));
check('inside it', isQuietNow(at(14, 0)));
check('at the end (exclusive)', !isQuietNow(at(15, 0)));
check('after it', !isQuietNow(at(16, 0)));
check('and the small hours are loud, unlike the wrapping case', !isQuietNow(at(3, 0)));

console.log(failures === 0 ? '\nAll quiet-hours checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
