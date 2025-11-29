import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ścieżka do głównego katalogu projektu mygit
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Wczytaj config z bezwzględną ścieżką
const require = createRequire(import.meta.url);
const rawConfig = require("../config.json");

// Rozwiąż wszystkie ścieżki względem katalogu projektu
export const config = {
  ...rawConfig,
  dataDir: path.resolve(PROJECT_ROOT, rawConfig.dataDir),
  staticWeb: path.resolve(PROJECT_ROOT, rawConfig.staticWeb)
};

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