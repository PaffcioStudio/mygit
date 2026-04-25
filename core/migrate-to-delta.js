#!/usr/bin/env node
// migrate-to-delta.js — Warstwa 2: migracja istniejących ZIP-ów do object store
//
// Użycie:
//   node core/migrate-to-delta.js [--dry-run] [--repo=nazwa] [--yes]
//
// Opcje:
//   --dry-run    Symulacja bez zapisu — pokazuje ile miejsca zostanie zaoszczędzone
//   --repo=xxx   Migruj tylko jedno repozytorium
//   --yes        Nie pytaj o potwierdzenie przed usunięciem ZIP-ów
//
// Algorytm:
//   Dla każdego repo → dla każdego ZIP (chronologicznie):
//     1. Wypakuj do /tmp
//     2. Dla każdego pliku oblicz SHA-256
//     3. Jeśli hash nie istnieje w object store → skopiuj plik
//     4. Zapisz manifest w SQLite
//     5. (Opcjonalnie) usuń oryginalny ZIP
//
// Idempotentne — snapshoty ze zmigrowanym manifestem są pomijane.

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// Inicjalizacja
const { config } = await import('./utils.js');
const { initDb, getDb, dbGetManifest, dbCreateManifest, dbAddObjects, dbFilterMissingObjects } = await import('./db.js');
const { objectPath, saveObjectFromBuffer } = await import('./objectStore.js');

await initDb();

// ── Parsowanie argumentów ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const AUTO_YES = args.includes('--yes');
const repoArg  = (args.find(a => a.startsWith('--repo=')) || '').replace('--repo=', '');

const REPOS_DIR = path.join(config.dataDir, 'repos');

if (DRY_RUN) {
  console.log('🔍 TRYB DRY-RUN — żadne pliki nie będą zapisane ani usunięte\n');
}

// ── Formatowanie ──────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GB';
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(2) + ' MB';
  if (b >= 1024)      return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

// ── Główna logika migracji ─────────────────────────────────────────────────

async function migrateRepo(repoId) {
  const versionsDir = path.join(REPOS_DIR, repoId, 'versions');
  if (!await fs.pathExists(versionsDir)) {
    console.log(`  ⚠  Brak katalogu versions/ — pomijam`);
    return { migrated: 0, skipped: 0, savedBytes: 0 };
  }

  const zipFiles = (await fs.readdir(versionsDir))
    .filter(f => f.endsWith('.zip'))
    .sort(); // chronologicznie

  if (!zipFiles.length) {
    console.log(`  ℹ  Brak ZIP-ów`);
    return { migrated: 0, skipped: 0, savedBytes: 0 };
  }

  console.log(`  📦 ${zipFiles.length} ZIP-ów do przetworzenia`);

  let migrated = 0;
  let skipped  = 0;
  let totalSavedBytes = 0; // bajty zaoszczędzone (pliki istniejące już w store)
  let totalNewBytes   = 0; // nowe bajty dodane do store

  for (const zipFile of zipFiles) {
    const manifestId = zipFile.replace(/\.zip$/, '');
    const zipPath = path.join(versionsDir, zipFile);

    // Sprawdź idempotentność — czy manifest już istnieje
    const existing = dbGetManifest(manifestId);
    if (existing) {
      process.stdout.write(`    ⏭  ${zipFile} — już zmigrowany\n`);
      skipped++;
      continue;
    }

    const zipStat = await fs.stat(zipPath);
    process.stdout.write(`    🔄 ${zipFile} (${fmtBytes(zipStat.size)})... `);

    // Wypakuj ZIP
    let zip;
    try {
      zip = new AdmZip(zipPath);
    } catch (e) {
      console.log(`❌ Błąd otwierania ZIPa: ${e.message}`);
      continue;
    }

    const entries = zip.getEntries().filter(e => !e.isDirectory);

    const fileMap = {}; // { "ścieżka": "sha256hash" }
    let newObjectsCount  = 0;
    let reusedCount = 0;

    for (const entry of entries) {
      let buf;
      try { buf = entry.getData(); } catch (e) {
        console.log(`\n    ⚠  Błąd odczytu ${entry.entryName}: ${e.message}`);
        continue;
      }

      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      fileMap[entry.entryName] = hash;

      if (!DRY_RUN) {
        const result = await saveObjectFromBuffer(buf, hash);
        if (result.saved) {
          newObjectsCount++;
          totalNewBytes += buf.length;
        } else {
          reusedCount++;
          totalSavedBytes += buf.length;
        }
      } else {
        // dry-run: sprawdź czy obiekt już istnieje
        const destExists = await fs.pathExists(objectPath(hash));
        if (destExists) {
          reusedCount++;
          totalSavedBytes += buf.length;
        } else {
          newObjectsCount++;
          totalNewBytes += buf.length;
        }
      }
    }

    if (!DRY_RUN) {
      // Zapisz manifest
      // Odczytaj message z DB (commits table) jeśli istnieje
      const db = getDb();
      const commitRow = db.prepare(
        'SELECT message FROM commits WHERE repo_id = ? AND file = ?'
      ).get(repoId, zipFile);
      const message = commitRow?.message || 'migrated snapshot';

      dbCreateManifest(manifestId, repoId, message, fileMap);
    }

    migrated++;
    console.log(`✅  ${entries.length} plików | +${newObjectsCount} nowych | ♻ ${reusedCount} reuse`);
  }

  return { migrated, skipped, savedBytes: totalSavedBytes, newBytes: totalNewBytes };
}

// ── Zbierz repo do migracji ───────────────────────────────────────────────

if (!await fs.pathExists(REPOS_DIR)) {
  console.error('❌ Katalog repos/ nie istnieje:', REPOS_DIR);
  process.exit(1);
}

const allRepos = (await fs.readdir(REPOS_DIR)).filter(async d =>
  (await fs.stat(path.join(REPOS_DIR, d))).isDirectory()
);

const repos = repoArg ? [repoArg] : allRepos;

console.log(`📂 Repozytoria do migracji: ${repos.length}\n`);

let totalMigrated   = 0;
let totalSkipped    = 0;
let totalSavedBytes = 0;
let totalNewBytes   = 0;

for (const repoId of repos) {
  const repoDir = path.join(REPOS_DIR, repoId);
  if (!await fs.pathExists(repoDir)) {
    console.log(`⚠  Repozytorium nie istnieje: ${repoId}`);
    continue;
  }

  console.log(`\n🗂  ${repoId}`);
  const result = await migrateRepo(repoId);
  totalMigrated   += result.migrated;
  totalSkipped    += result.skipped;
  totalSavedBytes += (result.savedBytes || 0);
  totalNewBytes   += (result.newBytes || 0);
}

// ── Podsumowanie ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log('📊 PODSUMOWANIE MIGRACJI');
console.log('─'.repeat(60));
console.log(`  Zmigrowanych snapshotów : ${totalMigrated}`);
console.log(`  Pominiętych (już OK)    : ${totalSkipped}`);
console.log(`  Nowych danych w store   : ${fmtBytes(totalNewBytes)}`);
console.log(`  Pliki reused (zaoszcz.) : ${fmtBytes(totalSavedBytes)}`);
if (DRY_RUN) {
  console.log('\n  ℹ  Tryb dry-run — żadne zmiany nie zostały zapisane.');
  console.log('  Uruchom bez --dry-run żeby przeprowadzić migrację.');
} else {
  console.log('\n  ✅ Migracja zakończona.');
  console.log('  Stare ZIP-y zostają nieruszone. Usuń je ręcznie po weryfikacji:');
  console.log(`  find ${REPOS_DIR} -name "*.zip" -path "*/versions/*" -delete`);
}
console.log('─'.repeat(60));
