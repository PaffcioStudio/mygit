// explorer.js — Przeglądarka plików
import { state } from './state.js';
import { fetchJson, escapeHtml, escapeJS, humanSize, fmtDate, fmtDateFull, snapHash, snapMessage, snapDate, snapDateFull } from './utils.js';
import { getFileIcon, getExtLang } from './fileicons.js';
import { renderNotesPanel } from './notes.js';
import { toast } from './toast.js';

// Pobiera opis snapshotu — najpierw z bazy (state.snapshotMessages), potem z nazwy pliku
function getSnapMsg(file) {
  if (!file) return '';
  const fromDb = state.snapshotMessages?.[file];
  if (fromDb !== undefined && fromDb !== null) return fromDb;
  return snapMessage(file);
}

// ── Markdown renderer ──────────────────────────────────────────────────────
function renderMarkdown(container, content) {
  let html = '';
  try {
    if (window.marked) {
      // marked v9: parse synchronously, potem highlight.js post-process
      const renderer = new marked.Renderer();
      // Własny renderer dla bloków kodu — żeby klasa lang trafiła na <code>
      renderer.code = function(code, lang) {
        const validLang = lang && window.hljs && hljs.getLanguage(lang);
        const highlighted = validLang
          ? hljs.highlight(code, { language: lang }).value
          : (window.hljs ? hljs.highlightAuto(code).value : escapeHtml(code));
        const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        return `<pre><code${langClass}>${highlighted}</code></pre>`;
      };
      html = marked.parse(content, { renderer, breaks: true, gfm: true });
    } else {
      html = `<pre style="white-space:pre-wrap;word-break:break-word;padding:16px">${escapeHtml(content)}</pre>`;
    }
  } catch (e) {
    html = `<pre style="white-space:pre-wrap;word-break:break-word;padding:16px">${escapeHtml(content)}</pre>`;
  }
  container.innerHTML = `<div class="md-preview-wrap">${html}</div>`;
}

// ── Snapshot picker ────────────────────────────────────────────────────────
export function renderSnapshotPicker(snapshots, current) {
  const btn = document.getElementById('snapshotBtn');
  if (!btn) return;
  const msg = current ? (getSnapMsg(current) || snapHash(current)) : 'Wybierz snapshot';
  btn.innerHTML = `
    <svg class="snap-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3"/><path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0" opacity=".3"/>
    </svg>
    <span class="snap-label" title="${escapeHtml(current||'')}">${escapeHtml(msg.slice(0,36))}</span>
    <svg class="snap-caret" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <polyline points="6 9 12 15 18 9"/>
    </svg>`;
  const countEl = document.getElementById('snapCount');
  if (countEl) countEl.textContent = snapshots.length ? `${snapshots.length} snapshotów` : '';
}

export function openSnapshotDropdown() {
  const dd = document.getElementById('snapshotDropdown');
  if (!dd) return;
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) {
    const inp = dd.querySelector('.snap-dd-search input');
    if (inp) { inp.value = ''; filterSnaps(''); inp.focus(); }
  }
}

export function filterSnaps(q) {
  const list = document.getElementById('snapDdList');
  if (!list) return;
  const filtered = q
    ? state.snapshots.filter(s => getSnapMsg(s).toLowerCase().includes(q.toLowerCase()) || s.includes(q))
    : state.snapshots;
  renderSnapList(list, filtered);
}

function renderSnapList(container, snaps) {
  if (!snaps.length) {
    container.innerHTML = `<div class="loading-row" style="padding:20px">Brak snapshotów</div>`;
    return;
  }
  container.innerHTML = snaps.map((s, i) => `
    <div class="snap-dd-item ${s === state.currentSnapshot ? 'active' : ''}" onclick="selectSnapshot('${escapeJS(s)}')">
      <div class="snap-dd-msg">
        ${escapeHtml(getSnapMsg(s) || s)}
        ${i === 0 ? `<span class="snap-dd-latest">najnowszy</span>` : ''}
      </div>
      <div class="snap-dd-date">${snapDateFull(s) || s}</div>
    </div>`).join('');
}

window.selectSnapshot = async function(filename) {
  document.getElementById('snapshotDropdown')?.classList.remove('open');
  state.currentSnapshot = filename;
  state.currentPath = '';
  renderSnapshotPicker(state.snapshots, filename);
  const ddList = document.getElementById('snapDdList');
  if (ddList) renderSnapList(ddList, state.snapshots);
  await loadDirectory('');
};

window.openSnapshotDropdown = openSnapshotDropdown;

// ── Otwieranie repo ────────────────────────────────────────────────────────
export async function openRepo(repo) {
  state.currentRepo   = repo;
  state.currentPath   = '';

  try {
    const hist = await fetchJson(`/api/repos/${repo.id}/history`);
    state.snapshots = Array.isArray(hist) ? hist.map(c => c.file).filter(Boolean) : [];
    state.snapshotMessages = {};
    if (Array.isArray(hist)) hist.forEach(c => { if (c.file) state.snapshotMessages[c.file] = c.message || ''; });
    state.currentSnapshot = state.snapshots[0] || null;
  } catch {
    state.snapshots = [];
    state.currentSnapshot = null;
  }

  renderRepoHeader(repo);
  renderNotesPanel(repo.id);

  if (state.currentSnapshot) {
    await loadDirectory('');
  } else {
    showEmptyExplorer();
  }
}

function renderRepoHeader(repo) {
  const pathEl = document.getElementById('topbarPath');
  if (pathEl) pathEl.innerHTML = `
    <span style="color:var(--text-muted);cursor:pointer" onclick="window.showView('dashboard')">mygit</span>
    <span class="path-sep"> / </span>
    <span class="path-repo" title="Kliknij aby skopiować nazwę"
      onclick="window.copyRepoName('${escapeJS(repo.name)}')"
      style="cursor:pointer">${escapeHtml(repo.name)}</span>`;

  const acts = document.getElementById('topbarActions');
  if (acts) {
    const isFav = repo.isFavourite;
    acts.innerHTML = `
      <button id="favBtn" class="topbar-btn ${isFav ? 'fav-on' : ''}" onclick="window.toggleFav('${repo.id}')">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
        ${isFav ? 'Ulubione' : 'Dodaj do ulubionych'}
      </button>
      <button class="topbar-btn" onclick="window.showCategoryModal('${repo.id}')">
        ${getCatIcon(repo.category || '')}
        ${repo.category ? formatCat(repo.category) : 'Kategoria'}
      </button>
      <button class="topbar-btn" onclick="window.downloadCurrentSnap()">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Pobierz
      </button>
      <button class="topbar-btn danger" onclick="window.confirmArchive('${repo.id}')">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/>
          <line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
        Archiwizuj
      </button>
      <button class="topbar-btn danger" onclick="window.confirmDeleteRepo('${repo.id}')" title="Usuń repozytorium na zawsze">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
        Usuń repo
      </button>`;
  }

  renderSnapshotPicker(state.snapshots, state.currentSnapshot);
  const ddList = document.getElementById('snapDdList');
  if (ddList) renderSnapList(ddList, state.snapshots);
}

function getCatIcon(id) {
  const icons = {
    'bez-kategorii': `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    'web':           `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    'backend':       `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
    'frontend':      `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    'ai':            `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>`,
    'dev-platform':  `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></svg>`,
    'infra':         `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    'security':      `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    'media':         `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
    'game':          `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="17" cy="13" r="1" fill="currentColor"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59L1.99 17.31A2.5 2.5 0 0 0 4.49 20c.859 0 1.687-.47 2.12-1.25L8 17h8l1.39 1.75A2.5 2.5 0 0 0 19.51 20a2.5 2.5 0 0 0 2.5-2.69l-1.712-8.72A4 4 0 0 0 17.32 5z"/></svg>`,
    'tools':         `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  };
  return icons[id] || `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
}

function formatCat(raw) {
  const map = { 'bez-kategorii':'Bez kategorii', 'work':'Praca', 'personal':'Osobiste',
    'tools':'Narzędzia pomocnicze', 'learning':'Nauka', 'backend':'Backend / API', 'frontend':'Frontend',
    'web':'Web / Frontend', 'infra':'System / Infrastruktura', 'security':'Bezpieczeństwo',
    'game':'Gry', 'media':'Media / Wideo / Audio', 'ai':'AI / Automatyzacja',
    'dev-platform':'Platformy developerskie' };
  return map[raw?.toLowerCase()] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '');
}

// ── Przeglądarka plików ────────────────────────────────────────────────────
export async function loadDirectory(dirPath) {
  state.currentPath = dirPath || '';
  // Reset sortowania przy każdej zmianie katalogu
  _sortState.col = 'name';
  _sortState.dir = 1;
  const repo = state.currentRepo;
  if (!repo || !state.currentSnapshot) return;

  const fileTable  = document.getElementById('fileTable');
  const breadcrumb = document.getElementById('explorerBreadcrumb');
  const commitBar  = document.getElementById('commitBar');

  if (fileTable) fileTable.innerHTML = `<div class="loading-row">
    <svg class="spin" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path d="M21 12a9 9 0 11-6.219-8.56"/>
    </svg> Ładowanie…
  </div>`;

  if (commitBar) {
    const hash = snapHash(state.currentSnapshot);
    const msg  = getSnapMsg(state.currentSnapshot);
    const date = snapDateFull(state.currentSnapshot);
    commitBar.innerHTML = `
      <span class="commit-hash">${hash}</span>
      <span class="commit-msg">${msg ? escapeHtml(msg) : '<span style="color:var(--text-muted);font-style:italic">(brak opisu)</span>'}</span>
      <span class="commit-date">${date}</span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
        <button class="btn btn-sm" title="Kopiuj ID snapshotu" onclick="window.copySnapId('${escapeJS(state.currentSnapshot)}')">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          ID
        </button>
        <button class="btn btn-sm btn-danger" title="Usuń snapshot" onclick="window.confirmDeleteSnapshot('${escapeJS(state.currentSnapshot)}')">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
          Usuń
        </button>
        <a href="/api/repos/${repo.id}/download/${encodeURIComponent(state.currentSnapshot)}"
           class="btn btn-sm">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg> .zip
        </a>
      </div>`;
  }

  if (breadcrumb) renderBreadcrumb(breadcrumb, dirPath);

  try {
    const params = new URLSearchParams();
    if (state.currentSnapshot) params.set('commit', state.currentSnapshot);
    if (dirPath) params.set('path', dirPath);
    const data = await fetchJson(`/api/repos/${repo.id}/browse?${params.toString()}`);
    if (fileTable) renderFileTable(fileTable, data.files || [], dirPath);
  } catch (e) {
    if (fileTable) fileTable.innerHTML =
      `<div class="loading-row" style="color:var(--red)">Błąd: ${escapeHtml(e.message)}</div>`;
  }
}

function renderBreadcrumb(el, dirPath) {
  const parts = dirPath ? dirPath.split('/').filter(Boolean) : [];
  let html = `<span class="breadcrumb-seg" onclick="loadDirectory('')">${escapeHtml(state.currentRepo?.name||'root')}</span>`;
  let acc = '';
  parts.forEach((p, i) => {
    acc += (acc ? '/' : '') + p;
    const isLast = i === parts.length - 1;
    html += `<span class="breadcrumb-sep"> / </span>`;
    if (isLast) html += `<span class="breadcrumb-current">${escapeHtml(p)}</span>`;
    else {
      const a = acc;
      html += `<span class="breadcrumb-seg" onclick="loadDirectory('${escapeJS(a)}')">${escapeHtml(p)}</span>`;
    }
  });
  // Przycisk wyszukiwarki po prawej
  html += `<span style="margin-left:auto">
    <button class="breadcrumb-search-btn" onclick="window.openFileSearch()" title="Szukaj pliku (Ctrl+F)">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      Szukaj
    </button>
  </span>`;
  el.innerHTML = html;
}

// Stan sortowania — lokalny dla aktualnie wyświetlanego folderu
const _sortState = { col: 'name', dir: 1 }; // dir: 1=asc, -1=desc

window._sortBy = function(col) {
  if (_sortState.col === col) {
    _sortState.dir *= -1;
  } else {
    _sortState.col = col;
    // Rozmiar i data — domyślnie od największego; nazwa — A→Z
    _sortState.dir = (col === 'name') ? 1 : -1;
  }
  // Re-render aktualnej zawartości
  const ft = document.getElementById('fileTable');
  if (ft && ft._lastFiles !== undefined) {
    renderFileTable(ft, ft._lastFiles, ft._lastPath);
  }
};

function renderFileTable(container, files, currentPath) {
  // Zapamiętaj do re-renderu przy zmianie sortowania
  container._lastFiles = files;
  container._lastPath  = currentPath;

  if (!files.length) {
    container.innerHTML = `<div class="empty-state">
      <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
      </svg>
      <h3>Pusty folder</h3><p>Ten folder nie zawiera plików</p>
    </div>`;
    return;
  }

  // Sortowanie — foldery zawsze na górze
  const sorted = [...files].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    const { col, dir } = _sortState;
    if (col === 'name')     return dir * a.name.localeCompare(b.name);
    if (col === 'size')     return dir * ((a.size || 0) - (b.size || 0));
    if (col === 'modified') {
      const ta = a.modified ? new Date(a.modified).getTime() : 0;
      const tb = b.modified ? new Date(b.modified).getTime() : 0;
      return dir * (ta - tb);
    }
    return 0;
  });

  // Strzałka kierunku
  const arrow = (col) => {
    if (_sortState.col !== col) return `<span class="sort-arrow sort-arrow--inactive">↕</span>`;
    return `<span class="sort-arrow sort-arrow--active">${_sortState.dir === 1 ? '↑' : '↓'}</span>`;
  };

  let backRow = '';
  if (currentPath) {
    const parent = currentPath.split('/').slice(0, -1).join('/');
    backRow = `
      <div class="file-row dir" onclick="loadDirectory('${escapeJS(parent)}')">
        <div class="file-icon-cell">
          <svg class="icon-dir" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
        </div>
        <div class="file-name-cell"><span class="file-name-text">..</span></div>
        <div class="file-size-cell"></div><div class="file-date-cell"></div>
      </div>`;
  }

  const rows = sorted.map(f => {
    const icon  = getFileIcon(f.name, f.type);
    const isDir = f.type === 'dir';
    const fp    = f.path.replace(/\/+/g, '/').replace(/\/$/, '');
    const click = isDir
      ? `loadDirectory('${escapeJS(fp)}')`
      : `openFilePreview('${escapeJS(fp)}','${escapeJS(f.name)}',${f.size||0})`;
    return `
      <div class="file-row ${isDir ? 'dir' : ''}" onclick="${click}">
        <div class="file-icon-cell">${icon}</div>
        <div class="file-name-cell"><span class="file-name-text">${escapeHtml(f.name)}</span></div>
        <div class="file-size-cell">${f.size ? humanSize(f.size) : (isDir ? '—' : '')}</div>
        <div class="file-date-cell">${f.modified ? fmtDateFull(new Date(f.modified)) : ''}</div>
      </div>`;
  });

  container.innerHTML = `
    <div class="file-table-head">
      <div class="file-th"></div>
      <div class="file-th file-th--sort" onclick="_sortBy('name')">Nazwa ${arrow('name')}</div>
      <div class="file-th file-th--sort" onclick="_sortBy('size')">Rozmiar ${arrow('size')}</div>
      <div class="file-th file-th--sort" onclick="_sortBy('modified')" style="text-align:right">Zmodyfikowane ${arrow('modified')}</div>
    </div>
    ${backRow}${rows.join('')}`;
}

function showEmptyExplorer() {
  const ft = document.getElementById('fileTable');
  if (ft) ft.innerHTML = `<div class="empty-state">
    <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" opacity=".3"/><path d="M12 8v4l3 3"/>
    </svg>
    <h3>Brak snapshotów</h3>
    <p>Użyj <code>mygit save</code> aby utworzyć pierwszy snapshot</p>
  </div>`;
}

// ── Podgląd pliku ──────────────────────────────────────────────────────────
// Rozszerzenia traktowane jako tekst (otwierane w edytorze)
const TEXT_EXTS = new Set([
  'txt','md','markdown','json','js','jsx','mjs','cjs','ts','tsx','html','htm',
  'css','scss','sass','less','styl','postcss',
  'xml','yaml','yml','ini','cfg','conf','toml','lock','env',
  'sh','bash','zsh','fish','bat','cmd','ps1','psm1','psd1',
  'c','cpp','h','cs','java','py','rb','php','go','rs','sql',
  'r','m','pl','lua','ex','exs','erl','kt','kts','swift','dart',
  'scala','clj','cljs','coffee','litcoffee',
  'graphql','gql','proto','tf','tfvars',
  'patch','diff','csv','tsv','log',
  'gitignore','mygitignore','dockerignore','editorconfig',
  'prettierrc','eslintrc','babelrc','npmrc','yarnrc','htaccess','mailmap',
  'vue','svelte','awk','sed',
]);

window.loadDirectory   = loadDirectory;
window.openFilePreview = async function(filePath, filename, fileSize) {
  const repo = state.currentRepo;
  if (!repo || !state.currentSnapshot) return;
  const ext = (filename.split('.').pop()||'').toLowerCase();
  const downloadUrl = `/api/repos/${repo.id}/file/${encodeURIComponent(state.currentSnapshot)}/${encodeURIComponent(filePath)}`;
  const previewUrl  = `/api/repos/${repo.id}/preview/${encodeURIComponent(state.currentSnapshot)}/${encodeURIComponent(filePath)}`;

  // Media — otwieramy w modalnym podglądzie
  const imgs = ['png','jpg','jpeg','gif','svg','webp','ico','bmp'];
  const vids = ['mp4','webm','ogg','mov'];
  const auds = ['mp3','wav','mpeg'];
  if (imgs.includes(ext)) { openMediaModal(downloadUrl, filename, 'image'); return; }
  if (vids.includes(ext)) { openMediaModal(downloadUrl, filename, 'video'); return; }
  if (auds.includes(ext)) { openMediaModal(downloadUrl, filename, 'audio'); return; }
  if (ext === 'pdf')       { openMediaModal(downloadUrl, filename, 'pdf');   return; }

  // Pliki tekstowe — otwieramy w edytorze Monaco
  if (TEXT_EXTS.has(ext) || filename.startsWith('.') || !filename.includes('.')) {
    try {
      const d = await fetchJson(previewUrl);
      openCodeModal(d.content || '', filename, downloadUrl);
      return;
    } catch {}
  }

  // Sprawdź przez API czy plik jest tekstowy
  try {
    const check = await fetchJson(
      `/api/repos/${repo.id}/checkfile/${encodeURIComponent(state.currentSnapshot)}/${encodeURIComponent(filePath)}`
    );
    if (check.isText || check.isContentText) {
      const d = await fetchJson(previewUrl);
      openCodeModal(d.content || '', filename, downloadUrl);
      return;
    }
  } catch {}

  // Plik binarny — modal z pytaniem o pobranie
  openDownloadConfirmModal(filename, fileSize, downloadUrl);
};

// ── Modal potwierdzenia pobierania pliku binarnego ─────────────────────────
function openDownloadConfirmModal(filename, fileSize, downloadUrl) {
  const modal = document.getElementById('confirmModal');
  const title = document.getElementById('confirmTitle');
  const body  = document.getElementById('confirmBody');
  const okBtn = document.getElementById('confirmOk');
  if (!modal) return;

  const ext = (filename.split('.').pop() || '').toUpperCase();
  const sizeStr = fileSize ? humanSize(fileSize) : 'nieznany';

  if (title) title.textContent = 'Pobierz plik';
  if (body) body.innerHTML = `
    <div style="text-align:center;padding:8px 0 16px">
      <svg width="40" height="40" fill="none" stroke="var(--accent)" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 12px;display:block">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px">${escapeHtml(filename)}</div>
      <div style="display:inline-flex;gap:12px;align-items:center;font-size:12px;color:var(--text-muted)">
        <span style="background:var(--bg-muted);border:1px solid var(--border);padding:2px 8px;border-radius:4px;font-family:var(--font-mono)">${ext}</span>
        <span>${sizeStr}</span>
      </div>
      <p style="font-size:12.5px;color:var(--text-muted);margin-top:14px">
        Ten plik nie może być wyświetlony w przeglądarce.<br>Czy chcesz go pobrać?
      </p>
    </div>`;

  if (okBtn) {
    okBtn.className = 'btn btn-primary';
    okBtn.innerHTML = `
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Pobierz`;
    okBtn.onclick = () => {
      window.closeConfirmModal();
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
  }

  modal.classList.add('open');
}

function openCodeModal(content, filename, downloadUrl) {
  const ext = (filename.split('.').pop()||'').toLowerCase();
  const lang = getExtLang(filename);
  const isMarkdown = ['md','markdown'].includes(ext);
  const langMap = { js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',
    ts:'typescript',tsx:'typescript',
    py:'python',rb:'ruby',php:'php',html:'html',css:'css',scss:'css',json:'json',
    md:'markdown',xml:'xml',sql:'sql',java:'java',c:'c',cpp:'cpp',h:'c',
    sh:'shell',bash:'shell',bat:'bat',cmd:'bat',ps1:'powershell',
    yml:'yaml',yaml:'yaml',go:'go',rs:'rust',toml:'ini',env:'ini',
    vue:'html',svelte:'html',graphql:'graphql',lua:'lua',rb:'ruby',
    kt:'kotlin',swift:'swift',dart:'dart' };
  const monacoLang = langMap[ext] || 'plaintext';

  document.getElementById('codeModalTitle').textContent = filename;
  document.getElementById('codeModalLang').textContent  = lang;
  const dlBtn = document.getElementById('codeModalDl');
  if (dlBtn) dlBtn.href = downloadUrl;

  // Przyciski z ikonami
  const copyBtn = document.getElementById('codeModalCopy');
  if (copyBtn) {
    copyBtn.innerHTML = `
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>
      Kopiuj`;
    copyBtn.onclick = async () => {
      const text = state.currentEditor ? state.currentEditor.getValue() : content;
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      copyBtn.innerHTML = `
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Skopiowano`;
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Kopiuj`;
      }, 2000);
    };
  }

  const mdToggle = document.getElementById('mdToggle');
  const monacoContainer = document.getElementById('codeMonaco');
  const mdPreview = document.getElementById('codeMdPreview');

  if (mdToggle) {
    mdToggle.style.display = isMarkdown ? 'inline-flex' : 'none';
    if (isMarkdown) {
      mdToggle.innerHTML = `
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        Podgląd`;
      mdToggle.onclick = () => {
        const showingMd = mdPreview.style.display !== 'none';
        if (showingMd) {
          mdPreview.style.display = 'none';
          monacoContainer.style.display = '';
          mdToggle.innerHTML = `
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Podgląd`;
        } else {
          mdPreview.style.display = '';
          monacoContainer.style.display = 'none';
          mdToggle.innerHTML = `
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            Źródło`;
          renderMarkdown(mdPreview, content);
        }
      };
    }
  }

  if (monacoContainer) { monacoContainer.style.display = ''; monacoContainer.innerHTML = ''; }
  if (mdPreview)        { mdPreview.style.display = 'none'; mdPreview.innerHTML = ''; }

  document.getElementById('codeModal')?.classList.add('open');

  if (monacoContainer) {
    setTimeout(() => {
      require(['vs/editor/editor.main'], () => {
        if (state.currentEditor) state.currentEditor.dispose();
        state.currentEditor = monaco.editor.create(monacoContainer, {
          value: content, language: monacoLang, theme: 'vs',
          readOnly: true, minimap: { enabled: content.length > 3000 },
          scrollBeyondLastLine: false, fontSize: 13,
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          automaticLayout: true, padding: { top: 12 }, lineNumbers: 'on',
        });
      });
    }, 50);
  }
}

function openMediaModal(src, filename, type) {
  const modal = document.getElementById('mediaModal');
  const title = document.getElementById('mediaModalTitle');
  const body  = document.getElementById('mediaModalBody');
  if (!modal) return;
  if (title) title.textContent = filename;
  const h = {
    image: `<img src="${src}" style="max-width:100%;max-height:75vh;display:block;margin:auto;border-radius:6px" alt="${escapeHtml(filename)}">`,
    video: `<video controls autoplay style="max-width:100%;max-height:75vh;background:#000;display:block;margin:auto;border-radius:6px"><source src="${src}"></video>`,
    audio: `<div style="padding:40px;text-align:center"><audio controls autoplay style="width:100%;max-width:400px"><source src="${src}"></audio></div>`,
    pdf:   `<iframe src="${src}" style="width:100%;height:75vh;border:none;border-radius:6px"></iframe>`,
  };
  if (body) body.innerHTML = h[type] || '';
  modal.classList.add('open');
}

// Globals
window.closeCodeModal  = function() {
  document.getElementById('codeModal')?.classList.remove('open');
  if (state.currentEditor) { state.currentEditor.dispose(); state.currentEditor = null; }
};
window.closeMediaModal = function() {
  document.getElementById('mediaModal')?.classList.remove('open');
  const b = document.getElementById('mediaModalBody');
  if (b) b.innerHTML = '';
};
window.downloadCurrentSnap = function() {
  if (!state.currentRepo || !state.currentSnapshot) return;
  window.open(`/api/repos/${state.currentRepo.id}/download/${encodeURIComponent(state.currentSnapshot)}`, '_blank');
};
window.copyRepoName = async function(name) {
  try {
    await navigator.clipboard.writeText(name);
    toast(`Skopiowano: ${name}`, 'success');
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: name });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    toast(`Skopiowano: ${name}`, 'success');
  }
};

window.copySnapId = async function(filename) {
  const id = filename || state.currentSnapshot;
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    toast(`Skopiowano ID snapshotu`, 'success');
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: id });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    toast(`Skopiowano ID snapshotu`, 'success');
  }
};

window.confirmDeleteSnapshot = function(filename) {
  const snapFile = filename || state.currentSnapshot;
  if (!snapFile || !state.currentRepo) return;

  const modal = document.getElementById('confirmModal');
  const title = document.getElementById('confirmTitle');
  const body  = document.getElementById('confirmBody');
  const okBtn = document.getElementById('confirmOk');
  if (!modal) return;

  const msg  = getSnapMsg(snapFile);
  const date = snapDateFull(snapFile);
  const label = msg ? `„${msg}"` : `snapshot z ${date}`;

  if (title) title.textContent = `Usuń ${label}?`;
  if (body) body.innerHTML = `
    <div class="danger-icon">
      <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <p style="text-align:center;font-size:13px;color:var(--text-secondary);margin-bottom:6px">
      Snapshot <strong style="color:var(--text-primary)">${escapeHtml(msg || date)}</strong> zostanie trwale usunięty.
    </p>
    <p style="text-align:center;font-size:12px;color:var(--text-muted)">
      Tej operacji nie można cofnąć.
    </p>`;

  if (okBtn) {
    okBtn.className = 'btn btn-danger';
    okBtn.textContent = 'Usuń snapshot';
    okBtn.onclick = async () => {
      closeConfirmModal();
      try {
        await fetchJson(`/api/repos/${state.currentRepo.id}/commit/${encodeURIComponent(snapFile)}`, { method: 'DELETE' });
        toast('Snapshot usunięty', 'success');
        // Odśwież cały widok repo
        await openRepo(state.currentRepo);
      } catch (e) {
        toast(`Błąd: ${e.message}`, 'error');
      }
    };
  }

  modal.classList.add('open');
};

// ── Wyszukiwarka plików (2.6) ──────────────────────────────────────────────

let _searchQuery = '';

function _getSearchBar()  { return document.getElementById('fileSearchBar'); }
function _getSearchInput(){ return document.getElementById('fileSearchInput'); }
function _getSearchCount(){ return document.getElementById('fileSearchCount'); }

window.openFileSearch = function() {
  const bar = _getSearchBar();
  const inp = _getSearchInput();
  if (!bar || !inp) return;
  bar.classList.remove('file-search-bar--hidden');
  inp.focus();
  inp.select();
};

window.closeFileSearch = function() {
  const bar = _getSearchBar();
  const inp = _getSearchInput();
  if (!bar || !inp) return;
  bar.classList.add('file-search-bar--hidden');
  inp.value = '';
  _searchQuery = '';
  _applyFileSearch('');
};

window._onFileSearchInput = function(q) {
  _searchQuery = q;
  _applyFileSearch(q);
};

function _applyFileSearch(q) {
  const ft = document.getElementById('fileTable');
  const countEl = _getSearchCount();
  if (!ft) return;

  const rows = ft.querySelectorAll('.file-row');
  let visible = 0;
  const ql = q.toLowerCase();

  rows.forEach(row => {
    const nameEl = row.querySelector('.file-name-text');
    if (!nameEl) return; // wiersz ".." lub nagłówek

    const raw = nameEl.dataset.rawName || nameEl.textContent;
    nameEl.dataset.rawName = raw; // zapamiętaj oryginalną nazwę

    if (!q) {
      nameEl.innerHTML = escapeHtml(raw);
      row.style.display = '';
      visible++;
      return;
    }

    const idx = raw.toLowerCase().indexOf(ql);
    if (idx === -1) {
      row.style.display = 'none';
    } else {
      // Podświetl pasujący fragment
      const before = escapeHtml(raw.slice(0, idx));
      const match  = escapeHtml(raw.slice(idx, idx + q.length));
      const after  = escapeHtml(raw.slice(idx + q.length));
      nameEl.innerHTML = `${before}<mark class="file-search-highlight">${match}</mark>${after}`;
      row.style.display = '';
      visible++;
    }
  });

  // Pokaż licznik wyników (tylko gdy wyszukiwanie aktywne)
  if (countEl) {
    const total = [...rows].filter(r => r.querySelector('.file-name-text')).length;
    countEl.textContent = q ? `${visible} / ${total}` : '';
  }

  // Komunikat "brak wyników"
  let noResults = ft.querySelector('.file-search-empty');
  if (q && visible === 0) {
    if (!noResults) {
      noResults = document.createElement('div');
      noResults.className = 'file-search-empty loading-row';
      noResults.style.color = 'var(--text-muted)';
      noResults.style.justifyContent = 'center';
      noResults.style.padding = '24px';
      ft.appendChild(noResults);
    }
    noResults.textContent = `Brak plików pasujących do „${q}"`;
    noResults.style.display = '';
  } else if (noResults) {
    noResults.style.display = 'none';
  }
}

// Ctrl+F — otwiera wyszukiwarkę gdy eksplorator jest widoczny
document.addEventListener('keydown', e => {
  const repoView = document.getElementById('repoView');
  if (!repoView || repoView.style.display === 'none') return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    window.openFileSearch();
    return;
  }

  if (e.key === 'Escape') {
    const bar = _getSearchBar();
    if (bar && !bar.classList.contains('file-search-bar--hidden')) {
      e.preventDefault();
      window.closeFileSearch();
    }
  }
});

// Podłącz input po załadowaniu DOM
document.addEventListener('DOMContentLoaded', () => {
  const inp = _getSearchInput();
  if (inp) {
    inp.addEventListener('input', e => window._onFileSearchInput(e.target.value));
  }
});

// Reset wyszukiwania przy zmianie katalogu / snapshotu
const _origLoadDirectory = window.loadDirectory;
window.loadDirectory = function(dirPath) {
  _searchQuery = '';
  const inp = _getSearchInput();
  if (inp) inp.value = '';
  const countEl = _getSearchCount();
  if (countEl) countEl.textContent = '';
  return _origLoadDirectory(dirPath);
};
