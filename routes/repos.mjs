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
  dbGetRepoManifests, dbGetManifest, dbGetFileHistory,
} from '../core/db.js';
import {
  checkMissingObjects, saveObjectsFromZip, getObject, reconstructSnapshot, objectStoreStats,
} from '../core/objectStore.js';
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

// ── Delta upload — Warstwa 1+3 ────────────────────────────────────────────

// POST /api/repos/:id/check-objects
// Body: { "ścieżka": "sha256hash", ... }
// Response: { missing: ["hash1", "hash2", ...] }
router.post('/repos/:id/check-objects', async (req, res) => {
  try {
    await ensureRepoExists(req.params.id);
    const fileMap = req.body; // { path: hash }
    if (!fileMap || typeof fileMap !== 'object')
      return res.status(400).json({ error: 'Body musi być obiektem { ścieżka: hash }' });

    const uniqueHashes = [...new Set(Object.values(fileMap))];
    const missing = checkMissingObjects(uniqueHashes);
    res.json({ missing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/repos/:id/snapshot-delta
// Multipart lub raw ZIP z brakującymi plikami + query/header z manifestem
// Query params: message=..., manifest=<JSON encoded { path: hash, ... }>
// Albo header X-Manifest: <JSON>
// Body: ZIP z brakującymi plikami (może być pusty ZIP jeśli wszystko już w store)
router.post('/repos/:id/snapshot-delta', async (req, res) => {
  const { id } = req.params;
  const message = req.query.message
    ? decodeURIComponent(req.query.message)
    : (req.headers['x-snapshot-message'] || 'snapshot');

  const tempFile = path.join(tempDir, `${id}_delta_${Date.now()}.zip`);

  try {
    await ensureRepoExists(id);

    // Odbierz ZIP z brakującymi plikami (i opcjonalnie __manifest__.json w środku)
    const ws = fs.createWriteStream(tempFile);
    await new Promise((resolve, reject) => {
      req.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      req.on('error', err => { ws.destroy(); reject(err); });
    });

    // Manifest może przyjść jako:
    // 1. plik __manifest__.json wewnątrz ZIPa (preferowane — brak limitu rozmiaru)
    // 2. query param ?manifest= (legacy, ograniczony do ~8KB URL)
    // 3. nagłówek X-Manifest (legacy, ograniczony do 16KB)
    let fileMap;
    const manifestRaw = req.query.manifest || req.headers['x-manifest'];
    if (manifestRaw) {
      try {
        fileMap = JSON.parse(decodeURIComponent(manifestRaw));
      } catch {
        return res.status(400).json({ error: 'Nieprawidłowy format manifestu (oczekiwano JSON)' });
      }
    } else {
      // Wyciągnij manifest z ZIPa
      try {
        const AdmZipInner = (await import('adm-zip')).default;
        const zipForManifest = new AdmZipInner(tempFile);
        const manifestEntry = zipForManifest.getEntry('__manifest__.json');
        if (!manifestEntry) {
          return res.status(400).json({ error: 'Brak manifestu — oczekiwano __manifest__.json w ZIPie, query ?manifest= lub nagłówka X-Manifest' });
        }
        fileMap = JSON.parse(manifestEntry.getData().toString('utf8'));
      } catch (e) {
        return res.status(400).json({ error: 'Błąd odczytu manifestu z ZIPa: ' + e.message });
      }
    }

    // Sprawdź jakie hashe są potrzebne (mogły minąć równolegle)
    const uniqueHashes = [...new Set(Object.values(fileMap))];
    const missingBefore = checkMissingObjects(uniqueHashes);
    const missingSet = new Set(missingBefore);

    // Zapisz nowe obiekty z ZIPa (tylko jeśli ZIP nie jest pusty)
    let saved = 0;
    let skipped = 0;
    const zipSize = (await fs.stat(tempFile)).size;

    if (zipSize > 22) { // 22 bajtów = minimalny pusty ZIP
      const result = await saveObjectsFromZip(tempFile, missingSet);
      saved = result.saved;
      skipped = result.skipped;
    }

    await fs.remove(tempFile);

    // Weryfikacja — czy wszystkie hashe są teraz dostępne?
    const stillMissing = checkMissingObjects(uniqueHashes);
    if (stillMissing.length > 0) {
      return res.status(400).json({
        error: `Brakuje ${stillMissing.length} obiektów po uploadzię`,
        missing: stillMissing,
      });
    }

    // Utwórz manifest w SQLite
    const now = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    const manifestId = now;
    const { dbCreateManifest: _createManifest } = await import('../core/db.js');
    const manifest = _createManifest(manifestId, id, message, fileMap);

    // Zarejestruj commit w istniejącym systemie (kompatybilność z web panel)
    const fileCount = Object.keys(fileMap).length;
    const { dbAddCommit, dbUpdateRepo, dbGetRepo: _getRepo, dbUpdateRepoStats } = await import('../core/db.js');

    // WAŻNE: file = czysty manifestId (bez rozszerzenia) — web panel używa tego
    // jako ?commit= do /browse, a isManifestId() rozpoznaje brak .zip
    const entry = {
      id:        manifestId,
      file:      manifestId,          // NIE .manifest — to powodowało błąd "Manifest nie istnieje"
      message,
      size:      zipSize,
      fileCount,
      date:      new Date().toISOString(),
      isDelta:   true,
    };

    dbAddCommit(id, entry);
    const now2 = new Date().toISOString();
    dbUpdateRepo(id, { updated_at: now2, last_commit: entry });
    const current = _getRepo(id);
    dbUpdateRepoStats(id, (current?.snapshots || 0) + 1, (current?.size || 0) + zipSize, now2);

    res.json({
      manifestId,
      fileCount,
      newObjects: saved,
      reusedObjects: fileCount - saved,
      deltaSize: zipSize,
      message,
    });

  } catch (e) {
    if (await fs.pathExists(tempFile)) await fs.remove(tempFile);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/repos/:id/manifest/:manifestId — odczyt manifestu + lista plików
router.get('/repos/:id/manifest/:manifestId', async (req, res) => {
  try {
    await ensureRepoExists(req.params.id);
    const manifest = dbGetManifest(req.params.manifestId);
    if (!manifest) return res.status(404).json({ error: 'Manifest nie istnieje' });
    if (manifest.repoId !== req.params.id)
      return res.status(403).json({ error: 'Manifest należy do innego repo' });
    res.json(manifest);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/repos/:id/manifest/:manifestId/file?path=...  — serwowanie pliku z object store
router.get('/repos/:id/manifest/:manifestId/file', async (req, res) => {
  try {
    await ensureRepoExists(req.params.id);
    const manifest = dbGetManifest(req.params.manifestId);
    if (!manifest) return res.status(404).json({ error: 'Manifest nie istnieje' });
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Brakuje parametru ?path=' });
    const hash = manifest.files[filePath];
    if (!hash) return res.status(404).json({ error: `Plik nie istnieje w tym manifeście: ${filePath}` });
    const buf = await getObject(hash);
    if (!buf) return res.status(404).json({ error: `Obiekt nie istnieje w store: ${hash}` });
    res.set('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/repos/:id/manifests — lista manifestów (delta snapshots)
router.get('/repos/:id/manifests', async (req, res) => {
  try {
    await ensureRepoExists(req.params.id);
    res.json(dbGetRepoManifests(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/repos/:id/file-log?path=... — historia zmian konkretnego pliku
router.get('/repos/:id/file-log', async (req, res) => {
  try {
    await ensureRepoExists(req.params.id);
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Brakuje parametru ?path=' });
    res.json(dbGetFileHistory(req.params.id, filePath));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/object-store/stats
router.get('/object-store/stats', async (req, res) => {
  try {
    res.json(await objectStoreStats());
  } catch (e) {
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
    const commits = await getRepoCommits(req.params.id);
    if (!commits.length) return res.status(404).json({ error: 'Brak snapshotów.' });

    const latest = commits[0]; // posortowane DESC
    const isManifest = !latest.file.endsWith('.zip');

    if (isManifest) {
      // Delta snapshot — rozmiar i info z DB
      return res.json({ file: latest.file, size: latest.size, date: latest.date, message: latest.message });
    }

    // Legacy ZIP — pobierz rozmiar z dysku
    const fp = path.join(dataDir, 'repos', req.params.id, 'versions', latest.file);
    const stat = await fs.stat(fp).catch(() => ({ size: latest.size || 0 }));
    res.json({ file: latest.file, size: stat.size, date: latest.date, message: latest.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/repos/:id/snapshot/:file', async (req, res) => {
  try {
    const { file: fileParam, id } = req.params;
    const commits = await getRepoCommits(id);

    // Szukaj w historii (oba systemy)
    const commit = commits.find(c =>
      c.file === fileParam ||
      c.file === fileParam + '.zip' ||
      c.file?.startsWith(fileParam)
    );
    if (!commit) return res.status(404).json({ error: 'Snapshot nie znaleziony.' });

    const isManifest = !commit.file.endsWith('.zip');
    if (isManifest) {
      return res.json({ file: commit.file, size: commit.size, date: commit.date, message: commit.message });
    }

    // Legacy ZIP — pobierz rozmiar z dysku
    const fp = path.join(dataDir, 'repos', id, 'versions', commit.file);
    const stat = await fs.stat(fp).catch(() => ({ size: commit.size || 0 }));
    res.json({ file: commit.file, size: stat.size, date: commit.date, message: commit.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/repos/:id/diff-local', async (req, res) => {
  try {
    const localMap = req.body;
    // Zabezpieczenie: body może być undefined/null gdy payload za duży lub złe Content-Type
    if (!localMap || typeof localMap !== 'object' || Array.isArray(localMap)) {
      return res.status(400).json({ error: 'Nieprawidłowy format danych (oczekiwano JSON object z mapą plików)' });
    }
    const remoteMap = await getSnapshotMap(req.params.id, 'latest');
    const result = { added: [], removed: [], modified: [], stats: {} };
    for (const p of Object.keys(localMap)) {
      if (!remoteMap[p]) result.added.push(p);
      else if (remoteMap[p].hash !== localMap[p]) result.modified.push(p);
    }
    for (const p of Object.keys(remoteMap)) { if (!localMap[p]) result.removed.push(p); }
    result.stats = { added: result.added.length, removed: result.removed.length, modified: result.modified.length };
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message ?? String(e) }); }
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
    const { id } = req.params;
    const relPath  = (req.query.path || '').replace(/^\//, '');
    const commitId = req.query.commit; // opcjonalny — konkretny snapshot/manifest

    // ── Delta: przez manifest ──────────────────────────────────────────────
    // Znajdź najnowszy manifest (lub wskazany) i zrekonstruuj plik/folder
    const manifests = dbGetRepoManifests(id);
    let targetManifest = null;

    if (commitId && !commitId.endsWith('.zip')) {
      const m = dbGetManifest(commitId.replace(/\.manifest$/, ''));
      if (m && m.repoId === id) targetManifest = m;
    } else if (!commitId && manifests.length > 0) {
      // Sprawdź czy manifest jest nowszy niż ZIP
      const dir = path.join(dataDir, 'repos', id, 'versions');
      const zipFiles = await fs.pathExists(dir)
        ? (await fs.readdir(dir)).filter(f => f.endsWith('.zip'))
        : [];
      const latestZipId = zipFiles.length > 0 ? zipFiles.sort().reverse()[0].replace('.zip','') : '';
      if (manifests[0].id > latestZipId) {
        targetManifest = dbGetManifest(manifests[0].id);
      }
    }

    if (targetManifest) {
      // Plik pojedynczy
      const hash = targetManifest.files[relPath];
      if (hash) {
        const buf = await getObject(hash);
        if (!buf) return res.status(404).json({ error: `Obiekt brakuje w store: ${hash}` });
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.send(buf);
      }

      // Folder — zrekonstruuj ZIP z pasujących plików
      const prefix  = relPath ? relPath + '/' : '';
      const matched = Object.entries(targetManifest.files)
        .filter(([p]) => !prefix || p.startsWith(prefix));

      if (!matched.length)
        return res.status(404).json({ error: 'Nie znaleziono ścieżki w manifeście' });

      const subZip = new AdmZip();
      for (const [filePath, fileHash] of matched) {
        const buf = await getObject(fileHash);
        if (buf) subZip.addFile(filePath, buf);
      }
      res.setHeader('Content-Type', 'application/zip');
      return res.send(subZip.toBuffer());
    }

    // ── Legacy: ZIP ────────────────────────────────────────────────────────
    const dir       = path.join(dataDir, 'repos', id, 'versions');
    const versions  = await fs.readdir(dir);
    const latestZip = versions.sort().reverse()[0];
    if (!latestZip) throw new Error('Brak snapshotów');
    const zipPath = path.join(dir, latestZip);
    let zip = zipCache.get(zipPath);
    if (!zip) { zip = new AdmZip(zipPath); zipCache.set(zipPath, zip); }
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
