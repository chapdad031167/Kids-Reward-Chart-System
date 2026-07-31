import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, parentApi } from '../api.js';
import { useIdleTimer } from '../hooks.js';
import { Modal, Toast } from '../components/ui.jsx';
import EmojiPicker from '../components/EmojiPicker.jsx';
import { CodePicker, CODE_LENGTH, CODE_EMOJIS } from '../components/KidCode.jsx';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Idle time before the parent dashboard locks itself back up. */
const PARENT_IDLE_MS = 5 * 60 * 1000;

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

export default function ParentDashboard({ onAppNameChange }) {
  const [pin, setPin] = useState(() => sessionStorage.getItem('parent-pin') || null);
  // Stable so it can be a dependency of the dashboard's idle timer and API
  // wrapper without re-arming them on every render.
  const lock = useCallback(() => {
    sessionStorage.removeItem('parent-pin');
    setPin(null);
  }, []);

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
  return <Dashboard pin={pin} onAppNameChange={onAppNameChange} onLock={lock} />;
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
      .then((res) => {
        if (!alive) return;
        if (res.ok) return onVerified(entered);
        setEntered('');
        setError(
          res.retry_after_s
            ? `Too many tries — wait ${res.retry_after_s}s`
            : 'Wrong PIN — try again'
        );
      })
      .catch((err) => {
        if (!alive) return;
        setEntered('');
        // 429 is the brute-force guard; anything else is the server being
        // unreachable, which shouldn't read as a wrong PIN.
        if (err.status === 429) setError('Too many tries — wait a moment');
        else setError('Could not reach the chart — try again');
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

function Dashboard({ pin, onLock, onAppNameChange }) {
  const [tab, setTab] = useState('pending');
  const [toast, setToast] = useState(null);
  const [vacation, setVacation] = useState(null); // {on, since}
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmingVacation, setConfirmingVacation] = useState(false);
  const navigate = useNavigate();

  // A parent request coming back 401 means this session's PIN is dead — most
  // often because it was changed on another device. Drop back to the keypad
  // instead of letting the 15s queue poll keep retrying it: those retries
  // count as failed attempts against the brute-force guard, and five of them
  // would lock the family out of their own dashboard. 429 means the guard has
  // already tripped, so stop hammering it and let the parent see the wait.
  const client = useMemo(() => {
    const raw = parentApi(pin);
    const guard = (p) =>
      p.catch((err) => {
        if (err.status === 401 || err.status === 429) onLock();
        throw err;
      });
    return {
      get: (url) => guard(raw.get(url)),
      post: (url, body) => guard(raw.post(url, body)),
      patch: (url, body) => guard(raw.patch(url, body)),
      delete: (url) => guard(raw.delete(url)),
      blob: (url) => guard(raw.blob(url)),
    };
  }, [pin, onLock]);

  const notify = (msg) => setToast(msg);

  // The kiosk tab is never closed, so a dashboard left open is a dashboard
  // any kid can walk into. Lock it back up after a few idle minutes and
  // return to the avatar screen, the same way the kid screens bounce back.
  const lockAndLeave = useCallback(() => {
    onLock();
    navigate('/');
  }, [onLock, navigate]);
  useIdleTimer(lockAndLeave, PARENT_IDLE_MS);

  useEffect(() => {
    client.get('/api/parent/vacation').then(setVacation).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Count on the tab itself, so a parent sitting on Tasks or Settings still
  // sees that work is waiting. Polled here rather than in PendingTab, which
  // only exists while that tab is open.
  useEffect(() => {
    const load = () =>
      client
        .get('/api/parent/pending')
        .then((d) => setPendingCount(d.completions.length + d.redemptions.length))
        .catch(() => {});
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
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
        <button className="btn secondary" onClick={lockAndLeave}>
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
          ['settings', '⚙️ Settings'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`parent-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'pending' && pendingCount > 0 && (
              <span className="tab-badge" aria-label={`${pendingCount} waiting`}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="parent-content">
        {tab === 'pending' && <PendingTab client={client} notify={notify} />}
        {tab === 'tasks' && <TasksTab client={client} notify={notify} />}
        {tab === 'rewards' && <RewardsTab client={client} notify={notify} />}
        {tab === 'kids' && <KidsTab client={client} notify={notify} />}
        {tab === 'settings' && (
          <SettingsTab client={client} notify={notify} onAppNameChange={onAppNameChange} />
        )}
      </div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ---------- Settings ----------

function SettingsTab({ client, notify, onAppNameChange }) {
  const [appName, setAppName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [usingDefaultPin, setUsingDefaultPin] = useState(false);
  const [pin, setPinValue] = useState('');
  const [pin2, setPin2] = useState('');
  const [publicUrl, setPublicUrl] = useState('');

  const load = useCallback(() => {
    client
      .get('/api/parent/settings')
      .then((s) => {
        setAppName(s.appName);
        setUsingDefaultPin(!!s.usingDefaultPin);
        setPublicUrl(s.publicUrl || '');
        setLoaded(true);
      })
      .catch(() => notify('Failed to load settings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  async function saveName() {
    try {
      await client.post('/api/parent/settings', { appName: appName.trim() });
      notify('Chart name updated');
      onAppNameChange?.();
    } catch {
      notify('Could not save the name');
    }
  }

  async function savePublicUrl() {
    try {
      const r = await client.post('/api/parent/settings', { publicUrl: publicUrl.trim() });
      setPublicUrl(r.publicUrl || '');
      notify(r.publicUrl ? 'Approve buttons enabled in notifications' : 'Approve buttons turned off');
    } catch {
      notify('That does not look like a URL — include http:// or https://');
    }
  }

  async function savePin() {
    if (!/^\d{4}$/.test(pin) || pin !== pin2) {
      notify('Enter a 4-digit PIN twice, matching');
      return;
    }
    try {
      await client.post('/api/parent/pin', { pin });
      // The PIN this session authenticated with is now stale.
      sessionStorage.setItem('parent-pin', pin);
      setUsingDefaultPin(pin === '1234');
      setPinValue('');
      setPin2('');
      notify('PIN changed');
    } catch {
      notify('Could not change PIN');
    }
  }

  if (!loaded) return 'Loading…';

  return (
    <div>
      {usingDefaultPin && (
        <div className="settings-warning">
          <strong>⚠️ This chart is still using the default PIN (1234).</strong>
          <div>
            It's published in the setup docs, so anyone who knows the app can open this
            dashboard. Pick your own below.
          </div>
        </div>
      )}
      <h3 style={{ marginTop: 0 }}>Chart name</h3>
      <p style={{ fontSize: 14, color: '#4a5568' }}>Shown on the kids' home screen and the browser tab.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <input
          value={appName}
          maxLength={60}
          onChange={(e) => setAppName(e.target.value)}
          style={{ flex: 1, minWidth: 200, fontSize: 16, padding: 12, border: '1px solid #cbd5e0', borderRadius: 10 }}
        />
        <button className="btn primary" disabled={!appName.trim()} onClick={saveName}>
          Save name
        </button>
      </div>

      <h3>Approve from your phone</h3>
      <p style={{ fontSize: 14, color: '#4a5568' }}>
        The address your phone can reach this chart on — usually the Tailscale one. Setting it
        puts <strong>Approve</strong> and <strong>Not yet</strong> buttons directly in the ntfy
        notification, so you can approve from anywhere without opening the dashboard. Leave it
        blank to turn the buttons off. See "Remote access" in the README for the 10-minute setup.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <input
          value={publicUrl}
          placeholder="http://chart-server:8090"
          onChange={(e) => setPublicUrl(e.target.value)}
          style={{ flex: 1, minWidth: 220, fontSize: 16, padding: 12, border: '1px solid #cbd5e0', borderRadius: 10 }}
        />
        <button className="btn primary" onClick={savePublicUrl}>
          Save address
        </button>
      </div>

      <h3>Parent PIN</h3>
      <p style={{ fontSize: 14, color: '#4a5568' }}>Change the 4-digit code that opens this dashboard.</p>
      <div className="form-grid" style={{ maxWidth: 320 }}>
        <label>
          New PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label>
          Confirm PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!/^\d{4}$/.test(pin) || pin !== pin2} onClick={savePin}>
          Change PIN
        </button>
      </div>
    </div>
  );
}

// ---------- Pending queue ----------

function PendingTab({ client, notify }) {
  const [data, setData] = useState(null);
  // Yesterday's taps stay approvable through today, so say which day a row is
  // from — approving it credits that day and keeps the streak intact.
  const todayKey = new Date().toLocaleDateString('en-CA');
  // Reject sits next to approve and isn't covered by undo, so it asks first.
  const [confirmingReject, setConfirmingReject] = useState(null);

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
  const rejected = data.rejected || [];
  const empty =
    data.completions.length === 0 &&
    data.redemptions.length === 0 &&
    rejected.length === 0 &&
    (data.toDeliver || []).length === 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          className="btn primary"
          disabled={data.completions.length === 0}
          onClick={() => act('/api/parent/approve-all', 'Approved everything waiting')}
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
            {c.date !== todayKey && <span className="day-tag">Yesterday</span>}
            <br />
            <small>{new Date(c.completed_at).toLocaleTimeString()}</small>
          </span>
          <button
            className="icon-btn approve"
            aria-label={`Approve ${c.title} for ${c.kid_name}`}
            onClick={() => act(`/api/parent/completions/${c.id}/approve`, `Approved: ${c.title}`)}
          >
            ✅
          </button>
          <button
            className="icon-btn reject"
            aria-label={`Reject ${c.title} for ${c.kid_name}`}
            onClick={() => setConfirmingReject(c)}
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
            aria-label={`Approve reward ${r.title} for ${r.kid_name}`}
            onClick={() => act(`/api/parent/redemptions/${r.id}/approve`, `Approved reward: ${r.title}`)}
          >
            ✅
          </button>
          <button
            className="icon-btn reject"
            aria-label={`Reject reward ${r.title} for ${r.kid_name}`}
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

      {rejected.length > 0 && <h3>↩ Sent back</h3>}
      {rejected.map((c) => (
        <div key={`x${c.id}`} className="pending-item">
          <span className="who">{c.kid_name}</span>
          <span className="what">
            {c.icon} {c.title}
            {c.date !== todayKey && <span className="day-tag">Yesterday</span>}
            <br />
            <small>rejected {new Date(c.reviewed_at).toLocaleTimeString()}</small>
          </span>
          <button
            className="btn secondary"
            aria-label={`Let ${c.kid_name} redo ${c.title}`}
            onClick={() => act(`/api/parent/completions/${c.id}/reopen`, `${c.kid_name} can redo ${c.title}`)}
          >
            Let them redo it
          </button>
        </div>
      ))}

      {confirmingReject && (
        <Modal title="Reject this?" onClose={() => setConfirmingReject(null)}>
          <p>
            Send back <strong>{confirmingReject.title}</strong> for{' '}
            <strong>{confirmingReject.kid_name}</strong>? They won't get the{' '}
            {confirmingReject.point_value} points.
          </p>
          <p style={{ fontSize: 14, color: '#4a5568' }}>
            Undo doesn't cover rejections, but you can put it back from the "Sent back" list below.
          </p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setConfirmingReject(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={() => {
                const c = confirmingReject;
                setConfirmingReject(null);
                act(`/api/parent/completions/${c.id}/reject`, `Rejected: ${c.title}`);
              }}
            >
              Reject
            </button>
          </div>
        </Modal>
      )}
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
                <td>{t.kid_id ? kids.find((k) => k.id === t.kid_id)?.name || t.kid_id : 'All kids'}</td>
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
            <option value="">All kids</option>
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
                <td>{r.kid_id ? kids.find((k) => k.id === r.kid_id)?.name || r.kid_id : 'All kids'}</td>
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
            <option value="">All kids</option>
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
  const [familyGoal, setFamilyGoalState] = useState(null);
  const [editingFamilyGoal, setEditingFamilyGoal] = useState(false);
  const [digestPreview, setDigestPreview] = useState(null);
  const [addingKid, setAddingKid] = useState(false);
  const [clearingBadges, setClearingBadges] = useState(null); // kid
  const [removingKid, setRemovingKid] = useState(null); // kid
  const [editingAvatar, setEditingAvatar] = useState(null); // kid
  const [freshStarting, setFreshStarting] = useState(false);

  const load = useCallback(() => {
    client.get('/api/parent/kids').then(setKids).catch(() => notify('Failed to load kids'));
    client.get('/api/parent/backups').then(setBackups).catch(() => {});
    client.get('/api/parent/family-goal').then(setFamilyGoalState).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  /** Pull a backup down through the PIN-gated endpoint and save it locally. */
  async function downloadBackup(file) {
    try {
      const blob = await client.blob(`/api/parent/backups/${encodeURIComponent(file)}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the save in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify(`Downloading ${file}`);
    } catch {
      notify('Could not download that backup');
    }
  }

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
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => setAwarding(true)}>
          🎁 Bonus award
        </button>
        <button className="btn secondary" onClick={() => setEditingFamilyGoal(true)}>
          👨‍👩‍👦‍👦 Family goal
          {familyGoal ? `: ${familyGoal.progress}/${familyGoal.target}${familyGoal.reached ? ' 🎉' : ''}` : ': none'}
        </button>
        <button
          className="btn secondary"
          onClick={async () => {
            const d = await client.get('/api/parent/digest').catch(() => null);
            if (d) setDigestPreview(d.data);
          }}
        >
          📊 Weekly digest
        </button>
        <button className="btn secondary" onClick={() => setAddingKid(true)}>
          ➕ Add kid
        </button>
      </div>

      {addingKid && (
        <AddKidModal
          client={client}
          notify={notify}
          onClose={() => {
            setAddingKid(false);
            load();
          }}
        />
      )}

      {clearingBadges && (
        <Modal title={`Clear ${clearingBadges.name}'s trophy case?`} onClose={() => setClearingBadges(null)}>
          <p style={{ fontSize: 15, lineHeight: 1.5 }}>
            This removes <strong>all of {clearingBadges.name}'s badges</strong> and takes back
            the bonus points those badges paid. Heads up: badges based on totals they've
            already passed (like "100 points earned") will be re-earned the next time they
            open their screen — this is mainly for correcting things after testing or
            history changes.
          </p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setClearingBadges(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              style={{ flex: 1 }}
              onClick={async () => {
                try {
                  const r = await client.post(`/api/parent/kids/${clearingBadges.id}/clear-badges`);
                  notify(`Cleared ${r.cleared} badge${r.cleared === 1 ? '' : 's'} for ${clearingBadges.name}`);
                } catch {
                  notify('Clear failed');
                }
                setClearingBadges(null);
                load();
              }}
            >
              Yes, clear trophy case
            </button>
          </div>
        </Modal>
      )}

      {removingKid && (
        <RemoveKidModal
          kid={removingKid}
          client={client}
          notify={notify}
          onClose={() => {
            setRemovingKid(null);
            load();
          }}
        />
      )}

      {editingAvatar && (
        <AvatarModal
          kid={editingAvatar}
          client={client}
          notify={notify}
          onClose={() => {
            setEditingAvatar(null);
            load();
          }}
        />
      )}

      {digestPreview !== null && (
        <Modal title="📊 This week" onClose={() => setDigestPreview(null)}>
          <DigestView data={digestPreview} />
          <p style={{ fontSize: 13, color: '#4a5568' }}>
            Sends automatically every Sunday at 6pm when ntfy is configured.
          </p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setDigestPreview(null)}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                await client.post('/api/parent/digest').catch(() => {});
                notify('Digest sent to ntfy (if configured)');
                setDigestPreview(null);
              }}
            >
              Send to my phone now
            </button>
          </div>
        </Modal>
      )}

      {editingFamilyGoal && (
        <FamilyGoalModal
          current={familyGoal}
          client={client}
          notify={notify}
          onClose={() => {
            setEditingFamilyGoal(false);
            load();
          }}
        />
      )}

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
          <button
            className="avatar-edit-btn"
            aria-label={`Change ${kid.name}'s avatar`}
            title="Change avatar"
            onClick={() => setEditingAvatar(kid)}
          >
            {kid.avatar_icon}
          </button>
          <span className="what">
            <strong style={{ fontSize: 17 }}>
              {kid.name} (age {kid.age})
            </strong>
            <br />
            💰 Checking: <strong>{kid.balances.checking}</strong> · 🏦 Savings:{' '}
            <strong>{kid.balances.savings}</strong>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontWeight: 700, fontSize: 14 }}>
                Theme:{' '}
                <select
                  value={kid.theme}
                  onChange={async (e) => {
                    const o = THEME_OPTIONS.find((x) => x.key === e.target.value);
                    try {
                      // Theme only — sending the theme's default avatar too
                      // used to wipe whatever avatar the kid had picked.
                      await client.patch(`/api/parent/kids/${kid.id}`, { theme: o.key });
                      notify(`${kid.name} is now ${o.label}!`);
                    } catch {
                      notify('Theme change failed');
                    }
                    load();
                  }}
                  style={{ fontSize: 15, padding: 8 }}
                >
                  {THEME_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
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

            {/* A wrapping row, not a tall right-hand column — the column left
                a half-screen void beside every kid. Destructive actions are
                pushed to their own group at the end. */}
            <div className="kid-actions">
              <button className="btn secondary" onClick={() => showHistory(kid)}>
                📜 History
              </button>
              <button className="btn secondary" onClick={() => setAdjusting(kid)}>
                ⚖️ Adjust points
              </button>
              <button className="btn secondary" onClick={() => setSettingCode(kid)}>
                🔒 Secret code{kid.secret_code ? `: ${kid.secret_code}` : ': none'}
              </button>
              <button className="btn secondary" onClick={() => setClearingBadges(kid)}>
                🏅 Clear trophy case
              </button>
              <span className="kid-actions-danger">
                <button className="btn danger" onClick={() => setResetting(kid)}>
                  🧹 Reset today
                </button>
                <button className="btn danger" onClick={() => setRemovingKid(kid)}>
                  🗑️ Remove kid
                </button>
              </span>
            </div>
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
              : 'Download a copy and keep it somewhere else — a snapshot that only lives on this machine is not really a backup.'}
          </div>
          {/* Getting a copy off the box used to mean shelling in. */}
          {backups.length > 0 && (
            <ul className="backup-list">
              {backups.slice(0, 5).map((b) => (
                <li key={b.file}>
                  <span>
                    {b.file} <span style={{ color: '#718096' }}>({Math.round(b.size / 1024)} KB)</span>
                  </span>
                  <button
                    className="btn secondary"
                    onClick={() => downloadBackup(b.file)}
                    aria-label={`Download ${b.file}`}
                  >
                    ⬇ Download
                  </button>
                </li>
              ))}
            </ul>
          )}
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

      <div className="pending-item" style={{ alignItems: 'flex-start' }}>
        <span style={{ fontSize: 28 }}>🔄</span>
        <span className="what">
          <strong>Fresh start</strong> — wipe all points, streaks, badges, and history (e.g.
          after testing) while keeping kids, themes, secret codes, tasks, rewards, and
          categories. A safety backup is saved first.
        </span>
        <button className="btn danger" onClick={() => setFreshStarting(true)}>
          🔄 Fresh start
        </button>
      </div>

      {freshStarting && (
        <FreshStartModal
          client={client}
          notify={notify}
          onClose={() => {
            setFreshStarting(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function FreshStartModal({ client, notify, onClose }) {
  const [typed, setTyped] = useState('');
  const match = typed.trim().toUpperCase() === 'FRESH';

  async function go() {
    try {
      const r = await client.post('/api/parent/fresh-start');
      notify(`Fresh start done — safety backup saved: ${r.backup}`);
    } catch {
      notify('Fresh start failed — check server logs');
    }
    onClose();
  }

  return (
    <Modal title="🔄 Fresh start?" onClose={onClose}>
      <p style={{ fontSize: 15, lineHeight: 1.5 }}>
        <strong>Wipes:</strong> all points, streaks, badges, task history, reward requests,
        mystery picks, undo history, and vacation history — for every kid, back to zero.
        <br />
        <strong>Keeps:</strong> the kids themselves (themes, secret codes, vault settings),
        all tasks and schedules, rewards, categories, and the family goal (its progress
        restarts from zero).
        <br />
        A backup is saved automatically first, so this is recoverable — but it's still a big
        red button.
      </p>
      <div className="form-grid">
        <label>
          Type <strong>FRESH</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="FRESH" />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger" style={{ flex: 1 }} disabled={!match} onClick={go}>
          Wipe and start fresh
        </button>
      </div>
    </Modal>
  );
}

const THEME_OPTIONS = [
  { key: 'soccer', label: '⚽ Soccer', avatar: '⚽' },
  { key: 'dino', label: '🦖 Dinosaur', avatar: '🦖' },
  { key: 'space', label: '🚀 Space', avatar: '🚀' },
  { key: 'fantasy', label: '🦄 Fantasy', avatar: '🦄' },
  { key: 'racing', label: '🏎️ Racing', avatar: '🏎️' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The week as a chart rather than a text blob.
 *
 * "Which chores keep getting skipped" is the most useful thing this app knows
 * about a household — it says which ones are mispriced or unrealistic — and it
 * used to be buried in a <pre>. The per-kid bars make an off week visible at a
 * glance instead of requiring you to compare numbers in prose.
 */
function DigestView({ data }) {
  if (!data) return <p>Loading…</p>;
  const { kids = [], missed = [], pendingNow = 0 } = data;
  if (kids.length === 0) return <p>No kids on the chart yet.</p>;

  // One scale across every kid, so the bars are comparable between them.
  const peak = Math.max(1, ...kids.flatMap((k) => k.daily.map((d) => d.points)));

  return (
    <div className="digest">
      {kids.map((kid) => (
        <div key={kid.id} className="digest-kid">
          <div className="digest-kid-head">
            <strong>
              {kid.icon} {kid.name}
            </strong>
            <span>
              +{kid.earned} pts · {kid.approved} tasks
              {kid.liveStreaks > 0 && ` · ${kid.liveStreaks} streak${kid.liveStreaks === 1 ? '' : 's'} 🔥`}
              {kid.newBadges > 0 && ` · ${kid.newBadges} new 🏅`}
            </span>
          </div>
          <div className="digest-bars">
            {kid.daily.map((d) => {
              const day = WEEKDAYS[new Date(`${d.date}T12:00:00`).getDay()];
              return (
                <div key={d.date} className="digest-bar" title={`${d.date}: ${d.points} points`}>
                  <span className="digest-bar-value">{d.points || ''}</span>
                  <span
                    className="digest-bar-fill"
                    style={{ height: `${Math.round((d.points / peak) * 100)}%` }}
                  />
                  <span className="digest-bar-day">{day}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {missed.length > 0 && (
        <>
          <h4 style={{ marginBottom: 6 }}>Most skipped this week</h4>
          <p style={{ fontSize: 13, color: '#4a5568', marginTop: 0 }}>
            Scheduled but not done. A chore near the top of this list every week is usually
            worth more points, or worth dropping.
          </p>
          <ul className="digest-missed">
            {missed.slice(0, 5).map((m) => (
              <li key={m.title}>
                <span>{m.title}</span>
                <span className="digest-missed-count">{m.misses}×</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {pendingNow > 0 && (
        <p className="digest-pending">
          ⏳ {pendingNow} completion{pendingNow === 1 ? '' : 's'} waiting for approval right now.
        </p>
      )}
    </div>
  );
}

/**
 * Change a kid's avatar after creation. There was no way to do this at all
 * before — the only avatar choice happened at add-time, and a theme change
 * silently overwrote it.
 */
function AvatarModal({ kid, client, notify, onClose }) {
  const [icon, setIcon] = useState(kid.avatar_icon);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await client.patch(`/api/parent/kids/${kid.id}`, { avatar_icon: icon });
      notify(`${kid.name}'s avatar updated`);
      onClose();
    } catch {
      notify('Could not change the avatar');
      setSaving(false);
    }
  }

  return (
    <Modal title={`${kid.name}'s avatar`} onClose={onClose}>
      <EmojiPicker value={icon} onChange={setIcon} />
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={saving || icon === kid.avatar_icon}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function AddKidModal({ client, notify, onClose }) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [theme, setTheme] = useState('soccer');
  const [avatar, setAvatar] = useState('⚽');
  const parsedAge = Number(age);
  const valid = name.trim().length > 0 && Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge <= 18;

  function pickTheme(t) {
    setTheme(t);
    setAvatar(THEME_OPTIONS.find((o) => o.key === t)?.avatar || '⭐');
  }

  async function save() {
    try {
      await client.post('/api/parent/kids', {
        name: name.trim(),
        age: parsedAge,
        theme,
        avatar_icon: avatar,
      });
      notify(`Welcome, ${name.trim()}! 🎉`);
      onClose();
    } catch {
      notify('Could not add the kid — check the fields');
    }
  }

  return (
    <Modal title="➕ Add a kid" onClose={onClose}>
      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Avery" />
        </label>
        <label>
          Age
          <input type="number" min="1" max="18" value={age} onChange={(e) => setAge(e.target.value)} />
        </label>
        <label>
          Theme
          <span style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
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
        <label>
          Avatar
          <EmojiPicker value={avatar} onChange={setAvatar} />
        </label>
      </div>
      <p style={{ fontSize: 13, color: '#4a5568' }}>
        Starts in manual vault mode with no secret code — adjust both here in Kids & Vaults
        after adding. Tasks assigned to "All kids" apply automatically.
      </p>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid} onClick={save}>
          Add kid
        </button>
      </div>
    </Modal>
  );
}

function RemoveKidModal({ kid, client, notify, onClose }) {
  const [typed, setTyped] = useState('');
  const match = typed.trim().toLowerCase() === kid.name.toLowerCase();

  async function remove() {
    try {
      await client.delete(`/api/parent/kids/${kid.id}`);
      notify(`${kid.name} removed`);
    } catch {
      notify('Remove failed');
    }
    onClose();
  }

  return (
    <Modal title={`🗑️ Remove ${kid.name}?`} onClose={onClose}>
      <p style={{ fontSize: 15, lineHeight: 1.5 }}>
        This <strong>permanently deletes {kid.name} and everything about them</strong> — all
        points, streaks, badges, history, reward requests, and any tasks or rewards that were
        just theirs. There is no undo. (Going on a break? Use Vacation Mode instead.)
      </p>
      <div className="form-grid">
        <label>
          Type <strong>{kid.name}</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={kid.name} />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger" style={{ flex: 1 }} disabled={!match} onClick={remove}>
          Permanently remove {kid.name}
        </button>
      </div>
    </Modal>
  );
}

function FamilyGoalModal({ current, client, notify, onClose }) {
  const [title, setTitle] = useState(current?.title || '');
  const [icon, setIcon] = useState(current?.icon || '🍕');
  const [target, setTarget] = useState(current ? String(current.target) : '');
  const parsed = Number(target);
  const valid = title.trim().length > 0 && Number.isInteger(parsed) && parsed > 0;

  async function save() {
    try {
      await client.post('/api/parent/family-goal', { title: title.trim(), icon, target: parsed });
      notify(`Family goal set: ${title.trim()} (${parsed} points)`);
      onClose();
    } catch {
      notify('Could not save the goal — check the fields');
    }
  }

  async function clear() {
    await client.post('/api/parent/family-goal', { clear: true }).catch(() => {});
    notify('Family goal cleared');
    onClose();
  }

  return (
    <Modal title="👨‍👩‍👦‍👦 Family goal" onClose={onClose}>
      <p style={{ fontSize: 14, color: '#4a5568' }}>
        One shared target both kids work toward together — they see a combined progress bar,
        never each other's numbers. Counts every point earned from now on (tasks, mysteries,
        awards). {current && `Current: "${current.title}" — ${current.progress}/${current.target}.`}
        {' '}Setting a new goal restarts progress from zero.
      </p>
      <div className="form-grid">
        <label>
          What's the prize?
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pizza & movie night" />
        </label>
        <label>
          Icon
          <EmojiPicker value={icon} onChange={setIcon} />
        </label>
        <label>
          Combined points needed
          <input type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" />
        </label>
      </div>
      <div className="modal-actions">
        {current && (
          <button className="btn danger" onClick={clear}>
            Clear goal
          </button>
        )}
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid} onClick={save}>
          {current ? 'Replace goal' : 'Set goal'}
        </button>
      </div>
    </Modal>
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
          <span style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
            {kids.map((k) => (
              <button
                type="button"
                key={k.id}
                aria-pressed={selected.has(k.id)}
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

/**
 * Turn a raw ledger `source` into something a parent can read.
 * Completions and redemptions get their own sections above, so this only
 * has to explain the point movements that have no other home.
 */
function ledgerLabel(source) {
  if (!source) return 'Adjustment';
  if (source === 'adjustment') return 'Manual adjustment';
  if (source === 'transfer') return 'Vault transfer';
  if (source.startsWith('badge:')) return `Badge bonus — ${source.slice(6).replace(/[-_]/g, ' ')}`;
  if (source.startsWith('award:')) {
    const note = source.slice(6);
    return note && note !== 'bonus' ? `Bonus — ${note}` : 'Bonus points';
  }
  return source;
}

/** Entries with no other section: awards, adjustments, transfers, badges. */
function otherLedgerEntries(ledger) {
  return (ledger || []).filter(
    (l) => !l.source?.startsWith('completion:') && !l.source?.startsWith('redemption:')
  );
}

function HistoryModal({ history, onClose }) {
  const adjustments = otherLedgerEntries(history.data.ledger);
  return (
    <Modal title={`${history.kid.name}'s history`} onClose={onClose}>
          <div className="history-list">
            {history.data.completions.length === 0 &&
              history.data.redemptions.length === 0 &&
              adjustments.length === 0 && <p>No activity yet.</p>}
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
            {adjustments.length > 0 && <h4>Bonuses &amp; adjustments</h4>}
            {adjustments.map((l) => (
              <div key={`l${l.id}`} className="history-row">
                <span>{l.created_at.slice(0, 10)}</span>
                <span style={{ flex: 1 }}>
                  {ledgerLabel(l.source)}{' '}
                  <span style={{ color: '#718096' }}>({l.bucket})</span>
                </span>
                <span className={l.direction === 'earn' ? 'ledger-plus' : 'ledger-minus'}>
                  {l.direction === 'earn' ? '+' : '−'}
                  {l.amount}
                </span>
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
