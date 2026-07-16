import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLongPress } from '../hooks.js';

export default function AvatarSelect() {
  const [kids, setKids] = useState([]);
  const navigate = useNavigate();
  const logoPress = useLongPress(() => navigate('/parent'));

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/api/kids').then((k) => alive && setKids(k)).catch(() => {});
    load();
    const retry = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(retry);
    };
  }, []);

  return (
    <div className="avatar-select">
      <h1>Who's checking in?</h1>
      <div className="avatar-row">
        {kids.map((kid) => (
          <button
            key={kid.id}
            className={`avatar-btn ${kid.theme}`}
            onClick={() => navigate(`/kid/${kid.id}`)}
          >
            <span className="avatar-emoji">{kid.avatar_icon}</span>
            {kid.name}
          </button>
        ))}
      </div>
      {/* Hidden parent entrance: long-press the logo (or browse to /parent). */}
      <div className="app-logo" {...logoPress}>
        ⭐ Chapman Reward Chart
      </div>
    </div>
  );
}
