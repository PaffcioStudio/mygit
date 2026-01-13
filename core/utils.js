import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ścieżka do głównego katalogu projektu mygit
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.resolve(PROJECT_ROOT, "config.json");

const DEFAULT_CONFIG = {
  port: 3350,
  dataDir: "./data",
  staticWeb: "./web",
  maxZipSizeMB: 1024
};

// Funkcja pomocnicza do synchronizacji configu
function loadOrCreateConfig() {
  let raw;
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log("📄 Nie znaleziono config.json. Tworzę domyślny...");
    fs.writeJsonSync(CONFIG_PATH, DEFAULT_CONFIG, { spaces: 2 });
    raw = DEFAULT_CONFIG;
  } else {
    try {
      raw = fs.readJsonSync(CONFIG_PATH);
    } catch (e) {
      console.error("❌ Błąd czytania config.json, używam domyślnych.");
      raw = DEFAULT_CONFIG;
    }
  }

  // Rozwiąż ścieżki względem PROJECT_ROOT, aby zawsze były bezwzględne
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    dataDir: path.resolve(PROJECT_ROOT, raw.dataDir || DEFAULT_CONFIG.dataDir),
    staticWeb: path.resolve(PROJECT_ROOT, raw.staticWeb || DEFAULT_CONFIG.staticWeb)
  };
}

// Eksport stałej konfiguracji
export const config = loadOrCreateConfig();

export async function ensureDataDir() {
  await fs.ensureDir(config.dataDir);
}

export function repoBasePath() {
  return path.resolve(config.dataDir, "repos");
}

export function repoMetaPath(repoId) {
  return path.join(repoBasePath(), repoId, "meta.json");
}

export function getProjectRoot() {
  return PROJECT_ROOT;
}