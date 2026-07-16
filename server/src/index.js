import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './db.js';
import { seedIfEmpty } from './seed.js';
import { kiosk } from './routes/kiosk.js';
import { parent } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8090);

seedIfEmpty();

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', kiosk);
app.use('/api/parent', parent);

// Serve the built frontend (client/dist is copied to ./public in the Docker image).
const staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'public');
if (fs.existsSync(staticDir)) {
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
});
