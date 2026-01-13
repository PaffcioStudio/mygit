import fs from "fs-extra";
import path from "path";
import os from "os";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { repoBasePath, ensureDataDir } from "./utils.js";
import { commitSnapshot } from "./snapshot.js";

// Upewnij się, że używamy właściwego katalogu danych przy starcie
await ensureDataDir();
await fs.ensureDir(repoBasePath());

// === PUBLIC API ===

export async function listRepos() {
  const base = repoBasePath();
  if (!await fs.pathExists(base)) return [];
  
  const dirs = await fs.readdir(base);
  const out = [];
  for (const d of dirs) {
    const metaFile = path.join(base, d, "meta.json");
    if (await fs.pathExists(metaFile)) {
      try {
        const meta = await fs.readJson(metaFile);
        out.push({ id: d, ...meta });
      } catch (e) {
        out.push({ id: d, name: d, description: "Błąd odczytu metadanych" });
      }
    }
  }
  return out;
}

export async function registerUploadedSnapshot(repoId, tempZipPath, message = "snapshot") {
  const repoDir = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, "versions");
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  const archiveName = `${timestamp}.zip`;
  const outPath = path.join(versionsDir, archiveName);

  console.log(`📥 Rejestrowanie uploadu: ${repoId} -> ${archiveName}`);

  await fs.ensureDir(versionsDir);
  await fs.move(tempZipPath, outPath, { overwrite: true });

  const commFile = path.join(repoDir, "commits.json");
  const commits = (await fs.pathExists(commFile)) ? await fs.readJson(commFile) : [];
  const stat = await fs.stat(outPath);
  
  let fileCount = 0;
  try {
    const zip = new AdmZip(outPath);
    fileCount = zip.getEntries().filter(e => !e.isDirectory).length;
  } catch (e) { /* ignore zip error on count */ }

  const entry = {
    id: archiveName.replace(/\.zip$/, ""),
    file: archiveName,
    message,
    size: stat.size,
    date: new Date().toISOString(),
    fileCount
  };

  commits.push(entry);
  await fs.writeJson(commFile, commits, { spaces: 2 });

  const metaFile = path.join(repoDir, "meta.json");
  let meta = {};
  try { meta = await fs.readJson(metaFile); } catch (e) {}
  
  meta.updatedAt = new Date().toISOString();
  meta.lastCommit = entry;
  await fs.writeJson(metaFile, meta, { spaces: 2 });

  return entry;
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
  
  const metaFile = path.join(repoDir, "meta.json");
  let meta = {};
  try { meta = await fs.readJson(metaFile); } catch (e) {}
  
  meta.updatedAt = new Date().toISOString();
  meta.lastCommit = entry;
  await fs.writeJson(metaFile, meta, { spaces: 2 });
  return entry;
}

export async function getRepoCommits(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  const commFile = path.join(repoDir, "commits.json");
  if (!await fs.pathExists(commFile)) return [];
  try {
    const commits = await fs.readJson(commFile);
    return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (e) { return []; }
}

export async function getCommitPath(repoId, commitFile) {
  const repoDir = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, "versions");
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
  const repoDir = await ensureRepoExists(repoId);
  const commitPath = await getCommitPath(repoId, commitFile);
  
  if (!commitPath) throw new Error(`Snapshot '${commitFile}' nie znaleziony.`);

  // 1. Usuń plik fizycznie
  await fs.remove(commitPath);

  // 2. Zaktualizuj commits.json
  const commFile = path.join(repoDir, "commits.json");
  let newCommits = [];
  
  if (await fs.pathExists(commFile)) {
    const commits = await fs.readJson(commFile);
    const targetName = path.basename(commitPath);
    // Filtrujemy, żeby usunąć ten konkretny plik
    newCommits = commits.filter(c => c.file !== targetName);
    await fs.writeJson(commFile, newCommits, { spaces: 2 });
  }

  // 3. Zaktualizuj meta.json (To naprawia statystyki i lastCommit!)
  const metaFile = path.join(repoDir, "meta.json");
  if (await fs.pathExists(metaFile)) {
    const meta = await fs.readJson(metaFile);
    meta.updatedAt = new Date().toISOString();
    // Ustawiamy ostatni commit na ostatni element z nowej listy (lub null jeśli pusto)
    meta.lastCommit = newCommits.length > 0 ? newCommits[newCommits.length - 1] : null;
    await fs.writeJson(metaFile, meta, { spaces: 2 });
  }

  return true;
}

export async function deleteRepo(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  await fs.remove(repoDir);
  return true;
}

// === DIFF ENGINE (Wersja Pancerna) ===

async function unpackToTemp(zipPath, destDir) {
  // Używamy bezpiecznej ścieżki i czyścimy ją najpierw
  await fs.emptyDir(destDir);
  
  try {
    const zip = new AdmZip(zipPath);
    // Wyodrębnij synchronicznie (AdmZip jest sync), ale w bloku try/catch
    zip.extractAllTo(destDir, true);
  } catch (e) {
    console.error(`❌ Błąd rozpakowywania ${path.basename(zipPath)}:`, e.message);
    // Jeśli ZIP jest uszkodzony, zwracamy pustą mapę, ale NIE rzucamy błędu wyżej,
    // żeby porównanie zadziałało (po prostu potraktuje ten snapshot jako pusty)
    return {};
  }
  
  // Zbierz pliki i policz hash
  const map = {};
  const files = [];

  async function walk(dir) {
    try {
        const items = await fs.readdir(dir);
        for (const it of items) {
            const full = path.join(dir, it);
            try {
                const st = await fs.stat(full);
                if (st.isDirectory()) {
                    await walk(full);
                } else {
                    files.push(full);
                }
            } catch(e) { /* ignore stat error */ }
        }
    } catch(e) { /* ignore readdir error */ }
  }
  
  await walk(destDir);
  
  for (const f of files) {
    const rel = path.relative(destDir, f).replaceAll(path.sep, "/");
    try {
        const content = await fs.readFile(f);
        const hash = crypto.createHash("sha1").update(content).digest("hex");
        map[rel] = { size: content.length, hash };
    } catch (err) {
        // Jeśli antywirus zablokuje odczyt konkretnego pliku, pomiń go
        console.warn(`⚠️ Pominięto plik (blokada?): ${rel}`);
    }
  }
  
  return map;
}

export async function computeDiff(repoId, commitFile) {
  console.log(`🔍 computeDiff: repo=${repoId}, input=${commitFile}`);
  
  // Unikalny katalog temp per request
  const tmpBase = path.join(os.tmpdir(), "mygit_diff_" + Date.now() + "_" + Math.random().toString(36).slice(2));
  
  try {
    const repoDir = await ensureRepoExists(repoId);
    const versionsDir = path.join(repoDir, "versions");
    
    if (!await fs.pathExists(versionsDir)) throw new Error("Brak katalogu versions");
    
    const files = await fs.readdir(versionsDir);
    const sorted = files.filter(f => f.endsWith('.zip')).sort();
    
    let targetFilename = null;
    if (!commitFile || commitFile === 'latest') {
        targetFilename = sorted[sorted.length - 1];
    } else {
        if (sorted.includes(commitFile)) targetFilename = commitFile;
        else if (sorted.includes(commitFile + '.zip')) targetFilename = commitFile + '.zip';
        else {
            const matches = sorted.filter(f => f.startsWith(commitFile));
            if (matches.length > 0) targetFilename = matches[matches.length - 1];
        }
    }

    if (!targetFilename) throw new Error(`Snapshot nie znaleziony: ${commitFile}`);

    // Poprzedni commit
    const idx = sorted.indexOf(targetFilename);
    const prevFilename = (idx > 0) ? sorted[idx - 1] : null;
    
    const result = { 
        added: [], removed: [], modified: [], 
        prev: prevFilename, current: targetFilename,
        stats: { added: 0, removed: 0, modified: 0, totalChanges: 0 }
    };

    if (!prevFilename) return result;

    const aDir = path.join(tmpBase, "prev");
    const bDir = path.join(tmpBase, "curr");
    
    // Rozpakuj oba snapshoty
    const aMap = await unpackToTemp(path.join(versionsDir, prevFilename), aDir);
    const bMap = await unpackToTemp(path.join(versionsDir, targetFilename), bDir);

    // Porównaj
    const aKeys = new Set(Object.keys(aMap));
    const bKeys = new Set(Object.keys(bMap));

    for (const k of bKeys) {
        if (!aKeys.has(k)) result.added.push(k);
        else if (aMap[k].hash !== bMap[k].hash) result.modified.push(k);
    }
    for (const k of aKeys) {
        if (!bKeys.has(k)) result.removed.push(k);
    }

    result.stats.added = result.added.length;
    result.stats.removed = result.removed.length;
    result.stats.modified = result.modified.length;
    result.stats.totalChanges = result.stats.added + result.stats.removed + result.stats.modified;

    console.log(`Diff OK: ${result.stats.totalChanges} zmian`);
    return result;

  } catch (error) {
    console.error("❌ Błąd w computeDiff:", error.message);
    throw error;
  } finally {
    // Sprzątanie asynchroniczne - nie blokuj odpowiedzi
    fs.remove(tmpBase).catch(() => {});
  }
}

export async function getFileFromCommit(repoId, commitFile, filePath) {
  const commitPath = await getCommitPath(repoId, commitFile);
  if (!commitPath) throw new Error("Snapshot nie znaleziony");
  
  const zip = new AdmZip(commitPath);
  const entry = zip.getEntry(filePath);
  if (!entry) throw new Error("Plik nie istnieje w snapshotcie");
  
  return {
    name: path.basename(filePath),
    path: filePath,
    size: entry.header.size,
    data: entry.getData(),
    isText: !entry.isDirectory && isTextFile(filePath)
  };
}

function isTextFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const textExtensions = ['.txt', '.js', '.json', '.html', '.css', '.md', '.xml', '.yml', '.yaml', '.php', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.go', '.rs', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
  return textExtensions.includes(ext);
}

export async function getRepoStats(repoId) {
  const repoDir = await ensureRepoExists(repoId);
  const versionsDir = path.join(repoDir, "versions");
  const commitsFile = path.join(repoDir, "commits.json");
  const commits = (await fs.pathExists(commitsFile)) ? await fs.readJson(commitsFile) : [];
  let versions = [];
  try { versions = await fs.readdir(versionsDir); } catch (e) {}
  
  let totalSize = 0;
  for (const version of versions) {
    try {
        const stat = await fs.stat(path.join(versionsDir, version));
        totalSize += stat.size;
    } catch(e) {}
  }
  
  return {
    commitCount: commits.length,
    totalSize,
    averageSize: commits.length > 0 ? totalSize / commits.length : 0,
    firstCommit: commits[0] || null,
    lastCommit: commits[commits.length - 1] || null
  };
}

export async function updateRepoComment(repoId, comment) {
  const repoDir = await ensureRepoExists(repoId);
  const metaFile = path.join(repoDir, "meta.json");
  let meta = {};
  if (await fs.pathExists(metaFile)) meta = await fs.readJson(metaFile);
  
  meta.description = comment;
  meta.updatedAt = new Date().toISOString();
  await fs.writeJson(metaFile, meta, { spaces: 2 });
  return meta;
}