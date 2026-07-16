import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { playSound } from '../sounds.js';

/**
 * The nine emoji every secret code is built from. The kid's unlock grid
 * and the parent's code-setting grid must use the same set, so a code can
 * always be entered.
 */
export const CODE_EMOJIS = ['🐶', '🐱', '🦖', '⚽', '🍕', '🌟', '🚗', '🐸', '🍦'];

export const CODE_LENGTH = 3;

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Full-screen gate: kid taps their 3 secret emoji in order. Wrong code
 * shakes and resets; right code calls onUnlocked.
 */
export function KidCodeGate({ kid, onUnlocked, onCancel }) {
  const grid = useMemo(() => shuffled(CODE_EMOJIS), []);
  const [entered, setEntered] = useState([]);
  const [shaking, setShaking] = useState(false);

  async function tap(emoji) {
    if (shaking || entered.length >= CODE_LENGTH) return;
    const next = [...entered, emoji];
    setEntered(next);
    if (next.length < CODE_LENGTH) return;
    const result = await api
      .post(`/api/kids/${kid.id}/verify-code`, { code: next.join('') })
      .catch(() => ({ ok: false }));
    if (result.ok) {
      playSound('unlock');
      return onUnlocked();
    }
    playSound('bonk');
    setShaking(true);
    setTimeout(() => {
      setEntered([]);
      setShaking(false);
    }, 700);
  }

  return (
    <div className="code-gate">
      <div className="code-gate-avatar">{kid.avatar_icon}</div>
      <h2>Hi {kid.name}! Tap your secret code</h2>
      <div className={`code-dots${shaking ? ' shake' : ''}`}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <span key={i} className={`code-dot${i < entered.length ? ' filled' : ''}`}>
            {entered[i] || ''}
          </span>
        ))}
      </div>
      <div className="code-grid">
        {grid.map((emoji) => (
          <button key={emoji} className="code-key" onClick={() => tap(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
      <button className="btn secondary" onClick={onCancel}>
        ⬅ Not {kid.name}? Go back
      </button>
    </div>
  );
}

/** Parent-side picker for setting a kid's code: tap 3 emoji in order. */
export function CodePicker({ value, onChange }) {
  // Emoji are multi-codepoint; split on the known set instead of chars.
  const pickedList = [];
  let rest = value || '';
  while (rest.length > 0) {
    const match = CODE_EMOJIS.find((e) => rest.startsWith(e));
    if (!match) break;
    pickedList.push(match);
    rest = rest.slice(match.length);
  }

  function tap(emoji) {
    if (pickedList.length >= CODE_LENGTH) return;
    onChange((value || '') + emoji);
  }

  return (
    <div>
      <div className="code-dots small">
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <span key={i} className={`code-dot${i < pickedList.length ? ' filled' : ''}`}>
            {pickedList[i] || ''}
          </span>
        ))}
        <button type="button" className="btn secondary" onClick={() => onChange('')}>
          ⌫ Clear
        </button>
      </div>
      <div className="code-grid small">
        {CODE_EMOJIS.map((emoji) => (
          <button type="button" key={emoji} className="code-key small" onClick={() => tap(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
