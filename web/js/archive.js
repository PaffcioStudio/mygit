// archive.js — Zarządzanie archiwum (przechowywane na serwerze w /data/archive/)
import { state } from './state.js';
import { toast } from './toast.js';
import { fetchJson, postJson } from './utils.js';

// Załaduj archiwum z serwera
export async function loadArchive() {
  try {
    const data = await fetchJson('/api/archive');
    state.archived     = data.archived  || [];
    state.archivedMeta = data.meta      || {};
  } catch {
    state.archived = [];
    state.archivedMeta = {};
  }
}

export function isArchived(id) { return state.archived.includes(id); }

export async function archiveRepo(id) {
  if (isArchived(id)) return;
  const repo = state.repos.find(r => r.id === id);
  const meta = {
    wasFav:      repo?.isFavourite || false,
    archivedAt:  new Date().toISOString(),
    name:        repo?.name || id,
    description: repo?.description || '',
  };
  try {
    await postJson(`/api/archive/${id}`, { meta });
    state.archived.push(id);
    state.archivedMeta[id] = meta;
    toast(`„${repo?.name || id}" przeniesiony do archiwum`, 'info');
  } catch (e) {
    toast('Błąd archiwizacji: ' + e.message, 'error');
  }
}

export async function unarchiveRepo(id) {
  try {
    await fetchJson(`/api/archive/${id}`, { method: 'DELETE' });
    state.archived = state.archived.filter(x => x !== id);
    delete state.archivedMeta[id];
    toast('Projekt przywrócony', 'success');
  } catch (e) {
    toast('Błąd przywracania: ' + e.message, 'error');
  }
}

export async function deleteArchivedRepo(id) {
  try {
    await fetchJson(`/api/archive/${id}`, { method: 'DELETE' });
    state.archived = state.archived.filter(x => x !== id);
    delete state.archivedMeta[id];
  } catch {}
}

export function getArchivedList() {
  return state.archived.map(id => ({
    id,
    ...state.archivedMeta[id],
  }));
}
