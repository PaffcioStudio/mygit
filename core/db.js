// db.js — SQLite database layer for mygit
// Zastępuje: meta.json, commits.json, favourites.json, notes.json, archive/archive.json
// ZIP-y zostają na dysku — tylko metadane w DB

import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { config } from './utils.js';
import { zipCache } from './cache.js';

const DB_PATH = path.join(config.dataDir, 'mygit.db');
const BACKUP_DIR = path.join(config.dataDir, 'backup_json_' + new Date().toISOString().slice(0,10));

let _db = null;

// ── Inicjalizacja ──────────────────────────────────────────────────────────
export function getDb() {
  if (_db) return _db;
  throw new Error('Baza danych nie jest zainicjalizowana. Wywołaj initDb() najpierw.');
}

export async function initDb() {
  await fs.ensureDir(config.dataDir);
  _db = new Database(DB_PATH);

  // WAL mode — lepsza wydajność przy wielu odczytach
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('cache_size = -32000'); // 32MB cache
  _db.pragma('foreign_keys = ON');

  // ── Schemat ──────────────────────────────────────────────────────────────
  _db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id          TEXT PRIMARY KEY,
      uuid        TEXT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      category    TEXT DEFAULT 'bez-kategorii',
      created_at  TEXT,
      updated_at  TEXT,
      last_commit TEXT  -- JSON stringified last commit entry
    );

    CREATE TABLE IF NOT EXISTS commits (
      id          TEXT,
      repo_id     TEXT NOT NULL,
      file        TEXT NOT NULL,
      message     TEXT DEFAULT '',
      size        INTEGER DEFAULT 0,
      file_count  INTEGER DEFAULT 0,
      date        TEXT,
      PRIMARY KEY (repo_id, file),
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repo_stats (
      repo_id     TEXT PRIMARY KEY,
      snapshots   INTEGER DEFAULT 0,
      total_size  INTEGER DEFAULT 0,
      updated_at  TEXT,
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favourites (
      repo_id TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS notes (
      repo_id    TEXT PRIMARY KEY,
      content    TEXT DEFAULT '',
      tags       TEXT DEFAULT '[]',  -- JSON array
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS archive (
      repo_id    TEXT PRIMARY KEY,
      meta       TEXT DEFAULT '{}',  -- JSON object with archived repo metadata
      archived_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_id);
    CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(date);
    CREATE INDEX IF NOT EXISTS idx_repos_category ON repos(category);
    CREATE INDEX IF NOT EXISTS idx_repos_updated ON repos(updated_at);
  `);

  console.log(`✅ SQLite DB gotowa: ${DB_PATH}`);
  return _db;
}

// ── Migracja JSON → SQLite ─────────────────────────────────────────────────
export async function migrateFromJson() {
  const db = getDb();
  const reposDir = path.join(config.dataDir, 'repos');

  if (!await fs.pathExists(reposDir)) return;

  const migrated = db.prepare('SELECT COUNT(*) as cnt FROM repos').get().cnt;
  if (migrated > 0) {
    console.log(`ℹ️  SQLite już zawiera dane (${migrated} repozytoriów) — pomijam migrację JSON`);
    return;
  }

  console.log('🔄 Migracja JSON → SQLite...');
  const dirs = await fs.readdir(reposDir);
  let repoCount = 0, commitCount = 0;

  const insertRepo   = db.prepare(`INSERT OR REPLACE INTO repos (id,uuid,name,description,category,created_at,updated_at,last_commit) VALUES (?,?,?,?,?,?,?,?)`);
  const insertCommit = db.prepare(`INSERT OR REPLACE INTO commits (id,repo_id,file,message,size,file_count,date) VALUES (?,?,?,?,?,?,?)`);
  const insertStats  = db.prepare(`INSERT OR REPLACE INTO repo_stats (repo_id,snapshots,total_size,updated_at) VALUES (?,?,?,?)`);

  const migrate = db.transaction(async (dirsToProcess) => {
    for (const d of dirsToProcess) {
      const metaFile    = path.join(reposDir, d, 'meta.json');
      const commitsFile = path.join(reposDir, d, 'commits.json');
      const versionsDir = path.join(reposDir, d, 'versions');

      if (!await fs.pathExists(metaFile)) continue;

      // Repo meta
      let meta = {};
      try { meta = await fs.readJson(metaFile); } catch {}

      insertRepo.run(
        d,
        meta.uuid || generateUUID(),
        meta.name || d,
        meta.description || '',
        meta.category || 'bez-kategorii',
        meta.createdAt || new Date().toISOString(),
        meta.updatedAt || new Date().toISOString(),
        meta.lastCommit ? JSON.stringify(meta.lastCommit) : null
      );
      repoCount++;

      // Commits
      let commits = [];
      try {
        if (await fs.pathExists(commitsFile)) commits = await fs.readJson(commitsFile);
      } catch {}

      let totalSize = 0;
      for (const c of commits) {
        insertCommit.run(
          c.id || c.file?.replace(/\.zip$/, '') || d + '_' + c.date,
          d,
          c.file || '',
          c.message || '',
          c.size || 0,
          c.fileCount || 0,
          c.date || new Date().toISOString()
        );
        totalSize += c.size || 0;
        commitCount++;
      }

      // Stats z commits.json — mamy już rozmiary, nie musimy stat() ZIP-ów
      // Ale weryfikujemy ile plików faktycznie jest w versions/
      let snapshotCount = 0;
      try {
        const vFiles = await fs.readdir(versionsDir);
        snapshotCount = vFiles.filter(f => f.endsWith('.zip')).length;
        // Jeśli commits.json ma mniej wpisów niż plików, zaufaj liczbie plików
        if (snapshotCount > commits.length) {
          // Policz rozmiary brakujących ZIP-ów
          for (const f of vFiles) {
            if (f.endsWith('.zip') && !commits.find(c => c.file === f)) {
              try {
                const stat = await fs.stat(path.join(versionsDir, f));
                totalSize += stat.size;
              } catch {}
            }
          }
        }
      } catch { snapshotCount = commits.length; }

      const updatedAt = commits.length > 0
        ? commits[commits.length - 1].date || meta.updatedAt
        : meta.updatedAt || new Date().toISOString();

      insertStats.run(d, snapshotCount, totalSize, updatedAt);
    }
  });

  await migrate(dirs);

  // Migracja ulubionych
  const favsFile = path.join(config.dataDir, 'favourites.json');
  if (await fs.pathExists(favsFile)) {
    try {
      const { favourites = [] } = await fs.readJson(favsFile);
      const insertFav = db.prepare('INSERT OR IGNORE INTO favourites (repo_id) VALUES (?)');
      const insertAllFavs = db.transaction((ids) => { for (const id of ids) insertFav.run(id); });
      insertAllFavs(favourites);
      console.log(`  ✓ Ulubione: ${favourites.length}`);
    } catch (e) { console.warn('  ⚠ Błąd migracji ulubionych:', e.message); }
  }

  // Migracja notatek
  const notesFile = path.join(config.dataDir, 'notes.json');
  if (await fs.pathExists(notesFile)) {
    try {
      const notes = await fs.readJson(notesFile);
      const insertNote = db.prepare('INSERT OR REPLACE INTO notes (repo_id,content,tags,updated_at) VALUES (?,?,?,?)');
      const insertAllNotes = db.transaction((notesObj) => {
        for (const [repoId, note] of Object.entries(notesObj)) {
          insertNote.run(
            repoId,
            note.content || note.text || '',
            JSON.stringify(note.tags || []),
            note.updatedAt || new Date().toISOString()
          );
        }
      });
      insertAllNotes(notes);
      console.log(`  ✓ Notatki: ${Object.keys(notes).length}`);
    } catch (e) { console.warn('  ⚠ Błąd migracji notatek:', e.message); }
  }

  // Migracja archiwum
  const archiveFile = path.join(config.dataDir, 'archive', 'archive.json');
  if (await fs.pathExists(archiveFile)) {
    try {
      const { archived = [], meta: archiveMeta = {} } = await fs.readJson(archiveFile);
      const insertArch = db.prepare('INSERT OR REPLACE INTO archive (repo_id,meta,archived_at) VALUES (?,?,?)');
      const insertAllArch = db.transaction((ids) => {
        for (const id of ids) {
          insertArch.run(id, JSON.stringify(archiveMeta[id] || {}), new Date().toISOString());
        }
      });
      insertAllArch(archived);
      console.log(`  ✓ Archiwum: ${archived.length}`);
    } catch (e) { console.warn('  ⚠ Błąd migracji archiwum:', e.message); }
  }

  console.log(`✅ Migracja zakończona: ${repoCount} repo, ${commitCount} commitów`);

  // Backup starych JSON-ów (nie usuwamy — zostają jako zabezpieczenie)
  await backupJsonFiles(reposDir);
}

async function backupJsonFiles(reposDir) {
  try {
    await fs.ensureDir(BACKUP_DIR);
    // Kopiuj globalne JSON-y
    const globalFiles = ['favourites.json', 'notes.json'];
    for (const f of globalFiles) {
      const src = path.join(config.dataDir, f);
      if (await fs.pathExists(src)) {
        await fs.copy(src, path.join(BACKUP_DIR, f));
      }
    }
    const archiveFile = path.join(config.dataDir, 'archive', 'archive.json');
    if (await fs.pathExists(archiveFile)) {
      await fs.copy(archiveFile, path.join(BACKUP_DIR, 'archive.json'));
    }
    // Kopiuj meta.json i commits.json każdego repo
    const dirs = await fs.readdir(reposDir).catch(() => []);
    for (const d of dirs) {
      const repoBackupDir = path.join(BACKUP_DIR, 'repos', d);
      await fs.ensureDir(repoBackupDir);
      for (const f of ['meta.json', 'commits.json']) {
        const src = path.join(reposDir, d, f);
        if (await fs.pathExists(src)) await fs.copy(src, path.join(repoBackupDir, f));
      }
    }
    console.log(`📦 Backup JSON → ${BACKUP_DIR}`);
  } catch (e) {
    console.warn('⚠ Nie udało się zrobić backupu JSON:', e.message);
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── REPOS API ─────────────────────────────────────────────────────────────
export function dbListRepos() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, rs.snapshots, rs.total_size, rs.updated_at as stats_updated_at,
           CASE WHEN f.repo_id IS NOT NULL THEN 1 ELSE 0 END as is_favourite
    FROM repos r
    LEFT JOIN repo_stats rs ON rs.repo_id = r.id
    LEFT JOIN favourites f  ON f.repo_id  = r.id
    ORDER BY COALESCE(rs.updated_at, r.updated_at) DESC
  `).all();

  return rows.map(r => ({
    id:          r.id,
    uuid:        r.uuid,
    name:        r.name,
    description: r.description,
    category:    r.category,
    createdAt:   r.created_at,
    updatedAt:   r.stats_updated_at || r.updated_at,
    lastCommit:  r.last_commit ? JSON.parse(r.last_commit) : null,
    snapshots:   r.snapshots || 0,
    size:        r.total_size || 0,
    isFavourite: r.is_favourite === 1,
  }));
}

export function dbGetRepo(repoId) {
  const db = getDb();
  const r = db.prepare(`
    SELECT r.*, rs.snapshots, rs.total_size, rs.updated_at as stats_updated_at,
           CASE WHEN f.repo_id IS NOT NULL THEN 1 ELSE 0 END as is_favourite
    FROM repos r
    LEFT JOIN repo_stats rs ON rs.repo_id = r.id
    LEFT JOIN favourites f  ON f.repo_id  = r.id
    WHERE r.id = ?
  `).get(repoId);
  if (!r) return null;
  return {
    id:          r.id,
    uuid:        r.uuid,
    name:        r.name,
    description: r.description,
    category:    r.category,
    createdAt:   r.created_at,
    updatedAt:   r.stats_updated_at || r.updated_at,
    lastCommit:  r.last_commit ? JSON.parse(r.last_commit) : null,
    snapshots:   r.snapshots || 0,
    size:        r.total_size || 0,
    isFavourite: r.is_favourite === 1,
  };
}

export function dbCreateRepo(id, name, description, category, uuid) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO repos (id,uuid,name,description,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, uuid || generateUUID(), name || id, description || '', category || 'bez-kategorii', now, now);
  db.prepare(`INSERT INTO repo_stats (repo_id,snapshots,total_size,updated_at) VALUES (?,0,0,?)`)
    .run(id, now);
  return dbGetRepo(id);
}

export function dbUpdateRepo(repoId, fields) {
  const db = getDb();
  const allowed = ['name','description','category','updated_at','last_commit'];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    if (allowed.includes(col)) { sets.push(`${col} = ?`); vals.push(typeof v === 'object' ? JSON.stringify(v) : v); }
  }
  if (!sets.length) return;
  vals.push(repoId);
  db.prepare(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function dbDeleteRepo(repoId) {
  const db = getDb();
  // CASCADE usuwa commits, stats, favourites, notes, archive
  db.prepare('DELETE FROM repos WHERE id = ?').run(repoId);
  zipCache.invalidateRepo(repoId);
}

export function dbUpdateRepoStats(repoId, snapshots, totalSize, updatedAt) {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO repo_stats (repo_id,snapshots,total_size,updated_at) VALUES (?,?,?,?)`)
    .run(repoId, snapshots, totalSize, updatedAt || new Date().toISOString());
}

// ── COMMITS API ───────────────────────────────────────────────────────────
export function dbGetCommits(repoId) {
  const db = getDb();
  return db.prepare('SELECT * FROM commits WHERE repo_id = ? ORDER BY date DESC')
    .all(repoId)
    .map(r => ({
      id:        r.id,
      file:      r.file,
      message:   r.message,
      size:      r.size,
      fileCount: r.file_count,
      date:      r.date,
    }));
}

export function dbAddCommit(repoId, commit) {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO commits (id,repo_id,file,message,size,file_count,date) VALUES (?,?,?,?,?,?,?)`)
    .run(
      commit.id || commit.file?.replace(/\.zip$/, '') || repoId + '_' + Date.now(),
      repoId,
      commit.file,
      commit.message || '',
      commit.size || 0,
      commit.fileCount || 0,
      commit.date || new Date().toISOString()
    );
}

export function dbDeleteCommit(repoId, file) {
  const db = getDb();
  db.prepare('DELETE FROM commits WHERE repo_id = ? AND file = ?').run(repoId, file);
}

// ── FAVOURITES API ────────────────────────────────────────────────────────
export function dbGetFavourites() {
  return getDb().prepare('SELECT repo_id FROM favourites').all().map(r => r.repo_id);
}

export function dbAddFavourite(repoId) {
  getDb().prepare('INSERT OR IGNORE INTO favourites (repo_id) VALUES (?)').run(repoId);
}

export function dbRemoveFavourite(repoId) {
  getDb().prepare('DELETE FROM favourites WHERE repo_id = ?').run(repoId);
}

// ── NOTES API ─────────────────────────────────────────────────────────────
export function dbGetAllNotes() {
  const rows = getDb().prepare('SELECT * FROM notes').all();
  const out = {};
  for (const r of rows) {
    out[r.repo_id] = {
      content:   r.content,
      tags:      JSON.parse(r.tags || '[]'),
      updatedAt: r.updated_at,
    };
  }
  return out;
}

export function dbGetNote(repoId) {
  const r = getDb().prepare('SELECT * FROM notes WHERE repo_id = ?').get(repoId);
  if (!r) return null;
  return { content: r.content, tags: JSON.parse(r.tags || '[]'), updatedAt: r.updated_at };
}

export function dbSaveNote(repoId, note) {
  getDb().prepare(`INSERT OR REPLACE INTO notes (repo_id,content,tags,updated_at) VALUES (?,?,?,?)`)
    .run(repoId, note.content || '', JSON.stringify(note.tags || []), new Date().toISOString());
}

// ── ARCHIVE API ───────────────────────────────────────────────────────────
export function dbGetArchive() {
  const rows = getDb().prepare('SELECT * FROM archive').all();
  const archived = rows.map(r => r.repo_id);
  const meta = {};
  for (const r of rows) { try { meta[r.repo_id] = JSON.parse(r.meta || '{}'); } catch {} }
  return { archived, meta };
}

export function dbArchiveRepo(repoId, metaData) {
  getDb().prepare(`INSERT OR REPLACE INTO archive (repo_id,meta,archived_at) VALUES (?,?,?)`)
    .run(repoId, JSON.stringify(metaData || {}), new Date().toISOString());
}

export function dbUnarchiveRepo(repoId) {
  getDb().prepare('DELETE FROM archive WHERE repo_id = ?').run(repoId);
}

// ── DB INFO ───────────────────────────────────────────────────────────────
export function dbGetStats() {
  const db = getDb();
  return {
    repos:   db.prepare('SELECT COUNT(*) as n FROM repos').get().n,
    commits: db.prepare('SELECT COUNT(*) as n FROM commits').get().n,
    notes:   db.prepare('SELECT COUNT(*) as n FROM notes').get().n,
    archive: db.prepare('SELECT COUNT(*) as n FROM archive').get().n,
    favs:    db.prepare('SELECT COUNT(*) as n FROM favourites').get().n,
  };
}

// ── GRACEFUL CLOSE ────────────────────────────────────────────────────────
process.on('exit',    () => { if (_db) _db.close(); });
process.on('SIGINT',  () => { if (_db) { _db.close(); process.exit(0); } });
process.on('SIGTERM', () => { if (_db) { _db.close(); process.exit(0); } });
