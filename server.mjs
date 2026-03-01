// server.mjs — mygit server (entry point)
import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import cors from 'cors';
import os from 'os';
import dayjs from 'dayjs';
import { fileURLToPath } from 'url';

import { config } from './core/utils.js';
import { initCategories } from './core/categories.js';
import { validateAndMigrateAll } from './core/validation.js';
import { runMigrations } from './core/migrate.js';
import { initDb, migrateFromJson } from './core/db.js';

import reposRouter from './routes/repos.mjs';
import filesRouter from './routes/files.mjs';
import runRouter   from './routes/run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir   = config.dataDir;

await fs.ensureDir(path.join(dataDir, 'repos'));

// ── Inicjalizacja bazy danych ──────────────────────────────────────────────
await initDb();
await migrateFromJson();  // Jednorazowa migracja JSON→SQLite (przy kolejnych startach: no-op)

await initCategories();
// validateAndMigrateAll naprawia stare meta.json — pomiń jeśli DB już ma dane
// (po migracji JSON-y są backup-only, nie są już source-of-truth)
const { dbGetStats } = await import('./core/db.js');
if (dbGetStats().repos === 0) {
  await validateAndMigrateAll(path.join(dataDir, 'repos'));
}
await runMigrations();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Repo-Name'],
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'web')));

app.use('/api/repos/:id/diff/:file',  (_, res, next) => { res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); next(); });
app.use('/api/repos/:id/history',     (_, res, next) => { res.setHeader('Cache-Control','max-age=60'); next(); });
app.use('/api/repos/:id/info',        (_, res, next) => { res.setHeader('Cache-Control','max-age=120'); next(); });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));
app.use('/api', reposRouter);
app.use('/api', filesRouter);
app.use('/api', runRouter);
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));

const PORT = config.port || 3350;
const nets = os.networkInterfaces();
let localIp = 'localhost';
for (const iface of Object.values(nets).flat())
  if (iface.family === 'IPv4' && !iface.internal) { localIp = iface.address; break; }

app.listen(PORT, '0.0.0.0', () => {
  console.log('\nmygit SERVER');
  console.log(`  http://${localIp}:${PORT}`);
  console.log(`  Data: ${dataDir}`);
  console.log(`  ${dayjs().format('DD.MM.YYYY | HH:mm:ss')}\n`);
});
