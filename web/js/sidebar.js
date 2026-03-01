// sidebar.js — Lista repozytoriów
import { state } from './state.js';
import { fetchJson, escapeHtml, fmtDate, humanSize } from './utils.js';
import { isArchived } from './archive.js';
import { openRepo } from './explorer.js';
import { toast } from './toast.js';

const CAT_COLORS = {
  work:'#3b82f6', personal:'#16a34a', tools:'#7c3aed',
  learning:'#d97706', backend:'#0891b2', frontend:'#db2777',
  game:'#dc2626', media:'#9333ea', ai:'#0d9488',
  'dev-platform':'#2563eb', 'bez-kategorii':'#94a3b8', default:'#94a3b8',
};

// Spolszczone kategorie
function formatCategory(raw) {
  if (!raw) return '';
  const map = {
    'bez-kategorii':'Bez kategorii', 'work':'Praca', 'personal':'Osobiste',
    'tools':'Narzędzia pomocnicze', 'learning':'Nauka', 'backend':'Backend / API',
    'frontend':'Frontend', 'web':'Web / Frontend', 'infra':'System / Infrastruktura',
    'security':'Bezpieczeństwo', 'game':'Gry', 'media':'Media / Wideo / Audio',
    'ai':'AI / Automatyzacja', 'dev-platform':'Platformy developerskie', 'archive':'Archiwum',
  };
  return map[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1);
}

export async function loadRepos() {
  setStatus('loading');
  try {
    const data = await fetchJson('/api/repos');
    state.repos = (data || []).filter(r => !isArchived(r.id));
    state.serverOnline = true;
    setStatus('online');
    extractCategories();
    filterAndRender();
  } catch {
    state.serverOnline = false;
    setStatus('error');
    document.getElementById('repoList').innerHTML =
      `<div class="empty-state" style="padding:30px 12px">
        <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3 style="margin-top:10px">Serwer offline</h3><p>Nie można połączyć się z mygit</p>
      </div>`;
  }
}

function setStatus(s) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (dot) dot.className = `status-dot ${s}`;
  if (txt) {
    if (s === 'online') {
      const total = state.repos.length;
      const totalSize = state.repos.reduce((a,r)=>a+(r.size||0),0);
      txt.textContent = `${total} repo · ${humanSize(totalSize)}`;
    } else if (s === 'loading') {
      txt.textContent = 'Ladowanie...';
    } else {
      txt.textContent = 'offline';
    }
  }
}

function extractCategories() {
  const cats = new Set();
  state.repos.forEach(r => { if (r.category) cats.add(r.category); });
  state.categories = [...cats].sort();
  const sel = document.getElementById('categoryFilter');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = `<option value="">Wszystkie kategorie</option>` +
      state.categories.map(c => `<option value="${escapeHtml(c)}">${formatCategory(c)}</option>`).join('');
    if (prev) sel.value = prev;
  }
  // Notify custom dropdown to rebuild
  document.dispatchEvent(new CustomEvent('categoriesUpdated', { detail: state.categories }));
}

export function filterAndRender() {
  const q    = (state.searchQuery || '').toLowerCase();
  const cat  = state.selectedCategory || '';
  const sort = state.currentSort || 'newest';

  let list = state.repos.filter(r => {
    if (isArchived(r.id)) return false;
    if (cat && r.category !== cat) return false;
    if (q) {
      const nameMatch = r.name.toLowerCase().includes(q);
      const descMatch = (r.description || '').toLowerCase().includes(q);
      // Szukaj po tagach z notatek
      const note = state.notes?.[r.id];
      const tagsMatch = (note?.tags || []).some(t => t.toLowerCase().includes(q));
      if (!nameMatch && !descMatch && !tagsMatch) return false;
    }
    return true;
  });

  list = list.sort((a, b) => {
    switch (sort) {
      case 'newest':    return new Date(b.updatedAt||0) - new Date(a.updatedAt||0);
      case 'oldest':    return new Date(a.updatedAt||0) - new Date(b.updatedAt||0);
      case 'name':      return a.name.localeCompare(b.name);
      case 'size':      return (b.size||0) - (a.size||0);
      case 'snapshots': return (b.snapshots||0) - (a.snapshots||0);
      default:          return 0;
    }
  });

  const favs = list.filter(r => r.isFavourite);
  const rest = list.filter(r => !r.isFavourite);
  state.filteredRepos = [...favs, ...rest];
  renderRepoList();
}

function renderRepoList() {
  const el = document.getElementById('repoList');
  if (!el) return;
  if (!state.filteredRepos.length) {
    el.innerHTML = `<div class="empty-state" style="padding:24px 12px">
      <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:.3">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <h3 style="margin-top:10px;font-size:13px">Brak wyników</h3>
      <p style="font-size:12px">Zmień kryteria wyszukiwania</p>
    </div>`;
    return;
  }

  el.innerHTML = state.filteredRepos.map(r => {
    const isActive = state.currentRepo?.id === r.id;
    const catColor = CAT_COLORS[r.category] || CAT_COLORS.default;
    const snaps    = r.snapshots || 0;
    const when     = fmtDate(r.updatedAt);
    return `
      <div class="repo-item ${isActive ? 'active' : ''}" onclick="window.clickRepo('${r.id}')">
        <div class="repo-name">
          ${r.isFavourite ? `<span class="repo-fav" title="Ulubione">★</span>` : ''}
          <span class="repo-name-text" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
          ${r.category ? `<span class="badge badge-cat" style="color:${catColor};border-color:${catColor}40;margin-left:auto;font-size:9.5px">${formatCategory(r.category)}</span>` : ''}
        </div>
        <div class="repo-meta">
          <span class="repo-desc" title="${escapeHtml(r.description||'')}">
            ${escapeHtml(r.description || when)}
          </span>
          <span class="badge badge-snap" title="${snaps} snapshotów">${snaps}s</span>
        </div>
      </div>`;
  }).join('');
}

// Toggle favourite
window.toggleFav = async function(id) {
  const repo = state.repos.find(r => r.id === id);
  if (!repo) return;
  const newVal = !repo.isFavourite;
  try {
    if (newVal) await fetchJson(`/api/favourites/${id}`, { method: 'POST' });
    else        await fetchJson(`/api/favourites/${id}`, { method: 'DELETE' });
    repo.isFavourite = newVal;
    if (state.currentRepo?.id === id) state.currentRepo.isFavourite = newVal;
    toast(newVal ? '★ Dodano do ulubionych' : 'Usunięto z ulubionych', 'success');
    filterAndRender();
    // Odśwież przycisk w topbarze
    const btn = document.getElementById('favBtn');
    if (btn) {
      btn.className = `topbar-btn ${newVal ? 'fav-on' : ''}`;
      btn.innerHTML = btn.innerHTML.replace(
        newVal ? 'Dodaj do ulubionych' : 'Ulubione',
        newVal ? 'Ulubione' : 'Dodaj do ulubionych'
      );
    }
  } catch (e) { toast('Błąd: ' + e.message, 'error'); }
};

window.clickRepo = async function(id) {
  const repo = state.repos.find(r => r.id === id);
  if (!repo) return;
  state.currentRepo = repo;   // set BEFORE showView so the guard passes
  window.showView('repo');
  await openRepo(repo);
  filterAndRender();
};

export { formatCategory };
