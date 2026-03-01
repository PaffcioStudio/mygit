import fs from "fs-extra";
import archiver from "archiver";
import path from "path";
import dayjs from "dayjs";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const DEFAULT_IGNORES = [
  "node_modules/",
  ".mygit_backup*/",
  ".git/",
  ".vscode/",
  ".idea/",
  "dist/",
  "build/",
  "data/",
  "*.log",
  "*.tmp",
  "*.swp"
//  "mygit",
//  "mygit/",
//  "mygit/*"
];

async function loadIgnorePatterns(sourcePath) {
  const ignoreFile = path.join(sourcePath, ".mygitignore");
  let lines = [];
  if (await fs.pathExists(ignoreFile)) {
    const content = await fs.readFile(ignoreFile, "utf8");
    lines = content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));
  }
  return [...new Set([...DEFAULT_IGNORES, ...lines])];
}

function shouldIgnore(filePath, sourcePath, patterns) {
  const normalizedFilePath = path.resolve(filePath);
  const normalizedSourcePath = path.resolve(sourcePath);
  
  if (!normalizedFilePath.startsWith(normalizedSourcePath)) return true;

  // FIX: Poprawiony regex zamiany backslashy na slashe
  const rel = path.relative(normalizedSourcePath, normalizedFilePath).replace(/\\/g, "/");
  if (!rel) return false;

  return patterns.some(pat => {
    let isRootOnly = false;
    let currentPat = pat;
    if (pat.startsWith("/")) {
      isRootOnly = true;
      currentPat = pat.slice(1);
    }

    const regexPat = currentPat
      .split('*')
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    
    const regex = new RegExp(`^${regexPat}(/.*)?$`);

    if (isRootOnly) {
      return regex.test(rel);
    } else {
      return regex.test(rel) || rel.split('/').some(part => new RegExp(`^${regexPat}$`).test(part));
    }
  });
}

function escapeRegExp(str) {
  // Poprawiony backup znaków specjalnych
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectFiles(dir, base, patterns, files = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      
      // Sprawdź czy powinno być ignorowane
      if (shouldIgnore(full, base, patterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        await collectFiles(full, base, patterns, files);
      } else {
        try {
          const stats = await fs.stat(full);
          if (stats.size <= MAX_FILE_SIZE) {
            files.push(full);
          }
        } catch (error) {
          console.log(`⚠️ Nie można odczytać pliku ${full}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ Nie można odczytać katalogu ${dir}: ${error.message}`);
  }
  
  return files;
}

// Główna funkcja tworzenia snapshotu
export async function commitSnapshot(sourcePath, destVersionsDir, message = "snapshot") {
  console.log(`📁 Source path: ${sourcePath}`);
  console.log(`💾 Destination versions dir: ${destVersionsDir}`);
  
  if (!await fs.pathExists(sourcePath))
    throw new Error("Ścieżka źródłowa nie istnieje: " + sourcePath);

  // Sprawdź czy sourcePath jest katalogiem
  const stat = await fs.stat(sourcePath);
  if (!stat.isDirectory()) {
    throw new Error("Ścieżka źródłowa musi być katalogiem");
  }

  const timestamp = dayjs().format("YYYYMMDD_HHmmss_SSS");
  const archiveName = `${timestamp}.zip`;
  await fs.ensureDir(destVersionsDir);
  const outPath = path.join(destVersionsDir, archiveName);

  console.log(`🎯 Output archive: ${outPath}`);

  const patterns = await loadIgnorePatterns(sourcePath);
  console.log("🧹 Ignorowane wzorce:", patterns.join(", "));

  const allFiles = await collectFiles(sourcePath, sourcePath, patterns);
  console.log(`📁 Znaleziono ${allFiles.length} plików do spakowania.`);

  if (allFiles.length === 0) {
    throw new Error("Brak plików do zarchiwizowania - wszystkie pliki są ignorowane lub katalog jest pusty");
  }

  const output = fs.createWriteStream(outPath);
  const archive = archiver("zip", { 
    zlib: { level: 9 },
    store: true // bez kompresji dla większej szybkości
  });

  let processed = 0;
  let lastPercent = 0;

  archive.on("progress", (data) => {
    const percent = Math.floor((data.fs.processedBytes / data.fs.totalBytes) * 100);
    if (percent >= lastPercent + 10) {
      lastPercent = percent;
      process.stdout.write(`⏳ Pakowanie... ${percent}%\r`);
    }
  });

  return new Promise((resolve, reject) => {
    output.on("close", async () => {
      console.log(`\nSnapshot zapisany (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB): ${archiveName}`);
      resolve({ archiveName, outPath, size: archive.pointer() });
    });
    
    archive.on("error", err => reject(err));
    
    // Przywrócona obsługa ostrzeżeń, której brakowało w poprzedniej wersji
    archive.on("warning", err => {
      if (err.code === 'ENOENT') {
        console.log(`⚠️ Ostrzeżenie archiwizacji: ${err.message}`);
      } else {
        reject(err);
      }
    });
    
    archive.pipe(output);

    // Dodaj pliki do archiwum
    for (const file of allFiles) {
      try {
        // Poprawna zamiana ukośników dla struktury ZIPa (ważne dla kompatybilności systemów)
        const rel = path.relative(sourcePath, file).replace(/\\/g, "/");
        archive.file(file, { name: rel });
        processed++;
        if (processed % 100 === 0) {
          process.stdout.write(`🧩 Dodano ${processed}/${allFiles.length} plików\r`);
        }
      } catch (error) {
        console.log(`⚠️ Nie można dodać pliku ${file}: ${error.message}`);
      }
    }

    console.log(`\n🎯 Finalizowanie archiwum...`);
    archive.finalize();
  });
}