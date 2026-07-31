/**
 * Fetch wrapper plus an offline queue for kiosk task taps: if the backend
 * is unreachable, the tap is stored in localStorage and retried until it
 * lands (client_id keeps retries idempotent server-side).
 */

const QUEUE_KEY = 'reward-chart-tap-queue';

async function request(url, options = {}) {
  const { headers, body, ...rest } = options;
  const res = await fetch(url, {
    ...rest,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request(url),
  post: (url, body, headers) => request(url, { method: 'POST', body, headers }),
  patch: (url, body, headers) => request(url, { method: 'PATCH', body, headers }),
};

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function queuedTapCount(kidId) {
  return readQueue().filter((item) => item.body.kid_id === kidId).length;
}

/**
 * Tap a task. Returns { ok: true } when the server accepted it and
 * { ok: true, queued: true } when it was stored for later sync.
 * Only a network failure queues — a 4xx (bad task etc.) throws.
 */
/**
 * crypto.randomUUID only exists on secure origins (https/localhost); the
 * kiosk runs over plain http on the LAN, so phones need the fallback.
 */
function makeClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function tapTask(taskId, kidId) {
  const body = { task_id: taskId, kid_id: kidId, client_id: makeClientId() };
  try {
    await api.post('/api/completions', body);
    return { ok: true };
  } catch (err) {
    if (err.status) throw err;
    const queue = readQueue();
    queue.push({ body, queuedAt: Date.now() });
    writeQueue(queue);
    return { ok: true, queued: true };
  }
}

let flushing = false;

/** Retry every queued tap; drop items the server permanently rejects. */
export async function flushTapQueue() {
  if (flushing) return;
  flushing = true;
  try {
    let queue = readQueue();
    while (queue.length > 0) {
      const item = queue[0];
      try {
        await api.post('/api/completions', item.body);
      } catch (err) {
        if (!err.status) return; // still offline — try again later
        // Server rejected it outright (task deleted, etc.) — drop it.
      }
      queue = queue.slice(1);
      writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
}

export function startQueueSync() {
  window.addEventListener('online', flushTapQueue);
  const interval = setInterval(flushTapQueue, 15000);
  flushTapQueue();
  return () => {
    window.removeEventListener('online', flushTapQueue);
    clearInterval(interval);
  };
}

// ---- Parent API (PIN sent per-request) ----

export function parentApi(pin) {
  const headers = { 'x-parent-pin': pin };
  return {
    get: (url) => request(url, { headers }),
    post: (url, body) => request(url, { method: 'POST', body, headers }),
    patch: (url, body) => request(url, { method: 'PATCH', body, headers }),
    delete: (url) => request(url, { method: 'DELETE', headers }),
    /**
     * Binary fetch, for backup downloads. A plain <a href> can't carry the
     * PIN header, so the file comes back as a blob and is saved client-side.
     */
    blob: async (url) => {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const err = new Error(`http_${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.blob();
    },
  };
}
