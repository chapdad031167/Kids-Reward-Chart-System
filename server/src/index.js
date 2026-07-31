import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './db.js';
import { ensureBonusPool } from './seed.js';
import { isConfigured, getAppName } from './config.js';
import { scheduleBackups, setRestartHandler } from './backup.js';
import { scheduleDigest } from './digest.js';
import { kiosk } from './routes/kiosk.js';
import { parent } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8090);

// Fresh installs configure themselves through the first-run setup wizard.
// Existing installs get the mystery bonus pool backfilled if they predate it.
if (isConfigured()) ensureBonusPool();
scheduleBackups();
scheduleDigest();

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', kiosk);
app.use('/api/parent', parent);

// Serve the built frontend: ./public in the Docker image, or client/dist
// when running straight from a checkout.
const staticDir =
  process.env.STATIC_DIR ||
  [path.join(__dirname, '..', 'public'), path.join(__dirname, '..', '..', 'client', 'dist')].find(
    (dir) => fs.existsSync(path.join(dir, 'index.html'))
  );
if (staticDir && fs.existsSync(staticDir)) {
  // The manifest is generated so the installed app carries the family's
  // chosen chart name and stays current after a rename in Settings.
  app.get('/manifest.webmanifest', (req, res) => {
    const name = getAppName();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/manifest+json').json({
      name,
      short_name: name.length <= 12 ? name : 'Rewards',
      description: 'A self-hosted chore & reward chart for families',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#16324a',
      theme_color: '#16324a',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });

  // index.html and the service worker must always revalidate so devices
  // pick up new releases; hashed bundles are immutable and cache forever.
  app.use(
    express.static(staticDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

/**
 * A restore replaces the database file underneath a process that is holding
 * connection-bound prepared statements and transaction wrappers, so the only
 * safe thing to do afterwards is start over. Exiting cleanly is the restart
 * when something supervises us — Docker's `restart: unless-stopped`, systemd,
 * a process manager. Run bare (`npm start`) there is nothing to restart us,
 * which is why the dashboard says so rather than promising it comes back.
 *
 * Living here rather than in the route because restart policy is a property
 * of how this process is deployed, not of an HTTP handler.
 */
setRestartHandler(() => {
  console.log('Restarting after database restore…');
  // Enough for the response to reach the browser and the socket to close.
  setTimeout(() => process.exit(0), 250).unref();
});

app.listen(PORT, () => {
  console.log(`Reward chart server listening on port ${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (staticDir && fs.existsSync(staticDir)) {
    console.log(`Serving frontend from: ${staticDir}`);
  } else {
    console.warn('No built frontend found — run "npm run build" in client/ (API-only mode).');
  }
});
