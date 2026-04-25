// state.js — Centralny stan aplikacji
export const state = {
  repos:           [],
  filteredRepos:   [],
  favourites:      [],
  archived:        [],       // id[] zarchiwizowanych repozytoriów
  archivedMeta:    {},       // { [id]: { wasFav, archivedAt } }
  categories:      [],
  currentSort:     'newest',
  selectedCategory: '',
  searchQuery:     '',

  // Aktywne repo
  currentRepo:     null,     // obiekt repo
  currentSnapshot: null,     // string — nazwa pliku .zip
  snapshots:       [],       // lista snapshotów aktualnego repo
  snapshotMessages: {},      // { [file]: message } — opisy z bazy danych
  currentPath:     '',       // ścieżka w przeglądarce

  // Notatki
  notes:           {},       // { [repoId]: { text, tags, updatedAt } }

  // UI
  currentView:     'dashboard', // 'dashboard' | 'repo' | 'archive'
  currentEditor:   null,
  serverOnline:    false,
};
