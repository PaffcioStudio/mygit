import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const WEB_DIR = path.join(PROJECT_ROOT, 'web');
export const REPOS_DIR = path.join(DATA_DIR, 'repos');

console.log(`🔧 Ścieżki mygit:
  PROJECT_ROOT: ${PROJECT_ROOT}
  DATA_DIR: ${DATA_DIR}
  WEB_DIR: ${WEB_DIR}
  REPOS_DIR: ${REPOS_DIR}
`);