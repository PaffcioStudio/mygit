// cache.js — ZIP LRU cache dla mygit
// RepoCache usunięty — SQLite jest wystarczająco szybki jako "cache"
// ZipCache zostaje — unika ponownego parsowania dużych ZIP-ów

const ZIP_LRU_SIZE = 8; // ostatnie 8 otwartych ZIP-ów

class ZipCache {
  constructor() {
    this._cache = new Map(); // Map<zipPath, {zip, ts}>
  }

  get(zipPath) {
    const entry = this._cache.get(zipPath);
    if (!entry) return null;
    // Przesuń na koniec (MRU)
    this._cache.delete(zipPath);
    this._cache.set(zipPath, entry);
    return entry.zip;
  }

  set(zipPath, zip) {
    if (this._cache.has(zipPath)) this._cache.delete(zipPath);
    if (this._cache.size >= ZIP_LRU_SIZE) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(zipPath, { zip, ts: Date.now() });
  }

  invalidate(zipPath) {
    this._cache.delete(zipPath);
  }

  invalidateRepo(repoId) {
    for (const key of this._cache.keys()) {
      if (key.includes(`/repos/${repoId}/`)) this._cache.delete(key);
    }
  }
}

export const zipCache = new ZipCache();
