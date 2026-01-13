#!/usr/bin/env node
import { program } from "commander";
import AdmZip from "adm-zip";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { 
  listRepos, 
  createRepo, 
  commitRepo, 
  getRepoCommits, 
  deleteCommit,
  deleteRepo,
  getRepoStats,
  updateRepoComment
} from "../core/repoManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Pomocnicze funkcje
function getCurrentRepoName() {
  if (process.env.REPO_NAME && process.env.REPO_NAME.trim() !== "") {
    return process.env.REPO_NAME.trim();
  }
  return path.basename(process.cwd());
}

function getSourcePath() {
  return process.env.SOURCE_PATH || process.cwd();
}

async function repoExists(name) {
  const repos = await listRepos();
  return repos.find(r => r.id === name);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('pl-PL');
}

// === GET - pobierz snapshot ===
program
  .command("get")
  .description("Pobierz snapshot repozytorium (najnowszy lub konkretny)")
  .argument("[target]", "repo@snapshot lub nazwa repozytorium (np. myrepo lub myrepo@2025-12-04_15-30-00.zip)")
  .option("-f, --force", "Nadpisz istniejące pliki bez pytania", false)
  .option("-b, --backup", "Zrób backup istniejących plików przed nadpisaniem", true)
  .option("-d, --dry-run", "Tylko pokaż co by zostało zrobione, nie wykonuj", false)
  .option("-o, --output <dir>", "Folder docelowy (domyślnie bieżący)", ".")
  .option("-s, --skip-conflicts", "Pomiń pliki gdzie lokalne są nowsze", false)
  .option("-t, --timeout <seconds>", "Timeout pobierania w sekundach", "60")
  .action(async (target, options) => {
    try {
      let repoName, snapshotFile;
      
      // Parsowanie argumentu
      if (target && target.includes('@')) {
        const parts = target.split('@');
        repoName = parts[0];
        snapshotFile = parts[1];
      } else {
        repoName = target || getCurrentRepoName();
        snapshotFile = null;
      }
      
      console.log(`📥 Pobieranie snapshotu dla repozytorium '${repoName}'...`);
      if (snapshotFile) {
        console.log(`🎯 Konkretny snapshot: ${snapshotFile}`);
      } else {
        console.log(`🎯 Najnowszy snapshot`);
      }

      // Pobierz dane snapshotu z serwera
      const snapshotInfo = await fetchSnapshotInfo(repoName, snapshotFile, parseInt(options.timeout) * 1000);
      if (!snapshotInfo) {
        console.log(`❌ Nie można pobrać informacji o snapshocie.`);
        return;
      }

      console.log(`📦 Snapshot: ${snapshotInfo.file}`);
      console.log(`📝 Komunikat: ${snapshotInfo.message || 'Brak'}`);
      console.log(`📅 Data: ${formatDate(snapshotInfo.date)}`);
      console.log(`📊 Rozmiar: ${formatBytes(snapshotInfo.size)}`);
      
      // Dry run - tylko pokaż co by zostało zrobione
      if (options.dryRun) {
        console.log(`\n🔍 DRY RUN - tylko symulacja`);
        console.log(`   Folder docelowy: ${options.output}`);
        console.log(`   Backup: ${options.backup ? 'TAK' : 'NIE'}`);
        console.log(`   Force: ${options.force ? 'TAK' : 'NIE'}`);
        console.log(`   Skip conflicts: ${options.skipConflicts ? 'TAK' : 'NIE'}`);
        console.log(`   Timeout: ${options.timeout}s`);
        return;
      }

      // Pobierz plik ZIP
      const zipPath = await downloadSnapshot(repoName, snapshotInfo.file, parseInt(options.timeout) * 1000);
      if (!zipPath) {
        console.log(`❌ Nie można pobrać pliku snapshotu.`);
        return;
      }

      // Waliduj ZIP
      if (!await validateZip(zipPath)) {
        console.log(`❌ Plik ZIP jest uszkodzony lub zawiera niebezpieczne ścieżki.`);
        await fs.remove(zipPath);
        return;
      }

      // Sprawdź folder docelowy
      const outputDir = path.resolve(options.output);
      await fs.ensureDir(outputDir);
      
      // Sprawdź konflikty
      const conflicts = await checkConflicts(zipPath, outputDir, snapshotInfo.date);
      if (conflicts.length > 0 && !options.force && !options.skipConflicts) {
        console.log(`\n⚠️  Znaleziono konflikty (${conflicts.length} plików):`);
        conflicts.slice(0, 5).forEach(conflict => {
          console.log(`   • ${conflict.file} (lokalny: ${formatDate(conflict.localDate)}, snapshot: ${formatDate(conflict.snapshotDate)})`);
        });
        if (conflicts.length > 5) {
          console.log(`   ... i ${conflicts.length - 5} więcej`);
        }
        
        const readline = (await import('readline')).createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
          readline.question(`\n🔍 Kontynuować? (T/N/P - pomiń konflikty): `, resolve);
        });
        readline.close();
        
        if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'nie') {
          console.log(`❌ Anulowano pobieranie.`);
          await fs.remove(zipPath);
          return;
        }
        if (answer.toLowerCase() === 'p' || answer.toLowerCase() === 'pomiń') {
          options.skipConflicts = true;
        }
      }

      // Zrób backup jeśli wymagane
      let backupDir = null;
      if (options.backup && conflicts.length > 0) {
        backupDir = await createBackup(conflicts, outputDir);
        console.log(`💾 Backup zapisany w: ${backupDir}`);
      }

      // Rozpakuj snapshot
      await extractSnapshot(zipPath, outputDir, conflicts, options);
      
      // Posprzątaj tymczasowy plik
      await fs.remove(zipPath);
      
      console.log(`\nPobieranie zakończone sukcesem!`);
      if (backupDir) {
        console.log(`💾 Backup: ${backupDir}`);
      }
      
    } catch (error) {
      console.error(`❌ Błąd: ${error.message}`);
      if (error.stack) {
        console.error(`🔍 Szczegóły: ${error.stack}`);
      }
    }
  });

// Pomocnicze funkcje dla get
async function fetchSnapshotInfo(repoName, snapshotFile, timeout = 30000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    let url;
    if (snapshotFile) {
      url = `http://localhost:3350/api/repos/${repoName}/snapshot/${snapshotFile}`;
    } else {
      url = `http://localhost:3350/api/repos/${repoName}/latest`;
    }
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`⏱️  Timeout: Przekroczono limit czasu (${timeout/1000}s)`);
    } else {
      console.error(`Błąd pobierania informacji: ${error.message}`);
    }
    return null;
  }
}

async function downloadSnapshot(repoName, snapshotFile, timeout = 60000) {
  try {
    const MAX_SIZE = 1024 * 1024 * 1024; // 1GB
    const tempDir = os.tmpdir();
    const zipPath = path.join(tempDir, `mygit_${repoName}_${Date.now()}.zip`);
    
    console.log(`⬇️  Pobieranie pliku...`);
    
    const url = `http://localhost:3350/api/repos/${repoName}/download/${snapshotFile}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_SIZE) {
      throw new Error(`Plik jest za duży (${formatBytes(contentLength)} > ${formatBytes(MAX_SIZE)})`);
    }
    
    const fileStream = fs.createWriteStream(zipPath);
    let downloaded = 0;
    let lastPercent = -1;
    
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      downloaded += value.length;
      fileStream.write(value);
      
      // Progress bar
      if (contentLength > 0) {
        const percent = Math.round((downloaded / contentLength) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          process.stdout.write(`\r📦 Pobieranie... ${percent}% (${formatBytes(downloaded)}/${formatBytes(contentLength)})`);
          lastPercent = percent;
        }
      }
    }
    
    fileStream.end();
    await new Promise(resolve => fileStream.on('finish', resolve));
    
    console.log(`\nPlik pobrany: ${zipPath} (${formatBytes(downloaded)})`);
    return zipPath;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`\n⏱️  Timeout: Przekroczono limit czasu pobierania (${timeout/1000}s)`);
    } else {
      console.error(`\n❌ Błąd pobierania pliku: ${error.message}`);
    }
    // Spróbuj usunąć częściowo pobrany plik
    try { await fs.remove(zipPath); } catch {}
    return null;
  }
}

async function validateZip(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    // Sprawdź czy nie ma niebezpiecznych ścieżek
    for (const entry of entries) {
      const entryName = entry.entryName;
      
      // Sprawdź czy ścieżka nie wychodzi poza katalog docelowy
      if (entryName.includes('..') || 
          entryName.startsWith('/') || 
          entryName.startsWith('\\') ||
          /^[a-zA-Z]:[\\/]/.test(entryName)) {
        console.error(`❌ Niebezpieczna ścieżka w ZIP: ${entryName}`);
        return false;
      }
    }
    
    // Sprawdź czy ZIP nie jest pusty
    if (entries.length === 0) {
      console.error(`❌ Plik ZIP jest pusty`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Błąd walidacji ZIP: ${error.message}`);
    return false;
  }
}

async function checkConflicts(zipPath, outputDir, snapshotDate) {
  const conflicts = [];
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  const snapshotDateObj = new Date(snapshotDate);
  
  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    
    const relativePath = entry.entryName;
    const fullPath = path.join(outputDir, relativePath);
    
    if (await fs.pathExists(fullPath)) {
      const localStat = await fs.stat(fullPath);
      
      // Użyj daty z snapshotu zamiast daty z ZIP header
      if (localStat.mtime > snapshotDateObj) {
        conflicts.push({
          file: relativePath,
          localDate: localStat.mtime,
          snapshotDate: snapshotDateObj,
          size: entry.header.size,
          localSize: localStat.size
        });
      }
    }
  }
  
  return conflicts;
}

async function createBackup(conflicts, outputDir) {
  const backupDir = path.join(outputDir, `.mygit-backup-${Date.now()}`);
  await fs.ensureDir(backupDir);
  
  console.log(`💾 Tworzenie backupu...`);
  let backedUp = 0;
  let totalSize = 0;
  
  for (const conflict of conflicts) {
    const sourcePath = path.join(outputDir, conflict.file);
    const backupPath = path.join(backupDir, conflict.file);
    
    try {
      await fs.ensureDir(path.dirname(backupPath));
      await fs.copy(sourcePath, backupPath);
      backedUp++;
      totalSize += conflict.localSize || 0;
      
      if (backedUp % 10 === 0) {
        process.stdout.write(`\r💾 Backup: ${backedUp}/${conflicts.length} plików (${formatBytes(totalSize)})`);
      }
    } catch (error) {
      console.log(`\n⚠️  Nie można zrobić backupu dla ${conflict.file}: ${error.message}`);
    }
  }
  
  console.log(`\nBackup utworzony: ${backupDir} (${backedUp} plików, ${formatBytes(totalSize)})`);
  
  // Zapisz manifest backupu
  const manifest = {
    timestamp: new Date().toISOString(),
    files: conflicts.length,
    backedUp: backedUp,
    totalSize: totalSize,
    conflicts: conflicts.map(c => ({
      file: c.file,
      localDate: c.localDate.toISOString(),
      snapshotDate: c.snapshotDate.toISOString(),
      size: c.localSize
    }))
  };
  
  await fs.writeJson(path.join(backupDir, '.backup-manifest.json'), manifest, { spaces: 2 });
  
  return backupDir;
}

async function extractSnapshot(zipPath, outputDir, conflicts, options) {
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  const totalFiles = zipEntries.filter(e => !e.isDirectory).length;
  
  if (totalFiles === 0) {
    console.log(`⚠️  Brak plików do rozpakowania.`);
    return;
  }
  
  let extracted = 0;
  let skipped = 0;
  let totalSize = 0;
  
  console.log(`\n📂 Rozpakowywanie ${totalFiles} plików...`);
  
  // Filtruj pliki do pominięcia
  const skipFiles = new Set();
  if (options.skipConflicts && conflicts.length > 0) {
    conflicts.forEach(conflict => skipFiles.add(conflict.file));
  }
  
  for (const entry of zipEntries) {
    const relativePath = entry.entryName;
    
    // Pomijaj katalogi
    if (entry.isDirectory) {
      continue;
    }
    
    // Pomijaj pliki z konfliktami jeśli skip-conflicts
    if (skipFiles.has(relativePath)) {
      skipped++;
      continue;
    }
    
    const fullPath = path.join(outputDir, relativePath);
    totalSize += entry.header.size;
    
    // Utwórz katalog jeśli nie istnieje
    await fs.ensureDir(path.dirname(fullPath));
    
    // Rozpakuj plik
    zip.extractEntryTo(entry, path.dirname(fullPath), false, true, path.basename(fullPath));
    extracted++;
    
    // Progress bar
    if (totalFiles > 0 && extracted % Math.max(1, Math.floor(totalFiles / 50)) === 0) {
      const percent = Math.round((extracted / totalFiles) * 100);
      process.stdout.write(`\r📂 Rozpakowywanie... ${percent}% (${extracted}/${totalFiles})`);
    }
  }
  
  console.log(`\nRozpakowano ${extracted} plików (${formatBytes(totalSize)})`);
  if (skipped > 0) {
    console.log(`⏭️  Pominięto ${skipped} plików (konflikty)`);
  }
}

// === INIT ===
program
  .command("init")
  .description("Utwórz repozytorium na podstawie bieżącego folderu")
  .option("-d, --description <description>", "Opis repozytorium")
  .action(async (options) => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (exists) {
      console.log(`⚠️  Repozytorium '${repoName}' już istnieje.`);
      return;
    }
    
    try {
      const description = options.description || `Repozytorium dla folderu ${repoName}`;
      await createRepo(repoName, repoName, description);
      console.log(`Repozytorium '${repoName}' utworzone.`);
      console.log(`📝 Opis: ${description}`);
    } catch (error) {
      console.error(`❌ Błąd: ${error.message}`);
    }
  });

// === COMMENT ===
program
  .command("comment")
  .description("Zmień opis repozytorium")
  .argument("[comment...]", "nowy opis repozytorium")
  .action(async (commentParts) => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje. Najpierw wykonaj: mygit init`);
      return;
    }

    const comment = Array.isArray(commentParts) && commentParts.length > 0
      ? commentParts.join(" ")
      : "";

    try {
      console.log(`💬 Aktualizowanie opisu repozytorium '${repoName}'...`);
      
      const result = await updateRepoComment(repoName, comment);
      
      if (comment) {
        console.log(`Opis zaktualizowany: "${comment}"`);
      } else {
        console.log(`Opis usunięty`);
      }
      
    } catch (err) {
      console.error(`❌ Błąd: ${err.message}`);
      if (err.stack) {
        console.error(`🔍 Szczegóły: ${err.stack}`);
      }
    }
  });

// === SAVE ===
program
  .command("save")
  .description("Zrób snapshot bieżącego folderu")
  .allowExcessArguments(true)
  .argument("[message...]", "wiadomość snapshotu (może zawierać spacje)")
  .action(async (messageParts) => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje. Najpierw wykonaj: mygit init`);
      return;
    }

    const msg = Array.isArray(messageParts) && messageParts.length > 0
      ? messageParts.join(" ")
      : "snapshot";

    try {
      console.log(`📦 Tworzenie snapshotu dla repozytorium '${repoName}'...`);
      console.log(`💭 Wiadomość: ${msg}`);
      
      // UŻYJ SOURCE_PATH JEŚLI JEST USTAWIONA, W PRZECIWNYM RAZIE BIERZESZ process.cwd()
      const sourcePath = getSourcePath();
      console.log(`📁 Źródłowy folder: ${sourcePath}`);
      
      const result = await commitRepo(repoName, sourcePath, msg);
      
      console.log(`Snapshot zapisany: ${result.file}`);
      console.log(`📊 Rozmiar: ${formatBytes(result.size)}`);
      
      if (result.fileCount) {
        console.log(`📁 Plików: ${result.fileCount}`);
      }
      
    } catch (err) {
      console.error(`❌ Błąd: ${err.message}`);
      if (err.stack) {
        console.error(`🔍 Szczegóły: ${err.stack}`);
      }
    }
  });

// === LIST ===
program
  .command("list")
  .description("Wyświetl listę repozytoriów")
  .option("-v, --verbose", "Pokaż szczegółowe informacje")
  .action(async (options) => {
    try {
      const repos = await listRepos();
      
      if (!repos.length) {
        console.log("📭 Brak repozytoriów.");
        return;
      }
      
      console.log("📂 Lista repozytoriów:");
      
      for (const repo of repos) {
        if (options.verbose) {
          const stats = await getRepoStats(repo.id);
          console.log(`\n• ${repo.id}`);
          console.log(`  📝 Opis: ${repo.description || "brak opisu"}`);
          console.log(`  🕓 Utworzone: ${formatDate(repo.createdAt)}`);
          console.log(`  📊 Snapshoty: ${stats.commitCount}`);
          console.log(`  💾 Rozmiar: ${formatBytes(stats.totalSize)}`);
        } else {
          console.log(`• ${repo.id} - ${repo.description || "bez opisu"}`);
        }
      }
    } catch (error) {
      console.error(`❌ Błąd: ${error.message}`);
    }
  });

// === LOG ===
program
  .command("log")
  .description("Pokaż historię snapshotów bieżącego repozytorium")
  .option("-l, --limit <number>", "Ogranicz liczbę wyświetlanych snapshotów", "10")
  .action(async (options) => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje.`);
      return;
    }
    
    try {
      const commits = await getRepoCommits(repoName);
      const limit = parseInt(options.limit) || 10;
      const limitedCommits = commits.slice(0, limit);
      
      if (!limitedCommits.length) {
        console.log("📭 Brak snapshotów.");
        return;
      }
      
      console.log(`🕓 Historia snapshotów repo '${repoName}':`);
      
      limitedCommits.forEach((c, index) => {
        console.log(`\n${index + 1}. ${c.file}`);
        console.log(`   💭 ${c.message}`);
        console.log(`   🕓 ${formatDate(c.date)}`);
        console.log(`   📊 ${formatBytes(c.size)}`);
      });
      
      if (commits.length > limit) {
        console.log(`\n... i ${commits.length - limit} więcej snapshotów`);
      }
      
    } catch (error) {
      console.error(`❌ Błąd: ${error.message}`);
    }
  });

// === STATUS ===
program
  .command("status")
  .description("Pokaż status bieżącego repozytorium")
  .action(async () => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje.`);
      return;
    }
    
    try {
      const stats = await getRepoStats(repoName);
      const repos = await listRepos();
      const repo = repos.find(r => r.id === repoName);
      
      console.log(`📊 Status repozytorium '${repoName}':`);
      console.log(`📝 Opis: ${repo.description || "brak opisu"}`);
      console.log(`🕓 Utworzone: ${formatDate(repo.createdAt)}`);
      console.log(`📦 Snapshoty: ${stats.commitCount}`);
      console.log(`💾 Całkowity rozmiar: ${formatBytes(stats.totalSize)}`);
      console.log(`📈 Średni rozmiar snapshotu: ${formatBytes(stats.averageSize)}`);
      
      if (stats.lastCommit) {
        console.log(`\n📋 Ostatni snapshot:`);
        console.log(`   📁 ${stats.lastCommit.file}`);
        console.log(`   💭 ${stats.lastCommit.message}`);
        console.log(`   🕓 ${formatDate(stats.lastCommit.date)}`);
      }
      
    } catch (error) {
      console.error(`❌ Błąd: ${error.message}`);
    }
  });

// === DELETE SNAPSHOT ===
program
  .command("delete <file>")
  .description("Usuń snapshot o podanej nazwie z bieżącego repo")
  .action(async (file) => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje.`);
      return;
    }
    
    try {
      console.log(`🗑️ Usuwanie snapshotu: ${file}`);
      await deleteCommit(repoName, file);
      console.log(`Usunięto snapshot: ${file}`);
    } catch (err) {
      console.error(`❌ Błąd: ${err.message}`);
    }
  });

// === DELETE REPO ===
program
  .command("delete-repo")
  .description("Usuń całe repozytorium")
  .action(async () => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje.`);
      return;
    }
    
    // Potwierdzenie
    const readline = (await import('readline')).createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    readline.question(`⚠️  Czy na pewno chcesz usunąć repozytorium '${repoName}'? (T/N): `, async (answer) => {
      if (answer.toLowerCase() === 't' || answer.toLowerCase() === 'tak') {
        try {
          await deleteRepo(repoName);
          console.log(`Usunięto repozytorium: ${repoName}`);
        } catch (error) {
          console.error(`❌ Błąd: ${error.message}`);
        }
      } else {
        console.log("❌ Anulowano usuwanie repozytorium.");
      }
      readline.close();
    });
  });

// === ALIASY ===
program
  .command("push")
  .description("Alias dla save (zrób snapshot)")
  .argument("[message...]", "wiadomość snapshotu (może zawierać spacje)")
  .allowExcessArguments(true)
  .action(async (messageParts) => {
    const repoName = getCurrentRepoName();
    const exists = await repoExists(repoName);
    
    if (!exists) {
      console.log(`❌ Repozytorium '${repoName}' nie istnieje. Najpierw wykonaj: mygit init`);
      return;
    }

    const msg = Array.isArray(messageParts) && messageParts.length > 0
      ? messageParts.join(" ")
      : "snapshot";

    try {
      console.log(`📦 Tworzenie snapshotu dla repozytorium '${repoName}'...`);
      
      // UŻYJ SOURCE_PATH JEŚLI JEST USTAWIONA, W PRZECIWNYM RAZIE BIERZESZ process.cwd()
      const sourcePath = getSourcePath();
      console.log(`📁 Źródłowy folder: ${sourcePath}`);
      
      const result = await commitRepo(repoName, sourcePath, msg);
      console.log(`Snapshot zapisany: ${result.file}`);
      console.log(`📊 Rozmiar: ${formatBytes(result.size)}`);
    } catch (err) {
      console.error(`❌ Błąd: ${err.message}`);
    }
  });

program
  .command("history")
  .description("Alias dla log (pokaż historię)")
  .action(() => program.parse(["node", "mygit", "log"]));

program
  .command("repos")
  .description("Alias dla list (lista repozytoriów)")
  .action(() => program.parse(["node", "mygit", "list"]));

// === INFO ===
program
  .command("info")
  .description("Informacje o systemie mygit")
  .action(() => {
    console.log(`
🧠 mygit - Lokalny system wersjonowania
Wersja: 1.2.0
Autor: Paffcio

📁 Struktura:
  data/repos/          - Główne repozytorium danych
  data/repos/<nazwa>/  - Poszczególne repozytoria
  data/repos/<nazwa>/versions/ - Snapshoty (pliki ZIP)
  data/repos/<nazwa>/meta.json - Metadane repozytorium
  data/repos/<nazwa>/commits.json - Historia snapshotów

🌐 Web Interface:
  Uruchom serwer: npm start
  Dostęp przez: http://localhost:3350

📋 Podstawowy workflow:
  1. mygit init          - utwórz repozytorium
  2. mygit comment "opis" - zmień opis repozytorium
  3. mygit save "opis"   - zrób snapshot
  4. mygit get           - pobierz snapshot
  5. mygit log           - zobacz historię
  6. mygit status        - sprawdź status
    `);
  });

// === HELP ===
program
  .name("mygit")
  .description("🧠  mygit - lokalny system wersjonowania od Paffcia 💾")
  .version("1.2.0");

program.action(() => {
  console.log(`
╭────────────────────────────────────╮
│  🧠  mygit - system wersjonowania  │
╰────────────────────────────────────╯
Użycie:
  mygit <komenda> [argumenty]

Podstawowe komendy:
  init                  🔧  utwórz repo z bieżącego folderu
  comment "opis"        💬  zmień opis repozytorium
  save "opis"           💾  zrób snapshot (commit)
  get [repo[@snapshot]] 📥  pobierz snapshot
  log                   🕓  pokaż historię snapshotów
  status                📊  pokaż status repozytorium
  list                  📂  lista wszystkich repozytoriów
  delete <zip>          🗑️  usuń snapshot
  delete-repo           🗑️  usuń całe repozytorium
  info                  ℹ️  informacje o systemie

Opcje dla get:
  -f, --force            Nadpisz istniejące pliki
  -b, --backup           Zrób backup przed nadpisaniem (domyślnie: tak)
  -d, --dry-run          Tylko pokaż co by zostało zrobione
  -o, --output DIR       Folder docelowy (domyślnie .)
  -s, --skip-conflicts   Pomiń pliki gdzie lokalne są nowsze
  -t, --timeout SEC      Timeout pobierania (domyślnie: 60s)

Skróty:
  push    → save
  history → log
  repos   → list

Przykłady get:
  mygit get                                     # Pobierz najnowszy snapshot
  mygit get myproject                           # Pobierz najnowszy snapshot myproject
  mygit get myproject@2025-12-04_15-30-00.zip   # Pobierz konkretny snapshot
  mygit get --force --backup                    # Nadpisz z backupem
  mygit get --output ./backup                   # Pobierz do folderu backup
  mygit get --skip-conflicts                    # Pomiń pliki z konfliktami
`);
});

program.parse(process.argv);