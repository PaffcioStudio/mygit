// routes/repos.mjs — Trasy: repozytoria, ulubione, kategorie (SQLite-backed)
import { Router } from 'express';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import os from 'os';
import { config } from '../core/utils.js';
import { zipCache } from '../core/cache.js';
import {
  dbListRepos, dbGetRepo, dbGetFavourites, dbAddFavourite, dbRemoveFavourite,
  dbGetAllNotes, dbGetNote, dbSaveNote,
  dbGetArchive, dbArchiveRepo, dbUnarchiveRepo,
} from '../core/db.js';
import {
  listRepos, createRepo, getRepoCommits, deleteCommit,
  computeDiff, registerUploadedSnapshot, updateRepoComment,
  deleteRepo, ensureRepoExists, getSnapshotMap, updateRepoCategory
} from '../core/repoManager.js';
import { getCategories, getCategory, addCategory, deleteCategory } from '../core/categories.js';
import { reassignReposCategory } from '../core/repoManager.js';

const router  = Router();
const dataDir = config.dataDir;
const tempDir = path.join(os.tmpdir(), 'mygit_uploads');
await fs.ensureDir(tempDir);

// ── Repos ──────────────────────────────────────────────────────────────────
router.get('/repos', (req, res) => {
  try { res.json(dbListRepos()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/repos', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) throw new Error('Wymagana nazwa repozytorium');
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      throw new Error('Nazwa może zawierać tylko litery, cyfry, myślniki i podkreślenia');
    res.json(await createRepo(name, name, description));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/repos/:id/snapshot', async (req, res) => {
  const { id } = req.params;
  const message = req.query.message || 'snapshot';
  const tempFile = path.join(tempDir, `${id}_${Date.now()}.zip`);
  try {
    await ensureRepoExists(id);
    const ws = fs.createWriteStream(tempFile);
    await new Promise((resolve, reject) => {
      req.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      req.on('error', err => { ws.destroy(); reject(err); });
    });
    if ((await fs.stat(tempFile)).size === 0) throw new Error('Otrzymano pusty plik');
    res.json(await registerUploadedSnapshot(id, tempFile, message));
  } catch (e) {
    if (await fs.pathExists(tempFile)) await fs.remove(tempFile);
    res.status(500).json({ error: e.message });
  }
});

router.post('/repos/:id/comment', async (req, res) => {
  try { res.json(await updateRepoComment(req.params.id, req.body.description)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/repos/:id/history', async (req, res) => {
  try { res.json(await getRepoCommits(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/repos/:id/commit/:file', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try { await deleteCommit(req.params.id, req.params.file); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/repos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const repoDir = path.join(dataDir, 'repos', id);
    if (!(await fs.pathExists(repoDir)))
      return res.status(404).json({ error: 'Repozytorium nie istnieje.' });
    dbRemoveFavourite(id);
    await fs.remove(repoDir);
    // deleteRepo w repoManager usuwa z DB przez CASCADE
    const { dbDeleteRepo } = await import('../core/db.js');
    dbDeleteRepo(id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/repos/:id/info', (req, res) => {
  try {
    const repo = dbGetRepo(req.params.id);
    if (!repo) return res.status(404).json({ error: 'Repo nie istnieje.' });
    res.json(repo);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/repos/:id/latest', async (req, res) => {
  try {
    const dir = path.join(dataDir, 'repos', req.params.id, 'versions');
    const versions = await fs.readdir(dir);
    if (!versions.length) return res.status(404).json({ error: 'Brak snapshotów.' });
    const latest  = versions.sort().reverse()[0];
    const commits = await getRepoCommits(req.params.id);
    const commit  = commits.find(c => c.file === latest) || {};
    const stat    = await fs.stat(path.join(dir, latest));
    res.json({ file: latest, size: stat.size, date: commit.date, message: commit.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/repos/:id/snapshot/:file', async (req, res) => {
  try {
    const dir     = path.join(dataDir, 'repos', req.params.id, 'versions');
    const versions = await fs.readdir(dir);
    const target   = versions.find(v => v.startsWith(req.params.file));
    if (!target) return res.status(404).json({ error: 'Snapshot nie znaleziony.' });
    const commits = await getRepoCommits(req.params.id);
    const commit  = commits.find(c => c.file === target) || {};
    const stat    = await fs.stat(path.join(dir, target));
    res.json({ file: target, size: stat.size, date: commit.date, message: commit.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/repos/:id/diff-local', async (req, res) => {
  try {
    const localMap  = req.body;
    const remoteMap = await getSnapshotMap(req.params.id, 'latest');
    const result = { added: [], removed: [], modified: [], stats: {} };
    for (const p of Object.keys(localMap)) {
      if (!remoteMap[p]) result.added.push(p);
      else if (remoteMap[p].hash !== localMap[p]) result.modified.push(p);
    }
    for (const p of Object.keys(remoteMap)) { if (!localMap[p]) result.removed.push(p); }
    result.stats = { added: result.added.length, removed: result.removed.length, modified: result.modified.length };
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/repos/:id/category', async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) return res.status(400).json({ error: 'Wymagana nazwa kategorii' });
    const cat = await getCategory(category);
    if (!cat) return res.status(404).json({ error: `Kategoria '${category}' nie istnieje` });
    res.json(await updateRepoCategory(req.params.id, cat.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/repos/:id/restore-path', async (req, res) => {
  try {
    const dir       = path.join(dataDir, 'repos', req.params.id, 'versions');
    const versions  = await fs.readdir(dir);
    const latestZip = versions.sort().reverse()[0];
    if (!latestZip) throw new Error('Brak snapshotów');
    const zipPath = path.join(dir, latestZip);
    let zip = zipCache.get(zipPath);
    if (!zip) { zip = new AdmZip(zipPath); zipCache.set(zipPath, zip); }
    const relPath = (req.query.path || '').replace(/^\//, '');
    const entry   = zip.getEntry(relPath);
    if (entry && !entry.isDirectory) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(entry.getData());
    } else {
      const subZip  = new AdmZip();
      const entries = zip.getEntries().filter(e => e.entryName.startsWith(relPath));
      if (!entries.length) return res.status(404).json({ error: 'Nie znaleziono ścieżki' });
      entries.forEach(e => subZip.addFile(e.entryName, e.getData()));
      res.setHeader('Content-Type', 'application/zip');
      res.send(subZip.toBuffer());
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Favourites ─────────────────────────────────────────────────────────────
router.get('/favourites', (req, res) => {
  try { res.json({ favourites: dbGetFavourites() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/favourites/:id', (req, res) => {
  try {
    dbAddFavourite(req.params.id);
    res.json({ success: true, favourites: dbGetFavourites() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/favourites/:id', (req, res) => {
  try {
    dbRemoveFavourite(req.params.id);
    res.json({ success: true, favourites: dbGetFavourites() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Categories ─────────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try { res.json({ categories: await getCategories() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/categories/:id', async (req, res) => {
  try {
    const cat = await getCategory(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Kategoria nie znaleziona' });
    res.json(cat);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, color, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Wymagana nazwa kategorii' });
    res.json(await addCategory(name, color, icon));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const cat = await getCategory(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Kategoria nie istnieje' });
    if (cat.isDefault) return res.status(400).json({ error: 'Nie można usunąć domyślnej' });
    const reassigned = await reassignReposCategory(cat.id, 'bez-kategorii');
    await deleteCategory(cat.id);
    res.json({ success: true, deleted: cat.id, reassigned, fallback: 'bez-kategorii' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Archive ────────────────────────────────────────────────────────────────
router.get('/archive', (req, res) => {
  try { res.json(dbGetArchive()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/archive/:id', (req, res) => {
  try {
    dbArchiveRepo(req.params.id, req.body.meta || {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/archive/:id', (req, res) => {
  try {
    dbUnarchiveRepo(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notes ──────────────────────────────────────────────────────────────────
router.get('/notes', (req, res) => {
  try { res.json(dbGetAllNotes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/notes/:id', (req, res) => {
  try {
    dbSaveNote(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
