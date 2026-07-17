/**
 * Service worker: makes the app installable and keeps the kiosk usable
 * through network blips.
 *
 * - Hashed build assets (/assets/*): cache-first — immutable by name.
 * - Pages and API GETs: network-first, falling back to the last good
 *   cached copy when offline. POSTs are never touched — the client's
 *   own offline tap queue handles those.
 */

const SHELL_CACHE = 'reward-chart-shell-v1';
const RUNTIME_CACHE = 'reward-chart-runtime-v1';

self.addEventListener('install', (event) => {
  // Precache the shell immediately — the first visit installs the worker
  // but isn't controlled by it, so without this an offline reload right
  // after the first visit would have nothing to fall back to.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.add('/');
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => ![SHELL_CACHE, RUNTIME_CACHE].includes(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Immutable hashed bundles: serve from cache, fill on first fetch.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Everything else (navigations, API GETs, manifest): freshest wins,
  // last good copy when the network is down.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(RUNTIME_CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = (await caches.match('/')) || (await caches.match('/index.html'));
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
