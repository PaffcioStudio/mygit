#!/usr/bin/env node
import { program } from "commander";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from 'url';
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

// Pomocnicze funkcje
function getCurrentRepoName() {
  // Jeśli wrapper SSH przesłał nazwę repozytorium (np. SynoPlayer), użyj jej
  if (process.env.REPO_NAME && process.env.REPO_NAME.trim() !== "") {
    return process.env.REPO_NAME.trim();
  }
  // W przeciwnym razie - nazwa bieżącego katalogu (lokalnie)
  return path.basename(process.cwd());
}

function getSourcePath() {
  // Użyj SOURCE_PATH jeśli jest ustawiona, w przeciwnym razie użyj bieżącego katalogu
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
      console.log(`✅ Repozytorium '${repoName}' utworzone.`);
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
        console.log(`✅ Opis zaktualizowany: "${comment}"`);
      } else {
        console.log(`✅ Opis usunięty`);
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
      
      console.log(`✅ Snapshot zapisany: ${result.file}`);
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
      console.log(`✅ Usunięto snapshot: ${file}`);
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
          console.log(`✅ Usunięto repozytorium: ${repoName}`);
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
      console.log(`✅ Snapshot zapisany: ${result.file}`);
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
Wersja: 1.0.0
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
  4. mygit log           - zobacz historię
  5. mygit status        - sprawdź status
    `);
  });

// === HELP ===
program
  .name("mygit")
  .description("🧠  mygit - lokalny system wersjonowania od Paffcia 💾")
  .version("1.0.0");

program.action(() => {
  console.log(`
╭────────────────────────────────────╮
│  🧠  mygit - system wersjonowania  │
╰────────────────────────────────────╯
Użycie:
  mygit <komenda> [argumenty]

Podstawowe komendy:
  init            🔧  utwórz repo z bieżącego folderu
  comment "opis"  💬  zmień opis repozytorium
  save "opis"     💾  zrób snapshot (commit)
  log             🕓  pokaż historię snapshotów
  status          📊  pokaż status repozytorium
  list            📂  lista wszystkich repozytoriów
  delete <zip>    🗑️  usuń snapshot
  delete-repo     🗑️  usuń całe repozytorium
  info            ℹ️  informacje o systemie

Skróty:
  push    → save
  history → log
  repos   → list

Przykłady:
  mygit init
  mygit comment "Mój projekt Node.js"
  mygit save "nowa wersja"
  mygit log
  mygit status
  mygit delete 2025-11-09_15-48-22.zip
`);
});

program.parse(process.argv);