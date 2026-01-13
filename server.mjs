import express from "express";
import fs from "fs-extra";
import path from "path";
import cors from "cors";
import AdmZip from "adm-zip";
import dayjs from "dayjs";
import os from "os";
import { fileURLToPath } from "url";
import {
  listRepos,
  createRepo,
  getRepoCommits,
  deleteCommit,
  computeDiff,
  registerUploadedSnapshot,
  updateRepoComment,
  deleteRepo,
  ensureRepoExists
} from "./core/repoManager.js";
// Import konfiguracji
import { config } from "./core/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname;
const app = express();

// Konfiguracja limitu (tylko informacyjnie, bo streamujemy)
const MAX_UPLOAD_SIZE = (config.maxZipSizeMB || 1024) + 'mb';

// CORS
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Repo-Name']
}));

app.options('*', cors());

// Middleware
// WAŻNE: Usunięto express.raw, aby nie konsumować strumienia przed zapisem pliku!
app.use(express.json({ limit: '50mb' })); 
app.use(express.static(path.join(PROJECT_ROOT, "web")));

console.log("🔧 Ścieżki projektu:");
console.log("  PROJECT_ROOT:", PROJECT_ROOT);
console.log("  Web dir:", path.join(PROJECT_ROOT, "web"));
console.log("  Data dir:", config.dataDir);

const dataDir = config.dataDir;
await fs.ensureDir(path.join(dataDir, "repos"));

const tempDir = path.join(os.tmpdir(), "mygit_uploads");
await fs.ensureDir(tempDir);

const favouritesPath = path.join(dataDir, "favourites.json");

// Inicjalizacja pliku z ulubionymi jeśli nie istnieje
if (!(await fs.pathExists(favouritesPath))) {
  await fs.writeJson(favouritesPath, { favourites: [] });
}

// Funkcje do zarządzania ulubionymi
async function loadFavourites() {
  try {
    const data = await fs.readJson(favouritesPath);
    return data.favourites || [];
  } catch (error) {
    console.error("Błąd ładowania ulubionych:", error);
    return [];
  }
}

async function saveFavourites(favourites) {
  try {
    await fs.writeJson(favouritesPath, { favourites }, { spaces: 2 });
  } catch (error) {
    console.error("Błąd zapisywania ulubionych:", error);
  }
}

// === TRASY INTERFEJSU WEB ===
app.get("/", (req, res) => {
  const indexPath = path.join(PROJECT_ROOT, "web", "index.html");
  res.sendFile(indexPath);
});

// Middleware do logowania requestów z rozszerzeń (opcjonalne)
app.use((req, res, next) => {
  next();
});

// Cache headers
app.use('/api/repos/:id/diff/:file', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

app.use('/api/repos/:id/history', (req, res, next) => {
  res.setHeader('Cache-Control', 'max-age=60');
  next();
});

app.use('/api/repos/:id/info', (req, res, next) => {
  res.setHeader('Cache-Control', 'max-age=120');
  next();
});

// === API ROUTES (NOWE - ZAPIS/POST) ===

// 1. INIT - Utworzenie nowego repozytorium
app.post("/api/repos", async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) throw new Error("Wymagana nazwa repozytorium");
    
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Nazwa może zawierać tylko litery, cyfry, myślniki i podkreślenia");
    }

    const result = await createRepo(name, name, description);
    console.log(`Utworzono repozytorium: ${name}`);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 2. SAVE - Upload snapshotu (binary stream)
app.post("/api/repos/:id/snapshot", async (req, res) => {
  const repoId = req.params.id;
  const message = req.query.message || "snapshot";
  const tempFile = path.join(tempDir, `${repoId}_${Date.now()}.zip`);
  
  console.log(`Odbieranie snapshotu dla ${repoId}...`);

  try {
    await ensureRepoExists(repoId);

    // Bezpośrednie strumieniowanie requestu do pliku
    const writeStream = fs.createWriteStream(tempFile);
    
    await new Promise((resolve, reject) => {
      req.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      req.on('error', (err) => {
        writeStream.destroy();
        reject(err);
      });
    });

    const stat = await fs.stat(tempFile);
    if (stat.size === 0) {
      throw new Error("Otrzymano pusty plik (błąd strumieniowania)");
    }

    const result = await registerUploadedSnapshot(repoId, tempFile, message);
    
    console.log(`Snapshot zapisany: ${result.file} (${(result.size / 1024 / 1024).toFixed(2)} MB)`);
    res.json(result);

  } catch (e) {
    console.error(`❌ Błąd uploadu: ${e.message}`);
    if (await fs.pathExists(tempFile)) {
      await fs.remove(tempFile);
    }
    res.status(500).json({ error: e.message });
  }
});

// 3. COMMENT - Aktualizacja opisu
app.post("/api/repos/:id/comment", async (req, res) => {
  try {
    const { description } = req.body;
    const result = await updateRepoComment(req.params.id, description);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === API ROUTES (ODCZYT/GET/DELETE) ===

app.get("/api/repos", async (req, res) => {
  try {
    const repos = await listRepos();
    const favourites = await loadFavourites();
    const reposWithFavourites = repos.map(repo => ({
      ...repo,
      isFavourite: favourites.includes(repo.id)
    }));
    res.json(reposWithFavourites);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/favourites", async (req, res) => {
  try {
    const favourites = await loadFavourites();
    res.json({ favourites });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/favourites/:id", async (req, res) => {
  try {
    const repoId = req.params.id;
    const favourites = await loadFavourites();
    if (!favourites.includes(repoId)) {
      favourites.push(repoId);
      await saveFavourites(favourites);
    }
    res.json({ success: true, favourites });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/favourites/:id", async (req, res) => {
  try {
    const repoId = req.params.id;
    let favourites = await loadFavourites();
    favourites = favourites.filter(id => id !== repoId);
    await saveFavourites(favourites);
    res.json({ success: true, favourites });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/repos/:id/history", async (req, res) => {
  try {
    const commits = await getRepoCommits(req.params.id);
    res.json(commits);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/repos/:id/download/:file", async (req, res) => {
  try {
    const filePath = path.join(dataDir, "repos", req.params.id, "versions", req.params.file);
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: "Nie znaleziono pliku." });
    }
    res.download(filePath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/repos/:id/file/:commitFile/:filePath(*)", async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, "repos", id, "versions", commitFile);
    
    if (!(await fs.pathExists(zipPath))) {
      return res.status(404).json({ error: "Snapshot nie istnieje." });
    }

    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry(filePath);
    
    if (!entry) {
      return res.status(404).json({ error: "Plik nie istnieje w archiwum." });
    }

    const data = entry.getData();
    const contentType = getContentType(filePath);
    
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", data.length);
    
    if (isTextFile(filePath)) {
      res.setHeader("Content-Disposition", `inline; filename="${path.basename(filePath)}"`);
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    }
    
    res.send(data);
  } catch (err) {
    console.error("Błąd pobierania pliku:", err);
    res.status(500).json({ error: "Błąd pobierania pliku: " + err.message });
  }
});

app.get("/api/repos/:id/preview/:commitFile/:filePath(*)", async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, "repos", id, "versions", commitFile);
    
    if (!(await fs.pathExists(zipPath))) {
      return res.status(404).json({ error: "Snapshot nie istnieje." });
    }

    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry(filePath);
    
    if (!entry) {
      return res.status(404).json({ error: "Plik nie istnieje w archiwum." });
    }

    if (!isTextFile(filePath)) {
      return res.status(400).json({ error: "Podgląd dostępny tylko dla plików tekstowych" });
    }

    const data = entry.getData().toString('utf8');
    res.json({ 
      content: data,
      type: 'text',
      size: data.length,
      filename: path.basename(filePath)
    });
  } catch (err) {
    res.status(500).json({ error: "Błąd podglądu pliku: " + err.message });
  }
});

app.delete("/api/repos/:id/commit/:file", async (req, res) => {
  // Wymuszenie nagłówków CORS dla DELETE, aby uniknąć NetworkError w Firefox
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  try {
    await deleteCommit(req.params.id, req.params.file);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/repos/:id", async (req, res) => {
  try {
    const repoId = req.params.id;
    const repoDir = path.join(dataDir, "repos", repoId);
    if (!(await fs.pathExists(repoDir))) {
      return res.status(404).json({ error: "Repozytorium nie istnieje." });
    }
    
    const favourites = await loadFavourites();
    const newFavourites = favourites.filter(id => id !== repoId);
    await saveFavourites(newFavourites);
    
    await fs.remove(repoDir);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/repos/:id/browse", async (req, res) => {
  try {
    const repoId = req.params.id;
    // FIX: Usuwanie podwójnych slashy (// -> /)
    let relPath = (req.query.path || "").replace(/\/+/g, '/');
    if (relPath.endsWith('/')) {
      relPath = relPath.slice(0, -1);
    }
    
    const commitFile = req.query.commit;
    const versionsDir = path.join(dataDir, "repos", repoId, "versions");

    if (!(await fs.pathExists(versionsDir))) {
      return res.status(404).json({ error: "Brak katalogu wersji." });
    }

    const versions = await fs.readdir(versionsDir);
    if (!versions.length) {
      return res.status(404).json({ error: "Brak snapshotów." });
    }

    const targetZip = commitFile && versions.includes(commitFile) 
      ? commitFile 
      : versions.sort().reverse()[0];

    const zipPath = path.join(versionsDir, targetZip);
    
    if (!(await fs.pathExists(zipPath))) {
        return res.status(404).json({ error: "Plik snapshotu nie istnieje." });
    }

    const zip = new AdmZip(zipPath);
    const seen = new Set();
    const entries = [];

    zip.getEntries().forEach(e => {
      let entryPath = e.entryName;
      if (entryPath.endsWith('/')) entryPath = entryPath.slice(0, -1);

      if (relPath) {
        const prefix = relPath + '/';
        if (!entryPath.startsWith(prefix)) return;
        
        const relativeToPath = entryPath.substring(prefix.length);
        const parts = relativeToPath.split('/');
        if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) return;
        
        const topLevelName = parts[0];
        const fullPath = `${relPath}/${topLevelName}`; // Budujemy czystą ścieżkę
        
        if (seen.has(fullPath)) return;
        seen.add(fullPath);
        
        const isDir = e.isDirectory || parts.length > 1;
        entries.push({
          name: topLevelName,
          path: fullPath + (isDir ? '/' : ''),
          type: isDir ? 'dir' : 'file',
          size: e.header.size
        });
      } else {
        const parts = entryPath.split('/');
        const topLevelName = parts[0];
        
        if (seen.has(topLevelName)) return;
        seen.add(topLevelName);
        
        const isDir = e.isDirectory || parts.length > 1;
        entries.push({
          name: topLevelName,
          path: topLevelName + (isDir ? '/' : ''),
          type: isDir ? 'dir' : 'file',
          size: e.header.size
        });
      }
    });

    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'dir' ? -1 : 1;
    });

    res.json({ commitFile: targetZip, files: entries, currentPath: relPath });
  } catch (err) {
    res.status(500).json({ error: "Błąd przeglądania: " + err.message });
  }
});

// === POPRAWIONY ENDPOINT DIFF ===
app.get("/api/repos/:id/diff/:file", async (req, res) => {
  // Wymuś nagłówki CORS, żeby przeglądarka i AV nie blokowały odpowiedzi
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const { id, file } = req.params;
    const diff = await computeDiff(id, file);
    
    const response = {
      added: diff.added || [],
      removed: diff.removed || [],
      modified: diff.modified || [],
      prev: diff.prev || null,
      current: diff.current || file,
      stats: diff.stats || {
        added: 0,
        removed: 0,
        modified: 0,
        totalChanges: 0
      },
      info: diff.info || null
    };
    res.json(response);
  } catch (err) {
    if (err.message.includes("Nie znaleziono") || err.message.includes("not found")) {
      console.warn(`⚠️  Diff warning: ${err.message}`);
      res.status(404).json({ error: err.message });
    } else {
      console.error("❌ Błąd w endpoint diff:", err);
      // Zawsze zwracamy JSON, nawet przy 500, żeby frontend nie dostał NetworkError
      res.status(500).json({ 
        error: "Błąd diff: " + err.message,
        added: [],
        removed: [],
        modified: [],
        prev: null,
        current: req.params.file,
        stats: { added: 0, removed: 0, modified: 0, totalChanges: 0 }
      });
    }
  }
});

app.get("/api/repos/:id/latest", async (req, res) => {
  try {
    const repoId = req.params.id;
    const repoDir = path.join(dataDir, "repos", repoId);
    const versionsDir = path.join(repoDir, "versions");
    
    if (!(await fs.pathExists(repoDir))) {
      return res.status(404).json({ error: "Repozytorium nie istnieje." });
    }

    const versions = await fs.readdir(versionsDir);
    if (!versions.length) {
      return res.status(404).json({ error: "Brak snapshotów." });
    }

    const latest = versions.sort().reverse()[0];
    const filePath = path.join(versionsDir, latest);

    const commitsPath = path.join(repoDir, "commits.json");
    const commits = await fs.readJson(commitsPath);
    const commit = commits.find(c => c.file === latest) || {};

    res.json({
      file: latest,
      path: filePath,
      size: (await fs.stat(filePath)).size,
      date: commit.date,
      message: commit.message
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/repos/:id/snapshot/:file", async (req, res) => {
  try {
    const repoId = req.params.id;
    const snapshotFile = req.params.file;
    const repoDir = path.join(dataDir, "repos", repoId);
    const versionsDir = path.join(repoDir, "versions");
    
    if (!(await fs.pathExists(repoDir))) {
      return res.status(404).json({ error: "Repozytorium nie istnieje." });
    }

    const versions = await fs.readdir(versionsDir);
    if (!versions.length) {
      return res.status(404).json({ error: "Brak snapshotów." });
    }

    const target = versions.find(v => v.startsWith(snapshotFile));
    if (!target) {
      return res.status(404).json({ error: `Snapshot nie znaleziony.` });
    }

    const filePath = path.join(versionsDir, target);
    const commitsPath = path.join(repoDir, "commits.json");
    const commits = await fs.readJson(commitsPath);
    const commit = commits.find(c => c.file === target) || {};

    res.json({
      file: target,
      path: filePath,
      size: (await fs.stat(filePath)).size,
      date: commit.date,
      message: commit.message
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/repos/:id/info", async (req, res) => {
  try {
    const repoId = req.params.id;
    const repoDir = path.join(dataDir, "repos", repoId);
    const metaPath = path.join(repoDir, "meta.json");
    const commitsPath = path.join(repoDir, "commits.json");
    
    if (!(await fs.pathExists(repoDir))) {
      return res.status(404).json({ error: "Repozytorium nie istnieje." });
    }

    const meta = await fs.readJson(metaPath);
    const commits = await fs.readJson(commitsPath);
    const versionsDir = path.join(repoDir, "versions");
    const versions = await fs.readdir(versionsDir);
    
    let totalSize = 0;
    for (const version of versions) {
      const stat = await fs.stat(path.join(versionsDir, version));
      totalSize += stat.size;
    }

    res.json({
      ...meta,
      commitCount: commits.length,
      totalSize,
      lastCommit: commits[commits.length - 1] || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback
app.get("*", (req, res) => {
  const indexPath = path.join(PROJECT_ROOT, "web", "index.html");
  res.sendFile(indexPath);
});

// CheckFile
app.get("/api/repos/:id/checkfile/:commitFile/:filePath(*)", async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, "repos", id, "versions", commitFile);
    
    if (!(await fs.pathExists(zipPath))) {
      return res.status(404).json({ error: "Snapshot nie istnieje." });
    }

    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry(filePath);
    
    if (!entry) {
      return res.status(404).json({ error: "Plik nie istnieje w archiwum." });
    }

    const isText = isTextFile(filePath);
    
    let isContentText = false;
    try {
      const data = entry.getData();
      const text = data.toString('utf8');
      const controlChars = text.split('').filter(c => {
        const code = c.charCodeAt(0);
        return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
      }).length;
      isContentText = controlChars / text.length < 0.1;
    } catch (e) {
      isContentText = false;
    }

    res.json({
      isText,
      isContentText,
      size: entry.header.size,
      filename: path.basename(filePath)
    });
  } catch (err) {
    res.status(500).json({ error: "Błąd sprawdzania pliku: " + err.message });
  }
});

// Pomocnicze funkcje
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.md': 'text/markdown',
    '.xml': 'application/xml',
    '.yml': 'application/x-yaml',
    '.yaml': 'application/x-yaml'
  };
  return types[ext] || 'application/octet-stream';
}

function isTextFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const textExtensions = [
    '.txt', '.js', '.json', '.html', '.css', '.md', '.xml', '.yml', '.yaml',
    '.php', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.go', '.rs',
    '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.sql', '.ini', '.cfg', '.conf',
    '.log', '.sh', '.bash', '.zsh', '.fish', '.mjs', '.cjs', '.env', '.gitignore',
    '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc',
    '.npmrc', '.yarnrc', '.gitattributes', '.gitmodules', '.htaccess', '.env.example',
    '.env.local', '.env.development', '.env.production', '.env.test'
  ];
  
  if (textExtensions.includes(ext)) {
    return true;
  }
  
  const fileName = path.basename(filename).toLowerCase();
  if (fileName.startsWith('.') && fileName.length > 1) {
    const binaryHiddenFiles = ['.DS_Store', '.localized'];
    if (binaryHiddenFiles.includes(fileName)) {
      return false;
    }
    return true;
  }
  
  const knownTextFiles = [
    'dockerfile', 'makefile', 'procfile', 'docker-compose.yml', 'docker-compose.yaml',
    'docker-compose.override.yml', 'package.json', 'package-lock.json', 'yarn.lock',
    'composer.json', 'composer.lock', 'gemfile', 'gemfile.lock', 'cargo.toml',
    'cargo.lock', 'go.mod', 'go.sum', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'gradle-wrapper.properties'
  ];
  
  if (knownTextFiles.includes(fileName)) {
    return true;
  }
  
  return false;
}

// === Start serwera ===
// Pobieranie portu z configa lub domyślnie 3350
const PORT = config.port || 3350;

const nets = os.networkInterfaces();
let localIp = "localhost";
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === "IPv4" && !net.internal) {
      localIp = net.address;
      break;
    }
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("\nmygit SERVER (REST API Mode)");
  console.log(`http://${localIp}:${PORT}`);
  console.log(`Katalog danych: ${dataDir}`);
  console.log(`Config: Port=${PORT}, MaxSize=${MAX_UPLOAD_SIZE}`);
  console.log(`Start: ${dayjs().format("DD.MM.YYYY | HH:mm:ss")}\n`);
});