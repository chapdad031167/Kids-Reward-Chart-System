import { useEffect, useState } from 'react';
import { playSound } from '../sounds.js';

const CONFETTI_COLORS = ['#f5c518', '#ffffff', '#2e9e56', '#f59e0b', '#63b3ed', '#f687b3'];

/** One in ten celebrations is a big one — rare enough to stay a surprise. */
const BIG_CHANCE = 0.1;

function Confetti({ count }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${3 + ((i * 37) % 94)}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 8) * 0.08}s`,
          }}
        />
      ))}
    </>
  );
}

/** Full-screen celebration: themed animation plus a themed jingle. */
export default function Celebration({ theme, onDone }) {
  // Chosen once per celebration — re-rolling on every render would make the
  // words flicker mid-animation.
  const [{ word, sub, big }] = useState(() => {
    const pool = theme.terms.cheers?.length
      ? theme.terms.cheers
      : [[theme.terms.celebration, theme.terms.celebrationSub]];
    const [w, s] = pool[Math.floor(Math.random() * pool.length)];
    return { word: w, sub: s, big: Math.random() < BIG_CHANCE };
  });

  useEffect(() => {
    playSound(theme.sound);
    const t = setTimeout(onDone, big ? 3400 : 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone]);

  return (
    <div className="celebration-overlay" onClick={onDone}>
      <div className={`celebration-stage${big ? ' big' : ''}`}>
        <Confetti count={big ? 44 : 18} />
        {theme.celebration === 'soccer' && (
          <>
            <span className="goal-net">🥅</span>
            <span className="goal-ball">⚽</span>
          </>
        )}
        {theme.celebration === 'dino' && (
          <>
            <span className="hatch-egg">🥚</span>
            <span className="hatch-dino">🦖</span>
            <span className="roar-bubble">ROAR!</span>
          </>
        )}
        {theme.celebration === 'space' && (
          <>
            <span className="space-planet">🪐</span>
            <span className="space-rocket">🚀</span>
          </>
        )}
        {theme.celebration === 'fantasy' && (
          <>
            <span className="magic-wand">🪄</span>
            <span className="magic-crown">👑</span>
          </>
        )}
        {theme.celebration === 'racing' && (
          <>
            <span className="race-flag">🏁</span>
            <span className="race-car">🏎️</span>
          </>
        )}
        {big && <div className="celebration-flag">⭐ BIG ONE ⭐</div>}
        <div className="celebration-word">{word}</div>
        <div className="celebration-sub">{sub}</div>
      </div>
    </div>
  );
}
