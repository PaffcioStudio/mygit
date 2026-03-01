// notes.js — Notatki i metadane repozytoriów (przechowywane na serwerze w /data/notes.json)
import { state } from './state.js';
import { toast } from './toast.js';
import { fetchJson } from './utils.js';

export async function loadNotes() {
  try {
    state.notes = await fetchJson('/api/notes');
  } catch { state.notes = {}; }
}

export async function saveNote(repoId, text, tags = []) {
  try {
    await fetchJson(`/api/notes/${repoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tags }),
    });
    state.notes[repoId] = { text, tags, updatedAt: new Date().toISOString() };
    toast('Notatka zapisana', 'success');
  } catch (e) {
    toast('Błąd zapisu notatki: ' + e.message, 'error');
  }
}

export function getNote(repoId) {
  return state.notes[repoId] || { text: '', tags: [] };
}

export function renderNotesPanel(repoId) {
  const panel = document.getElementById('notesPanel');
  if (!panel) return;
  const note = getNote(repoId);
  const repo = state.currentRepo;

  panel.innerHTML = `
    <div class="notes-header">
      <span>Metadane projektu</span>
    </div>
    <div class="notes-body">
      <div class="notes-section">
        <div class="notes-section-title">Notatki</div>
        <textarea id="noteText" class="notes-textarea" placeholder="Dodaj notatki do projektu...">${note.text || ''}</textarea>
        <button onclick="saveCurrentNote('${repoId}')" class="notes-save-btn">Zapisz notatki</button>
      </div>
      <div class="notes-section">
        <div class="notes-section-title">Tagi</div>
        <div id="noteTags" class="mb-2">${renderTags(note.tags)}</div>
        <div style="display:flex;gap:6px">
          <input id="tagInput" type="text" placeholder="Dodaj tag..." class="notes-textarea" style="min-height:0;padding:5px 8px;resize:none"
            onkeydown="if(event.key==='Enter'){addTag('${repoId}');event.preventDefault()}">
          <button onclick="addTag('${repoId}')" class="btn btn-sm btn-primary" style="white-space:nowrap">+</button>
        </div>
      </div>
      <div class="notes-section">
        <div class="notes-section-title">Info</div>
        <div id="repoMetaInfo">${renderRepoMeta(repo)}</div>
      </div>
    </div>`;
}

function renderRepoMeta(repo) {
  if (!repo) return '<span style="font-size:11px;color:var(--text-muted)">Brak danych</span>';
  const row = (label, value) => value
    ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-subtle);gap:8px">
        <span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${label}</span>
        <span style="font-size:11px;color:var(--text-primary);text-align:right;word-break:break-all">${value}</span>
       </div>`
    : '';
  const fmt = (d) => {
    if (!d) return null;
    try { return new Date(d).toLocaleString('pl-PL', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return d; }
  };
  const hs = (b) => {
    if (!b) return null;
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
  };
  return [
    row('Nazwa', repo.name || repo.id),
    row('ID', `<code style="font-family:monospace;font-size:10px;background:var(--bg-muted);padding:1px 4px;border-radius:3px">${repo.id}</code>`),
    row('Kategoria', repo.category || 'Brak'),
    row('Snapshoty', repo.snapshots != null ? String(repo.snapshots) : null),
    row('Rozmiar', repo.size ? hs(repo.size) : null),
    row('Utworzono', fmt(repo.createdAt)),
    row('Ostatnia zmiana', fmt(repo.updatedAt)),
    row('Opis', repo.description || null),
  ].filter(Boolean).join('') || '<span style="font-size:11px;color:var(--text-muted)">Brak danych</span>';
}

function renderTags(tags) {
  if (!tags?.length) return '<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">Brak tagów</span>';
  return tags.map((t, i) => `
    <span class="notes-tag">
      ${t}
      <span onclick="removeTag('${i}')" style="cursor:pointer;color:var(--text-muted);margin-left:2px">×</span>
    </span>`).join('');
}

// Globalne funkcje dla onclick=
window.saveCurrentNote = async function(repoId) {
  const text = document.getElementById('noteText')?.value || '';
  const note = getNote(repoId);
  await saveNote(repoId, text, note.tags);
};

window.addTag = async function(repoId) {
  const input = document.getElementById('tagInput');
  const val = input?.value.trim();
  if (!val) return;
  const note = getNote(repoId);
  const tags = [...(note.tags || [])];
  if (!tags.includes(val)) {
    tags.push(val);
    await saveNote(repoId, note.text || '', tags);
  }
  if (input) input.value = '';
  document.getElementById('noteTags').innerHTML = renderTags(tags);
};

window.removeTag = async function(indexStr) {
  const note = getNote(state.currentRepo?.id);
  if (!note) return;
  const tags = (note.tags || []).filter((_, i) => i !== parseInt(indexStr));
  await saveNote(state.currentRepo?.id, note.text || '', tags);
  document.getElementById('noteTags').innerHTML = renderTags(tags);
};
