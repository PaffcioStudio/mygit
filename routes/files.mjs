// routes/files.mjs — Trasy: przeglądanie plików, podgląd, pobieranie, diff
import { Router } from 'express';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { config } from '../core/utils.js';
import { computeDiff } from '../core/repoManager.js';
import { zipCache } from '../core/cache.js';

const router = Router();
const dataDir = config.dataDir;

// ── Helpers ────────────────────────────────────────────────────────────────
function getContentType(filename) {
  const map = {
    '.txt':'text/plain', '.html':'text/html', '.css':'text/css',
    '.js':'application/javascript', '.mjs':'application/javascript',
    '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg', '.gif':'image/gif', '.svg':'image/svg+xml',
    '.webp':'image/webp', '.pdf':'application/pdf', '.zip':'application/zip',
    '.md':'text/markdown', '.xml':'application/xml',
    '.yml':'application/x-yaml', '.yaml':'application/x-yaml',
    '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg',
    '.wav':'audio/wav', '.ogg':'audio/ogg',
  };
  return map[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function isTextFile(filename) {
  const textExts = new Set([
    '.txt','.js','.json','.html','.htm','.css','.md','.xml','.yml','.yaml',
    '.php','.py','.java','.c','.cpp','.h','.cs','.rb','.go','.rs',
    '.ts','.jsx','.tsx','.vue','.svelte','.sql','.ini','.cfg','.conf',
    '.log','.sh','.bash','.zsh','.fish','.mjs','.cjs','.env',
    '.bat','.cmd','.ps1','.psm1','.psd1','.awk','.sed',
    '.toml','.lock','.graphql','.gql','.proto','.tf','.tfvars',
    '.r','.m','.pl','.lua','.ex','.exs','.erl','.kt','.kts',
    '.swift','.dart','.scala','.clj','.cljs','.coffee','.litcoffee',
    '.sass','.less','.styl','.postcss','.patch','.diff','.csv','.tsv',
    '.gitignore','.mygitignore','.dockerignore','.editorconfig','.prettierrc',
    '.eslintrc','.babelrc','.npmrc','.yarnrc','.htaccess','.mailmap',
  ]);
  if (textExts.has(path.extname(filename).toLowerCase())) return true;
  const base = path.basename(filename).toLowerCase();
  if (base.startsWith('.') && base.length > 1 &&
      !['.ds_store','.localized'].includes(base)) return true;
  const knownText = new Set([
    'dockerfile','makefile','rakefile','jakefile','gruntfile','gulpfile',
    'procfile','vagrantfile','brewfile','capfile','podfile',
    'package.json','package-lock.json',
    'yarn.lock','composer.json','composer.lock','gemfile','gemfile.lock',
    'cargo.toml','cargo.lock','go.mod','go.sum','pom.xml','build.gradle',
    'cmakelists.txt','cmakecache.txt','readme','license','changelog','authors',
    'contributing','todo','fixme','notes',
  ]);
  return knownText.has(base);
}

// ── Browse ─────────────────────────────────────────────────────────────────
router.get('/repos/:id/browse', async (req, res) => {
  try {
    const { id } = req.params;
    let relPath = (req.query.path || '').replace(/\/+/g, '/').replace(/\/$/, '');
    const commitFile  = req.query.commit;
    const versionsDir = path.join(dataDir, 'repos', id, 'versions');

    if (!(await fs.pathExists(versionsDir)))
      return res.status(404).json({ error: 'Brak katalogu wersji.' });

    const versions = await fs.readdir(versionsDir);
    if (!versions.length) return res.status(404).json({ error: 'Brak snapshotów.' });

    const targetZip = (commitFile && versions.includes(commitFile))
      ? commitFile : versions.sort().reverse()[0];
    const zipPath = path.join(versionsDir, targetZip);

    if (!(await fs.pathExists(zipPath)))
      return res.status(404).json({ error: 'Plik snapshotu nie istnieje.' });

    // Użyj cache ZIP-a jeśli dostępny (unika ponownego parsowania dużych ZIP-ów)
    let zip = zipCache.get(zipPath);
    if (!zip) {
      zip = new AdmZip(zipPath);
      zipCache.set(zipPath, zip);
    }
    const seen    = new Set();
    const entries = [];
    const allEntries = zip.getEntries();

    // Aggregate folder sizes and latest modification dates
    const folderSize = {};
    const folderDate = {};
    allEntries.forEach(e => {
      if (e.isDirectory) return;
      const parts = e.entryName.split('/');
      for (let d = 1; d < parts.length; d++) {
        const key = parts.slice(0, d).join('/');
        folderSize[key] = (folderSize[key] || 0) + (e.header.size || 0);
        const t = e.header.time ? new Date(e.header.time).getTime() : 0;
        if (t && (!folderDate[key] || t > folderDate[key])) folderDate[key] = t;
      }
    });

    allEntries.forEach(e => {
      let ep = e.entryName;
      if (ep.endsWith('/')) ep = ep.slice(0, -1);

      if (relPath) {
        const prefix = relPath + '/';
        if (!ep.startsWith(prefix)) return;
        const rel   = ep.substring(prefix.length);
        const parts = rel.split('/');
        if (!parts.length || (parts.length === 1 && !parts[0])) return;
        const name = parts[0];
        const full = `${relPath}/${name}`;
        if (seen.has(full)) return;
        seen.add(full);
        const isDir = e.isDirectory || parts.length > 1;
        const modRaw = isDir ? folderDate[full] : (e.header.time ? new Date(e.header.time).getTime() : 0);
        entries.push({ name, path: full + (isDir ? '/' : ''),
          type: isDir ? 'dir' : 'file',
          size: isDir ? (folderSize[full] || 0) : (e.header.size || 0),
          modified: modRaw || null });
      } else {
        const parts = ep.split('/');
        const name  = parts[0];
        if (seen.has(name)) return;
        seen.add(name);
        const isDir = e.isDirectory || parts.length > 1;
        const modRaw = isDir ? folderDate[name] : (e.header.time ? new Date(e.header.time).getTime() : 0);
        entries.push({ name, path: name + (isDir ? '/' : ''),
          type: isDir ? 'dir' : 'file',
          size: isDir ? (folderSize[name] || 0) : (e.header.size || 0),
          modified: modRaw || null });
      }
    });

    entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1));
    res.json({ commitFile: targetZip, files: entries, currentPath: relPath });
  } catch (e) { res.status(500).json({ error: 'Błąd przeglądania: ' + e.message }); }
});

// ── Download ───────────────────────────────────────────────────────────────
router.get('/repos/:id/download/:file', async (req, res) => {
  try {
    const fp = path.join(dataDir, 'repos', req.params.id, 'versions', req.params.file);
    if (!(await fs.pathExists(fp))) return res.status(404).json({ error: 'Nie znaleziono.' });
    res.download(fp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── File raw ───────────────────────────────────────────────────────────────
router.get('/repos/:id/file/:commitFile/:filePath(*)', async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, 'repos', id, 'versions', commitFile);
    if (!(await fs.pathExists(zipPath))) return res.status(404).json({ error: 'Snapshot nie istnieje.' });
    let zip = zipCache.get(zipPath);
    if (!zip) { zip = new AdmZip(zipPath); zipCache.set(zipPath, zip); }
    const entry = zip.getEntry(filePath);
    if (!entry) return res.status(404).json({ error: 'Plik nie istnieje w archiwum.' });
    const data = entry.getData();
    res.setHeader('Content-Type', getContentType(filePath));
    res.setHeader('Content-Length', data.length);
    res.setHeader('Content-Disposition',
      `${isTextFile(filePath) ? 'inline' : 'attachment'}; filename="${path.basename(filePath)}"`);
    res.send(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Preview (text only) ────────────────────────────────────────────────────
router.get('/repos/:id/preview/:commitFile/:filePath(*)', async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, 'repos', id, 'versions', commitFile);
    if (!(await fs.pathExists(zipPath))) return res.status(404).json({ error: 'Snapshot nie istnieje.' });
    let zip = zipCache.get(zipPath);
    if (!zip) { zip = new AdmZip(zipPath); zipCache.set(zipPath, zip); }
    const entry = zip.getEntry(filePath);
    if (!entry) return res.status(404).json({ error: 'Plik nie istnieje.' });
    if (!isTextFile(filePath)) return res.status(400).json({ error: 'Tylko pliki tekstowe' });
    const content = entry.getData().toString('utf8');
    res.json({ content, type: 'text', size: content.length, filename: path.basename(filePath) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CheckFile ──────────────────────────────────────────────────────────────
router.get('/repos/:id/checkfile/:commitFile/:filePath(*)', async (req, res) => {
  try {
    const { id, commitFile, filePath } = req.params;
    const zipPath = path.join(dataDir, 'repos', id, 'versions', commitFile);
    if (!(await fs.pathExists(zipPath))) return res.status(404).json({ error: 'Snapshot nie istnieje.' });
    let zip = zipCache.get(zipPath);
    if (!zip) { zip = new AdmZip(zipPath); zipCache.set(zipPath, zip); }
    const entry = zip.getEntry(filePath);
    if (!entry) return res.status(404).json({ error: 'Plik nie istnieje.' });
    const isText = isTextFile(filePath);
    let isContentText = false;
    try {
      const text = entry.getData().toString('utf8');
      const bad  = [...text].filter(c => { const n = c.charCodeAt(0);
        return (n < 32 && n !== 9 && n !== 10 && n !== 13) || n === 127; }).length;
      isContentText = bad / text.length < 0.1;
    } catch {}
    res.json({ isText, isContentText, size: entry.header.size, filename: path.basename(filePath) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Diff ───────────────────────────────────────────────────────────────────
router.get('/repos/:id/diff/:file', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const empty = { added:[], removed:[], modified:[], prev:null,
    current: req.params.file, stats:{ added:0,removed:0,modified:0,totalChanges:0 } };
  try {
    const diff = await computeDiff(req.params.id, req.params.file);
    res.json({ added: diff.added||[], removed: diff.removed||[], modified: diff.modified||[],
      prev: diff.prev||null, current: diff.current||req.params.file,
      stats: diff.stats||empty.stats, info: diff.info||null });
  } catch (e) {
    const code = e.message.includes('Nie znaleziono') || e.message.includes('not found') ? 404 : 500;
    res.status(code).json({ error: e.message, ...empty });
  }
});

export default router;
