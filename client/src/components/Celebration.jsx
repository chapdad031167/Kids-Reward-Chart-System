import { useEffect } from 'react';
import { playSound } from '../sounds.js';

const CONFETTI_COLORS = ['#f5c518', '#ffffff', '#2e9e56', '#f59e0b', '#63b3ed', '#f687b3'];

function Confetti() {
  return (
    <>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${5 + ((i * 53) % 90)}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 6) * 0.09}s`,
          }}
        />
      ))}
    </>
  );
}

/** Full-screen celebration: themed animation plus a themed jingle. */
export default function Celebration({ theme, onDone }) {
  useEffect(() => {
    playSound(theme.sound);
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone]);

  return (
    <div className="celebration-overlay" onClick={onDone}>
      <div className="celebration-stage">
        <Confetti />
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
        <div className="celebration-word">{theme.terms.celebration}</div>
        <div className="celebration-sub">{theme.terms.celebrationSub}</div>
      </div>
    </div>
  );
}
