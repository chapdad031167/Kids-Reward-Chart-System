/**
 * Quiet hours: storage, validation, and delivery to the kiosk.
 *
 * The window-matching logic itself lives in the client (it has to be judged
 * when a sound plays, not when the page loaded), so it's covered separately
 * by client/test/quiet.test.mjs. This file covers the half the server owns.
 */
import express from 'express';
import { kiosk } from '../src/routes/kiosk.js';
import { parent } from '../src/routes/parent.js';
import { getQuietHours, setQuietHours } from '../src/config.js';
import { check, requireScratchDb, makeKid, finish } from './helpers.mjs';

requireScratchDb();

const app = express();
app.use(express.json());
app.use('/api', kiosk);
app.use('/api/parent', parent);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const PIN = '1234';

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const asParent = (method, path, body) => req(method, path, body, { 'x-parent-pin': PIN });

console.log('\nDefaults');
const initial = getQuietHours();
check('quiet hours start off', initial.on === false);
check(
  'with a sensible suggested window rather than blanks',
  initial.start === '19:30' && initial.end === '07:00',
  `${initial.start}-${initial.end}`
);

console.log('\nValidation');
check('a valid window is stored', !!setQuietHours({ on: true, start: '20:00', end: '06:30' }));
check('and reads back', getQuietHours().start === '20:00' && getQuietHours().on === true);

for (const bad of [
  { start: '24:00', end: '06:00' },
  { start: '7:00', end: '06:00' },
  { start: '19:60', end: '06:00' },
  { start: 'bedtime', end: '06:00' },
  { start: '20:00', end: null },
  // Same start and end is either "always" or "never" depending on how you
  // read it — refusing beats silently picking one.
  { start: '20:00', end: '20:00' },
]) {
  check(
    `${JSON.stringify(bad)} is refused`,
    setQuietHours({ on: true, ...bad }) === null,
    JSON.stringify(setQuietHours({ on: true, ...bad }))
  );
}
check(
  'a refused window leaves the previous one in place',
  getQuietHours().start === '20:00' && getQuietHours().end === '06:30'
);

console.log('\nThrough the parent API');
const bad = await asParent('POST', '/api/parent/settings', {
  quietHours: { on: true, start: '99:99', end: '06:00' },
});
check('a bad window 400s', bad.status === 400, `${bad.status}`);
check('with a reason', bad.body.error === 'invalid_quiet_hours', bad.body.error);

const good = await asParent('POST', '/api/parent/settings', {
  quietHours: { on: true, start: '19:00', end: '07:15' },
});
check('a good window saves', good.status === 200 && good.body.quietHours.start === '19:00');

const fetched = await asParent('GET', '/api/parent/settings');
check('and comes back on GET /settings', fetched.body.quietHours.end === '07:15');

// The bug this guards: settings POST handles several independent fields, and
// an early `return` in one branch would silently drop the others.
const rename = await asParent('POST', '/api/parent/settings', { appName: 'Quiet House' });
check(
  'saving an unrelated setting leaves quiet hours alone',
  rename.body.quietHours.start === '19:00' && rename.body.appName === 'Quiet House'
);

console.log('\nDelivery to the kiosk');
const kid = makeKid('Sleeper');
const today = await req('GET', `/api/kids/${kid}/today`);
check(
  'the kid payload carries the window, so the tablet can judge it live',
  today.body.quietHours?.start === '19:00' && today.body.quietHours?.on === true,
  JSON.stringify(today.body.quietHours)
);

// Turning it off must reach the kiosk too, not just stop being enforced.
await asParent('POST', '/api/parent/settings', { quietHours: { on: false, start: '19:00', end: '07:15' } });
const off = await req('GET', `/api/kids/${kid}/today`);
check('turning it off reaches the kiosk', off.body.quietHours.on === false);

server.close();
finish('quiet hours');
