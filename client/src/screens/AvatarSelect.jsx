import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLongPress } from '../hooks.js';
import { KidCodeGate } from '../components/KidCode.jsx';
import { THEMES } from '../themes.js';

export default function AvatarSelect({ appName = 'Reward Chart' }) {
  const [kids, setKids] = useState([]);
  const [unlocking, setUnlocking] = useState(null); // kid awaiting secret code
  const navigate = useNavigate();
  const logoPress = useLongPress(() => navigate('/parent'));

  useEffect(() => {
    // Re-lock everyone whenever the kiosk is back on the avatar screen.
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('kid-unlocked-')) sessionStorage.removeItem(key);
    }
    let alive = true;
    const load = () => api.get('/api/kids').then((k) => alive && setKids(k)).catch(() => {});
    load();
    const retry = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(retry);
    };
  }, []);

  function enter(kid) {
    sessionStorage.setItem(`kid-unlocked-${kid.id}`, '1');
    navigate(`/kid/${kid.id}`);
  }

  function onTapAvatar(kid) {
    if (kid.has_code) setUnlocking(kid);
    else enter(kid);
  }

  if (unlocking) {
    return (
      <KidCodeGate
        kid={unlocking}
        onUnlocked={() => enter(unlocking)}
        onCancel={() => setUnlocking(null)}
      />
    );
  }

  return (
    <div className="avatar-select">
      <h1>Who's checking in?</h1>
      <div className="avatar-row">
        {kids.map((kid) => (
          <button
            key={kid.id}
            className={`avatar-btn ${kid.theme}`}
            // Same texture the kid's own screen uses, so the tile is a
            // preview of where tapping takes them.
            style={{ '--tile-texture': THEMES[kid.theme]?.colors.texture || 'none' }}
            onClick={() => onTapAvatar(kid)}
          >
            <span className="avatar-emoji">{kid.avatar_icon}</span>
            {kid.name}
            {kid.has_code && (
              <span className="avatar-lock" role="img" aria-label="has a secret code">
                🔒
              </span>
            )}
            {/* The pull: what's actually waiting behind this tile. */}
            <span className="avatar-teasers">
              {kid.level > 1 && <span className="teaser">Lv {kid.level}</span>}
              {kid.streak > 0 && (
                <span className="teaser flame">🔥 {kid.streak}</span>
              )}
              {kid.allDone ? (
                <span className="teaser done">All done! 🎉</span>
              ) : (
                kid.waiting > 0 && (
                  <span className="teaser waiting">
                    {kid.waiting} to do
                  </span>
                )
              )}
            </span>
          </button>
        ))}
      </div>
      <button className="parents-btn" onClick={() => navigate('/parent')}>
        👨‍👧‍👦 Parents
      </button>
      {/* Long-press still works as a shortcut to the parent PIN screen. */}
      <div className="app-logo" {...logoPress}>
        ⭐ {appName}
      </div>
    </div>
  );
}
