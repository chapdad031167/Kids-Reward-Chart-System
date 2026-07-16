import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'reward-chart.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS kids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar_icon TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('soccer', 'dino')),
  age INTEGER NOT NULL,
  vault_mode TEXT NOT NULL DEFAULT 'manual' CHECK (vault_mode IN ('manual', 'auto_split')),
  auto_split_ratio REAL NOT NULL DEFAULT 0.7
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('morning', 'evening', 'personal_space', 'chores', 'social_school')),
  point_value INTEGER NOT NULL,
  icon TEXT NOT NULL DEFAULT '⭐',
  active INTEGER NOT NULL DEFAULT 1,
  kid_id INTEGER REFERENCES kids(id)
);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  completed_at TEXT NOT NULL,
  reviewed_at TEXT,
  client_id TEXT UNIQUE,
  UNIQUE (task_id, kid_id, date)
);

CREATE TABLE IF NOT EXISTS streaks (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  PRIMARY KEY (task_id, kid_id)
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  amount INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('earn', 'spend')),
  bucket TEXT NOT NULL CHECK (bucket IN ('checking', 'savings')),
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rewards_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_id INTEGER REFERENCES kids(id),
  title TEXT NOT NULL,
  cost INTEGER NOT NULL,
  bucket_required TEXT NOT NULL DEFAULT 'checking' CHECK (bucket_required IN ('checking', 'savings')),
  icon TEXT NOT NULL DEFAULT '🎁',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  reward_id INTEGER NOT NULL REFERENCES rewards_catalog(id),
  cost_paid INTEGER NOT NULL,
  redeemed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS bonus_assignments (
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  date TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  revealed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kid_id, date)
);

CREATE TABLE IF NOT EXISTS parent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);
`);

// Migration for databases created before the mystery-task feature.
const taskColumns = db.prepare(`PRAGMA table_info(tasks)`).all().map((c) => c.name);
if (!taskColumns.includes('is_bonus')) {
  db.exec(`ALTER TABLE tasks ADD COLUMN is_bonus INTEGER NOT NULL DEFAULT 0`);
}

/** Current point balances per bucket for a kid. */
export function balances(kidId) {
  const rows = db
    .prepare(
      `SELECT bucket, COALESCE(SUM(CASE direction WHEN 'earn' THEN amount ELSE -amount END), 0) AS bal
       FROM points_ledger WHERE kid_id = ? GROUP BY bucket`
    )
    .all(kidId);
  const out = { checking: 0, savings: 0 };
  for (const r of rows) out[r.bucket] = r.bal;
  return out;
}
