import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

/**
 * Generuje UUID v4
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Waliduje i uzupełnia meta.json
 * @param {Object} meta - obiekt metadanych
 * @param {string} repoId - ID repozytorium
 * @returns {Object} - zwalidowane i uzupełnione metadane
 */
export function validateAndFixMeta(meta, repoId) {
  const now = new Date().toISOString();

  let category = meta.category;

  // Normalizacja starych danych
  if (!category || category === "Bez kategorii") {
    category = "bez-kategorii";
  }

  return {
    id: meta.id || repoId,
    uuid: meta.uuid || generateUUID(),
    name: meta.name || meta.id || repoId,
    description: meta.description || "",
    category,
    favourite: meta.favourite || false,
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || now,
    lastCommit: meta.lastCommit || null
  };
}

/**
 * Waliduje strukturę meta.json
 * @param {Object} meta 
 * @returns {boolean}
 */
export function isValidMeta(meta) {
  const required = ['id', 'uuid', 'name', 'createdAt', 'updatedAt'];
  return required.every(field => meta.hasOwnProperty(field) && meta[field] !== null);
}

/**
 * Sprawdza czy commits.json ma poprawną strukturę
 * @param {Array} commits 
 * @returns {boolean}
 */
export function isValidCommits(commits) {
  if (!Array.isArray(commits)) return false;
  
  return commits.every(commit => {
    return commit.id && commit.file && commit.date;
  });
}

/**
 * Migruje istniejące repo do nowego formatu
 * @param {string} repoPath - ścieżka do repozytorium
 * @param {string} repoId - ID repozytorium
 */
export async function migrateRepo(repoPath, repoId) {
  const metaPath = path.join(repoPath, "meta.json");
  const commitsPath = path.join(repoPath, "commits.json");
  
  let meta = {};
  let commits = [];
  let needsSave = false;
  
  // Wczytaj istniejące dane
  if (await fs.pathExists(metaPath)) {
    try {
      meta = await fs.readJson(metaPath);
    } catch (e) {
      console.warn(`⚠️  Błąd odczytu meta.json dla ${repoId}, tworzę nowe`);
    }
  }
  
  if (await fs.pathExists(commitsPath)) {
    try {
      commits = await fs.readJson(commitsPath);
    } catch (e) {
      console.warn(`⚠️  Błąd odczytu commits.json dla ${repoId}, tworzę nowe`);
      commits = [];
    }
  }
  
  // Sprawdź czy trzeba migrować
  if (!meta.uuid || !meta.category || !meta.createdAt) {
    console.log(`🔄 Migracja repozytorium: ${repoId}`);
    needsSave = true;
  }
  
  // Waliduj i napraw meta
  const fixedMeta = validateAndFixMeta(meta, repoId);
  
  // Zapisz tylko jeśli coś się zmieniło
  if (needsSave || JSON.stringify(meta) !== JSON.stringify(fixedMeta)) {
    await fs.writeJson(metaPath, fixedMeta, { spaces: 2 });
    console.log(`✅ Zaktualizowano meta.json dla ${repoId}`);
    
    // Loguj dodane pola
    if (!meta.uuid) console.log(`   📝 Dodano UUID: ${fixedMeta.uuid}`);
    if (!meta.category) console.log(`   📁 Dodano kategorię: ${fixedMeta.category}`);
  }
  
  // Waliduj commits
  if (!isValidCommits(commits)) {
    console.warn(`⚠️  Nieprawidłowa struktura commits.json dla ${repoId}`);
    await fs.writeJson(commitsPath, [], { spaces: 2 });
  }
  
  return fixedMeta;
}

/**
 * Sprawdza całość struktury danych i przeprowadza migrację jeśli potrzeba
 * @param {string} dataDir - katalog data/repos
 */
export async function validateAndMigrateAll(dataDir) {
  console.log("🔍 Sprawdzanie struktury danych...");
  
  if (!await fs.pathExists(dataDir)) {
    console.log("📁 Katalog repos nie istnieje, tworzę...");
    await fs.ensureDir(dataDir);
    return;
  }
  
  const repos = await fs.readdir(dataDir);
  let migrated = 0;
  
  for (const repoId of repos) {
    const repoPath = path.join(dataDir, repoId);
    const stat = await fs.stat(repoPath);
    
    if (!stat.isDirectory()) continue;
    
    try {
      await migrateRepo(repoPath, repoId);
      migrated++;
    } catch (e) {
      console.error(`❌ Błąd migracji ${repoId}: ${e.message}`);
    }
  }
  
  console.log(`✅ Sprawdzono ${migrated} repozytoriów\n`);
}