import fs from "fs-extra";
import archiver from "archiver";
import path from "path";
import dayjs from "dayjs";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const DEFAULT_IGNORES = [
  "node_modules/",
  ".git/",
  ".vscode/",
  ".idea/",
  "dist/",
  "build/",
  "data/",
  "*.log",
  "*.tmp",
  "*.swp",
  "mygit",
  "mygit/",
  "mygit/*"
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
  // Normalizuj ścieżki
  const normalizedFilePath = path.resolve(filePath);
  const normalizedSourcePath = path.resolve(sourcePath);
  
  // Sprawdź czy plik jest poza sourcePath (może się zdarzyć przy linkach symbolicznych)
  if (!normalizedFilePath.startsWith(normalizedSourcePath)) {
    return true;
  }

  const rel = path.relative(normalizedSourcePath, normalizedFilePath).replace(/\\/g, "/");

  // Ignoruj puste ścieżki
  if (!rel) return true;

  return patterns.some(pat => {
    if (pat.endsWith("/")) {
      const dirPattern = pat.slice(0, -1);
      return rel === dirPattern || rel.startsWith(dirPattern + "/");
    }
    if (pat.includes("*")) {
      const regex = new RegExp("^" + pat.split("*").map(escapeRegExp).join(".*") + "$");
      return regex.test(rel);
    }
    return rel === pat;
  });
}

function escapeRegExp(str) {
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

// główna funkcja tworzenia snapshotu
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