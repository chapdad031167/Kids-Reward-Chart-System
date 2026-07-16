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
      pendingBanner: 'Waiting for the ref to check it!',
      rejectedBanner: 'No goal this time — ask a grown-up',
      mysteryTitle: 'Mystery Challenge!',
      mysteryTap: 'Tap to open the golden trophy box!',
      bonus: 'BONUS',
    },
    icons: {
      mascot: '⚽',
      streak: '🏅',
      savings: '🏆',
      checking: '💰',
      mystery: '🏆',
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
      pendingBanner: 'Waiting for a grown-up dino to check it!',
      rejectedBanner: 'Not this time — ask a grown-up',
      mysteryTitle: 'Mystery Egg!',
      mysteryTap: 'Tap to crack it open!',
      bonus: 'BONUS',
    },
    icons: {
      mascot: '🦖',
      streak: '🦴',
      savings: '🥚',
      checking: '💰',
      mystery: '🥚',
    },
    celebration: 'dino',
    progressStyle: 'egg',
  },
};

// Task categories now live in the database (parent-editable) and arrive
// with each /today payload — no hardcoded list here anymore.
