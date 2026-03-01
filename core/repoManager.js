// repoManager.js — zarządzanie repozytoriami (SQLite-backed)
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { repoBasePath, ensureDataDir, config } from './utils.js';
import { commitSnapshot } from './snapshot.js';
import { validateAndFixMeta, generateUUID } from './validation.js';
import { getDefaultCategory } from './categories.js';
import { zipCache } from './cache.js';
import {
  dbListRepos, dbGetRepo, dbCreateRepo, dbUpdateRepo, dbDeleteRepo, dbUpdateRepoStats,
  dbGetCommits, dbAddCommit, dbDeleteCommit,
} from './db.js';

await ensureDataDir();
await fs.ensureDir(repoBasePath());

// ── PUBLIC API ─────────────────────────────────────────────────────────────
export async function listRepos() {
  return dbListRepos();
}

export async function registerUploadedSnapshot(repoId, tempZipPath, message = 'snapshot') {
  const repoDir     = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, 'versions');

  const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
  const archiveName = `${timestamp}.zip`;
  const outPath     = path.join(versionsDir, archiveName);

  console.log(`📥 Rejestrowanie uploadu: ${repoId} -> ${archiveName}`);

  await fs.ensureDir(versionsDir);
  await fs.move(tempZipPath, outPath, { overwrite: true });

  const stat = await fs.stat(outPath);
  let fileCount = 0;
  try {
    const zip = new AdmZip(outPath);
    fileCount = zip.getEntries().filter(e => !e.isDirectory).length;
    zipCache.set(outPath, zip);
  } catch {}

  const entry = {
    id:        archiveName.replace(/\.zip$/, ''),
    file:      archiveName,
    message,
    size:      stat.size,
    date:      new Date().toISOString(),
    fileCount,
  };

  dbAddCommit(repoId, entry);
  const now = new Date().toISOString();
  dbUpdateRepo(repoId, { updated_at: now, last_commit: entry });

  // Stats — inkrementalnie
  const current = dbGetRepo(repoId);
  dbUpdateRepoStats(repoId, (current?.snapshots || 0) + 1, (current?.size || 0) + stat.size, now);

  return entry;
}

export async function createRepo(repoId, displayName = null, description = '', category = null) {
  const repoDir = path.join(repoBasePath(), repoId);
  if (await fs.pathExists(repoDir)) throw new Error('Repozytorium już istnieje');

  await fs.ensureDir(repoDir);
  await fs.ensureDir(path.join(repoDir, 'versions'));

  if (!category) {
    const defaultCat = await getDefaultCategory();
    category = defaultCat.id;
  }

  const uuid = generateUUID();
  const meta = dbCreateRepo(repoId, displayName || repoId, description, category, uuid);
  console.log(`✅ Utworzono repozytorium: ${repoId} (UUID: ${uuid})`);
  return meta;
}

export async function ensureRepoExists(repoId) {
  const p = path.join(repoBasePath(), repoId);
  if (!await fs.pathExists(p)) throw new Error(`Repozytorium '${repoId}' nie istnieje`);
  return p;
}

export async function commitRepo(repoId, sourcePath, message = 'Auto commit') {
  const repoDir     = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, 'versions');
  console.log(`📦 Tworzenie snapshotu dla: ${sourcePath}`);
  const result = await commitSnapshot(sourcePath, versionsDir, message);

  const entry = {
    id:        result.archiveName.replace(/\.zip$/, ''),
    file:      result.archiveName,
    message,
    size:      result.size,
    date:      new Date().toISOString(),
    fileCount: result.fileCount || 0,
  };

  dbAddCommit(repoId, entry);
  const now = new Date().toISOString();
  dbUpdateRepo(repoId, { updated_at: now, last_commit: entry });

  const current = dbGetRepo(repoId);
  dbUpdateRepoStats(repoId, (current?.snapshots || 0) + 1, (current?.size || 0) + result.size, now);

  return entry;
}

export async function getRepoCommits(repoId) {
  await ensureRepoExists(repoId);
  return dbGetCommits(repoId);
}

export async function getCommitPath(repoId, commitFile) {
  const repoDir     = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, 'versions');
  let targetPath = path.join(versionsDir, commitFile);
  if (await fs.pathExists(targetPath)) return targetPath;
  if (!commitFile.endsWith('.zip')) {
    targetPath = path.join(versionsDir, commitFile + '.zip');
    if (await fs.pathExists(targetPath)) return targetPath;
  }
  const files = await fs.readdir(versionsDir);
  const found = files.find(f => f.startsWith(commitFile));
  if (found) return path.join(versionsDir, found);
  return null;
}

export async function deleteCommit(repoId, commitFile) {
  const repoDir    = await ensureRepoExists(repoId);
  const commitPath = await getCommitPath(repoId, commitFile);
  if (!commitPath) throw new Error(`Snapshot '${commitFile}' nie znaleziony.`);

  const stat = await fs.stat(commitPath).catch(() => ({ size: 0 }));
  await fs.remove(commitPath);

  const targetName = path.basename(commitPath);
  dbDeleteCommit(repoId, targetName);

  const current = dbGetRepo(repoId);
  if (current) {
    const newSnapshots = Math.max(0, (current.snapshots || 0) - 1);
    const newSize      = Math.max(0, (current.size      || 0) - stat.size);
    const remaining    = dbGetCommits(repoId);
    const updatedAt    = remaining.length > 0 ? remaining[0].date : current.updatedAt;
    dbUpdateRepoStats(repoId, newSnapshots, newSize, updatedAt);
    dbUpdateRepo(repoId, {
      updated_at:  new Date().toISOString(),
      last_commit: remaining.length > 0 ? remaining[0] : null,
    });
  }

  zipCache.invalidate(commitPath);
  return true;
}

export async function deleteRepo(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  await fs.remove(repoDir);
  dbDeleteRepo(repoId);
  return true;
}

export async function updateRepoCategory(repoId, categoryId) {
  await ensureRepoExists(repoId);
  if (!/^[a-z0-9-]+$/.test(categoryId)) throw new Error("Kategoria musi być ID (np. 'backend')");
  dbUpdateRepo(repoId, { category: categoryId, updated_at: new Date().toISOString() });
  return dbGetRepo(repoId);
}

export async function updateRepoComment(repoId, comment) {
  await ensureRepoExists(repoId);
  dbUpdateRepo(repoId, { description: comment, updated_at: new Date().toISOString() });
  return dbGetRepo(repoId);
}

export async function getRepoStats(repoId) {
  const repo    = dbGetRepo(repoId);
  const commits = dbGetCommits(repoId);
  return {
    commitCount: commits.length,
    totalSize:   repo?.size || 0,
    averageSize: commits.length > 0 ? (repo?.size || 0) / commits.length : 0,
    firstCommit: commits.length > 0 ? commits[commits.length - 1] : null,
    lastCommit:  commits.length > 0 ? commits[0] : null,
  };
}

export async function reassignReposCategory(oldCategoryId, fallbackCategoryId = 'bez-kategorii') {
  const all = dbListRepos();
  let count = 0;
  for (const repo of all) {
    if (repo.category === oldCategoryId) {
      dbUpdateRepo(repo.id, { category: fallbackCategoryId, updated_at: new Date().toISOString() });
      count++;
    }
  }
  return count;
}

// ── DIFF ENGINE ────────────────────────────────────────────────────────────
async function unpackToTemp(zipPath, destDir) {
  await fs.emptyDir(destDir);
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  } catch (e) {
    console.error(`❌ Błąd rozpakowywania ${path.basename(zipPath)}:`, e.message);
    return {};
  }
  const map = [];
  const files = [];
  async function walk(dir) {
    try {
      for (const it of await fs.readdir(dir)) {
        const full = path.join(dir, it);
        try {
          const st = await fs.stat(full);
          if (st.isDirectory()) await walk(full);
          else files.push(full);
        } catch {}
      }
    } catch {}
  }
  await walk(destDir);
  const result = {};
  for (const f of files) {
    const rel = path.relative(destDir, f).replaceAll(path.sep, '/');
    try {
      const content = await fs.readFile(f);
      const hash    = crypto.createHash('sha1').update(content).digest('hex');
      result[rel]   = { size: content.length, hash };
    } catch { console.warn(`⚠️ Pominięto plik: ${rel}`); }
  }
  return result;
}

export async function getSnapshotMap(repoId, commitFile = 'latest') {
  const repoDir     = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, 'versions');
  const files       = await fs.readdir(versionsDir);
  const sorted      = files.filter(f => f.endsWith('.zip')).sort();
  let targetZip = commitFile === 'latest' ? sorted[sorted.length - 1] : commitFile;
  if (!targetZip) return {};
  const zipPath = path.join(versionsDir, targetZip);
  let zip = zipCache.get(zipPath);
  if (!zip) { zip = new AdmZip(zipPath); zipCache.set(zipPath, zip); }
  const map = {};
  zip.getEntries().forEach(entry => {
    if (!entry.isDirectory) {
      const content = entry.getData();
      const hash    = crypto.createHash('sha1').update(content).digest('hex');
      map[entry.entryName] = { size: entry.header.size, hash };
    }
  });
  return map;
}

export async function computeDiff(repoId, commitFile) {
  console.log(`🔍 computeDiff: repo=${repoId}, input=${commitFile}`);
  const tmpBase = path.join(os.tmpdir(), `mygit_diff_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  try {
    const repoDir     = await ensureRepoExists(repoId);
    const versionsDir = path.join(repoDir, 'versions');
    if (!await fs.pathExists(versionsDir)) throw new Error('Brak katalogu versions');

    const files  = await fs.readdir(versionsDir);
    const sorted = files.filter(f => f.endsWith('.zip')).sort();

    let targetFilename = null;
    if (!commitFile || commitFile === 'latest') {
      targetFilename = sorted[sorted.length - 1];
    } else {
      if (sorted.includes(commitFile))              targetFilename = commitFile;
      else if (sorted.includes(commitFile + '.zip')) targetFilename = commitFile + '.zip';
      else {
        const matches = sorted.filter(f => f.startsWith(commitFile));
        if (matches.length) targetFilename = matches[matches.length - 1];
      }
    }
    if (!targetFilename) throw new Error(`Snapshot nie znaleziony: ${commitFile}`);

    const idx          = sorted.indexOf(targetFilename);
    const prevFilename = idx > 0 ? sorted[idx - 1] : null;
    const result       = {
      added: [], removed: [], modified: [],
      prev: prevFilename, current: targetFilename,
      stats: { added: 0, removed: 0, modified: 0, totalChanges: 0 }
    };
    if (!prevFilename) return result;

    const aMap = await unpackToTemp(path.join(versionsDir, prevFilename),   path.join(tmpBase, 'prev'));
    const bMap = await unpackToTemp(path.join(versionsDir, targetFilename), path.join(tmpBase, 'curr'));
    const aKeys = new Set(Object.keys(aMap));
    const bKeys = new Set(Object.keys(bMap));
    for (const k of bKeys) {
      if (!aKeys.has(k)) result.added.push(k);
      else if (aMap[k].hash !== bMap[k].hash) result.modified.push(k);
    }
    for (const k of aKeys) { if (!bKeys.has(k)) result.removed.push(k); }
    result.stats = {
      added: result.added.length, removed: result.removed.length,
      modified: result.modified.length,
      totalChanges: result.added.length + result.removed.length + result.modified.length
    };
    console.log(`✅ Diff OK: ${result.stats.totalChanges} zmian`);
    return result;
  } catch (error) {
    console.error('❌ Błąd w computeDiff:', error.message);
    throw error;
  } finally {
    fs.remove(tmpBase).catch(() => {});
  }
}

export async function getFileFromCommit(repoId, commitFile, filePath) {
  const commitPath = await getCommitPath(repoId, commitFile);
  if (!commitPath) throw new Error('Snapshot nie znaleziony');
  let zip = zipCache.get(commitPath);
  if (!zip) { zip = new AdmZip(commitPath); zipCache.set(commitPath, zip); }
  const entry = zip.getEntry(filePath);
  if (!entry) throw new Error('Plik nie istnieje w snapshotcie');
  return { name: path.basename(filePath), path: filePath, size: entry.header.size, data: entry.getData() };
}
