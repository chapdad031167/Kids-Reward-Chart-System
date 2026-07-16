import { useState } from 'react';

// Curated kid-friendly icon set for tasks, rewards, and categories.
export const KID_EMOJIS = [
  '⭐', '🌟', '✨', '🌅', '🌙', '☀️', '🌈', '❤️',
  '🛏️', '👕', '🧥', '👟', '🧦', '🪥', '🧺', '🧼',
  '🛁', '🚿', '🧻', '🧹', '🧽', '🗑️', '🧸', '🪁',
  '🍽️', '🍴', '🥣', '🍎', '🥕', '🍕', '🧃', '🍦',
  '🎒', '📚', '📖', '✏️', '🖍️', '🎨', '🧩', '🎲',
  '🎵', '🎹', '🥁', '⚽', '🏀', '🚲', '🛴', '🏆',
  '🐶', '🐱', '🐠', '🐢', '🦖', '🐸', '🐾', '🪴',
  '🌻', '🍂', '🛒', '📦', '🚗', '🏠', '🤝', '💝',
];

/**
 * Emoji dropdown used everywhere an icon is chosen — no free-text typing,
 * so icons stay kid-recognizable and render on every device.
 */
export default function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="emoji-picker">
      <button type="button" className="emoji-current" onClick={() => setOpen(!open)}>
        <span className="emoji-current-icon">{value || '⭐'}</span>
        <span className="emoji-current-hint">{open ? 'Close' : 'Change'}</span>
      </button>
      {open && (
        <div className="emoji-grid">
          {KID_EMOJIS.map((emoji) => (
            <button
              type="button"
              key={emoji}
              className={`emoji-cell${emoji === value ? ' selected' : ''}`}
              onClick={() => {
                onChange(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
