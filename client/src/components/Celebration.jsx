import { useEffect } from 'react';

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

/**
 * Full-screen, sound-free celebration. Visual-only by design so audio can
 * be layered in later (add a sound trigger where onDone is armed).
 */
export default function Celebration({ theme, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
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
        <div className="celebration-word">{theme.terms.celebration}</div>
        <div className="celebration-sub">{theme.terms.celebrationSub}</div>
      </div>
    </div>
  );
}
