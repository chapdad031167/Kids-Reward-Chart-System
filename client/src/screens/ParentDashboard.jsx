import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, parentApi } from '../api.js';
import { Modal, Toast } from '../components/ui.jsx';
import EmojiPicker from '../components/EmojiPicker.jsx';
import { CodePicker, CODE_LENGTH, CODE_EMOJIS } from '../components/KidCode.jsx';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleSummary(days) {
  if (!days) return 'Every day';
  if (days === '12345') return 'Weekdays';
  if (days === '06') return 'Weekends';
  return days.split('').sort().map((d) => DAY_LABELS[Number(d)]).join(', ');
}

/** Day-of-week chips; null = every day, at least one day always selected. */
function DayPicker({ value, onChange }) {
  const selected = value == null ? new Set(['0', '1', '2', '3', '4', '5', '6']) : new Set(value.split(''));
  function toggle(d) {
    const next = new Set(selected);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    if (next.size === 0) return;
    onChange(next.size === 7 ? null : [...next].sort().join(''));
  }
  return (
    <div className="day-chips">
      {DAY_LABELS.map((label, i) => (
        <button
          type="button"
          key={label}
          className={`day-chip${selected.has(String(i)) ? ' on' : ''}`}
          onClick={() => toggle(String(i))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

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

  // Physical keyboard works too: digits type, Backspace/Delete erase.
  useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        setError('');
        setEntered((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  const [vacation, setVacation] = useState(null); // {on, since}
  const [confirmingVacation, setConfirmingVacation] = useState(false);
  const navigate = useNavigate();
  const client = parentApi(pin);

  const notify = (msg) => setToast(msg);

  useEffect(() => {
    client.get('/api/parent/vacation').then(setVacation).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleVacation(on) {
    try {
      const state = await client.post('/api/parent/vacation', { on });
      setVacation(state);
      notify(on ? 'Vacation mode is ON — tasks paused, streaks frozen' : 'Welcome back! Routines resume today');
    } catch {
      notify('Could not update vacation mode');
    }
    setConfirmingVacation(false);
  }

  return (
    <div className="parent-shell">
      <div className="parent-topbar">
        <h1>👨‍👧‍👦 Parent Dashboard</h1>
        {vacation && (
          <button
            className={`btn ${vacation.on ? 'accent' : 'secondary'}`}
            onClick={() => (vacation.on ? toggleVacation(false) : setConfirmingVacation(true))}
          >
            🏖️ Vacation: {vacation.on ? 'ON' : 'OFF'}
          </button>
        )}
        <button className="btn secondary" onClick={() => navigate('/')}>
          Kiosk
        </button>
        <button className="btn secondary" onClick={onLock}>
          🔒 Lock
        </button>
      </div>
      {vacation?.on && (
        <div className="vacation-banner">
          🏖️ Vacation mode since {vacation.since} — kid task lists are paused and streaks are
          frozen. Turn it off the morning routines resume.
        </div>
      )}
      {confirmingVacation && (
        <Modal title="🏖️ Turn on Vacation Mode?" onClose={() => setConfirmingVacation(false)}>
          <p style={{ fontSize: 15, lineHeight: 1.5 }}>
            While vacation mode is on: the kids' task lists are <strong>paused</strong> (no
            tapping, no mystery challenges), and <strong>streaks freeze</strong> — the days away
            won't count as missed, so every streak picks up right where it left off when you
            turn this off. Points and the reward shop stay available.
          </p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setConfirmingVacation(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => toggleVacation(true)}>
              Start vacation 🏖️
            </button>
          </div>
        </Modal>
      )}
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
  const empty =
    data.completions.length === 0 &&
    data.redemptions.length === 0 &&
    (data.toDeliver || []).length === 0;

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
            {c.is_bonus ? '✨ ' : ''}{c.icon} {c.title} <strong>(+{c.point_value})</strong>
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

      {(data.toDeliver || []).length > 0 && <h3>🎁 To deliver (approved, not yet given)</h3>}
      {(data.toDeliver || []).map((r) => (
        <div key={`d${r.id}`} className="pending-item">
          <span className="who">{r.kid_name}</span>
          <span className="what">
            {r.icon} {r.title}
            <br />
            <small>approved {new Date(r.reviewed_at).toLocaleDateString()}</small>
          </span>
          <button
            className="btn primary"
            onClick={() => act(`/api/parent/redemptions/${r.id}/fulfill`, `Delivered: ${r.title} 🎉`)}
          >
            ✓ Delivered
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- Task management ----------

function TasksTab({ client, notify }) {
  const [tasks, setTasks] = useState(null);
  const [kids, setKids] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [managingCategories, setManagingCategories] = useState(false);

  const load = useCallback(() => {
    client.get('/api/parent/tasks').then(setTasks).catch(() => notify('Failed to load tasks'));
    client.get('/api/parent/kids').then(setKids).catch(() => {});
    client.get('/api/parent/categories').then(setCategories).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function save(form) {
    const body = {
      ...form,
      point_value: Number(form.point_value),
      category_id: Number(form.category_id),
      kid_id: form.kid_id ? Number(form.kid_id) : null,
    };
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
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          className="btn primary"
          onClick={() => setEditing({ title: '', category_id: categories[0]?.id ?? 1, point_value: 1, icon: '⭐', kid_id: null, is_bonus: 0, days: null })}
        >
          ➕ Add Task
        </button>
        <button className="btn secondary" onClick={() => setManagingCategories(true)}>
          🏷️ Manage Categories
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="mgmt-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Category</th>
              <th>When</th>
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
                  {t.is_bonus ? '✨ ' : ''}{t.icon} {t.title}
                </td>
                <td>{categories.find((c) => c.id === t.category_id)?.label || '—'}</td>
                <td>{t.is_bonus ? '✨ Mystery' : scheduleSummary(t.days)}</td>
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
        <TaskForm task={editing} kids={kids} categories={categories} onSave={save} onClose={() => setEditing(null)} />
      )}
      {managingCategories && (
        <CategoryManager
          client={client}
          notify={notify}
          onClose={() => {
            setManagingCategories(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CategoryManager({ client, notify, onClose }) {
  const [categories, setCategories] = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('📋');

  const load = useCallback(() => {
    client.get('/api/parent/categories').then(setCategories).catch(() => notify('Failed to load categories'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function saveRow(cat) {
    try {
      await client.patch(`/api/parent/categories/${cat.id}`, { label: cat.label, icon: cat.icon });
      notify(`Saved "${cat.label}"`);
    } catch {
      notify('Could not save — the name can’t be empty');
    }
    load();
  }

  async function add() {
    try {
      await client.post('/api/parent/categories', { label: newLabel, icon: newIcon });
      notify(`Added "${newLabel}"`);
      setNewLabel('');
      setNewIcon('📋');
      load();
    } catch {
      notify('Could not add — give it a name first');
    }
  }

  return (
    <Modal title="🏷️ Task Categories" onClose={onClose}>
      <p style={{ fontSize: 14, color: '#4a5568' }}>
        Rename a category or change its icon — the kids' screens update right away. Categories
        with tasks can't be deleted, but you can move their tasks elsewhere and stop using them.
      </p>
      {!categories
        ? 'Loading…'
        : categories.map((cat, i) => (
            <div key={cat.id} className="category-row">
              <EmojiPicker
                value={cat.icon}
                onChange={(icon) => setCategories(categories.map((c, j) => (j === i ? { ...c, icon } : c)))}
              />
              <input
                value={cat.label}
                onChange={(e) => setCategories(categories.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)))}
              />
              <button className="btn secondary" onClick={() => saveRow(cat)}>
                Save
              </button>
            </div>
          ))}
      <h4 style={{ marginBottom: 8 }}>Add a category</h4>
      <div className="category-row">
        <EmojiPicker value={newIcon} onChange={setNewIcon} />
        <input placeholder="e.g. Weekend Jobs" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        <button className="btn primary" onClick={add}>
          Add
        </button>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function TaskForm({ task, kids, categories, onSave, onClose }) {
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
          <select value={form.category_id} onChange={set('category_id')}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Point value (1 = easy, 2 = standard, 3 = big effort)
          <input type="number" min="1" max="10" value={form.point_value} onChange={set('point_value')} />
        </label>
        <label>
          Icon
          <EmojiPicker value={form.icon} onChange={(icon) => setForm({ ...form, icon })} />
        </label>
        {!form.is_bonus && (
          <label>
            Which days? ({scheduleSummary(form.days)})
            <DayPicker value={form.days} onChange={(days) => setForm({ ...form, days })} />
          </label>
        )}
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
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={!!form.is_bonus}
            onChange={(e) => setForm({ ...form, is_bonus: e.target.checked ? 1 : 0 })}
            style={{ width: 22, height: 22 }}
          />
          ✨ Mystery bonus task — hidden from the daily list; appears randomly as the
          mystery challenge
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
          Icon
          <EmojiPicker value={form.icon} onChange={(icon) => setForm({ ...form, icon })} />
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
  const [adjusting, setAdjusting] = useState(null); // kid
  const [resetting, setResetting] = useState(null); // kid
  const [settingCode, setSettingCode] = useState(null); // kid
  const [backups, setBackups] = useState([]);
  const [awarding, setAwarding] = useState(false);

  const load = useCallback(() => {
    client.get('/api/parent/kids').then(setKids).catch(() => notify('Failed to load kids'));
    client.get('/api/parent/backups').then(setBackups).catch(() => {});
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

  async function adjust(kid, bucket, amount) {
    try {
      await client.post(`/api/parent/kids/${kid.id}/adjust`, { bucket, amount });
      notify(`${kid.name}: ${amount > 0 ? '+' : ''}${amount} ${bucket}`);
      setAdjusting(null);
      load();
    } catch (err) {
      notify(
        err.message === 'insufficient_points'
          ? 'Not enough points in that vault to remove'
          : 'Adjustment failed — check the amount'
      );
    }
  }

  async function resetDay(kid) {
    try {
      const result = await client.post(`/api/parent/kids/${kid.id}/reset-day`);
      notify(`Cleared ${result.cleared} of today's completions for ${kid.name}`);
    } catch {
      notify('Reset failed');
    }
    setResetting(null);
    load();
  }

  if (!kids) return 'Loading…';

  return (
    <div>
      <button className="btn primary" style={{ marginBottom: 14 }} onClick={() => setAwarding(true)}>
        🎁 Bonus award
      </button>

      {awarding && (
        <AwardModal
          kids={kids}
          client={client}
          notify={notify}
          onClose={() => {
            setAwarding(false);
            load();
          }}
        />
      )}

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
          <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn secondary" onClick={() => showHistory(kid)}>
              📜 History
            </button>
            <button className="btn secondary" onClick={() => setAdjusting(kid)}>
              ⚖️ Adjust points
            </button>
            <button className="btn secondary" onClick={() => setSettingCode(kid)}>
              🔒 Secret code{kid.secret_code ? `: ${kid.secret_code}` : ': none'}
            </button>
            <button className="btn danger" onClick={() => setResetting(kid)}>
              🧹 Reset today
            </button>
          </span>
        </div>
      ))}

      {adjusting && (
        <AdjustModal kid={adjusting} onSave={adjust} onClose={() => setAdjusting(null)} />
      )}

      {settingCode && (
        <SecretCodeModal
          kid={settingCode}
          client={client}
          notify={notify}
          onClose={() => {
            setSettingCode(null);
            load();
          }}
        />
      )}

      {resetting && (
        <Modal title={`Reset ${resetting.name}'s day?`} onClose={() => setResetting(null)}>
          <p style={{ fontSize: 15, lineHeight: 1.5 }}>
            This clears <strong>all of {resetting.name}'s completions from today</strong> — pending
            and approved — takes back any points they earned today, and rewinds streaks as if
            today hadn't been tapped yet. It also clears the undo history. Use this to fix a day
            that went wrong (accidental taps, wrong kid selected).
          </p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setResetting(null)}>
              Cancel
            </button>
            <button className="btn danger" style={{ flex: 1 }} onClick={() => resetDay(resetting)}>
              Yes, reset today
            </button>
          </div>
        </Modal>
      )}

      {history && (
        <HistoryModal history={history} onClose={() => setHistory(null)} />
      )}

      <div className="pending-item" style={{ alignItems: 'flex-start', marginTop: 18 }}>
        <span style={{ fontSize: 28 }}>💾</span>
        <span className="what">
          <strong>Backups</strong> — automatic nightly snapshot at 3:15am (kept:{' '}
          {backups.length}); stored in the data folder alongside the database.
          <div style={{ marginTop: 6, fontSize: 13, color: '#4a5568' }}>
            {backups.length === 0
              ? 'No backups yet — the first one is written on boot.'
              : `Latest: ${backups[0].file} (${Math.round(backups[0].size / 1024)} KB)`}
          </div>
        </span>
        <button
          className="btn secondary"
          onClick={async () => {
            try {
              const r = await client.post('/api/parent/backups');
              notify(`Backup written: ${r.file}`);
            } catch {
              notify('Backup failed — check server logs');
            }
            load();
          }}
        >
          Back up now
        </button>
      </div>
    </div>
  );
}

function AwardModal({ kids, client, notify, onClose }) {
  const [selected, setSelected] = useState(new Set(kids.map((k) => k.id)));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed > 0 && selected.size > 0;

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function award() {
    try {
      await client.post('/api/parent/award', {
        kid_ids: [...selected],
        amount: parsed,
        note,
      });
      notify(`Awarded +${parsed} to ${kids.filter((k) => selected.has(k.id)).map((k) => k.name).join(' & ')} 🎁`);
      onClose();
    } catch {
      notify('Award failed — check the amount');
    }
  }

  return (
    <Modal title="🎁 Bonus award" onClose={onClose}>
      <p style={{ fontSize: 14, color: '#4a5568' }}>
        Points for something outside the chart ("helped unload the camping gear"). Each kid's
        vault rules apply — auto-split kids split it, manual kids get it as spending.
      </p>
      <div className="form-grid">
        <label>
          Who gets it?
          <span style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {kids.map((k) => (
              <button
                type="button"
                key={k.id}
                className={`btn ${selected.has(k.id) ? 'primary' : 'secondary'}`}
                onClick={() => toggle(k.id)}
              >
                {k.avatar_icon} {k.name}
              </button>
            ))}
          </span>
        </label>
        <label>
          Points
          <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5" />
        </label>
        <label>
          What for? (shows in history)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="helped with the camping gear" />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid} onClick={award}>
          Award {valid ? `+${parsed}` : ''} 🎁
        </button>
      </div>
    </Modal>
  );
}

function countCodeEmojis(str) {
  let rest = str || '';
  let n = 0;
  while (rest.length > 0) {
    const match = CODE_EMOJIS.find((e) => rest.startsWith(e));
    if (!match) break;
    n++;
    rest = rest.slice(match.length);
  }
  return n;
}

function SecretCodeModal({ kid, client, notify, onClose }) {
  const [code, setCode] = useState('');
  const pickedCount = countCodeEmojis(code);

  async function save(newCode) {
    try {
      await client.patch(`/api/parent/kids/${kid.id}`, { secret_code: newCode });
      notify(newCode ? `${kid.name}'s secret code is set` : `${kid.name}'s code removed`);
      onClose();
    } catch {
      notify('Could not save the code');
    }
  }

  return (
    <Modal title={`🔒 ${kid.name}'s secret code`} onClose={onClose}>
      <p style={{ fontSize: 14, color: '#4a5568' }}>
        {kid.secret_code
          ? `Current code: ${kid.secret_code}. Pick 3 emoji below to change it.`
          : `No code yet — ${kid.name}'s screen opens with one tap. Pick 3 emoji in order to lock it.`}{' '}
        The kid taps the same 3, in the same order, to open their screen.
      </p>
      <CodePicker value={code} onChange={setCode} />
      <div className="modal-actions">
        {kid.secret_code && (
          <button className="btn danger" onClick={() => save(null)}>
            Remove code
          </button>
        )}
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={pickedCount < CODE_LENGTH} onClick={() => save(code)}>
          Save code
        </button>
      </div>
    </Modal>
  );
}

function AdjustModal({ kid, onSave, onClose }) {
  const [bucket, setBucket] = useState('checking');
  const [amount, setAmount] = useState('');
  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed !== 0;

  return (
    <Modal title={`Adjust ${kid.name}'s points`} onClose={onClose}>
      <p style={{ fontSize: 14, color: '#4a5568' }}>
        Current: 💰 {kid.balances.checking} checking · 🏦 {kid.balances.savings} savings.
        Positive adds points, negative removes them. Shows in history as an adjustment.
      </p>
      <div className="form-grid">
        <label>
          Vault
          <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="checking">Checking (spending)</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label>
          Amount (e.g. 5 or -3)
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave(kid, bucket, parsed)}>
          Apply
        </button>
      </div>
    </Modal>
  );
}

function HistoryModal({ history, onClose }) {
  return (
    <Modal title={`${history.kid.name}'s history`} onClose={onClose}>
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
        <button className="btn secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
