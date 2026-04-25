// objectStore.js — warstwa fizycznego przechowywania obiektów (delta storage, Warstwa 1)
//
// Każdy unikalny plik trafia do data/objects/<xx>/<reszta_hasha>
// (podkatalog z pierwszymi 2 znakami hasha — jak git objects)
// Identyczne pliki w różnych projektach/snapshotach zajmują miejsce tylko raz.

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { config } from './utils.js';
import {
  dbFilterMissingObjects,
  dbAddObjects,
  dbCreateManifest,
  dbHasObject,
} from './db.js';

const OBJECTS_DIR = path.join(config.dataDir, 'objects');

// ── Ścieżka do obiektu ────────────────────────────────────────────────────

export function objectPath(hash) {
  return path.join(OBJECTS_DIR, hash.slice(0, 2), hash.slice(2));
}

// ── Sprawdzenie jakich hashy brakuje ─────────────────────────────────────

export function checkMissingObjects(hashes) {
  return dbFilterMissingObjects(hashes);
}

// ── Zapisanie obiektów z ZIPa ──────────────────────────────────────────────
// zipPath     — ścieżka do ZIPa zawierającego TYLKO brakujące pliki
// fileMap     — pełna mapa { "ścieżka": "sha256hash" } całego snapshotu
// expectedSet — Set hashy które powinny być w ZIPie (missing)
//
// Zwraca: { saved: n, skipped: n }

export async function saveObjectsFromZip(zipPath, expectedSet) {
  await fs.ensureDir(OBJECTS_DIR);

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);

  const newObjects = [];
  let saved = 0;
  let skipped = 0;

  for (const entry of entries) {
    const buf = entry.getData();

    // Hash pliku z ZIPa — weryfikujemy że zgadza się z oczekiwanym
    const hash = crypto.createHash('sha256').update(buf).digest('hex');

    if (!expectedSet.has(hash)) {
      // Plik nie był na liście brakujących — ignoruj (np. stary format, dodatkowy plik)
      skipped++;
      continue;
    }

    const dest = objectPath(hash);
    if (await fs.pathExists(dest)) {
      // Obiekt już istnieje (race condition lub ponowna próba) — pomiń zapis
      skipped++;
    } else {
      await fs.ensureDir(path.dirname(dest));
      await fs.writeFile(dest, buf);
      newObjects.push({ hash, size: buf.length });
      saved++;
    }
  }

  if (newObjects.length) {
    dbAddObjects(newObjects);
  }

  return { saved, skipped };
}

// ── Pobranie obiektu po hashu ─────────────────────────────────────────────

export async function getObject(hash) {
  const p = objectPath(hash);
  if (!await fs.pathExists(p)) return null;
  return fs.readFile(p);
}

// ── Sprawdź czy obiekt istnieje fizycznie ─────────────────────────────────

export async function objectExists(hash) {
  return fs.pathExists(objectPath(hash));
}

// ── Rekonstrukcja stanu projektu (dla restore/cat) ────────────────────────
// manifest.files: { "ścieżka/do/pliku": "sha256hash" }
// Zwraca Buffer ZIPa z pełnym stanem projektu

export async function reconstructSnapshot(manifest) {
  const zip = new AdmZip();

  for (const [filePath, hash] of Object.entries(manifest.files)) {
    const buf = await getObject(hash);
    if (!buf) {
      throw new Error(`Brakujący obiekt: ${hash} (plik: ${filePath})`);
    }
    zip.addFile(filePath, buf);
  }

  return zip.toBuffer();
}

// ── Migracja: zapisz pojedynczy plik do object store ─────────────────────
// Używane przez migrate-to-delta.js

export async function saveObjectFromBuffer(buf, hash) {
  if (!hash) {
    hash = crypto.createHash('sha256').update(buf).digest('hex');
  }
  const dest = objectPath(hash);
  if (!await fs.pathExists(dest)) {
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, buf);
    dbAddObjects([{ hash, size: buf.length }]);
    return { hash, saved: true };
  }
  return { hash, saved: false };
}

// ── Info o object store ───────────────────────────────────────────────────

export async function objectStoreStats() {
  let totalFiles = 0;
  let totalSize = 0;

  async function scanDir(dir) {
    if (!await fs.pathExists(dir)) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await scanDir(full);
      } else {
        totalFiles++;
        const stat = await fs.stat(full);
        totalSize += stat.size;
      }
    }
  }

  await scanDir(OBJECTS_DIR);
  return { totalFiles, totalSize, objectsDir: OBJECTS_DIR };
}
