import { useState } from 'react';
import { api } from '../api.js';
import EmojiPicker from '../components/EmojiPicker.jsx';

const THEME_OPTIONS = [
  { key: 'soccer', label: '⚽ Soccer', avatar: '⚽' },
  { key: 'dino', label: '🦖 Dinosaur', avatar: '🦖' },
  { key: 'space', label: '🚀 Space', avatar: '🚀' },
  { key: 'fantasy', label: '🦄 Fantasy', avatar: '🦄' },
  { key: 'racing', label: '🏎️ Racing', avatar: '🏎️' },
];

/**
 * First-run wizard, shown only while the instance is unconfigured. Names
 * the app, sets the parent PIN, adds the first child, and offers the
 * starter task/reward library. On finish it reloads into the live app.
 */
export default function Setup({ onDone }) {
  const [step, setStep] = useState(0);
  const [appName, setAppName] = useState('Reward Chart');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [theme, setTheme] = useState('soccer');
  const [avatar, setAvatar] = useState('⚽');
  const [loadStarter, setLoadStarter] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const parsedAge = Number(age);
  const pinOk = /^\d{4}$/.test(pin) && pin === pin2;
  const kidOk = name.trim().length > 0 && Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge <= 18;

  function pickTheme(t) {
    setTheme(t);
    setAvatar(THEME_OPTIONS.find((o) => o.key === t)?.avatar || '⭐');
  }

  async function finish() {
    setSaving(true);
    setError('');
    try {
      await api.post('/api/setup', {
        app_name: appName.trim(),
        pin,
        kid: { name: name.trim(), age: parsedAge, theme, avatar_icon: avatar },
        load_starter: loadStarter,
      });
      onDone();
    } catch {
      setError('Setup failed — please check your entries and try again.');
      setSaving(false);
    }
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-progress">
          {['Welcome', 'PIN', 'First child', 'Finish'].map((label, i) => (
            <span key={label} className={`setup-dot${i <= step ? ' on' : ''}`}>
              {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="setup-step">
            <h1>Welcome! 👋</h1>
            <p>
              Let’s set up your reward chart. First, what should it be called? This shows on the
              home screen — your family name, a fun title, anything you like.
            </p>
            <label className="setup-label">
              Chart name
              <input value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={60} />
            </label>
            <div className="setup-actions">
              <button className="btn primary" disabled={!appName.trim()} onClick={() => setStep(1)}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="setup-step">
            <h1>Parent PIN 🔒</h1>
            <p>
              Pick a 4-digit PIN to open the parent dashboard. Kids don’t need a password — this
              just keeps the grown-up controls private.
            </p>
            <label className="setup-label">
              PIN (4 digits)
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="setup-label">
              Confirm PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {pin && pin2 && pin !== pin2 && <div className="setup-error">PINs don’t match yet.</div>}
            <div className="setup-actions">
              <button className="btn secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn primary" disabled={!pinOk} onClick={() => setStep(2)}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="setup-step">
            <h1>Add your first child 🌟</h1>
            <p>You can add more kids later from the parent dashboard.</p>
            <label className="setup-label">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="setup-label">
              Age
              <input type="number" min="1" max="18" value={age} onChange={(e) => setAge(e.target.value)} />
            </label>
            <label className="setup-label">
              Theme
              <span className="setup-themes">
                {THEME_OPTIONS.map((o) => (
                  <button
                    type="button"
                    key={o.key}
                    className={`btn ${theme === o.key ? 'primary' : 'secondary'}`}
                    onClick={() => pickTheme(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </span>
            </label>
            <label className="setup-label">
              Avatar
              <EmojiPicker value={avatar} onChange={setAvatar} />
            </label>
            <div className="setup-actions">
              <button className="btn secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn primary" disabled={!kidOk} onClick={() => setStep(3)}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="setup-step">
            <h1>Almost done! 🎉</h1>
            <p>Want a head start? We can load a library of common chores, mystery bonus tasks, and rewards you can edit or delete anytime.</p>
            <label className="setup-check">
              <input type="checkbox" checked={loadStarter} onChange={(e) => setLoadStarter(e.target.checked)} />
              Load the starter tasks &amp; rewards (recommended)
            </label>
            <p className="setup-summary">
              Creating <strong>{appName.trim()}</strong> with{' '}
              <strong>
                {name.trim()} ({THEME_OPTIONS.find((o) => o.key === theme)?.label})
              </strong>
              .
            </p>
            {error && <div className="setup-error">{error}</div>}
            <div className="setup-actions">
              <button className="btn secondary" onClick={() => setStep(2)} disabled={saving}>
                Back
              </button>
              <button className="btn primary" onClick={finish} disabled={saving}>
                {saving ? 'Setting up…' : 'Start using it! 🚀'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
