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
of inactivity the kiosk returns to the avatar screen. Kids never see each other's progress.

**Parent dashboard** (`/parent`, or long-press the logo on the avatar screen): protected by a
4-digit PIN. Approve/reject completions and reward requests (with Quick Approve All), undo the
last approval (restores points *and* streaks), manage tasks and rewards, configure each kid's
vault, and view per-kid history.

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

- **Keyboard entry on the parent PIN screen** — the PIN pad currently only accepts
  taps/clicks; typing digits (and Enter/Backspace) should work too for desktop use.
- **Manual reset from the parent dashboard** — a correction tool for when a mistake slips
  past the single-level undo: e.g. reset a kid's day (clear today's completions) and/or
  directly adjust a vault balance, with the change logged in the ledger.
- **Holiday / Vacation Mode** — a parent toggle for stretches when daily routines aren't
  practical (travel, school breaks): pause the daily task list and freeze streaks so they
  resume where they left off instead of breaking.
- **Push notifications via ntfy** — already running on the NAS for other services; notify a
  parent's phone on new pending completions/redemptions. V1 keeps the approval flow
  manual in-app by choice.
- **"Fog of War" mystery/random bonus tasks.**
- **Multi-household or external/cloud accounts** — the app stays LAN-only.
- **Audio/sound effects** — celebrations are visual-only by design so sound can be layered
  in later without rework (trigger point is marked in `Celebration.jsx`).
