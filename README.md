# Reward Chart

A self-hosted chore & reward system for families — a shared kiosk tablet the kids tap,
and a PIN-protected dashboard the parents run it from. Each child gets their own themed
world (soccer, dinosaur, space, fantasy, or racing) with its own colors, celebrations,
sounds, and vocabulary. Runs entirely on your own hardware; your family's data never
leaves the house.

**[▶ Try the live demo](https://claude.ai/code/artifact/a01a6552-1d54-463d-9a77-dc4ee6ce7f07)** — a full in-browser build, parent PIN `1234`, add `?reset` to start over.

<p align="center">
  <img src="docs/screenshots/avatar-select.png" width="49%" alt="Avatar select screen with themed kids" />
  <img src="docs/screenshots/kid-home.png" width="49%" alt="A kid's themed home screen" />
</p>
<p align="center">
  <img src="docs/screenshots/parent-dashboard.png" width="49%" alt="Parent approval dashboard" />
  <img src="docs/screenshots/setup-wizard.png" width="49%" alt="First-run setup wizard" />
</p>

## Why I built this

Sticker charts on the fridge don't scale past one kid, don't teach saving, and turn into
a source of sibling comparison. I wanted something my kids would actually *want* to walk
up and use, that let them earn toward things they cared about, and that I could approve
from my phone without another cloud account holding my children's data. So I built it to
run on the home server next to the rest of the self-hosted stack — one container, one
SQLite file, no accounts, no internet required.

It's grown well past a sticker chart: a points economy with spending/saving vaults,
streaks, random mystery challenges, achievement badges, per-child levels, and a
cooperative family goal — but the core loop is still *tap a task → parent approves →
points land → celebrate.*

## Features

**For kids (the shared kiosk):**
- Tap an avatar to enter your own themed home screen — no password (or an optional
  3-emoji secret code so siblings can't open each other's).
- Big, tappable tasks grouped by category; tapping one plays a themed celebration
  (animation + synthesized sound) and queues it for a parent.
- A daily progress meter, a two-vault points economy (spend now vs. save up), streaks,
  a reward shop you browse and request from, and a savings goal you pick and watch fill.
- **Mystery challenges** appear on random days — a glowing chest/egg/capsule that opens
  to reveal a bigger bonus task.
- **Badges, levels, and a cooperative family goal** for long-term motivation — kids only
  ever see their own numbers and a shared team bar, never a head-to-head comparison.
- After 90 seconds idle, the kiosk returns to the avatar screen on its own.

**For parents (the PIN-protected dashboard):**
- An approval queue with one-tap approve/reject, Quick Approve All, and Undo.
- Full management of tasks (with per-day-of-week schedules), categories, rewards, and
  each child's vault rules — manual saving or automatic split.
- Add/remove kids, switch a kid's theme, set secret codes, adjust balances, reset a day,
  bonus awards, a "to deliver" list so approved rewards don't get forgotten, and a
  fresh-start wipe (with an automatic safety backup).
- **Vacation mode** pauses the household and freezes streaks; **automated nightly
  backups**; and an optional **weekly digest + push notifications** via
  [ntfy](https://ntfy.sh).

**Under the hood:**
- Offline-tolerant kiosk — task taps queue in the browser and sync when the connection
  returns.
- Five fully-realized themes driven by a single config object, so adding a sixth is a
  data change, not a rewrite.
- Everything is a single SQLite file on a mounted volume; schema migrations run
  automatically on boot.

## Quick start

Runs anywhere Docker does — a home server, a NAS, or your laptop.

```bash
git clone https://github.com/chapdad031167/Kids-Reward-Chart-System.git
cd Kids-Reward-Chart-System
docker compose up -d --build
```

Open **http://localhost:8090** (or `http://<server-ip>:8090` from another device on your
network) and the **first-run setup wizard** walks you through naming the chart, choosing a
parent PIN, and adding your first child — no config files to edit. Add the tablet's URL to
its home screen for a full-screen kiosk.

A pre-built image is also published to GHCR, so you can skip the build:

```yaml
services:
  reward-chart:
    image: ghcr.io/chapdad031167/kids-reward-chart-system:latest
    restart: unless-stopped
    ports:
      - "8090:8090"
    environment:
      - TZ=America/New_York          # local timezone — daily reset keys off this
      # - NTFY_URL=http://your-server:8093/reward-chart   # optional push notifications
    volumes:
      - ./data:/data                 # SQLite lives here — back up this folder
```

### Local development

```bash
# terminal 1 — API on :8090 (creates ./data/reward-chart.db)
cd server && npm install && npm start

# terminal 2 — Vite dev server on :5173, proxying /api to :8090
cd client && npm install && npm run dev
```

### Configuration

Everything is configured in the app (setup wizard + Settings tab). These env vars are
optional overrides for scripted deploys:

| Env var       | Default            | Purpose                                                    |
| ------------- | ------------------ | --------------------------------------------------------- |
| `PORT`        | `8090`             | HTTP port inside the container                            |
| `TZ`          | `America/New_York` | Local timezone for the daily reset and streaks            |
| `DATA_DIR`    | `/data`            | Where the SQLite file lives (mount a volume)              |
| `PARENT_PIN`  | `1234`             | Fallback PIN before setup runs; the wizard sets the real one |
| `APP_NAME`    | `Reward Chart`     | Fallback name before setup runs                           |
| `NTFY_URL`    | *(unset)*          | ntfy topic URL for push notifications; unset disables     |
| `BACKUP_KEEP` | `14`               | How many nightly database backups to retain               |

## Tech stack & architecture

- **Frontend** — React + Vite. Custom themed components, no UI kit. Audio is synthesized
  live with the Web Audio API (no sound files). Offline tap queue in `localStorage`.
- **Backend** — Node.js + Express, SQLite via `better-sqlite3` (one file, easy backup).
  Small single-purpose modules — approval/streak/ledger logic, badges, vacation, backups,
  digest — behind a public kiosk router and a PIN-gated parent router.
- **Packaging** — multi-stage Docker build (Vite build served as static files by Express),
  one container, one mounted volume. CI publishes the image to GHCR on push.

```
server/
  src/db.js          schema + automatic migrations
  src/service.js     approval, streaks, ledger, undo, transfers, fresh-start
  src/badges.js      achievement badges + levels
  src/{vacation,backup,digest,familyGoal,bonus,schedule}.js
  src/routes/        kiosk.js (public) · parent.js (PIN-protected)
client/
  src/themes.js      per-theme config: colors, terminology, icons, sounds
  src/sounds.js      Web Audio synthesis
  src/screens/       Setup · AvatarSelect · KidHome · ParentDashboard
  src/components/     Celebration · ProgressMeter · EmojiPicker · KidCode · ui
```

## Design notes

A few decisions that shaped the app:

- **No cross-kid comparison, ever.** Each child sees only their own progress; the one
  shared surface is a *cooperative* family goal. This was a hard rule from day one — the
  point is to motivate each kid, not to rank them.
- **Two vaults, not one.** Points split into spending and saving. Younger kids can
  auto-split every earning; older kids choose what to move — a light, low-stakes way to
  practice the save-vs-spend decision.
- **Privacy by architecture.** Self-hosted and LAN-only means there's no account to
  create and no children's data in someone else's cloud — a deliberate design choice, not
  a limitation.
- **Themes are data.** Colors, vocabulary, celebration, and sound for each theme live in
  one config object, so the five themes share one codebase and a sixth is a small
  addition.

## License

[MIT](LICENSE) — free to use, modify, and self-host.
