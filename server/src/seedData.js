/**
 * The starter content library: the tasks, mystery pool and rewards a fresh
 * install can opt into from the setup wizard.
 *
 * Pure data with no imports, so the browser-only demo build can pull the
 * exact same library the real app seeds. Duplicating it there is how a demo
 * starts drifting from the product it is supposed to be showing.
 */

export const SEED_TASKS = [
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

// Mystery bonus pool — bigger, more involved tasks that appear as the
// random "mystery challenge". Higher point values than daily routines.
export const SEED_BONUS_TASKS = [
  { title: 'Help make dinner from start to finish', category: 'chores', points: 4, icon: '👨‍🍳' },
  { title: 'Wash the car with a grown-up', category: 'chores', points: 5, icon: '🚗' },
  { title: 'Clean out the toy bin and pick 3 toys to donate', category: 'personal_space', points: 5, icon: '📦' },
  { title: 'Read a book out loud to someone', category: 'social_school', points: 3, icon: '📖' },
  { title: 'Yard duty: 15 minutes of weeding or raking', category: 'chores', points: 4, icon: '🍂' },
  { title: 'Secret kindness mission: do something nice without being asked', category: 'social_school', points: 4, icon: '💝' },
];

export const SEED_REWARDS = [
  { title: '30 minutes of extra screen time', cost: 10, bucket: 'checking', icon: '📺' },
  { title: 'Pick what we have for dinner', cost: 15, bucket: 'checking', icon: '🍕' },
  { title: 'Stay up 30 minutes past bedtime', cost: 15, bucket: 'checking', icon: '🌟' },
  { title: 'Pick the family movie night movie', cost: 12, bucket: 'checking', icon: '🎬' },
  { title: 'One-on-one outing with a parent', cost: 40, bucket: 'savings', icon: '🚗' },
  { title: 'Small toy or book (under $10)', cost: 60, bucket: 'savings', icon: '🎁' },
];

/** Categories are inserted by db.js in this fixed order. */
export const CATEGORY_IDS = { morning: 1, evening: 2, personal_space: 3, chores: 4, social_school: 5 };

/** The default categories, in the order db.js inserts them. */
export const SEED_CATEGORIES = [
  { label: 'Morning', icon: '🌅' },
  { label: 'Evening', icon: '🌙' },
  { label: 'My Space', icon: '🧹' },
  { label: 'Family Jobs', icon: '🏠' },
  { label: 'School & Feelings', icon: '🧠' },
];
