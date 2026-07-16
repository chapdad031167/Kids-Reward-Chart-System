/**
 * Daily progress display. Soccer renders an XP-style bar with a ball
 * marker; dino renders an egg that cracks as tasks complete and hatches
 * when everything is done.
 */
export default function ProgressMeter({ theme, progress }) {
  const { doneCount, totalTasks, earnedToday } = progress;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
  const complete = totalTasks > 0 && doneCount >= totalTasks;

  return (
    <div className="panel">
      <h2>{theme.terms.progress}</h2>
      {theme.progressStyle === 'egg' ? (
        <EggMeter pct={pct} complete={complete} />
      ) : (
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${Math.max(pct, 6)}%` }}>
            <span className="meter-marker">{theme.icons.mascot}</span>
          </div>
        </div>
      )}
      <div className="meter-caption">
        {complete
          ? theme.terms.allDone
          : `${doneCount} of ${totalTasks} tasks done · ${earnedToday} points approved today`}
      </div>
    </div>
  );
}

/** Crack lines appear at 25/50/75%; at 100% the egg is replaced by a hatchling. */
function EggMeter({ pct, complete }) {
  if (complete) {
    return (
      <div className="egg-progress">
        <span className="egg-hatched" role="img" aria-label="hatched baby dino">
          🐣🦖
        </span>
      </div>
    );
  }
  const cracks = [pct >= 25, pct >= 50, pct >= 75];
  return (
    <div className="egg-progress">
      <svg className="egg-svg" viewBox="0 0 100 126" aria-label={`egg ${pct}% cracked`}>
        <defs>
          <clipPath id="eggClip">
            <path d="M50 6 C74 6 92 42 92 76 C92 104 73 120 50 120 C27 120 8 104 8 76 C8 42 26 6 50 6 Z" />
          </clipPath>
        </defs>
        <path
          d="M50 6 C74 6 92 42 92 76 C92 104 73 120 50 120 C27 120 8 104 8 76 C8 42 26 6 50 6 Z"
          fill="#fdf3d8"
          stroke="#d9b26a"
          strokeWidth="3"
        />
        {/* fill rises with progress */}
        <rect
          x="0"
          y={120 - (114 * pct) / 100}
          width="100"
          height="126"
          fill="#f59e0b"
          opacity="0.55"
          clipPath="url(#eggClip)"
          style={{ transition: 'y 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
        {cracks[0] && (
          <polyline points="30,50 40,58 34,66 44,72" fill="none" stroke="#8a6520" strokeWidth="3" strokeLinecap="round" />
        )}
        {cracks[1] && (
          <polyline points="62,38 55,48 64,56 56,66" fill="none" stroke="#8a6520" strokeWidth="3" strokeLinecap="round" />
        )}
        {cracks[2] && (
          <polyline points="44,84 52,92 46,100 58,106" fill="none" stroke="#8a6520" strokeWidth="3" strokeLinecap="round" />
        )}
      </svg>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        {pct}% cracked…
        <br />
        finish every task to hatch it!
      </div>
    </div>
  );
}
