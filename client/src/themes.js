/**
 * All theme-specific colors, words, and icons live here — components read
 * from the theme object instead of hardcoding soccer/dino strings, so new
 * themes are a matter of adding an entry.
 */

/**
 * Tileable background texture as an inline SVG data URI.
 *
 * A flat gradient is what made every theme read as the same screen in a
 * different colour. A texture layered over it gives each one a place —
 * a pitch, a starfield, a track — for a few hundred bytes and no requests,
 * which keeps the offline promise intact.
 *
 * encodeURIComponent handles the `#` in colour literals; hand-escaping data
 * URIs is where these usually break.
 */
const texture = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg.trim())}")`;

/** Mown pitch stripes with a faint chalk line. */
const PITCH = texture(`
<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
  <rect width='80' height='160' fill='#ffffff' opacity='0.035'/>
  <rect y='158' width='160' height='2' fill='#ffffff' opacity='0.05'/>
</svg>`);

/** Three-toed tracks wandering across the screen. */
const TRACKS = texture(`
<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'>
  <g fill='#ffffff' opacity='0.06'>
    <ellipse cx='34' cy='40' rx='9' ry='11'/>
    <ellipse cx='25' cy='27' rx='3.5' ry='6' transform='rotate(-20 25 27)'/>
    <ellipse cx='34' cy='24' rx='3.5' ry='6.5'/>
    <ellipse cx='43' cy='27' rx='3.5' ry='6' transform='rotate(20 43 27)'/>
    <ellipse cx='104' cy='110' rx='9' ry='11'/>
    <ellipse cx='95' cy='97' rx='3.5' ry='6' transform='rotate(-20 95 97)'/>
    <ellipse cx='104' cy='94' rx='3.5' ry='6.5'/>
    <ellipse cx='113' cy='97' rx='3.5' ry='6' transform='rotate(20 113 97)'/>
  </g>
</svg>`);

/** Starfield: a few bright stars, many faint ones. */
const STARFIELD = texture(`
<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
  <g fill='#ffffff'>
    <circle cx='20' cy='30' r='1.6' opacity='0.5'/>
    <circle cx='70' cy='15' r='1' opacity='0.3'/>
    <circle cx='130' cy='45' r='1.8' opacity='0.55'/>
    <circle cx='180' cy='25' r='1' opacity='0.3'/>
    <circle cx='45' cy='85' r='1.2' opacity='0.35'/>
    <circle cx='110' cy='100' r='1' opacity='0.28'/>
    <circle cx='165' cy='115' r='1.7' opacity='0.5'/>
    <circle cx='25' cy='140' r='1' opacity='0.3'/>
    <circle cx='85' cy='160' r='1.5' opacity='0.45'/>
    <circle cx='145' cy='180' r='1' opacity='0.3'/>
    <circle cx='195' cy='150' r='1.2' opacity='0.35'/>
  </g>
</svg>`);

/** Four-point sparkles, the shape kids draw when they mean "magic". */
const SPARKLES = texture(`
<svg xmlns='http://www.w3.org/2000/svg' width='170' height='170'>
  <g fill='#ffffff'>
    <path d='M40 18 L44 32 L58 36 L44 40 L40 54 L36 40 L22 36 L36 32 Z' opacity='0.09'/>
    <path d='M128 78 L131 88 L141 91 L131 94 L128 104 L125 94 L115 91 L125 88 Z' opacity='0.07'/>
    <path d='M68 128 L72 141 L85 145 L72 149 L68 162 L64 149 L51 145 L64 141 Z' opacity='0.08'/>
  </g>
</svg>`);

/** A checkered strip, the way it edges a finish line. */
const CHECKERS = texture(`
<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'>
  <g fill='#ffffff' opacity='0.05'>
    <rect width='24' height='24'/>
    <rect x='24' y='24' width='24' height='24'/>
  </g>
</svg>`);

/** Rolling swell, the way a kid draws the sea. */
const WAVES = texture(`
<svg xmlns='http://www.w3.org/2000/svg' width='120' height='60'>
  <g fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round' opacity='0.07'>
    <path d='M0 18 q15 -10 30 0 t30 0 t30 0 t30 0'/>
    <path d='M0 42 q15 -10 30 0 t30 0 t30 0 t30 0'/>
  </g>
</svg>`);

export const THEMES = {
  soccer: {
    key: 'soccer',
    label: 'Soccer',
    colors: {
      bg: 'linear-gradient(160deg, #1b7a3d 0%, #2e9e56 55%, #1b6a38 100%)',
      card: '#ffffff',
      cardText: '#173d24',
      accent: '#f5c518',
      accentText: '#3d3000',
      meterFill: 'linear-gradient(90deg, #f5c518, #ffe27a)',
      chip: '#e8f6ec',
      headerText: '#ffffff',
      texture: PITCH,
    },
    terms: {
      celebration: 'GOAL!',
      celebrationSub: 'What a shot!',
      // Kids habituate to a single catchphrase fast; the celebration picks
      // from these at random so it stays worth watching.
      cheers: [
        ['GOAL!', 'What a shot!'],
        ['BACK OF THE NET!', 'Unstoppable!'],
        ['WHAT A STRIKE!', 'Straight in the top corner!'],
        ['GOLAZO!', 'The crowd goes wild!'],
      ],
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
      goalTitle: 'My Trophy Goal',
      goalReached: 'YOU DID IT! Go get it in the Trophy Shop! 🏆',
      badges: 'Trophy Case',
      familyGoal: 'Team Goal',
      levelTitles: ['Rookie', 'Junior Striker', 'Striker', 'Playmaker', 'Team Captain', 'All-Star', 'MVP', 'Champion', 'Legend'],
      vacationTitle: 'Off-Season Break! 🏖️',
      vacationBody: 'No matches today — enjoy your break! Your Win Streaks are frozen safe and will be waiting when you get back.',
    },
    icons: {
      mascot: '⚽',
      streak: '🏅',
      savings: '🏆',
      checking: '💰',
      mystery: '🏆',
    },
    celebration: 'soccer',
    sound: 'goal',
    progressStyle: 'pitch',
  },
  dino: {
    key: 'dino',
    label: 'Dinosaur',
    colors: {
      bg: 'linear-gradient(160deg, #1f7a5c 0%, #2c9a74 55%, #14655f 100%)',
      card: '#fffaf0',
      cardText: '#2d3a1f',
      accent: '#f59e0b',
      accentText: '#3d2800',
      meterFill: 'linear-gradient(90deg, #f59e0b, #fbc963)',
      chip: '#f0f9e8',
      headerText: '#ffffff',
      texture: TRACKS,
    },
    terms: {
      celebration: 'ROAR!',
      celebrationSub: 'Dino-mite job!',
      cheers: [
        ['ROAR!', 'Dino-mite job!'],
        ['STOMP STOMP!', 'Prehistoric power!'],
        ['RAWR!', 'That was Jurassic-sized!'],
        ['MIGHTY!', 'Even the T-Rex is impressed!'],
      ],
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
      goalTitle: 'My Dino Dream',
      goalReached: 'YOU DID IT! Go get it in the Dino Store! 🦖',
      badges: 'Fossil Collection',
      familyGoal: 'Herd Goal',
      levelTitles: ['Dino Egg', 'Hatchling', 'Little Raptor', 'Speedy Raptor', 'Junior Paleontologist', 'Dino Ranger', 'Raptor Boss', 'T-Rex Boss', 'Dino Legend'],
      vacationTitle: 'Dino Vacation! 🏝️',
      vacationBody: 'The dinos are taking a nap — no tasks today! Your Fossil Streaks are frozen safe until you’re back.',
    },
    icons: {
      mascot: '🦖',
      streak: '🦴',
      savings: '🥚',
      checking: '💰',
      mystery: '🥚',
    },
    celebration: 'dino',
    sound: 'roar',
    progressStyle: 'egg',
  },
  space: {
    key: 'space',
    label: 'Space',
    colors: {
      bg: 'linear-gradient(160deg, #1a1f4b 0%, #2d3585 55%, #141838 100%)',
      card: '#f4f6ff',
      cardText: '#1c2350',
      accent: '#ffd94a',
      accentText: '#3d3000',
      meterFill: 'linear-gradient(90deg, #ffd94a, #ffe98f)',
      chip: '#e6ebff',
      headerText: '#ffffff',
      texture: STARFIELD,
    },
    terms: {
      celebration: 'BLAST OFF!',
      celebrationSub: 'Out of this world!',
      cheers: [
        ['BLAST OFF!', 'Out of this world!'],
        ['LIFTOFF!', 'Mission Control is proud!'],
        ['TO THE STARS!', 'Perfect trajectory!'],
        ['ORBIT ACHIEVED!', 'Textbook flying, Commander!'],
      ],
      streak: 'Orbit Streak',
      progress: 'Mission Progress',
      checking: 'Spending',
      savings: 'Star Fund',
      allDone: 'MISSION COMPLETE — welcome home, astronaut! 🚀',
      rewards: 'Star Shop',
      pendingBanner: 'Waiting for Mission Control to check it!',
      rejectedBanner: 'Not this launch — ask a grown-up',
      mysteryTitle: 'Mystery Capsule!',
      mysteryTap: 'Tap to open the space capsule!',
      bonus: 'BONUS',
      goalTitle: 'My Space Dream',
      goalReached: 'YOU DID IT! Go get it in the Star Shop! 🚀',
      badges: 'Mission Patches',
      familyGoal: 'Crew Goal',
      levelTitles: ['Cadet', 'Rookie Pilot', 'Pilot', 'Co-Captain', 'Captain', 'Commander', 'Space Ranger', 'Star Voyager', 'Galaxy Legend'],
      vacationTitle: 'Space Station Break! 🛸',
      vacationBody: 'Mission Control says rest up — no missions today! Your Orbit Streaks are frozen safe until you land back home.',
    },
    icons: {
      mascot: '🚀',
      streak: '☄️',
      savings: '🌟',
      checking: '💰',
      mystery: '🛸',
    },
    celebration: 'space',
    sound: 'blastoff',
    progressStyle: 'rocket',
  },
  fantasy: {
    key: 'fantasy',
    label: 'Fantasy',
    colors: {
      bg: 'linear-gradient(160deg, #6d28a8 0%, #9b4fd1 55%, #55217f 100%)',
      card: '#fdf7ff',
      cardText: '#43195f',
      accent: '#f5b8d9',
      accentText: '#5c1a3e',
      meterFill: 'linear-gradient(90deg, #f5b8d9, #fbdaec)',
      chip: '#f5ebfb',
      headerText: '#ffffff',
      texture: SPARKLES,
    },
    terms: {
      celebration: 'TA-DA!',
      celebrationSub: 'Simply enchanting!',
      cheers: [
        ['TA-DA!', 'Simply enchanting!'],
        ['ABRACADABRA!', 'Pure magic!'],
        ['SPELLBINDING!', 'The whole kingdom cheers!'],
        ['ENCHANTED!', 'The spell worked perfectly!'],
      ],
      streak: 'Magic Streak',
      progress: 'Royal Quest',
      checking: 'Spending',
      savings: 'Royal Treasury',
      allDone: 'THE WHOLE KINGDOM CHEERS! 👑',
      rewards: 'Royal Boutique',
      pendingBanner: 'Waiting for the Royal Court to check it!',
      rejectedBanner: 'Not this time — ask a grown-up',
      mysteryTitle: 'Enchanted Chest!',
      mysteryTap: 'Tap to break the magic seal!',
      bonus: 'BONUS',
      goalTitle: 'My Royal Wish',
      goalReached: 'YOU DID IT! Go get it in the Royal Boutique! 👑',
      badges: 'Crown Jewels',
      familyGoal: 'Kingdom Goal',
      levelTitles: ['Little Royal', 'Castle Helper', 'Court Apprentice', 'Knight', 'Royal Knight', 'Court Wizard', 'Crown Guardian', 'Royal Highness', 'Legend of the Realm'],
      vacationTitle: 'Royal Holiday! 🏰',
      vacationBody: 'The castle is on holiday — no quests today! Your Magic Streaks are safe under a protection spell until you return.',
    },
    icons: {
      mascot: '🦄',
      streak: '✨',
      savings: '💎',
      checking: '💰',
      mystery: '🔮',
    },
    celebration: 'fantasy',
    sound: 'magic',
    progressStyle: 'castle',
  },
  racing: {
    key: 'racing',
    label: 'Racing',
    colors: {
      bg: 'linear-gradient(160deg, #8f1d1d 0%, #c23b2e 55%, #6e1414 100%)',
      card: '#fffdf7',
      cardText: '#4a1414',
      accent: '#ffcf3f',
      accentText: '#3d3000',
      meterFill: 'linear-gradient(90deg, #ffcf3f, #ffe485)',
      chip: '#fdeee6',
      headerText: '#ffffff',
      texture: CHECKERS,
    },
    terms: {
      celebration: 'VROOM!',
      celebrationSub: 'Checkered flag!',
      cheers: [
        ['VROOM!', 'Checkered flag!'],
        ['FULL THROTTLE!', 'New lap record!'],
        ['PIT PERFECT!', 'Straight to the podium!'],
        ['FLAT OUT!', 'Nobody could catch you!'],
      ],
      streak: 'Race Streak',
      progress: 'Race to the Finish',
      checking: 'Spending',
      savings: 'Trophy Garage',
      allDone: 'CHECKERED FLAG — you won the race! 🏁',
      rewards: 'Speed Shop',
      pendingBanner: 'Waiting for the pit crew to check it!',
      rejectedBanner: 'Back to the pits — ask a grown-up',
      mysteryTitle: 'Mystery Pit Stop!',
      mysteryTap: 'Tap to open the toolbox!',
      bonus: 'BONUS',
      goalTitle: 'My Dream Ride',
      goalReached: 'YOU DID IT! Go get it in the Speed Shop! 🏁',
      badges: "Winner's Garage",
      familyGoal: 'Pit Crew Goal',
      levelTitles: ['Go-Kart Rookie', 'Street Racer', 'Speedster', 'Track Star', 'Pro Driver', 'Race Champion', 'Grand Prix Hero', 'World Champion', 'Legend of the Track'],
      vacationTitle: 'Pit Stop Break! 🏖️',
      vacationBody: 'The race is on pause — no laps today! Your Race Streaks are parked safe in the garage until you’re back.',
    },
    icons: {
      mascot: '🏎️',
      streak: '🏁',
      savings: '🏆',
      checking: '💰',
      mystery: '🧰',
    },
    celebration: 'racing',
    sound: 'vroom',
    progressStyle: 'track',
  },
  ocean: {
    key: 'ocean',
    label: 'Ocean',
    colors: {
      bg: 'linear-gradient(160deg, #0b4f6c 0%, #1789a8 55%, #06394f 100%)',
      card: '#f2fbff',
      cardText: '#0a3a4d',
      accent: '#ffc93c',
      accentText: '#3d2f00',
      meterFill: 'linear-gradient(90deg, #ffc93c, #ffe08a)',
      chip: '#dff2f9',
      headerText: '#ffffff',
      texture: WAVES,
    },
    terms: {
      celebration: 'AHOY!',
      celebrationSub: 'Fine sailing!',
      cheers: [
        ['AHOY!', 'Fine sailing!'],
        ['LAND HO!', 'Sharp eyes, sailor!'],
        ['FULL SAIL!', 'The crew is cheering!'],
        ['SHIVER ME TIMBERS!', 'That was seamanship!'],
      ],
      streak: 'Voyage Streak',
      progress: 'Sail to the Island',
      checking: 'Spending',
      savings: 'Treasure Chest',
      allDone: 'LAND HO — you reached the island! 🏝️',
      rewards: 'Trading Post',
      pendingBanner: 'Waiting for the captain to check it!',
      rejectedBanner: 'Not this voyage — ask a grown-up',
      mysteryTitle: 'Message in a Bottle!',
      mysteryTap: 'Tap to pull out the scroll!',
      bonus: 'BONUS',
      goalTitle: 'My Treasure Goal',
      goalReached: 'YOU DID IT! Go claim it at the Trading Post! 🏴‍☠️',
      badges: 'Map Pieces',
      familyGoal: 'Crew Goal',
      levelTitles: ['Stowaway', 'Deckhand', 'Cabin Kid', 'Sailor', 'Navigator', 'Quartermaster', 'First Mate', 'Captain', 'Legend of the Seas'],
      vacationTitle: 'Shore Leave! 🏖️',
      vacationBody: 'The ship is in port — no chores today! Your Voyage Streaks are safe below deck until you set sail again.',
    },
    icons: {
      mascot: '⛵',
      streak: '🧭',
      savings: '💎',
      checking: '💰',
      mystery: '🍾',
    },
    celebration: 'ocean',
    sound: 'wave',
    progressStyle: 'voyage',
  },
};

// Task categories now live in the database (parent-editable) and arrive
// with each /today payload — no hardcoded list here anymore.

/**
 * Options for every theme picker in the app.
 *
 * The parent dashboard and the setup wizard each used to carry their own
 * hand-typed copy of this list, on top of the two validators on the server —
 * four places to remember, which is how a theme ends up half-added. Deriving
 * it here is what actually makes the README's "a new theme is a data change"
 * claim true.
 */
export const THEME_OPTIONS = Object.values(THEMES).map((t) => ({
  key: t.key,
  label: `${t.icons.mascot} ${t.label}`,
  avatar: t.icons.mascot,
}));
