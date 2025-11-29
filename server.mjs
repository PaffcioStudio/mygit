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
  computeDiff 
} from "./core/repoManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname;
const app = express();

// SPECJALNA konfiguracja CORS z preflight
app.use(cors({
  origin: [
    'http://192.168.0.197:3350',
    'http://localhost:3350', 
    'http://127.0.0.1:3350',
    'http://192.168.0.197:3000',
    'http://localhost:3000',
    'chrome-extension://',
    'moz-extension://'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Obsługa preflight requests
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(PROJECT_ROOT, "web")));

console.log("🔧 Ścieżki projektu:");
console.log("  PROJECT_ROOT:", PROJECT_ROOT);
console.log("  Web dir:", path.join(PROJECT_ROOT, "web"));
console.log("  Data dir:", path.join(PROJECT_ROOT, "data"));

const dataDir = path.join(PROJECT_ROOT, "data");
await fs.ensureDir(path.join(dataDir, "repos"));

// === TRASY INTERFEJSU WEB ===
app.get("/", (req, res) => {
  const indexPath = path.join(PROJECT_ROOT, "web", "index.html");
  res.sendFile(indexPath);
});

// Middleware do blokowania requestów z rozszerzeń
app.use((req, res, next) => {
  const userAgent = req.get('User-Agent') || '';
  const origin = req.get('Origin') || '';
  const referer = req.get('Referer') || '';
  
  // TYLKO LOGUJ requesty z rozszerzeń, NIE BLOKUJ
  const extensionPatterns = [
    'chrome-extension://',
    '127.0.0.1:9614',
    'localhost:9614',
    'moz-extension://'
  ];
  
  const isExtension = extensionPatterns.some(pattern => 
    origin.includes(pattern) || 
    referer.includes(pattern) ||
    userAgent.includes('React DevTools')
  );
  
  if (isExtension) {
    console.log(`⚠️ Request z rozszerzenia: ${origin} ${req.method} ${req.path}`);
    // NIE BLOKUJ - pozwól przejść dalej
  }
  
  next();
});

// Cache headers dla statycznych danych
app.use('/api/repos/:id/diff/:file', (req, res, next) => {
  // Wyłącz cache dla diff żądań - często się zmieniają
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Cache dla innych endpointów
app.use('/api/repos/:id/history', (req, res, next) => {
  res.setHeader('Cache-Control', 'max-age=60'); // 1 minuta cache
  next();
});

app.use('/api/repos/:id/info', (req, res, next) => {
  res.setHeader('Cache-Control', 'max-age=120'); // 2 minuty cache
  next();
});

// === API ROUTES ===

// Lista repozytoriów
app.get("/api/repos", async (req, res) => {
  try {
    const repos = await listRepos();
    res.json(repos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Historia commitów
app.get("/api/repos/:id/history", async (req, res) => {
  try {
    const commits = await getRepoCommits(req.params.id);
    res.json(commits);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pobranie CAŁEGO snapshotu (pliku ZIP)
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

// Pobieranie POJEDYNCZEGO pliku z snapshotu
app.get("/api/repos/:id/file/:commitFile/:filePath(*)", async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, "repos", id, "versions", commitFile);
    
    console.log(`📁 Pobieranie pliku: ${filePath} z ${zipPath}`);
    
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
    
    // Dla plików tekstowych - pokaż w przeglądarce, dla innych - pobierz
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

// Podgląd zawartości pliku tekstowego
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

// Usuwanie snapshotu
app.delete("/api/repos/:id/commit/:file", async (req, res) => {
  try {
    await deleteCommit(req.params.id, req.params.file);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Usuwanie repo
app.delete("/api/repos/:id", async (req, res) => {
  try {
    const repoDir = path.join(dataDir, "repos", req.params.id);
    if (!(await fs.pathExists(repoDir))) {
      return res.status(404).json({ error: "Repozytorium nie istnieje." });
    }
    await fs.remove(repoDir);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Przeglądanie snapshotu
app.get("/api/repos/:id/browse", async (req, res) => {
  try {
    const repoId = req.params.id;
    const relPath = req.query.path || "";
    const commitFile = req.query.commit;
    
    const versionsDir = path.join(dataDir, "repos", repoId, "versions");

    if (!(await fs.pathExists(versionsDir))) {
      return res.status(404).json({ error: "Brak katalogu wersji." });
    }

    const versions = await fs.readdir(versionsDir);
    if (!versions.length) {
      return res.status(404).json({ error: "Brak snapshotów." });
    }

    // Użyj określonego commita lub najnowszego
    const targetZip = commitFile && versions.includes(commitFile) 
      ? commitFile 
      : versions.sort().reverse()[0];

    const zipPath = path.join(versionsDir, targetZip);
    const zip = new AdmZip(zipPath);

    const seen = new Set();
    const entries = [];

    zip.getEntries().forEach(e => {
      let entryPath = e.entryName;
      
      if (entryPath.endsWith('/')) {
        entryPath = entryPath.slice(0, -1);
      }

      if (relPath) {
        if (!entryPath.startsWith(relPath) || entryPath === relPath) {
          return;
        }
        
        let relativeToPath = entryPath.substring(relPath.length);
        if (relativeToPath.startsWith('/')) {
          relativeToPath = relativeToPath.substring(1);
        }
        
        const parts = relativeToPath.split('/');
        if (parts.length === 0) return;
        
        const topLevelName = parts[0];
        const fullPath = relPath ? `${relPath}/${topLevelName}` : topLevelName;
        
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
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'dir' ? -1 : 1;
    });

    res.json({ 
      commitFile: targetZip, 
      files: entries,
      currentPath: relPath 
    });
  } catch (err) {
    res.status(500).json({ error: "Błąd przeglądania: " + err.message });
  }
});

// Diff z rozbudowanym porównaniem
app.get("/api/repos/:id/diff/:file", async (req, res) => {
  try {
    const { id, file } = req.params;
    console.log(`🔍 Diff request: repo=${id}, file=${file}`);
    
    const diff = await computeDiff(id, file);
    console.log(`✅ Diff result:`, {
      added: diff.added?.length || 0,
      removed: diff.removed?.length || 0,
      modified: diff.modified?.length || 0,
      prev: diff.prev,
      current: diff.current
    });
    
    // Upewnij się, że zawsze zwracasz obiekt z wymaganymi polami
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
    
    console.log(`📤 Sending diff response for ${file}`);
    res.json(response);
  } catch (err) {
    console.error("❌ Błąd w endpoint diff:", err);
    res.status(500).json({ 
      error: "Błąd diff: " + err.message,
      added: [],
      removed: [],
      modified: [],
      prev: null,
      current: req.params.file,
      stats: {
        added: 0,
        removed: 0,
        modified: 0,
        totalChanges: 0
      }
    });
  }
});

// Informacje o repozytorium
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

// Fallback dla SPA
app.get("*", (req, res) => {
  const indexPath = path.join(PROJECT_ROOT, "web", "index.html");
  res.sendFile(indexPath);
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
  const textExtensions = ['.txt', '.js', '.json', '.html', '.css', '.md', '.xml', '.yml', '.yaml', '.php', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.go', '.rs', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
  return textExtensions.includes(ext);
}

// === Start serwera ===
const PORT = process.env.PORT || 3350;

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
  console.log("\n🚀 mygit uruchomiony!");
  console.log(`🌍  http://${localIp}:${PORT}`);
  console.log(`📁  Katalog danych: ${dataDir}/repos/`);
  console.log(`🕓  Start: ${dayjs().format("DD.MM.YYYY | HH:mm:ss")}\n`);
});