/**
 * Daily progress display, one bespoke scene per theme.
 *
 * The dino egg was the only themed meter; every other theme fell back to the
 * same bar with a different emoji on it, which is most of why five themes read
 * as one screen recoloured. Each theme now gets a scene that means something
 * in its own world — a ball closing on goal, a rocket climbing to its planet,
 * a car coming round to the flag, a castle going up stone by stone — and a
 * distinct finished state worth getting to.
 *
 * All of them are inline SVG on the same contract: take `pct` and `complete`,
 * animate off a CSS transition, and cost nothing to load.
 */
export default function ProgressMeter({ theme, progress }) {
  const { doneCount, totalTasks, earnedToday } = progress;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
  const complete = totalTasks > 0 && doneCount >= totalTasks;

  const Meter = METERS[theme.progressStyle];

  return (
    <div className="panel">
      <h2>{theme.terms.progress}</h2>
      {Meter ? (
        <Meter pct={pct} complete={complete} theme={theme} />
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

/** Shared line under each scene: how far along, and what finishing gets you. */
function MeterNote({ children }) {
  return <div className="meter-note">{children}</div>;
}

// ---------------------------------------------------------------- dino

/** Crack lines appear at 25/50/75%; at 100% the egg is replaced by a hatchling. */
function EggMeter({ pct, complete }) {
  if (complete) {
    return (
      <div className="scene-meter">
        <span className="scene-finished" role="img" aria-label="hatched baby dino">
          🐣🦖
        </span>
      </div>
    );
  }
  const cracks = [pct >= 25, pct >= 50, pct >= 75];
  return (
    <div className="scene-meter">
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
      <MeterNote>
        <strong>{pct}% cracked…</strong>
        <br />
        finish every task to hatch it!
      </MeterNote>
    </div>
  );
}

// ---------------------------------------------------------------- soccer

/** Ball runs down the pitch toward an open goal; finishing puts it in the net. */
function PitchMeter({ pct, complete }) {
  // Travel the whole pitch: kick-off spot to just shy of the goal line, then
  // into the net on completion. (Under-shooting this range makes a kid at 90%
  // see the ball barely past halfway.)
  const x = complete ? 182 : 12 + (pct / 100) * 152;
  return (
    <div className="scene-meter">
      <svg
        className="scene-svg wide"
        viewBox="0 0 200 100"
        aria-label={complete ? 'goal scored' : `ball ${pct}% of the way to goal`}
      >
        {/* pitch */}
        <rect x="0" y="18" width="200" height="70" rx="6" fill="#2e9e56" />
        <rect x="0" y="18" width="200" height="70" rx="6" fill="#ffffff" opacity="0.05" />
        <line x1="12" y1="18" x2="12" y2="88" stroke="#ffffff" strokeWidth="2" opacity="0.55" />
        <circle cx="12" cy="53" r="14" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.45" />
        {/* goal mouth */}
        <rect x="170" y="30" width="24" height="46" fill="none" stroke="#ffffff" strokeWidth="3" />
        <path
          d="M170 30 L194 30 M170 76 L194 76"
          stroke="#ffffff"
          strokeWidth="1"
          opacity="0.5"
        />
        {[36, 44, 52, 60, 68].map((y) => (
          <line key={y} x1="170" y1={y} x2="194" y2={y} stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
        ))}
        {[176, 182, 188].map((gx) => (
          <line key={gx} x1={gx} y1="30" x2={gx} y2="76" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
        ))}
        {/* ball */}
        <g style={{ transition: 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)', transform: `translateX(${x}px)` }}>
          <circle cx="0" cy="53" r="9" fill="#ffffff" stroke="#1b6a38" strokeWidth="1.5" />
          <path d="M0 47 L4 51 L2 56 L-2 56 L-4 51 Z" fill="#173d24" />
        </g>
      </svg>
      <MeterNote>
        {complete ? (
          <strong>GOAL! 🥅</strong>
        ) : (
          <>
            <strong>{pct}% up the pitch</strong>
            <br />
            finish every task to score!
          </>
        )}
      </MeterNote>
    </div>
  );
}

// ---------------------------------------------------------------- space

/** Rocket climbs toward its planet; finishing lands it. */
function RocketMeter({ pct, complete }) {
  const y = complete ? 34 : 104 - (pct / 100) * 62;
  return (
    <div className="scene-meter">
      <svg
        className="scene-svg"
        viewBox="0 0 100 126"
        aria-label={complete ? 'landed at the planet' : `rocket ${pct}% of the way to the planet`}
      >
        {/* The card behind this is near-white, so the scene brings its own
            night sky — otherwise the white stars and flight path vanish. */}
        <rect x="0" y="0" width="100" height="126" rx="10" fill="#1a1f4b" />
        {/* stars */}
        {[
          [18, 30], [76, 22], [30, 62], [84, 58], [22, 96], [70, 100],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={i % 2 ? 1 : 1.6} fill="#ffffff" opacity="0.55" />
        ))}
        {/* planet at the top */}
        <circle cx="50" cy="20" r="15" fill="#ffd94a" />
        <ellipse cx="50" cy="20" rx="24" ry="6" fill="none" stroke="#ffe98f" strokeWidth="2.5" opacity="0.85" />
        <circle cx="44" cy="16" r="3.5" fill="#e6b800" opacity="0.5" />
        <circle cx="56" cy="25" r="2.5" fill="#e6b800" opacity="0.5" />
        {/* climb path */}
        <line x1="50" y1="112" x2="50" y2="38" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.35" />
        {/* rocket */}
        <g style={{ transition: 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)', transform: `translateY(${y - 104}px)` }}>
          <path d="M50 92 C56 100 56 108 50 114 C44 108 44 100 50 92 Z" fill="#f4f6ff" stroke="#1c2350" strokeWidth="1.5" />
          <circle cx="50" cy="103" r="2.6" fill="#2d3585" />
          <path d="M44 108 L40 116 L46 113 Z" fill="#e53e3e" />
          <path d="M56 108 L60 116 L54 113 Z" fill="#e53e3e" />
          {!complete && <path d="M50 116 L46 124 L50 121 L54 124 Z" fill="#ffb545" />}
        </g>
      </svg>
      <MeterNote>
        {complete ? (
          <strong>TOUCHDOWN! 🪐</strong>
        ) : (
          <>
            <strong>{pct}% to the planet</strong>
            <br />
            finish every task to land!
          </>
        )}
      </MeterNote>
    </div>
  );
}

// ---------------------------------------------------------------- racing

/** Car runs the lap; finishing brings it under the flag. */
function TrackMeter({ pct, complete }) {
  // Trace the lap by retracting a dash the length of the whole path.
  // Perimeter of a 160x60 rect with r=30: the straights (2 x 100) plus one
  // full circle of radius 30 from the four corners. Guessing this low leaves
  // the loop visibly unclosed at 100%.
  const LAP = 2 * 100 + 2 * Math.PI * 30; // ≈ 388.5
  const travelled = (complete ? 100 : pct) / 100;

  return (
    <div className="scene-meter">
      <svg
        className="scene-svg wide"
        viewBox="0 0 200 100"
        aria-label={complete ? 'lap complete' : `car ${pct}% around the lap`}
      >
        {/* track */}
        <rect
          x="20"
          y="20"
          width="160"
          height="60"
          rx="30"
          fill="none"
          stroke="#4a5568"
          strokeWidth="16"
        />
        <rect
          x="20"
          y="20"
          width="160"
          height="60"
          rx="30"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeDasharray="6 10"
          opacity="0.5"
        />
        {/* progress traced over the track */}
        <rect
          id="lapPath"
          x="20"
          y="20"
          width="160"
          height="60"
          rx="30"
          fill="none"
          stroke="#ffcf3f"
          strokeWidth="16"
          strokeDasharray={LAP}
          strokeDashoffset={LAP - LAP * travelled}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }}
          opacity="0.9"
        />
        {/* start/finish line */}
        <g>
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={96 + (i % 2) * 4}
              y={12 + Math.floor(i / 2) * 4}
              width="4"
              height="4"
              fill={i % 3 === 0 ? '#1a202c' : '#ffffff'}
            />
          ))}
          <rect x="96" y="12" width="8" height="8" fill="none" stroke="#1a202c" strokeWidth="0.5" />
          <line x1="100" y1="20" x2="100" y2="30" stroke="#1a202c" strokeWidth="2" />
        </g>
        {/* Car sits at the flag when the lap is done, on the track otherwise.
            Moved with a transform rather than an animated `x` — geometry-
            attribute transitions don't work in Safari, which is most of the
            iPads this runs on. */}
        <g
          style={{
            transition: 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)',
            transform: `translateX(${complete ? 100 : 24 + travelled * 152}px)`,
          }}
        >
          <text x="0" y="27" fontSize="18" textAnchor="middle">
            🏎️
          </text>
        </g>
      </svg>
      <MeterNote>
        {complete ? (
          <strong>CHECKERED FLAG! 🏁</strong>
        ) : (
          <>
            <strong>{pct}% around the lap</strong>
            <br />
            finish every task to take the flag!
          </>
        )}
      </MeterNote>
    </div>
  );
}

// ---------------------------------------------------------------- fantasy

/** The castle goes up in stages; finishing raises the flag. */
function CastleMeter({ pct, complete }) {
  // Four stages so each block landing is a visible reward.
  const stage = complete ? 4 : Math.floor(pct / 25);
  const built = (n) => ({
    opacity: stage >= n ? 1 : 0.12,
    transition: 'opacity 0.6s ease',
  });

  return (
    <div className="scene-meter">
      <svg
        className="scene-svg"
        viewBox="0 0 110 126"
        aria-label={complete ? 'castle complete' : `castle ${stage} of 4 parts built`}
      >
        {/* ground */}
        <rect x="0" y="112" width="110" height="14" fill="#6d28a8" opacity="0.35" rx="3" />
        {/* stage 1: keep */}
        <g style={built(1)}>
          <rect x="38" y="66" width="34" height="46" fill="#e9d5ff" stroke="#6d28a8" strokeWidth="2" />
          <rect x="49" y="88" width="12" height="24" fill="#6d28a8" rx="6" />
        </g>
        {/* stage 2: side towers */}
        <g style={built(2)}>
          <rect x="16" y="78" width="22" height="34" fill="#f3e8ff" stroke="#6d28a8" strokeWidth="2" />
          <rect x="72" y="78" width="22" height="34" fill="#f3e8ff" stroke="#6d28a8" strokeWidth="2" />
        </g>
        {/* stage 3: battlements */}
        <g style={built(3)}>
          {[38, 48, 58, 68].map((x) => (
            <rect key={x} x={x} y="58" width="6" height="8" fill="#e9d5ff" stroke="#6d28a8" strokeWidth="1.5" />
          ))}
          {[16, 26, 72, 82].map((x) => (
            <rect key={x} x={x} y="70" width="6" height="8" fill="#f3e8ff" stroke="#6d28a8" strokeWidth="1.5" />
          ))}
        </g>
        {/* stage 4: the flag */}
        <g style={built(4)}>
          <line x1="55" y1="58" x2="55" y2="30" stroke="#6d28a8" strokeWidth="2.5" />
          <path d="M55 32 L80 39 L55 46 Z" fill="#f5b8d9" stroke="#6d28a8" strokeWidth="1.5" />
        </g>
        {complete && (
          <g className="castle-sparkles">
            <path d="M22 34 L25 42 L33 45 L25 48 L22 56 L19 48 L11 45 L19 42 Z" fill="#ffffff" opacity="0.85" />
            <path d="M92 52 L94 58 L100 60 L94 62 L92 68 L90 62 L84 60 L90 58 Z" fill="#ffffff" opacity="0.7" />
          </g>
        )}
      </svg>
      <MeterNote>
        {complete ? (
          <strong>THE CASTLE IS BUILT! 🏰</strong>
        ) : (
          <>
            <strong>{stage} of 4 parts built</strong>
            <br />
            finish every task to raise the flag!
          </>
        )}
      </MeterNote>
    </div>
  );
}

const METERS = {
  egg: EggMeter,
  pitch: PitchMeter,
  rocket: RocketMeter,
  track: TrackMeter,
  castle: CastleMeter,
};
