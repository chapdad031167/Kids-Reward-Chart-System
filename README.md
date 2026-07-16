# Kids Reward Chart System

A self-hosted web app for tracking daily routines/chores and rewarding two kids with a points
economy. Runs locally on a home NAS (Docker), accessed via a shared kiosk tablet plus a parent
dashboard from any device on the home network. LAN-only — no cloud, no accounts.

- **Aedan (8)** — ⚽ soccer theme: "GOAL!" celebrations, Match Progress bar, Win Streaks, Season Fund savings vault
- **Ashton (6)** — 🦖 dino theme: "ROAR!" celebrations, an egg that cracks as tasks complete and hatches when the day is done, Fossil Streaks, Dino Nest Egg savings vault

## How it works

**Kid kiosk** (`/`): the landing screen shows two big avatar buttons. Tapping one opens that
kid's themed home screen — today's tasks grouped by category, a daily progress meter, streaks,
points balances (Spending / Savings split), and a reward shop. Tapping a task marks it
*pending* with an instant celebration animation; a parent approves it later. After 90 seconds
of inactivity the kiosk returns to the avatar screen. Kids never see each other's progress —
and each kid can optionally get a **secret emoji code** (set in Kids & Vaults): their avatar
shows a 🔒, and opening their screen means tapping their 3 secret emoji in order on a
9-emoji grid. Wrong code shakes and resets; returning to the avatar screen re-locks.

**Task categories** are parent-editable (Tasks → Manage Categories): rename the defaults,
change their icons, or add new ones (e.g. "Weekend Jobs") — kid screens regroup instantly.
All icons across tasks, rewards, and categories are chosen from a curated kid-friendly emoji
picker rather than free text.

**Parent dashboard** (the "👨‍👧‍👦 Parents" button on the avatar screen, `/parent`, or
long-press the logo): protected by a 4-digit PIN (tap the pad or type on a keyboard). Approve/reject completions and reward
requests (with Quick Approve All), undo the last approval (restores points *and* streaks),
manage tasks and rewards, configure each kid's vault, and view per-kid history. Two
correction tools live in Kids & Vaults for when a mistake slips past undo: **Adjust points**
(directly add/remove from a vault, logged in the ledger) and **Reset today** (wipe a kid's
day — clears today's completions, claws back today's points, and rewinds streaks as if the
day hadn't been tapped).

**Mystery challenges ("Fog of War")**: on pseudo-random days (~4 out of 7, different per
kid), a glowing mystery object appears on the kid's home screen — a golden trophy box for
the soccer theme, a mystery egg for the dino theme. Tapping it reveals a bonus task drawn
from a parent-managed pool of bigger, higher-point challenges ("Wash the car with a
grown-up", "Secret kindness mission", …). The revealed task completes and gets approved
like any other, but doesn't count toward the daily progress meter — it's pure bonus. Manage
the pool in the Tasks tab: any task with the ✨ *Mystery bonus task* checkbox is hidden from
the daily list and enters the mystery rotation. The day schedule and task pick are
deterministic per (kid, date), so restarts and multiple devices always agree.

**Task scheduling**: every task can be limited to specific days of the week (day chips in
the task form — e.g. "Pack backpack" on school nights only, trash duty on Tuesdays). Kids
only see tasks scheduled for today, and streaks count only expected days: a weekdays-only
task completed Friday and Monday is a continuous streak, and a Sunday-only task can't
"break" midweek.

**Backups**: a consistent SQLite snapshot is written to `<data>/backups/` on every boot and
nightly at 3:15am (container time), keeping the last 14 (`BACKUP_KEEP` to change). The
parent dashboard (Kids & Vaults) shows the latest backup and has a "Back up now" button.
Restore = stop the container, replace `reward-chart.db` with a backup file, start.

**Vacation mode**: the 🏖️ toggle in the parent dashboard pauses the whole household for
travel or school breaks. Kids see a friendly themed "on break" screen instead of their task
list (points and the reward shop stay available), no completions or mystery challenges
happen, and — the important part — **streaks freeze**: days inside a vacation stretch never
count as missed, so a 20-day streak from before the trip resumes at 20 the day you turn the
toggle off. Vacation stretches are remembered permanently, so streak math stays correct
forever after.

**Sounds**: every sound is synthesized in the browser with the Web Audio API — no audio
files, works offline. Task celebrations play a themed jingle (ref's whistle + fanfare for
soccer, egg-crack + friendly roar for dino), mystery reveals shimmer, reward requests ding,
the secret-code gate chimes or bonks, and finishing every task triggers a full fanfare. The
🔊/🔇 button on the kid home screen mutes the whole kiosk (persists per device; recipes live
in `client/src/sounds.js`).

**Notifications (optional)**: set `NTFY_URL` to an ntfy topic URL and the app pushes a
notification whenever a kid taps a task or requests a reward, so you can approve from your
phone without watching the queue. Unset = disabled; a down ntfy server never blocks the app.

**Points & vaults**: each kid has a `checking` (spending) and `savings` bucket.
- *Manual mode* (Aedan): all earnings land in checking; the kid can move points into savings
  from their own screen.
- *Auto-split mode* (Ashton): earnings split automatically (default 70% checking / 30%
  savings, configurable). Splits round to whole points — a 1-point task goes 1/0, a 2-point
  task 1/1 at 70/30.

**Daily reset & streaks**: "today" is computed from the container's `TZ`. At local midnight
the task list is fresh; approving a task on consecutive days builds its streak, missing a day
breaks that task's streak (others are unaffected). Pending completions from a prior day
expire — they can no longer be approved, but stay logged for parent visibility.

**Offline-tolerant kiosk**: if the tablet loses the backend, task taps queue in the browser's
localStorage and sync automatically when the connection returns (a banner shows how many taps
are waiting). Retries are idempotent, so nothing double-counts.

## Deploying on ChappyNAS (UGREEN UGOS)

Runs as a single container alongside the existing Docker stack (Plex/Sonarr/Radarr/etc.).

### With docker-compose (recommended)

```bash
# on the NAS, e.g. in /volume1/docker/reward-chart
git clone <this repo> reward-chart && cd reward-chart
# edit docker-compose.yml: set PARENT_PIN and TZ
docker compose up -d --build
```

### With plain docker

```bash
docker build -t reward-chart .
docker run -d --name reward-chart --restart unless-stopped \
  -p 8090:8090 \
  -e TZ=America/New_York \
  -e PARENT_PIN=1234 \
  -v /volume1/docker/reward-chart/data:/data \
  reward-chart
```

Then open `http://<NAS-IP>:8090` from the kiosk tablet and any household device. Add it to
the tablet's home screen in kiosk/fullscreen mode for the best experience.

### Configuration

| Env var      | Default            | Purpose                                        |
| ------------ | ------------------ | ---------------------------------------------- |
| `PORT`       | `8090`             | HTTP port inside the container                 |
| `PARENT_PIN` | `1234`             | 4-digit PIN for the parent dashboard — change it |
| `TZ`         | `America/New_York` | Local timezone for daily reset and streaks     |
| `DATA_DIR`   | `/data`            | Where the SQLite file lives (mount a volume)   |
| `NTFY_URL`   | *(unset)*          | ntfy topic URL for parent push notifications; unset disables |
| `BACKUP_KEEP`| `14`               | How many nightly database backups to retain               |

### Persistence & backup

Everything lives in one SQLite file at `<volume>/reward-chart.db`. Back up the mounted `data/`
folder (it may also contain `-wal`/`-shm` journal files — copy all three, or stop the
container first). The database is created and seeded with both kids, the starter task list,
and a starter reward catalog on first boot; seeding never runs again once data exists.

## Local development

```bash
# terminal 1 — backend on :8090 (creates + seeds ./data/reward-chart.db)
cd server && npm install && npm start

# terminal 2 — frontend dev server on :5173, proxying /api to :8090
cd client && npm install && npm run dev
```

## Project layout

```
server/            Node.js + Express + better-sqlite3 API
  src/db.js          schema (kids, tasks, completions, streaks, points_ledger,
                     rewards_catalog, redemptions, parent_actions)
  src/seed.js        first-boot seed: both kids + starter tasks/rewards
  src/service.js     approval, streak, ledger, undo, expiry, transfer logic
  src/routes/        kiosk.js (kid-facing) and parent.js (PIN-protected)
client/            React + Vite kiosk & dashboard
  src/themes.js      per-kid theme config (colors, terminology, icons) —
                     components never hardcode soccer/dino strings
  src/api.js         fetch wrapper + offline tap queue
  src/screens/       AvatarSelect, KidHome, ParentDashboard
  src/components/    Celebration, ProgressMeter (bar + hatching egg), ui
Dockerfile         multi-stage build: Vite build → static files served by Express
```

## Backlog

- **Multi-household or external/cloud accounts** — the app stays LAN-only.
