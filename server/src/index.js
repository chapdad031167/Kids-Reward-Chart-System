import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './db.js';
import { seedIfEmpty, ensureBonusPool } from './seed.js';
import { scheduleBackups } from './backup.js';
import { scheduleDigest } from './digest.js';
import { kiosk } from './routes/kiosk.js';
import { parent } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8090);

seedIfEmpty();
ensureBonusPool();
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
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
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
