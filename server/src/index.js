import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './db.js';
import { ensureBonusPool } from './seed.js';
import { isConfigured } from './config.js';
import { scheduleBackups } from './backup.js';
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
  // index.html must always revalidate so phones pick up new releases;
  // hashed bundle files are immutable and can cache forever.
  app.use(
    express.static(staticDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
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

app.listen(PORT, () => {
  console.log(`Reward chart server listening on port ${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (staticDir && fs.existsSync(staticDir)) {
    console.log(`Serving frontend from: ${staticDir}`);
  } else {
    console.warn('No built frontend found — run "npm run build" in client/ (API-only mode).');
  }
});
