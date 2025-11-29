import fs from "fs-extra";
import path from "path";
import os from "os";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { repoBasePath, ensureDataDir, getProjectRoot } from "./utils.js";
import { commitSnapshot } from "./snapshot.js";

// Upewnij się, że używamy właściwego katalogu danych
await ensureDataDir();
await fs.ensureDir(repoBasePath());

export async function listRepos() {
  const base = repoBasePath();
  if (!await fs.pathExists(base)) {
    return [];
  }
  
  const dirs = await fs.readdir(base);
  const out = [];
  for (const d of dirs) {
    const metaFile = path.join(base, d, "meta.json");
    if (await fs.pathExists(metaFile)) {
      try {
        const meta = await fs.readJson(metaFile);
        out.push({ id: d, ...meta });
      } catch (e) {
        console.error(`Błąd wczytywania meta dla ${d}:`, e.message);
      }
    }
  }
  return out;
}

export async function createRepo(repoId, displayName = null, description = "") {
  const repoDir = path.join(repoBasePath(), repoId);
  if (await fs.pathExists(repoDir)) {
    throw new Error("Repozytorium już istnieje");
  }
  
  await fs.ensureDir(repoDir);
  await fs.ensureDir(path.join(repoDir, "versions"));
  
  const metaData = {
    id: repoId,
    name: displayName || repoId,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await fs.writeJson(path.join(repoDir, "meta.json"), metaData, { spaces: 2 });
  await fs.writeJson(path.join(repoDir, "commits.json"), []);
  
  return metaData;
}

export async function ensureRepoExists(repoId) {
  const p = path.join(repoBasePath(), repoId);
  if (!await fs.pathExists(p)) {
    throw new Error(`Repozytorium '${repoId}' nie istnieje`);
  }
  return p;
}

export async function commitRepo(repoId, sourcePath, message = "Auto commit") {
  const repoDir = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, "versions");
  
  console.log(`📦 Tworzenie snapshotu dla: ${sourcePath}`);
  console.log(`💾 Cel: ${versionsDir}`);
  
  const result = await commitSnapshot(sourcePath, versionsDir, message);
  
  const commFile = path.join(repoDir, "commits.json");
  const commits = (await fs.pathExists(commFile)) ? await fs.readJson(commFile) : [];
  
  const entry = {
    id: result.archiveName.replace(/\.zip$/, ""),
    file: result.archiveName,
    message,
    size: result.size,
    date: new Date().toISOString(),
    fileCount: result.fileCount || 0
  };
  
  commits.push(entry);
  await fs.writeJson(commFile, commits, { spaces: 2 });
  
  // Aktualizuj datę modyfikacji w meta
  const metaFile = path.join(repoDir, "meta.json");
  const meta = await fs.readJson(metaFile);
  meta.updatedAt = new Date().toISOString();
  meta.lastCommit = entry;
  await fs.writeJson(metaFile, meta, { spaces: 2 });
  
  return entry;
}

export async function getRepoCommits(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  const commFile = path.join(repoDir, "commits.json");
  if (!await fs.pathExists(commFile)) return [];
  
  const commits = await fs.readJson(commFile);
  // Sortuj od najnowszego do najstarszego
  return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function getCommitPath(repoId, commitFile) {
  const repoDir = await ensureRepoExists(repoId);
  const filePath = path.join(repoDir, "versions", commitFile);
  
  if (await fs.pathExists(filePath)) return filePath;
  
  // Jeśli podano id (prefiks), znajdź odpowiadający plik
  const files = await fs.readdir(path.join(repoDir, "versions"));
  const found = files.find(f => f.startsWith(commitFile));
  if (found) return path.join(repoDir, "versions", found);
  
  return null;
}

export async function deleteCommit(repoId, commitFile) {
  const repoDir = await ensureRepoExists(repoId);
  const commitPath = await getCommitPath(repoId, commitFile);
  
  if (!commitPath) {
    throw new Error("Snapshot nie znaleziony");
  }
  
  // Usuń plik .zip
  await fs.remove(commitPath);
  
  // Zaktualizuj commits.json — usuń wpis
  const commFile = path.join(repoDir, "commits.json");
  const commits = (await fs.pathExists(commFile)) ? await fs.readJson(commFile) : [];
  const keep = commits.filter(c => path.basename(c.file) !== path.basename(commitPath));
  await fs.writeJson(commFile, keep, { spaces: 2 });
  
  return true;
}

export async function deleteRepo(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  await fs.remove(repoDir);
  return true;
}

// Rozpakuj zip do katalogu tymczasowego i zwróć mapę ścieżka->hash
async function unpackToTemp(zipPath, destDir) {
  await fs.ensureDir(destDir);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  
  // Zbierz pliki i policz hash
  const files = [];
  async function walk(dir) {
    const items = await fs.readdir(dir);
    for (const it of items) {
      const full = path.join(dir, it);
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        await walk(full);
      } else {
        files.push(full);
      }
    }
  }
  
  await walk(destDir);
  const map = {};
  
  for (const f of files) {
    const rel = path.relative(destDir, f).replaceAll(path.sep, "/");
    const hash = crypto.createHash("sha1").update(await fs.readFile(f)).digest("hex");
    map[rel] = { 
      size: (await fs.stat(f)).size, 
      hash 
    };
  }
  
  return map;
}

export async function computeDiff(repoId, commitFile) {
  console.log(`🔍 computeDiff: repo=${repoId}, file=${commitFile}`);
  
  try {
    const repoDir = await ensureRepoExists(repoId);
    const versionsDir = path.join(repoDir, "versions");
    
    // Sprawdź czy katalog wersji istnieje
    if (!await fs.pathExists(versionsDir)) {
      throw new Error("Katalog wersji nie istnieje");
    }
    
    const files = await fs.readdir(versionsDir);
    console.log(`📁 Znalezione pliki w versions:`, files);
    
    if (files.length === 0) {
      throw new Error("Brak snapshotów w repozytorium");
    }

    // Znajdź index commitów posortowanych (alfabetycznie timestamp -> porządek chronologiczny)
    const sorted = files.sort();
    
    // Znajdź nazwę pliku docelowego dokładnie lub prefiks
    const target = files.find(f => f.startsWith(commitFile)) || null;
    if (!target) {
      throw new Error(`Snapshot '${commitFile}' nie znaleziony. Dostępne: ${files.join(', ')}`);
    }
    
    console.log(`🎯 Cel diff: ${target}`);
    console.log(`📊 Wszystkie pliki:`, sorted);

    const idx = sorted.indexOf(target);
    console.log(`📈 Index celu: ${idx}`);
    
    const prev = (idx > 0) ? sorted[idx - 1] : null;
    console.log(`📉 Poprzedni commit: ${prev}`);

    // Jeśli nie ma poprzedniego commita, zwróć pusty diff z informacją
    if (!prev) {
      console.log("ℹ️  Brak poprzedniego commita - zwracam pusty diff");
      return { 
        added: [], 
        removed: [], 
        modified: [], 
        prev: null, 
        current: target,
        stats: {
          added: 0,
          removed: 0,
          modified: 0,
          totalChanges: 0
        },
        info: "To jest pierwszy snapshot - brak poprzedniej wersji do porównania"
      };
    }

    const tmpBase = path.join(os.tmpdir(), "mygit_" + Date.now() + "_" + Math.random().toString(36).slice(2));
    const aDir = path.join(tmpBase, "a");
    const bDir = path.join(tmpBase, "b");
    
    console.log(`📂 Tymczasowe katalogi: a=${aDir}, b=${bDir}`);
    
    try {
      // Jeśli prev istnieje rozpakuj do a, inaczej a = {}
      if (prev) {
        console.log(`📦 Rozpakowywanie poprzedniego: ${prev}`);
        await unpackToTemp(path.join(versionsDir, prev), aDir);
      } else {
        console.log("📦 Tworzenie pustego katalogu dla poprzedniego");
        await fs.ensureDir(aDir);
      }
      
      console.log(`📦 Rozpakowywanie obecnego: ${target}`);
      await unpackToTemp(path.join(versionsDir, target), bDir);

      const aMap = await buildMap(aDir);
      const bMap = await buildMap(bDir);
      
      console.log(`🗂️  Mapy: a=${Object.keys(aMap).length} plików, b=${Object.keys(bMap).length} plików`);

      // Porównaj klucze
      const added = [];
      const removed = [];
      const modified = [];

      const aKeys = new Set(Object.keys(aMap));
      const bKeys = new Set(Object.keys(bMap));

      for (const k of bKeys) {
        if (!aKeys.has(k)) {
          added.push(k);
        } else if (aMap[k].hash !== bMap[k].hash) {
          modified.push(k);
        }
      }
      
      for (const k of aKeys) {
        if (!bKeys.has(k)) {
          removed.push(k);
        }
      }

      const result = { 
        added, 
        removed, 
        modified, 
        prev: prev || null, 
        current: target,
        stats: {
          added: added.length,
          removed: removed.length,
          modified: modified.length,
          totalChanges: added.length + removed.length + modified.length
        }
      };
      
      console.log(`✅ Diff zakończony:`, result.stats);
      return result;
      
    } finally {
      // Sprzątnij temp
      try { 
        await fs.remove(tmpBase); 
        console.log(`🧹 Posprzątano katalog tymczasowy: ${tmpBase}`);
      } catch(e) {
        console.error("Błąd czyszczenia temp:", e.message);
      }
    }
  } catch (error) {
    console.error(`❌ Błąd w computeDiff:`, error);
    throw error;
  }
}

async function buildMap(dir) {
  const map = {};
  if (!await fs.pathExists(dir)) return map;
  
  async function walk(d) {
    const items = await fs.readdir(d);
    for (const it of items) {
      const full = path.join(d, it);
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        await walk(full);
      } else {
        const rel = path.relative(dir, full).replaceAll(path.sep, "/");
        const hash = crypto.createHash("sha1").update(await fs.readFile(full)).digest("hex");
        map[rel] = { 
          hash, 
          size: st.size 
        };
      }
    }
  }
  
  await walk(dir);
  return map;
}

// Pobierz szczegóły pliku z snapshotu
export async function getFileFromCommit(repoId, commitFile, filePath) {
  const commitPath = await getCommitPath(repoId, commitFile);
  if (!commitPath) {
    throw new Error("Snapshot nie znaleziony");
  }
  
  const zip = new AdmZip(commitPath);
  const entry = zip.getEntry(filePath);
  
  if (!entry) {
    throw new Error("Plik nie istnieje w snapshotcie");
  }
  
  return {
    name: path.basename(filePath),
    path: filePath,
    size: entry.header.size,
    data: entry.getData(),
    isText: !entry.isDirectory && isTextFile(filePath)
  };
}

// Sprawdź czy plik jest tekstowy
function isTextFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const textExtensions = ['.txt', '.js', '.json', '.html', '.css', '.md', '.xml', '.yml', '.yaml', '.php', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.go', '.rs', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
  return textExtensions.includes(ext);
}

// Pobierz statystyki repozytorium
export async function getRepoStats(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, "versions");
  const commitsFile = path.join(repoDir, "commits.json");
  
  const commits = await fs.readJson(commitsFile);
  const versions = await fs.readdir(versionsDir);
  
  let totalSize = 0;
  for (const version of versions) {
    const stat = await fs.stat(path.join(versionsDir, version));
    totalSize += stat.size;
  }
  
  return {
    commitCount: commits.length,
    totalSize,
    averageSize: commits.length > 0 ? totalSize / commits.length : 0,
    firstCommit: commits.length > 0 ? commits[0] : null,
    lastCommit: commits.length > 0 ? commits[commits.length - 1] : null
  };
}

// Aktualizuj opis repozytorium
export async function updateRepoComment(repoId, comment) {
  const repoDir = await ensureRepoExists(repoId);
  const metaFile = path.join(repoDir, "meta.json");
  
  const meta = await fs.readJson(metaFile);
  meta.description = comment;
  meta.updatedAt = new Date().toISOString();
  
  await fs.writeJson(metaFile, meta, { spaces: 2 });
  
  return meta;
}