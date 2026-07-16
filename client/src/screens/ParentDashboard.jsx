import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, parentApi } from '../api.js';
import { Modal, Toast } from '../components/ui.jsx';

const CATEGORIES = [
  ['morning', 'Morning'],
  ['evening', 'Evening'],
  ['personal_space', 'Personal Space'],
  ['chores', 'Household'],
  ['social_school', 'Social & School'],
];

export default function ParentDashboard() {
  const [pin, setPin] = useState(() => sessionStorage.getItem('parent-pin') || null);
  if (!pin) {
    return (
      <PinScreen
        onVerified={(p) => {
          sessionStorage.setItem('parent-pin', p);
          setPin(p);
        }}
      />
    );
  }
  return <Dashboard pin={pin} onLock={() => {
    sessionStorage.removeItem('parent-pin');
    setPin(null);
  }} />;
}

function PinScreen({ onVerified }) {
  const [entered, setEntered] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Functional update so rapid taps can't clobber each other's digits.
  function press(digit) {
    setError('');
    setEntered((prev) => (prev.length >= 4 ? prev : prev + digit));
  }

  useEffect(() => {
    if (entered.length !== 4) return;
    let alive = true;
    api
      .post('/api/parent/verify', { pin: entered })
      .catch(() => ({ ok: false }))
      .then((res) => {
        if (!alive) return;
        if (res.ok) return onVerified(entered);
        setEntered('');
        setError('Wrong PIN — try again');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered]);

  return (
    <div className="pin-screen">
      <h2>Parent Dashboard</h2>
      <div className="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`pin-dot${i < entered.length ? ' filled' : ''}`} />
        ))}
      </div>
      <div className="pin-error">{error}</div>
      <div className="pin-pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} className="pin-key" onClick={() => press(String(n))}>
            {n}
          </button>
        ))}
        <button className="pin-key" onClick={() => navigate('/')}>
          ✕
        </button>
        <button className="pin-key" onClick={() => press('0')}>
          0
        </button>
        <button className="pin-key" onClick={() => setEntered('')}>
          ⌫
        </button>
      </div>
    </div>
  );
}

function Dashboard({ pin, onLock }) {
  const [tab, setTab] = useState('pending');
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();
  const client = parentApi(pin);

  const notify = (msg) => setToast(msg);

  return (
    <div className="parent-shell">
      <div className="parent-topbar">
        <h1>👨‍👧‍👦 Parent Dashboard</h1>
        <button className="btn secondary" onClick={() => navigate('/')}>
          Kiosk
        </button>
        <button className="btn secondary" onClick={onLock}>
          🔒 Lock
        </button>
      </div>
      <div className="parent-tabs">
        {[
          ['pending', '⏳ Pending'],
          ['tasks', '📋 Tasks'],
          ['rewards', '🎁 Rewards'],
          ['kids', '🏦 Kids & Vaults'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`parent-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="parent-content">
        {tab === 'pending' && <PendingTab client={client} notify={notify} />}
        {tab === 'tasks' && <TasksTab client={client} notify={notify} />}
        {tab === 'rewards' && <RewardsTab client={client} notify={notify} />}
        {tab === 'kids' && <KidsTab client={client} notify={notify} />}
      </div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ---------- Pending queue ----------

function PendingTab({ client, notify }) {
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    client.get('/api/parent/pending').then(setData).catch(() => notify('Failed to load queue'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, [load]);

  async function act(url, okMsg) {
    try {
      await client.post(url);
      notify(okMsg);
    } catch (err) {
      notify(err.message === 'insufficient_points' ? 'Kid can no longer afford this reward' : 'Action failed');
    }
    load();
  }

  if (!data) return 'Loading…';
  const empty = data.completions.length === 0 && data.redemptions.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          className="btn primary"
          disabled={data.completions.length === 0}
          onClick={() => act('/api/parent/approve-all', 'Approved all of today’s tasks')}
        >
          ✅ Quick Approve All ({data.completions.length})
        </button>
        <button className="btn accent" onClick={() => act('/api/parent/undo', 'Undid last approval')}>
          ↩ Undo Last Approval
        </button>
      </div>

      {empty && <p>Nothing waiting for review. 🎉</p>}

      {data.completions.map((c) => (
        <div key={`c${c.id}`} className="pending-item">
          <span className="who">{c.kid_name}</span>
          <span className="what">
            {c.icon} {c.title} <strong>(+{c.point_value})</strong>
            <br />
            <small>{new Date(c.completed_at).toLocaleTimeString()}</small>
          </span>
          <button
            className="icon-btn approve"
            onClick={() => act(`/api/parent/completions/${c.id}/approve`, `Approved: ${c.title}`)}
          >
            ✅
          </button>
          <button
            className="icon-btn reject"
            onClick={() => act(`/api/parent/completions/${c.id}/reject`, `Rejected: ${c.title}`)}
          >
            ❌
          </button>
        </div>
      ))}

      {data.redemptions.length > 0 && <h3>Reward requests</h3>}
      {data.redemptions.map((r) => (
        <div key={`r${r.id}`} className="pending-item">
          <span className="who">{r.kid_name}</span>
          <span className="what">
            {r.icon} {r.title} <strong>(−{r.cost_paid} from {r.bucket_required})</strong>
          </span>
          <button
            className="icon-btn approve"
            onClick={() => act(`/api/parent/redemptions/${r.id}/approve`, `Approved reward: ${r.title}`)}
          >
            ✅
          </button>
          <button
            className="icon-btn reject"
            onClick={() => act(`/api/parent/redemptions/${r.id}/reject`, `Rejected reward: ${r.title}`)}
          >
            ❌
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- Task management ----------

const EMPTY_TASK = { title: '', category: 'morning', point_value: 1, icon: '⭐', kid_id: null };

function TasksTab({ client, notify }) {
  const [tasks, setTasks] = useState(null);
  const [kids, setKids] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    client.get('/api/parent/tasks').then(setTasks).catch(() => notify('Failed to load tasks'));
    client.get('/api/parent/kids').then(setKids).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function save(form) {
    const body = { ...form, point_value: Number(form.point_value), kid_id: form.kid_id ? Number(form.kid_id) : null };
    try {
      if (form.id) await client.patch(`/api/parent/tasks/${form.id}`, body);
      else await client.post('/api/parent/tasks', body);
      notify('Task saved');
      setEditing(null);
      load();
    } catch {
      notify('Could not save task — check the fields');
    }
  }

  async function toggleActive(task) {
    await client.patch(`/api/parent/tasks/${task.id}`, { active: task.active ? 0 : 1 }).catch(() => {});
    load();
  }

  if (!tasks) return 'Loading…';

  return (
    <div>
      <button className="btn primary" style={{ marginBottom: 14 }} onClick={() => setEditing({ ...EMPTY_TASK })}>
        ➕ Add Task
      </button>
      <div style={{ overflowX: 'auto' }}>
        <table className="mgmt-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Category</th>
              <th>Pts</th>
              <th>Who</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className={t.active ? '' : 'inactive'}>
                <td>
                  {t.icon} {t.title}
                </td>
                <td>{CATEGORIES.find(([k]) => k === t.category)?.[1]}</td>
                <td>{t.point_value}</td>
                <td>{t.kid_id ? kids.find((k) => k.id === t.kid_id)?.name || t.kid_id : 'Both'}</td>
                <td>
                  <button className="btn secondary" onClick={() => setEditing({ ...t })}>
                    Edit
                  </button>
                </td>
                <td>
                  <button className="btn secondary" onClick={() => toggleActive(t)}>
                    {t.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <TaskForm task={editing} kids={kids} onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TaskForm({ task, kids, onSave, onClose }) {
  const [form, setForm] = useState(task);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title={form.id ? 'Edit Task' : 'Add Task'} onClose={onClose}>
      <div className="form-grid">
        <label>
          Title
          <input value={form.title} onChange={set('title')} />
        </label>
        <label>
          Category
          <select value={form.category} onChange={set('category')}>
            {CATEGORIES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Point value (1 = easy, 2 = standard, 3 = big effort)
          <input type="number" min="1" max="10" value={form.point_value} onChange={set('point_value')} />
        </label>
        <label>
          Icon (emoji)
          <input value={form.icon} onChange={set('icon')} />
        </label>
        <label>
          Applies to
          <select value={form.kid_id ?? ''} onChange={(e) => setForm({ ...form, kid_id: e.target.value || null })}>
            <option value="">Both kids</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} only
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onSave(form)}>
          Save
        </button>
      </div>
    </Modal>
  );
}

// ---------- Rewards management ----------

const EMPTY_REWARD = { title: '', cost: 10, bucket_required: 'checking', icon: '🎁', kid_id: null };

function RewardsTab({ client, notify }) {
  const [rewards, setRewards] = useState(null);
  const [kids, setKids] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    client.get('/api/parent/rewards').then(setRewards).catch(() => notify('Failed to load rewards'));
    client.get('/api/parent/kids').then(setKids).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function save(form) {
    const body = { ...form, cost: Number(form.cost), kid_id: form.kid_id ? Number(form.kid_id) : null };
    try {
      if (form.id) await client.patch(`/api/parent/rewards/${form.id}`, body);
      else await client.post('/api/parent/rewards', body);
      notify('Reward saved');
      setEditing(null);
      load();
    } catch {
      notify('Could not save reward — check the fields');
    }
  }

  async function toggleActive(reward) {
    await client.patch(`/api/parent/rewards/${reward.id}`, { active: reward.active ? 0 : 1 }).catch(() => {});
    load();
  }

  if (!rewards) return 'Loading…';

  return (
    <div>
      <button className="btn primary" style={{ marginBottom: 14 }} onClick={() => setEditing({ ...EMPTY_REWARD })}>
        ➕ Add Reward
      </button>
      <div style={{ overflowX: 'auto' }}>
        <table className="mgmt-table">
          <thead>
            <tr>
              <th>Reward</th>
              <th>Cost</th>
              <th>Vault</th>
              <th>Who</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rewards.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'inactive'}>
                <td>
                  {r.icon} {r.title}
                </td>
                <td>{r.cost}</td>
                <td>{r.bucket_required}</td>
                <td>{r.kid_id ? kids.find((k) => k.id === r.kid_id)?.name || r.kid_id : 'Both'}</td>
                <td>
                  <button className="btn secondary" onClick={() => setEditing({ ...r })}>
                    Edit
                  </button>
                </td>
                <td>
                  <button className="btn secondary" onClick={() => toggleActive(r)}>
                    {r.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <RewardForm reward={editing} kids={kids} onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function RewardForm({ reward, kids, onSave, onClose }) {
  const [form, setForm] = useState(reward);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title={form.id ? 'Edit Reward' : 'Add Reward'} onClose={onClose}>
      <div className="form-grid">
        <label>
          Title
          <input value={form.title} onChange={set('title')} />
        </label>
        <label>
          Cost (points)
          <input type="number" min="1" value={form.cost} onChange={set('cost')} />
        </label>
        <label>
          Draws from vault
          <select value={form.bucket_required} onChange={set('bucket_required')}>
            <option value="checking">Checking (spending)</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label>
          Icon (emoji)
          <input value={form.icon} onChange={set('icon')} />
        </label>
        <label>
          Available to
          <select value={form.kid_id ?? ''} onChange={(e) => setForm({ ...form, kid_id: e.target.value || null })}>
            <option value="">Both kids</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} only
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onSave(form)}>
          Save
        </button>
      </div>
    </Modal>
  );
}

// ---------- Kids, vaults & history ----------

function KidsTab({ client, notify }) {
  const [kids, setKids] = useState(null);
  const [history, setHistory] = useState(null); // { kid, data }

  const load = useCallback(() => {
    client.get('/api/parent/kids').then(setKids).catch(() => notify('Failed to load kids'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function updateVault(kid, patch) {
    try {
      await client.patch(`/api/parent/kids/${kid.id}`, patch);
      notify(`${kid.name}'s vault settings updated`);
    } catch {
      notify('Update failed');
    }
    load();
  }

  async function showHistory(kid) {
    const data = await client.get(`/api/parent/kids/${kid.id}/history`).catch(() => null);
    if (data) setHistory({ kid, data });
  }

  if (!kids) return 'Loading…';

  return (
    <div>
      {kids.map((kid) => (
        <div key={kid.id} className="pending-item" style={{ alignItems: 'flex-start' }}>
          <span style={{ fontSize: 34 }}>{kid.avatar_icon}</span>
          <span className="what">
            <strong style={{ fontSize: 17 }}>
              {kid.name} (age {kid.age})
            </strong>
            <br />
            💰 Checking: <strong>{kid.balances.checking}</strong> · 🏦 Savings:{' '}
            <strong>{kid.balances.savings}</strong>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontWeight: 700, fontSize: 14 }}>
                Vault mode:{' '}
                <select
                  value={kid.vault_mode}
                  onChange={(e) => updateVault(kid, { vault_mode: e.target.value })}
                  style={{ fontSize: 15, padding: 8 }}
                >
                  <option value="manual">Manual (kid moves points)</option>
                  <option value="auto_split">Auto-split earnings</option>
                </select>
              </label>
              {kid.vault_mode === 'auto_split' && (
                <label style={{ fontWeight: 700, fontSize: 14 }}>
                  Checking share:{' '}
                  <select
                    value={String(kid.auto_split_ratio)}
                    onChange={(e) => updateVault(kid, { auto_split_ratio: Number(e.target.value) })}
                    style={{ fontSize: 15, padding: 8 }}
                  >
                    {[0.5, 0.6, 0.7, 0.8, 0.9].map((r) => (
                      <option key={r} value={String(r)}>
                        {Math.round(r * 100)}% / {Math.round((1 - r) * 100)}% savings
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </span>
          <button className="btn secondary" onClick={() => showHistory(kid)}>
            📜 History
          </button>
        </div>
      ))}

      {history && (
        <Modal title={`${history.kid.name}'s history`} onClose={() => setHistory(null)}>
          <div className="history-list">
            {history.data.completions.length === 0 && <p>No activity yet.</p>}
            {history.data.completions.map((c) => (
              <div key={c.id} className="history-row">
                <span>{c.date}</span>
                <span style={{ flex: 1 }}>
                  {c.icon} {c.title} (+{c.point_value})
                </span>
                <span className={`status-pill ${c.status}`}>{c.status}</span>
              </div>
            ))}
            {history.data.redemptions.length > 0 && <h4>Rewards</h4>}
            {history.data.redemptions.map((r) => (
              <div key={r.id} className="history-row">
                <span>{r.redeemed_at.slice(0, 10)}</span>
                <span style={{ flex: 1 }}>
                  {r.icon} {r.title} (−{r.cost_paid})
                </span>
                <span className={`status-pill ${r.status}`}>{r.status}</span>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setHistory(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
