import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, tapTask, queuedTapCount, startQueueSync } from '../api.js';
import { THEMES, CATEGORY_LABELS } from '../themes.js';
import { useIdleTimer } from '../hooks.js';
import Celebration from '../components/Celebration.jsx';
import ProgressMeter from '../components/ProgressMeter.jsx';
import { Modal, Toast } from '../components/ui.jsx';

const CATEGORY_ORDER = ['morning', 'evening', 'personal_space', 'chores', 'social_school'];

export default function KidHome() {
  const { kidId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [celebrating, setCelebrating] = useState(false);
  const [toast, setToast] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [showRewards, setShowRewards] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [easterEgg, setEasterEgg] = useState(false);
  const mascotTaps = useRef([]);

  // Kiosk behavior: bounce back to the avatar screen after 90s idle.
  useIdleTimer(() => navigate('/'), 90000);

  const refresh = useCallback(async () => {
    try {
      const d = await api.get(`/api/kids/${kidId}/today`);
      setData(d);
    } catch {
      /* offline — keep showing what we have */
    }
    setQueuedCount(queuedTapCount(Number(kidId)));
  }, [kidId]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 20000);
    const stopSync = startQueueSync();
    return () => {
      clearInterval(poll);
      stopSync();
    };
  }, [refresh]);

  if (!data) return <div className="pin-screen">Loading…</div>;

  const theme = THEMES[data.kid.theme] || THEMES.soccer;
  const cssVars = {
    '--card': theme.colors.card,
    '--card-text': theme.colors.cardText,
    '--accent': theme.colors.accent,
    '--accent-text': theme.colors.accentText,
    '--meter-fill': theme.colors.meterFill,
    '--chip': theme.colors.chip,
    '--header-text': theme.colors.headerText,
    background: theme.colors.bg,
  };

  async function onTapTask(task) {
    if (task.status) return;
    // Optimistic: mark pending locally and celebrate right away.
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, status: 'pending' } : t)),
      progress: { ...d.progress, doneCount: d.progress.doneCount + 1 },
    }));
    setCelebrating(true);
    try {
      const result = await tapTask(task.id, Number(kidId));
      if (result.queued) {
        setQueuedCount((n) => n + 1);
      }
    } catch {
      setToast('Hmm, that one didn’t count. Try again!');
      refresh();
    }
  }

  function onMascotTap() {
    // Easter egg: three quick taps on the dino mascot → "ooo wooo".
    if (theme.key !== 'dino') return;
    const now = Date.now();
    mascotTaps.current = [...mascotTaps.current.filter((t) => now - t < 1200), now];
    if (mascotTaps.current.length >= 3) {
      mascotTaps.current = [];
      setEasterEgg(true);
      setTimeout(() => setEasterEgg(false), 2500);
    }
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    tasks: data.tasks.filter((t) => t.category === cat),
  })).filter((g) => g.tasks.length > 0);

  return (
    <div className="kid-home" style={cssVars}>
      <header className="kid-header">
        <span className="mascot" onClick={onMascotTap}>
          {theme.icons.mascot}
        </span>
        <h1>Hi, {data.kid.name}!</h1>
        <button className="home-btn" onClick={() => setShowRewards(true)}>
          🎁 {theme.terms.rewards}
        </button>
        <button className="home-btn" onClick={() => navigate('/')}>
          ⬅ Back
        </button>
      </header>

      {queuedCount > 0 && (
        <div className="offline-banner">
          📡 {queuedCount} tap{queuedCount > 1 ? 's' : ''} saved — will send when back online
        </div>
      )}

      <ProgressMeter theme={theme} progress={data.progress} />

      <div className="panel">
        <h2>My Points</h2>
        <div className="vault-row">
          <div className="vault-box">
            <div className="vault-amount">
              {theme.icons.checking} {data.balances.checking}
            </div>
            <div className="vault-label">{theme.terms.checking}</div>
          </div>
          <div className="vault-box">
            <div className="vault-amount">
              {theme.icons.savings} {data.balances.savings}
            </div>
            <div className="vault-label">{theme.terms.savings}</div>
          </div>
        </div>
        {data.kid.vault_mode === 'manual' && (
          <button className="transfer-btn" onClick={() => setShowTransfer(true)}>
            Move points into my {theme.terms.savings}
          </button>
        )}
        {data.pendingRedemptions.length > 0 && (
          <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>
            ⏳ Waiting for a grown-up:{' '}
            {data.pendingRedemptions.map((r) => `${r.icon} ${r.title}`).join(', ')}
          </div>
        )}
      </div>

      {grouped.map(({ cat, tasks }) => (
        <section key={cat}>
          <div className="category-header">
            <span>{CATEGORY_LABELS[cat].icon}</span>
            {CATEGORY_LABELS[cat].label}
          </div>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} theme={theme} onTap={() => onTapTask(task)} />
          ))}
        </section>
      ))}

      {celebrating && <Celebration theme={theme} onDone={() => setCelebrating(false)} />}
      {easterEgg && <div className="easter-egg-bubble">ooo wooo… DINOS!!! 🦖🦕</div>}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {showRewards && (
        <RewardsModal
          kidId={Number(kidId)}
          theme={theme}
          onClose={() => {
            setShowRewards(false);
            refresh();
          }}
        />
      )}
      {showTransfer && (
        <TransferModal
          kidId={Number(kidId)}
          theme={theme}
          checking={data.balances.checking}
          onClose={() => {
            setShowTransfer(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function TaskCard({ task, theme, onTap }) {
  // Locked cards get a full-width banner so "already tapped today" is
  // unmistakable — a subtle side label read as "broken button" to testers.
  const banner =
    task.status === 'approved'
      ? { cls: 'approved', icon: '✔', label: `${theme.terms.celebration} +${task.point_value} earned` }
      : task.status === 'pending'
        ? { cls: 'pending', icon: '⏳', label: theme.terms.pendingBanner }
        : task.status === 'rejected'
          ? { cls: 'rejected', icon: '✋', label: theme.terms.rejectedBanner }
          : null;

  return (
    <button
      className={`task-card${task.status ? ` status-${task.status}` : ''}`}
      onClick={onTap}
      disabled={!!task.status}
    >
      <span className="task-main">
        <span className="task-icon">{task.icon}</span>
        <span className="task-body">
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            <span className="points-chip">+{task.point_value}</span>
            {task.streak > 0 && (
              <span className="streak-chip">
                {theme.icons.streak} {task.streak} day {theme.terms.streak}
              </span>
            )}
          </div>
        </span>
      </span>
      {banner && (
        <span className={`task-banner ${banner.cls}`}>
          <span className="task-banner-icon">{banner.icon}</span>
          {banner.label}
        </span>
      )}
    </button>
  );
}

function RewardsModal({ kidId, theme, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/kids/${kidId}/rewards`).then(setCatalog).catch(() => setToast('Can’t reach the reward shop right now.'));
  }, [kidId]);

  useEffect(load, [load]);

  async function requestReward(reward) {
    try {
      await api.post('/api/redemptions', { kid_id: kidId, reward_id: reward.id });
      setToast('Sent to a grown-up to approve! ⏳');
      setConfirming(null);
      load();
    } catch (err) {
      setToast(
        err.status ? 'Not enough points for that yet!' : 'Can’t reach the shop — try again in a bit.'
      );
      setConfirming(null);
    }
  }

  return (
    <Modal title={`🎁 ${theme.terms.rewards}`} onClose={onClose}>
      {!catalog ? (
        'Loading…'
      ) : (
        <div className="reward-grid">
          {catalog.rewards.map((r) => (
            <button
              key={r.id}
              className="reward-card"
              disabled={!r.affordable}
              onClick={() => setConfirming(r)}
            >
              <span className="reward-icon">{r.icon}</span>
              <span className="reward-title">{r.title}</span>
              <span className="reward-cost">
                {r.cost} pts · {r.bucket_required === 'savings' ? theme.terms.savings : theme.terms.checking}
              </span>
              {!r.affordable && <span className="reward-locked">Keep earning!</span>}
            </button>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {confirming && (
        <Modal title="Are you sure?" onClose={() => setConfirming(null)}>
          <p style={{ fontSize: 16 }}>
            Trade <strong>{confirming.cost} points</strong> for{' '}
            <strong>
              {confirming.icon} {confirming.title}
            </strong>
            ? A grown-up will approve it.
          </p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setConfirming(null)}>
              No thanks
            </button>
            <button className="btn primary" onClick={() => requestReward(confirming)}>
              Yes! 🎉
            </button>
          </div>
        </Modal>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Modal>
  );
}

function TransferModal({ kidId, theme, checking, onClose }) {
  const [amount, setAmount] = useState(0);
  const [toast, setToast] = useState(null);
  const options = [1, 2, 5, 10].filter((n) => n <= checking);

  async function transfer() {
    try {
      await api.post(`/api/kids/${kidId}/transfer`, { amount });
      onClose();
    } catch {
      setToast('That didn’t work — try again.');
    }
  }

  return (
    <Modal title={`Move points to ${theme.terms.savings}`} onClose={onClose}>
      <p style={{ fontSize: 15 }}>
        You have <strong>{checking}</strong> {theme.terms.checking} points. How many do you want to
        save?
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {options.length === 0 && <em>No points to move yet — go earn some!</em>}
        {options.map((n) => (
          <button
            key={n}
            className={`btn ${amount === n ? 'primary' : 'secondary'}`}
            onClick={() => setAmount(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={amount === 0} onClick={transfer}>
          Save {amount > 0 ? amount : ''} points {theme.icons.savings}
        </button>
      </div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Modal>
  );
}
