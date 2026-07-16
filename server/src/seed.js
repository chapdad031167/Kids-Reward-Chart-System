import { db } from './db.js';

const SEED_TASKS = [
  // Morning & Evening Routines
  { title: 'Get dressed independently before breakfast', category: 'morning', points: 1, icon: '👕' },
  { title: 'Brush teeth for two full minutes', category: 'morning', points: 1, icon: '🪥' },
  { title: 'Put dirty pajamas in the laundry hamper', category: 'morning', points: 1, icon: '🧺' },
  { title: 'Pack backpack (lunch, water, folders) the night before', category: 'evening', points: 2, icon: '🎒' },
  { title: 'Complete bedtime routine on time without reminders', category: 'evening', points: 2, icon: '🌙' },
  // Personal Space & Organization
  { title: 'Make the bed', category: 'personal_space', points: 1, icon: '🛏️' },
  { title: 'Put shoes and coat away in their spot', category: 'personal_space', points: 1, icon: '👟' },
  { title: 'Put dirty dishes in the sink/dishwasher', category: 'personal_space', points: 1, icon: '🍽️' },
  { title: 'Clear toys off the floor before switching activities', category: 'personal_space', points: 2, icon: '🧸' },
  { title: 'Hang up wet towels after bathing', category: 'personal_space', points: 1, icon: '🧻' },
  // Household Contributions
  { title: 'Feed the pet at the scheduled time', category: 'chores', points: 2, icon: '🐾' },
  { title: 'Set the dinner table', category: 'chores', points: 2, icon: '🍴' },
  { title: 'Wipe down the dining table after meals', category: 'chores', points: 1, icon: '🧽' },
  { title: 'Sort clean laundry by type/family member', category: 'chores', points: 2, icon: '👖' },
  { title: 'Empty small trash cans into the main bin', category: 'chores', points: 2, icon: '🗑️' },
  { title: 'Water plants with a measuring pitcher', category: 'chores', points: 1, icon: '🪴' },
  { title: 'Pair up clean socks', category: 'chores', points: 1, icon: '🧦' },
  { title: 'Unpack groceries (low-shelf items)', category: 'chores', points: 2, icon: '🛒' },
  // Social, Emotional & School Skills
  { title: 'Complete homework/reading time before screen time', category: 'social_school', points: 3, icon: '📚' },
  { title: 'Use a calm voice when frustrated', category: 'social_school', points: 2, icon: '😌' },
  { title: 'Practice an instrument/skill for the agreed duration', category: 'social_school', points: 2, icon: '🎵' },
  { title: "Help clean up a mess they didn't make", category: 'social_school', points: 2, icon: '🤝' },
  { title: 'Listen and cooperate on the first ask', category: 'social_school', points: 2, icon: '👂' },
];

const SEED_REWARDS = [
  { title: '30 minutes of extra screen time', cost: 10, bucket: 'checking', icon: '📺' },
  { title: 'Pick what we have for dinner', cost: 15, bucket: 'checking', icon: '🍕' },
  { title: 'Stay up 30 minutes past bedtime', cost: 15, bucket: 'checking', icon: '🌟' },
  { title: 'Pick the family movie night movie', cost: 12, bucket: 'checking', icon: '🎬' },
  { title: 'One-on-one outing with a parent', cost: 40, bucket: 'savings', icon: '🚗' },
  { title: 'Small toy or book (under $10)', cost: 60, bucket: 'savings', icon: '🎁' },
];

export function seedIfEmpty() {
  const kidCount = db.prepare('SELECT COUNT(*) AS n FROM kids').get().n;
  if (kidCount > 0) return false;

  const seed = db.transaction(() => {
    const insertKid = db.prepare(
      `INSERT INTO kids (name, avatar_icon, theme, age, vault_mode, auto_split_ratio)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertKid.run('Aedan', '⚽', 'soccer', 8, 'manual', 0.7);
    insertKid.run('Ashton', '🦖', 'dino', 6, 'auto_split', 0.7);

    const insertTask = db.prepare(
      `INSERT INTO tasks (title, category, point_value, icon, active, kid_id)
       VALUES (?, ?, ?, ?, 1, NULL)`
    );
    for (const t of SEED_TASKS) insertTask.run(t.title, t.category, t.points, t.icon);

    const insertReward = db.prepare(
      `INSERT INTO rewards_catalog (kid_id, title, cost, bucket_required, icon, active)
       VALUES (NULL, ?, ?, ?, ?, 1)`
    );
    for (const r of SEED_REWARDS) insertReward.run(r.title, r.cost, r.bucket, r.icon);
  });

  seed();
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const seeded = seedIfEmpty();
  console.log(seeded ? 'Database seeded.' : 'Database already has data; skipped seeding.');
}
