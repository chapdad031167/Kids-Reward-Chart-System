# Mobile App QA Audit — Kids Reward Chart System

**Date:** 2026-07-23
**Scope:** Full application — server (`server/src`), client (`client/src`), PWA/service worker, packaging (Docker), and product design. Every source file was read in full.
**Context assumed:** A self-hosted family app used by one household on a LAN — a shared kiosk tablet plus parents' phones. It is *not* a mass-market product, so severity ratings below are calibrated to the realistic threat model: curious/competitive kids, a shared tablet, and one family's data — not internet attackers.

---

## 1. Executive summary

The app is in genuinely good shape for what it is. The architecture is clean (small single-purpose server modules, themes-as-data, parameterized SQL everywhere, real transactions, undo snapshots, automated backups), the kid-facing loop is well thought out, and details like the offline tap queue, idempotent completions, and reduced-motion support show real care.

The audit found **no catastrophic issues**, but it did find:

- **1 exploitable-by-a-kid security gap that matters in practice** (the parent dashboard stays unlocked on the shared kiosk tab), plus a cluster of PIN-hardening gaps that are low effort to close.
- **2 real logic bugs** (a partial-commit in `awardPoints`, and history UI that silently omits an entire data set).
- **3 design-level UX defects** that will bite a family within the first month (day-boundary expiry of unapproved work, no way to retry a rejected task, no way to delete anything).
- A **visual layer that under-delivers on a strong concept** — which matches the feedback you've received. The theming *system* is excellent; the theming *execution* is shallow (gradient + accent color + emoji), and the parent dashboard is unstyled-utilitarian. Concrete, low-cost fixes are in §5.
- The **"no internet access" concern is solvable without abandoning the privacy architecture** — recommendation in §7.

Prioritized roadmap in §9.

---

## 2. What's working well (keep these)

Worth stating so the fixes below don't read as "rewrite it":

- **Data integrity:** every money-like mutation goes through an append-only ledger inside a SQLite transaction; balances are always derived, never stored. This is the right design and it shows — undo, reset-day, and fresh-start are all coherent because of it.
- **Idempotent kiosk taps** (`UNIQUE(task_id, kid_id, date)` + `client_id`) plus the localStorage offline queue: taps survive Wi-Fi blips on a tablet, retries can't double-award. This is better than most commercial apps of this type.
- **No cross-kid comparison** is enforced in the API shape itself (a kid's `/today` payload contains only their own numbers) — the design rule can't be accidentally broken by a UI change.
- **Migrations run automatically and handle real legacy shapes** (CHECK-constraint rebuilds done correctly with FK off + transaction).
- **Safety rails on destructive actions:** type-to-confirm for Fresh Start and Remove Kid, automatic pre-wipe backup, nightly backups with pruning that never prunes suffixed safety backups.
- **Web Audio synthesis + emoji icons** = zero assets to load, works offline, and the synthesized jingles are genuinely charming.
- `prefers-reduced-motion` is respected — rare and appreciated.

---

## 3. Security findings

Ranked by *realistic family-context* severity.

### S1 — HIGH: Parent dashboard stays unlocked on the shared kiosk

`ParentDashboard.jsx:44` reads the PIN from `sessionStorage('parent-pin')`. `sessionStorage` lives for the life of the browser tab — and a kiosk tablet's tab is effectively never closed. If a parent opens the dashboard on the kiosk, approves things, and taps "Kiosk" (rather than the easily-missed "🔒 Lock"), then **any kid who taps the visible "👨‍👧‍👦 Parents" button gets straight into the dashboard with no PIN prompt** — full access to adjust balances, approve everything, see secret codes, and remove siblings.

The kid screens auto-return to the avatar screen after 90s idle; the parent dashboard has **no idle timeout at all**.

**Fix (small):**
1. Add the same `useIdleTimer` to the dashboard (e.g. 3–5 min → clear `parent-pin`, return to `/`).
2. Clear the stored PIN whenever the user navigates from `/parent` back to the kiosk (make "Kiosk" behave as "Lock + go").

### S2 — MEDIUM: Parent PIN is brute-forceable with zero friction

- `POST /api/parent/verify` (`parent.js:31`) and the `x-parent-pin` header check (`parent.js:36`) have **no rate limiting, no lockout, no delay**. 10,000 combinations at LAN speed is under a minute with a trivial script — well within reach of a motivated 12-year-old with the browser console open on the kiosk.
- The PIN is stored **plaintext** in the settings table, is returned nowhere (good), but compares with a non-constant-time `!==` (irrelevant at this threat level, noted for completeness).
- The well-known fallback `1234` applies whenever `parent_pin` is unset. Legacy installs that predate the wizard get auto-marked configured (`db.js:198–201`) **without ever being forced to change the PIN**, so a pre-wizard household may be running on `1234` indefinitely.

**Fix (small):** in-memory throttle on PIN failures (e.g. 5 failures → 30s lockout, exponential), a `console.warn` on repeated failures, hash the PIN at rest (even unsalted SHA-256 raises the bar meaningfully here), and a Settings banner when the effective PIN is the default. Consider allowing 4–8 digits.

### S3 — MEDIUM (accepted-by-design, but should be documented in-app): every kiosk endpoint is unauthenticated

Anyone on the LAN can, for any kid, without any code: create completions (including bonus tasks on non-mystery days — `kiosk.js:181` skips the schedule check for `is_bonus`), file reward redemptions, move checking→savings, set/clear the savings goal, and reveal mysteries. The emoji secret code gates only the *UI*, not the API — and `verify-code` itself (`kiosk.js:71`) is unlimited-attempts over 9³ = 729 combinations.

For a trusting household this is fine and matches the README's philosophy. But since everything lands in the parent approval queue anyway, the exposure is mostly *mischief between siblings*. Two cheap improvements if it ever matters: require the secret code (when set) as a header on that kid's mutating kiosk calls, and add a shake-lockout (3 wrong codes → 30s cooldown) so the code gate isn't defeated by patient tapping.

### S4 — LOW: ntfy pushes family data to whatever topic is configured

`notify.js` sends kid names + task/reward titles to `NTFY_URL`. On public `ntfy.sh`, topics are unauthenticated — anyone who guesses/learns the topic name can **read the family's activity and send fake "task waiting" notifications**. The README example correctly shows a self-hosted URL; nothing enforces or warns about this.

**Fix:** README + Settings note recommending self-hosted ntfy or an access-token topic; support an `NTFY_TOKEN` env var (ntfy supports `Authorization: Bearer`).

### S5 — LOW / informational

- **Cleartext HTTP on the LAN** (by design): the PIN header crosses the Wi-Fi unencrypted on every parent request. Acceptable at this threat model; becomes S1-class if the app is ever port-forwarded — see §7.
- **Container runs as root.** Add `USER node` to the final Docker stage (with a `chown` on `/data`) — free hardening.
- **No security headers** (`X-Content-Type-Options`, frame-ancestors, etc.). Two lines of Express middleware; low value on a LAN but zero cost.
- **Good:** all SQL is parameterized (no injection surface found), React auto-escaping is never bypassed (`dangerouslySetInnerHTML` absent), no path traversal in static serving, `express.json()` default body limit intact, and secret codes are correctly stripped from the public `/api/kids` response (`kiosk.js:66`).

---

## 4. Bugs & defects

### B1 — Partial commit in `awardPoints` (real bug, data integrity)

`service.js:311–323`: the loop inserts ledger rows kid-by-kid, and on an unknown `kid_id` returns `{ ok: false }` **mid-loop**. `better-sqlite3` transactions only roll back on a *throw* — a plain return **commits** the rows already inserted. So a bonus award to `[validKid, deletedKid]` errors out to the parent ("Award failed") while silently having paid the first kid.

Hard to hit from the UI today (kid list is fresh), but reachable if a kid is removed on another device between load and award. **Fix:** validate all kids first, then insert; or `throw` and catch at the route.

### B2 — Award/adjustment/transfer history is invisible

`parent.js:450` (`/kids/:id/history`) returns a `ledger` array, and the Award modal promises *"shows in history"* — but `HistoryModal` (`ParentDashboard.jsx:1613`) renders only `completions` and `redemptions`, **never `ledger`**. Bonus awards, manual adjustments, transfers, and badge bonuses cannot be reviewed anywhere in the UI. This also makes balance discrepancies impossible for a parent to self-diagnose ("why does he have 12 extra points?").

**Fix:** render the ledger section (it's already fetched); label sources (`award:…`, `adjustment`, `transfer`, `badge:…`) in friendly language.

### B3 — Unapproved work silently evaporates at midnight (design defect, will bite weekly)

`expireStalePending()` (`service.js:11`) marks any prior-day pending completion `expired`, and the parent queue only shows *today's* pending rows (`parent.js:72`). Real household flow: kid does bedtime tasks at 8pm → parent falls asleep → next morning the taps are **expired, invisible in the queue, and worth zero points** — and the streak breaks. Nothing in the parent UI even shows that it happened. This punishes exactly the behavior the app is built to reward, through no fault of the kid.

**Fix options (pick one):**
- Grace window: pending completions stay approvable until the *next* day's evening (i.e. expire after ~36–44h, not at midnight); or
- Show yesterday's pending in the queue with a "yesterday" tag and let approval credit the original date (streak logic already keys off `completion.date`, so this mostly works today); or
- Make the expiry window a Settings option.

Also worth an ntfy nudge at e.g. 8:30pm: "3 taps still waiting for approval."

### B4 — A rejected task is dead for the rest of the day

`UNIQUE(task_id, kid_id, date)` means once a completion exists — including status `rejected` — the kid cannot re-tap that task until tomorrow, and no parent endpoint can flip `rejected` back to `pending` (undo covers approvals only). The natural flow "you missed a spot, redo it and tap again" is impossible; the parent's only tool is **Reset Day**, which nukes the kid's entire day.

**Fix:** parent "re-open" action on a rejected completion (set back to `pending`, or delete the row so the kid can re-tap). Small server change, big fairness win.

### B5 — Redemption requests aren't checked against pending holds

The rewards *list* subtracts pending redemption holds from the affordability flag (`kiosk.js:220–239`) — but `POST /redemptions` (`kiosk.js:245`) checks the raw balance only. A kid with 20 points can queue two 15-point rewards; the second approval then fails confusingly at parent-approval time ("Kid can no longer afford this reward"). Apply the same held-amount math in the POST.

### B6 — Changing a kid's theme wipes their custom avatar

`ParentDashboard.jsx:1059` always sends the theme's default `avatar_icon` with a theme change, clobbering any custom avatar chosen at add-time or setup. Send only `{ theme }` and let the avatar be edited separately (there's currently **no UI to change an avatar after creation at all** — add one while there).

### B7 — "Both kids" is hardcoded

Task/reward forms and tables say "Both kids"/"Both" (`ParentDashboard.jsx:674, 530, 768`) regardless of household size — wrong for 1 kid and for 3+. Say "All kids." Similarly `AwardModal` renders kid buttons in a non-wrapping row that will overflow with 4+ kids.

### B8 — Minor / cosmetic

- **Vacation banner typo** (`ParentDashboard.jsx:186`): "Turn it off the morning routines resume" — missing word.
- **Undo button** always enabled; failing with `nothing_to_undo` shows the generic "Action failed." Also undo is single-level with no preview of *what* will be undone — after Quick Approve All, one tap silently reverts N approvals.
- **Digest week window is timezone-skewed** (`digest.js:27`): local date + `T00:00:00` is compared against UTC `created_at` strings, shifting the 7-day points window by the UTC offset (~4–5h for America/New_York). Harmless but the numbers won't quite match the completions count.
- **Kid transfer is capped at 10** (`KidHome.jsx:560`): preset chips `[1,2,5,10]` only — a kid with 47 points must tap through 5 transfers to move 47. Add a "Move all" chip and/or larger presets.
- **Late-night queued taps time-travel:** an offline tap queued at 11:58pm that syncs at 12:01am is recorded for the *new* day (server stamps `todayStr()` at insert). Rare; acceptable; noting it.
- **Suffixed backups are never pruned** (`backup.js:19` — intentional per comment, but they accumulate forever; a fresh-start-happy family will collect them).
- **`categories.position` exists but there's no reorder UI**, and category display order is fixed at creation.
- **If the server is down on first load**, `App.jsx:19` assumes `configured: true` — a fresh install briefly shows the kid UI instead of setup until refresh. Benign.

---

## 5. Design & visual audit — responding to "bland, generic, function over fashion"

The feedback is fair, and the root cause is specific: **the theme system is deep but the theme *rendering* is shallow.** Every theme is the same layout of flat white rounded cards; what changes is a background gradient, one accent color, and which emoji get sprinkled in. Meanwhile the parent dashboard has no design language at all (default tables, inline styles, gray-on-white).

None of this needs a redesign — the CSS-variable theming pipe is already in place. Concrete recommendations, cheapest-first:

### D1 — Typography (the single biggest bang-for-buck)
`'Segoe UI', 'Comic Sans MS', system-ui'` (`index.css:12`) renders differently on every device (Segoe on Windows only; iPads fall through to system-ui) and reads "default app." Self-host one rounded display font as a woff2 (e.g. **Fredoka, Baloo 2, or Nunito** — all OFL-licensed, ~30KB, keeps the no-internet promise) for kid-screen headings, keep system-ui for body/parent. Instant identity change.

### D2 — Give each theme a *texture*, not just a gradient
One tiled inline-SVG background per theme (a few hundred bytes each): pitch line-markings for soccer, a starfield for space, scattered fossils for dino, castle silhouettes for fantasy, a checkered-flag strip for racing. Plus a per-theme card treatment (e.g. themed border or corner motif on `.panel`). The `THEMES` object already supports arbitrary values — add `colors.texture` and drop it in as a `background-image` layer.

### D3 — Finish the `progressStyle` idea
The dino egg-that-cracks is the best moment in the app — and it's the *only* theme with a bespoke meter; the other four share a plain bar (`themes.js: progressStyle: 'bar'`). The config hook already exists. Build the matching four: ball advancing toward a goal mouth (soccer), rocket climbing to a planet (space), car lapping a track (racing), castle/crystal assembling (fantasy). This directly converts "function over fashion" into the app's signature feature.

### D4 — Kid home screen composition
- The header is a functional row of small buttons; make the mascot bigger and animated (it already bobs on the avatar screen but is static in-app), and turn the greeting into a themed banner ("Matchday, Leo!" / "Mission log, Cmdr. Maya").
- Task cards are uniform white rectangles; category headers are small text. Consider per-category card tinting from the `chip` color so the list has visual rhythm.
- The avatar select screen is the app's front door and its emptiest screen: name + emoji on a gradient tile. Add a per-kid teaser (level chip, live streak flame, "3 tasks waiting") — data is one `/today` call away and it pulls kids in.

### D5 — Parent dashboard needs a design pass more than the kid side
It's the screen the paying customer (you) sees most, and it's the one with zero styling budget: default `<table>`, inline styles, mixed button metaphors. Cheap wins: extract the inline styles into the stylesheet with a small token set (spacing, radius, one accent color); card-per-kid instead of table rows on Kids & Vaults (already halfway there); consistent icon+label buttons; a visible count badge on the Pending tab (e.g. "⏳ Pending (4)") so a parent landing on Tasks knows work is waiting.

### D6 — Celebration variety
The celebration is identical every time per theme; kids habituate fast. Cheap: 2–3 word/phrase variants per theme chosen at random, occasional "big" variant (10% chance: more confetti + longer jingle), and a distinct daily-complete celebration (the fanfare exists but reuses the same overlay).

---

## 6. Layout, usability & accessibility

### U1 — Usability
- **Loading states** are the string `'Loading…'` everywhere; on a slow tablet the kid screen white-flashes. Cheap skeleton cards would polish this a lot.
- **Toasts** (2.5s, bottom) carry real information ("Cleared 4 of today's completions") that vanishes before a distracted parent reads it. Important results should land in the modal/inline, not a toast.
- **No way to change a kid's name or age** after creation (PATCH `/kids/:id` doesn't accept them, and there's no UI). Kids have birthdays; names get misspelled.
- **No delete anywhere:** tasks and rewards can only be deactivated (rows accumulate in the tables forever, sorted inactive-last but still present); categories can't even be deactivated. Allow hard-delete when there's no history referencing the row, otherwise offer "archive" that hides it from the parent list by default.
- **Setup wizard** is genuinely good. One gap: it never mentions the kiosk long-press shortcut or the "Add to Home Screen" step — a "put it on the tablet" final step with per-platform hints would raise install success.
- **Approve/reject buttons** (`✅`/`❌` icon-only, ~40px apart) sit adjacent for opposite-consequence actions; a mis-tap rejects a kid's work with no confirm (undo doesn't cover rejections). Add spacing or a confirm on reject, and `aria-label`s.

### U2 — Accessibility
- `user-scalable=no` (`index.html:5`) blocks pinch-zoom — a WCAG violation that hurts low-vision users (including grandparents on approval duty). The layout is responsive; zoom won't break it. Remove it.
- Global `user-select: none` on `body` is fine for the kiosk but also applies to the parent dashboard, where copying (e.g. a backup filename) is legitimate.
- No visible `:focus` styles anywhere in the stylesheet — keyboard/switch-access users get browser defaults at best (buttons aren't outline-reset, so defaults survive; verify on the actual tablet browser).
- Icon-only buttons (approve/reject, mute already has one) need `aria-label`s throughout.
- Emoji-as-information (streak `🏅 3`, vault icons) is mostly paired with text — good; keep that discipline.

---

## 7. The "no internet access" concern

The feedback is really two distinct needs; they have different right answers:

**(a) Parents want to approve when away from home.** This is the real gap — ntfy already *notifies* the parent's phone off-LAN (it's a push through ntfy's servers), but the approve action needs LAN access, which is a frustrating dead-end ("your kid did their chores" … "you can't do anything about it").

**Recommendation: overlay VPN, zero code changes.** Tailscale (or WireGuard/ZeroTier) on the home server + parents' phones makes `http://server:8090` work from anywhere, end-to-end encrypted, with **no port forwarding, no accounts holding family data, and no change to the privacy architecture** — the README's "data never leaves the house" promise stays literally true. This is a documentation feature: a "Remote access for parents" README section with a 10-minute Tailscale walkthrough. Worth doing before any code-level alternative.

**(b) "Should it be internet-exposed at all?"** I'd hold the line on *not* supporting naked port-forwarding: the current auth (4-digit PIN header over HTTP, no rate limit, unauthenticated kiosk API) is nowhere near internet-grade, and making it so (TLS, session tokens, hashed credentials, rate limiting, CSRF) is a project in itself. If demand grows, the incremental path is: S1/S2 fixes above → session-token auth instead of PIN-per-request → then document reverse-proxy-with-TLS deployment. But VPN gets 100% of the family value at 0% of that cost.

One code-level complement worth doing regardless: **approve/reject action links in the ntfy notification** (ntfy supports action buttons) — with a short-lived signed token per pending item, a parent could one-tap approve from the notification itself over the VPN.

---

## 8. Feature opportunities

Beyond fixes — ranked by value-to-effort for a family app.

**Function**
1. **Approve-from-notification** (see §7) — closes the loop on the app's best flow.
2. **Restore & download backups from the UI.** Backups exist and are listed, but restore means shelling into the server and swapping files. A "download" endpoint (PIN-gated) + documented restore is the minimum; one-click restore-with-confirm is the dream.
3. **Weekly digest in-app.** `buildDigest()` output is already fetchable; render it as a proper "This week" screen with simple bars (per-kid earning trend, most-skipped tasks) instead of `<pre>` text. The insight ("which chores are mispriced") is the most parent-valuable data in the app and it's currently trapped in a text blob.
4. **Points→money layer (optional).** A per-kid "1 point = $0.10" setting turning savings into a real allowance tracker — a natural extension of the two-vault teaching goal.
5. **Reward limits/cooldowns** (e.g. "screen time: max 1/day") — currently a kid can request the same reward repeatedly.
6. **Multi-parent audit trail** — even just two PINs (or per-parent name tagging on approvals) so "who approved this?" has an answer.
7. **CSV export** of ledger + completions (tax-season-grade closure for data-curious parents; trivial endpoint).

**Experience**
8. **Sixth theme as proof of the promise** (ocean/pirate is the obvious gap) — the README claims a theme is "a data change"; making one would validate D2/D3 refactors.
9. **Weekend/summer schedule presets** ("school day" vs "break day" task sets) — `days` handles weekly patterns but not school-calendar reality; even a manual "today is a break day" toggle (vacation-lite that keeps tasks but relaxes schedule) would cover most of it.
10. **Streak-save token** ("streak freeze" a kid can earn/buy) — the single most motivation-preserving mechanic in habit apps; fits the existing vacation-days machinery.
11. **Kid-visible "almost there" nudges** — "2 more points to Level 4" (data already in `/today`'s `level.next`).
12. **Sound variety per D6**, and a quiet-hours setting (no celebration audio after bedtime — parents of early risers will thank you).

---

## 9. Prioritized roadmap

| Priority | Items | Effort |
|---|---|---|
| **P0 — this week** | S1 (dashboard auto-lock), S2 (PIN throttle + default-PIN banner), B1 (`awardPoints` transaction), B3 (approval grace window) | Small — each is hours, not days |
| **P1 — next** | B2 (render ledger history), B4 (re-open rejected), B5 (holds check), B6/B7 (avatar clobber, "All kids"), U2 (`user-scalable`, aria-labels, reject confirm) | Small–medium |
| **P2 — the fashion pass** | D1 (font), D2 (textures), D5 (parent dashboard styling), D4 (avatar-screen teasers), D6 (celebration variety) | Medium — D1+D2 alone will move the "bland" needle |
| **P3 — the flagship** | D3 (per-theme progress meters), §7 (Tailscale docs + ntfy action buttons), F2/F3 (backup restore UI, in-app digest) | Medium–large |
| **P4 — when inspired** | Points→money, reward cooldowns, streak freeze, sixth theme, presets, CSV export | As desired |

---

*Method note: this audit was performed by reading the complete source (≈8,000 LOC) — every server module, every screen/component, the service worker, stylesheet, and Docker packaging. No dynamic testing was performed in this pass; findings B1–B5 were verified against library semantics (better-sqlite3 transaction commit-on-return, sessionStorage lifetime, SQLite UNIQUE behavior) rather than live repro. A follow-up pass can add repro scripts for any finding you want to see demonstrated.*
