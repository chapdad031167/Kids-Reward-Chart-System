/**
 * All theme-specific colors, words, and icons live here — components read
 * from the theme object instead of hardcoding soccer/dino strings, so new
 * themes are a matter of adding an entry.
 */
export const THEMES = {
  soccer: {
    key: 'soccer',
    colors: {
      bg: 'linear-gradient(160deg, #1b7a3d 0%, #2e9e56 55%, #1b6a38 100%)',
      card: '#ffffff',
      cardText: '#173d24',
      accent: '#f5c518',
      accentText: '#3d3000',
      meterFill: 'linear-gradient(90deg, #f5c518, #ffe27a)',
      chip: '#e8f6ec',
      headerText: '#ffffff',
    },
    terms: {
      celebration: 'GOAL!',
      celebrationSub: 'What a shot!',
      streak: 'Win Streak',
      progress: 'Match Progress',
      checking: 'Spending',
      savings: 'Season Fund',
      allDone: 'FULL TIME — you won the day! 🏆',
      rewards: 'Trophy Shop',
    },
    icons: {
      mascot: '⚽',
      streak: '🏅',
      savings: '🏆',
      checking: '💰',
    },
    celebration: 'soccer',
    progressStyle: 'bar',
  },
  dino: {
    key: 'dino',
    colors: {
      bg: 'linear-gradient(160deg, #1f7a5c 0%, #2c9a74 55%, #14655f 100%)',
      card: '#fffaf0',
      cardText: '#2d3a1f',
      accent: '#f59e0b',
      accentText: '#3d2800',
      meterFill: 'linear-gradient(90deg, #f59e0b, #fbc963)',
      chip: '#f0f9e8',
      headerText: '#ffffff',
    },
    terms: {
      celebration: 'ROAR!',
      celebrationSub: 'Dino-mite job!',
      streak: 'Fossil Streak',
      progress: 'Hatch the Egg',
      checking: 'Spending',
      savings: 'Dino Nest Egg',
      allDone: 'The egg HATCHED! 🐣',
      rewards: 'Dino Store',
    },
    icons: {
      mascot: '🦖',
      streak: '🦴',
      savings: '🥚',
      checking: '💰',
    },
    celebration: 'dino',
    progressStyle: 'egg',
  },
};

export const CATEGORY_LABELS = {
  morning: { label: 'Morning', icon: '🌅' },
  evening: { label: 'Evening', icon: '🌙' },
  personal_space: { label: 'My Space', icon: '🧹' },
  chores: { label: 'Family Jobs', icon: '🏠' },
  social_school: { label: 'School & Feelings', icon: '🧠' },
};
