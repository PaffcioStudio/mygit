// main.js - Routing, inicjalizacja, pomocnicze modale
import { loadNotes } from './notes.js';
import { loadArchive } from './archive.js';
import { loadRepos, filterAndRender } from './sidebar.js';
import { renderDashboard } from './dashboard.js';
import { renderArchiveView } from './archiveView.js';
import { openSnapshotDropdown, filterSnaps } from './explorer.js';
import { fetchJson } from './utils.js';
import { state } from './state.js';

// ── View router ──────────────────────────────────────────────────────────────
window.showView = function(view) {
  if (view === 'repo' && !state.currentRepo) return;
  state.currentView = view;

  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.topbar-nav-btn').forEach(el => el.classList.remove('active'));

  const ids = { dashboard:'dashView', repo:'repoView', archive:'archiveView' };
  document.getElementById(ids[view])?.classList.add('active');
  document.getElementById(`nav_${view}`)?.classList.add('active');

  const path = document.getElementById('topbarPath');
  const acts = document.getElementById('topbarActions');

  if (view === 'dashboard') {
    if (path) path.innerHTML = `<span style="color:var(--text-muted)">mygit</span>`;
    if (acts) acts.innerHTML = `
      <button class="topbar-btn" onclick="window.showHelpModal()">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Pomoc
      </button>
      <button class="topbar-btn" onclick="window.refreshAll()">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        Odśwież
      </button>`;
    renderDashboard();
  } else if (view === 'archive') {
    if (path) path.innerHTML = `
      <span style="cursor:pointer;color:var(--text-muted)" onclick="window.showView('dashboard')">mygit</span>
      <span style="color:var(--text-muted);padding:0 3px">/</span>
      <span style="font-weight:500">archive</span>`;
    if (acts) acts.innerHTML = '';
    renderArchiveView();
  }
};

window.refreshAll = async function() { await loadRepos(); renderDashboard(); };

// ── Confirm/Archive modal ────────────────────────────────────────────────────
window.closeConfirmModal = () => {
  document.getElementById('confirmModal')?.classList.remove('open');
  const inner = document.getElementById('confirmModalInner');
  if (inner) { inner.classList.remove('modal-xl'); inner.classList.add('modal-lg'); }
};

window.confirmArchive = function(id) {
  const repo = state.repos.find(r => r.id === id);
  const name = repo?.name || id;
  document.getElementById('confirmTitle').textContent = `Zarchiwizować „${name}"?`;
  document.getElementById('confirmBody').innerHTML = `
    <p style="font-size:13.5px;color:var(--text-secondary);margin-bottom:8px;text-align:center">
      Projekt <strong>${e(name)}</strong> zostanie przeniesiony do archiwum.
    </p>
    <p style="font-size:12.5px;color:var(--text-muted);text-align:center">
      Nie będzie widoczny w CLI mygit ani sidebarze.<br>
      Możesz go przywrócić z zakładki <strong>Archiwum</strong>.
    </p>`;
  const okBtn = document.getElementById('confirmOk');
  okBtn.className = 'btn btn-primary'; okBtn.textContent = 'Archiwizuj';
  okBtn.onclick = async () => {
    window.closeConfirmModal();
    const { archiveRepo } = await import('./archive.js');
    await archiveRepo(id);
    await loadRepos();
    window.showView('dashboard');
  };
  document.getElementById('confirmModal')?.classList.add('open');
};

// ── Delete repo modal ─────────────────────────────────────────────────────────
window.confirmDeleteRepo = function(id) {
  const repo = state.repos.find(r => r.id === id);
  const name = repo?.name || id;
  const modal = document.getElementById('confirmModal');
  const title = document.getElementById('confirmTitle');
  const body  = document.getElementById('confirmBody');
  const okBtn = document.getElementById('confirmOk');

  if (title) title.textContent = `Usuń repozytorium „${name}"?`;
  if (body) body.innerHTML = `
    <div class="danger-icon">
      <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <p style="text-align:center;font-size:13px;color:var(--text-secondary);margin-bottom:12px">
      Wpisz nazwę repozytorium aby potwierdzić usunięcie:
    </p>
    <input id="deleteConfirmInput" type="text" class="form-input" placeholder="${e(name)}"
      style="text-align:center;font-family:var(--font-mono)"
      oninput="document.getElementById('confirmOk').disabled = this.value !== '${e(name)}'">
    <p style="text-align:center;font-size:11px;color:var(--text-muted);margin-top:10px">
      Tej operacji <strong>nie można cofnąć</strong>. Wszystkie snapshoty zostaną usunięte.
    </p>`;

  if (okBtn) {
    okBtn.className = 'btn btn-danger';
    okBtn.textContent = 'Usuń na zawsze';
    okBtn.disabled = true;
    okBtn.onclick = async () => {
      const val = document.getElementById('deleteConfirmInput')?.value;
      if (val !== name) return;
      window.closeConfirmModal();
      try {
        await fetchJson(`/api/repos/${id}`, { method: 'DELETE' });
        // Usuń też z archiwum jeśli tam był
        const { deleteArchivedRepo } = await import('./archive.js');
        await deleteArchivedRepo(id);
        await loadRepos();
        window.showView('dashboard');
        const { toast } = await import('./toast.js');
        toast(`Repozytorium „${name}" usunięte`, 'success');
      } catch (ex) {
        const { toast } = await import('./toast.js');
        toast('Błąd usuwania: ' + ex.message, 'error');
      }
    };
  }
  modal?.classList.add('open');
  setTimeout(() => document.getElementById('deleteConfirmInput')?.focus(), 100);
};
window.showCategoryModal = async function(repoId) {
  const repo = state.repos.find(r => r.id === repoId);
  const modal = document.getElementById('confirmModal');
  const title = document.getElementById('confirmTitle');
  const body  = document.getElementById('confirmBody');
  const okBtn = document.getElementById('confirmOk');

  let categories = [];
  try {
    const data = await fetchJson('/api/categories');
    categories = data.categories || [];
  } catch {}

  const current = repo?.category || '';
  const formatCat = c => {
    const map = { 'bez-kategorii':'Bez kategorii', 'work':'Praca', 'personal':'Osobiste',
      'tools':'Narzędzia pomocnicze', 'learning':'Nauka', 'backend':'Backend / API', 'frontend':'Frontend',
      'web':'Web / Frontend', 'infra':'System / Infrastruktura', 'security':'Bezpieczeństwo',
      'game':'Gry', 'media':'Media / Wideo / Audio', 'ai':'AI / Automatyzacja',
      'dev-platform':'Platformy developerskie' };
    return map[c?.toLowerCase()] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : c);
  };

  if (title) title.textContent = `Kategoria projektu: ${repo?.name || repoId}`;
  if (body) body.innerHTML = `
    <div class="form-group">
      <label class="form-label">Wybierz kategorię</label>
      <select id="catSelectModal" class="form-input" style="cursor:pointer">
        ${categories.map(c => `
          <option value="${e(c.id)}" ${c.id === current ? 'selected' : ''}>
            ${formatCat(c.id)}
          </option>`).join('')}
      </select>
    </div>`;

  if (okBtn) {
    okBtn.className = 'btn btn-primary'; okBtn.textContent = 'Zapisz';
    okBtn.onclick = async () => {
      const sel = document.getElementById('catSelectModal')?.value;
      if (!sel) return;
      try {
        await fetchJson(`/api/repos/${repoId}/category`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: sel }),
        });
        const { toast } = await import('./toast.js');
        toast('Kategoria zaktualizowana', 'success');
        await loadRepos();
        // Odśwież aktywne repo
        if (state.currentRepo?.id === repoId) {
          state.currentRepo.category = sel;
          const catBtn = document.querySelector('[onclick*="showCategoryModal"]');
          if (catBtn) { const { openRepo } = await import('./explorer.js'); await openRepo(state.currentRepo); }
        }
      } catch (err) {
        const { toast } = await import('./toast.js');
        toast('Błąd: ' + err.message, 'error');
      }
      window.closeConfirmModal();
    };
  }
  modal?.classList.add('open');
};

// ── Help modal ───────────────────────────────────────────────────────────────
window.showHelpModal = function() {
  const modal = document.getElementById('confirmModal');
  const title = document.getElementById('confirmTitle');
  const sub   = document.getElementById('confirmSub');
  const body  = document.getElementById('confirmBody');
  const okBtn = document.getElementById('confirmOk');

  // Make modal wider
  const panel = document.getElementById('confirmModalInner');
  if (panel) {
    panel.classList.remove('modal-lg');
    panel.classList.add('modal-xl');
  }

  if (title) title.textContent = 'Pomoc - mygit';
  if (sub)   sub.textContent   = 'System wersjonowania snapshotów';

  if (body) body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px">

      <!-- Quick start -->
      <div style="background:linear-gradient(135deg,#eff6ff,#eef2ff);padding:18px;border-radius:14px;border:1px solid #c7d2fe">
        <div style="font-weight:700;color:#1e293b;margin-bottom:12px;font-size:13.5px;display:flex;align-items:center;gap:7px">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20" fill="#6366f1"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3z"/></svg>
          Szybki start
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
          ${[['1','init','mygit init','Start projektu'],['2','save','mygit save "opis"','Zapisz wersję'],['3','diff','mygit diff','Sprawdź zmiany'],['4','get','mygit get','Pobierz wersję']].map(([n,_,cmd,desc])=>`
            <div style="background:#fff;border:1px solid #c7d2fe;border-radius:10px;padding:12px;text-align:center">
              <div style="width:28px;height:28px;background:#e0e7ff;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-size:12px;font-weight:700;color:#4f46e5">${n}</div>
              <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:3px">${_[0].toUpperCase()+_.slice(1)}</div>
              <div style="font-size:11px;color:#64748b;margin-bottom:6px">${desc}</div>
              <code style="display:block;background:#eff6ff;color:#4338ca;padding:4px 6px;border-radius:5px;font-size:10.5px;font-family:monospace">${cmd}</code>
            </div>`).join('')}
        </div>
      </div>

      <!-- Commands -->
      <div style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);padding:18px;border-radius:14px;border:1px solid #a7f3d0">
        <div style="font-weight:700;color:#1e293b;margin-bottom:12px;font-size:13.5px;display:flex;align-items:center;gap:7px">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20" fill="#10b981"><path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
          Komendy CLI
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[
            ['mygit init [opis]',  'Tworzy repozytorium na serwerze', ''],
            ['mygit save [msg]',   'Wysyła snapshot (alias: push)', ''],
            ['mygit get [repo]',   'Pobiera snapshot (alias: pull)', ''],
            ['mygit status',       'Pokazuje info o repo i ostatnim save', ''],
            ['mygit diff [snap]',  'Pokazuje różnice (+ dodane, - usunięte)', 'new'],
            ['mygit search "txt"', 'Szuka frazy w opisach snapshotów', 'new'],
            ['mygit cat <zip> <f>','Wyświetla treść pliku z historii', 'new'],
            ['mygit delete-repo',  'Usuwa całe repozytorium z serwera', 'danger'],
          ].map(([cmd,desc,badge])=>`
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:9px 11px;background:#fff;border-radius:9px;border:1px solid #d1fae5">
              <div>
                <code style="font-family:monospace;font-size:12px;color:#1e293b;font-weight:600">${e(cmd)}</code>
                <div style="font-size:11px;color:#64748b;margin-top:2px">${desc}</div>
              </div>
              ${badge === 'new' ? '<span style="font-size:9.5px;padding:2px 6px;background:#dbeafe;color:#1d4ed8;border-radius:99px;font-weight:600;flex-shrink:0;white-space:nowrap">NOWOŚĆ</span>' : ''}
              ${badge === 'danger' ? '<span style="font-size:9.5px;padding:2px 6px;background:#fee2e2;color:#dc2626;border-radius:99px;font-weight:600;flex-shrink:0;white-space:nowrap">NIEBEZP.</span>' : ''}
            </div>`).join('')}
        </div>
      </div>

      <!-- Scenarios + .mygitignore side by side -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:linear-gradient(135deg,#fffbeb,#fff7ed);padding:16px;border-radius:14px;border:1px solid #fed7aa">
          <div style="font-weight:700;color:#1e293b;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:6px">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="#f59e0b"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/></svg>
            Scenariusze użycia
          </div>
          <div style="font-size:11.5px;color:#92400e;font-weight:600;margin-bottom:5px">Codzienna praca</div>
          <pre style="font-size:10.5px;background:#fffbeb;color:#92400e;padding:9px;border-radius:7px;border:1px solid #fde68a;overflow-x:auto;white-space:pre-wrap;margin:0 0 10px">mygit status
mygit save "Dodałem logowanie"
mygit diff</pre>
          <div style="font-size:11.5px;color:#92400e;font-weight:600;margin-bottom:5px">Naprawa błędu</div>
          <pre style="font-size:10.5px;background:#fffbeb;color:#92400e;padding:9px;border-radius:7px;border:1px solid #fde68a;overflow-x:auto;white-space:pre-wrap;margin:0">mygit search "fix login"
mygit diff 2026-01-12_14-00.zip
mygit cat 2026-01-12.zip src/auth.js</pre>
        </div>
        <div style="background:linear-gradient(135deg,#fff1f2,#fdf2f8);padding:16px;border-radius:14px;border:1px solid #fecdd3">
          <div style="font-weight:700;color:#1e293b;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:6px">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="#f43f5e"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
            Plik .mygitignore
          </div>
          <p style="font-size:11.5px;color:#9f1239;margin:0 0 8px">Utwórz w projekcie - działa jak <code style="background:#ffe4e6;padding:1px 4px;border-radius:4px;font-size:11px">.gitignore</code></p>
          <pre style="font-size:10.5px;background:#fff1f2;color:#9f1239;padding:9px;border-radius:7px;border:1px solid #fecdd3;overflow-x:auto;white-space:pre-wrap;margin:0 0 8px">node_modules/
.env
*.log
.DS_Store
dist/
build/</pre>
          <div style="font-size:11px;color:#be185d;display:flex;flex-direction:column;gap:4px">
            <div>✓ Mniejsze snapshoty</div>
            <div>✓ Szybsze tworzenie</div>
            <div>✓ Brak zbędnych plików</div>
          </div>
        </div>
      </div>

      <!-- Shortcuts -->
      <div style="background:var(--bg-subtle);padding:12px 16px;border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text-secondary)">Skróty:</span>
        <span style="font-size:12px;color:var(--text-muted)"><kbd style="background:#fff;border:1px solid var(--border);padding:2px 7px;border-radius:4px;font-family:monospace;font-size:11px">Ctrl+K</kbd> → wyszukaj</span>
        <span style="font-size:12px;color:var(--text-muted)"><kbd style="background:#fff;border:1px solid var(--border);padding:2px 7px;border-radius:4px;font-family:monospace;font-size:11px">Esc</kbd> → zamknij / wróć do dashboardu</span>
        <span style="font-size:12px;color:var(--text-muted)">mygit v2.2 · Power Tool Edition</span>
      </div>
    </div>`;

  if (okBtn) {
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = 'Zamknij';
    okBtn.onclick = () => {
      window.closeConfirmModal();
      // Reset modal size
      const p = document.getElementById('confirmModalInner');
      if (p) { p.classList.remove('modal-xl'); p.classList.add('modal-lg'); }
    };
  }
  modal?.classList.add('open');
};

function e(s) { return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

// ── Custom selects ───────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Najnowsze',  icon: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 5.64 5.64L23 4"/></svg>` },
  { value: 'oldest',    label: 'Najstarsze', icon: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15A9 9 0 1 0 18.36 5.64L1 4"/></svg>` },
  { value: 'name',      label: 'Nazwa A-Z',  icon: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/></svg>` },
  { value: 'size',      label: 'Rozmiar',    icon: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>` },
  { value: 'snapshots', label: 'Snapshoty',  icon: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M3 12a9 9 0 1 1 18 0A9 9 0 0 1 3 12z" opacity=".4"/></svg>` },
];

const CAT_ICONS = {
  '':              `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  'work':          `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="12"/></svg>`,
  'personal':      `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  'tools':         `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  'learning':      `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  'backend':       `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
  'frontend':      `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  'game':          `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="17" cy="13" r="1" fill="currentColor"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59L1.99 17.31A2.5 2.5 0 0 0 4.49 20c.859 0 1.687-.47 2.12-1.25L8 17h8l1.39 1.75A2.5 2.5 0 0 0 19.51 20a2.5 2.5 0 0 0 2.5-2.69l-1.712-8.72A4 4 0 0 0 17.32 5z"/></svg>`,
  'media':         `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
  'ai':            `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>`,
  'dev-platform':  `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></svg>`,
  'web':           `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  'infra':         `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  'security':      `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  'bez-kategorii': `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

const CAT_LABELS = {
  '':'Wszystkie kategorie','bez-kategorii':'Bez kategorii','work':'Praca',
  'personal':'Osobiste','tools':'Narzędzia pomocnicze','learning':'Nauka',
  'backend':'Backend / API','frontend':'Frontend','web':'Web / Frontend',
  'infra':'System / Infrastruktura','security':'Bezpieczeństwo',
  'game':'Gry','media':'Media / Wideo / Audio','ai':'AI / Automatyzacja',
  'dev-platform':'Platformy developerskie',
};

function buildSortDropdown() {
  const dd = document.getElementById('sortFilterDd');
  if (!dd) return;
  const current = state.currentSort || 'newest';
  dd.innerHTML = SORT_OPTIONS.map(o => `
    <div class="custom-select-item ${o.value === current ? 'active' : ''}"
         onclick="window.selectSort('${o.value}')">
      ${o.icon}
      <span>${o.label}</span>
      ${o.value === current ? `<svg class="item-check" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
    </div>`).join('');
}

function buildCategoryDropdown(categories) {
  const dd = document.getElementById('categoryFilterDd');
  if (!dd) return;
  const current = state.selectedCategory || '';
  const allOpt = { value: '', label: 'Wszystkie kategorie' };
  const items = [allOpt, ...categories.map(c => ({ value: c, label: CAT_LABELS[c] || c }))];
  dd.innerHTML = items.map((o, i) => {
    const icon = CAT_ICONS[o.value] || CAT_ICONS[''];
    const sep = i === 0 && items.length > 1 ? '<div class="custom-select-sep"></div>' : '';
    return `
      <div class="custom-select-item ${o.value === current ? 'active' : ''}"
           onclick="window.selectCategory('${o.value}')">
        ${icon}
        <span>${o.label}</span>
        ${o.value === current ? `<svg class="item-check" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </div>${sep}`;
  }).join('');
}

window.toggleCustomSelect = function(which) {
  const catDd   = document.getElementById('categoryFilterDd');
  const sortDd  = document.getElementById('sortFilterDd');
  const catBtn  = document.getElementById('categoryFilterBtn');
  const sortBtn = document.getElementById('sortFilterBtn');

  if (which === 'category') {
    const isOpen = catDd.classList.contains('open');
    closeBothSelects();
    if (!isOpen) {
      buildCategoryDropdown(state.categories || []);
      catDd.classList.add('open');
      catBtn.classList.add('open');
    }
  } else {
    const isOpen = sortDd.classList.contains('open');
    closeBothSelects();
    if (!isOpen) {
      buildSortDropdown();
      sortDd.classList.add('open');
      sortBtn.classList.add('open');
    }
  }
};

function closeBothSelects() {
  document.getElementById('categoryFilterDd')?.classList.remove('open');
  document.getElementById('sortFilterDd')?.classList.remove('open');
  document.getElementById('categoryFilterBtn')?.classList.remove('open');
  document.getElementById('sortFilterBtn')?.classList.remove('open');
}

window.selectSort = function(value) {
  state.currentSort = value;
  const opt = SORT_OPTIONS.find(o => o.value === value);
  const btn = document.getElementById('sortFilterBtn');
  document.getElementById('sortFilterLabel').textContent = opt?.label || value;
  // Highlight when non-default sort
  if (btn) {
    if (value && value !== 'newest') {
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
      btn.style.background = 'var(--accent-dim)';
    } else {
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.style.background = '';
    }
  }
  // sync hidden select
  const sel = document.getElementById('sortFilter');
  if (sel) sel.value = value;
  closeBothSelects();
  filterAndRender();
};

window.selectCategory = function(value) {
  state.selectedCategory = value;
  const label = CAT_LABELS[value] || value || 'Kategoria';
  const btn = document.getElementById('categoryFilterBtn');
  document.getElementById('categoryFilterLabel').textContent = label === 'Wszystkie kategorie' ? 'Kategoria' : label;
  // Highlight button when filter is active
  if (btn) {
    if (value) {
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
      btn.style.background = 'var(--accent-dim)';
    } else {
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.style.background = '';
    }
  }
  // sync hidden select
  const sel = document.getElementById('categoryFilter');
  if (sel) sel.value = value;
  closeBothSelects();
  filterAndRender();
};

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  const catWrap  = document.getElementById('categoryFilterWrap');
  const sortWrap = document.getElementById('sortFilterWrap');
  if (catWrap && !catWrap.contains(e.target) && sortWrap && !sortWrap.contains(e.target)) {
    closeBothSelects();
  }
});

// ── Custom select END ────────────────────────────────────────────────────────

function setupSearchClear() {
  const input = document.getElementById('repoSearch');
  const wrap  = input?.parentElement;
  if (!input || !wrap) return;

  // Dodaj przycisk X
  const clearBtn = document.createElement('button');
  clearBtn.id = 'searchClear';
  clearBtn.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  clearBtn.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:none;line-height:1;border-radius:3px';
  clearBtn.title = 'Wyczyść';
  wrap.appendChild(clearBtn);

  const toggle = () => { clearBtn.style.display = input.value ? 'flex' : 'none'; };
  input.addEventListener('input', toggle);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    state.searchQuery = '';
    filterAndRender();
    clearBtn.style.display = 'none';
    input.focus();
  });
}

// ── Migracja z localStorage ────────────────────────────────────────────────
async function migrateFromLocalStorage() {
  const MIGRATED_KEY = 'mygit_migrated_v1';
  if (localStorage.getItem(MIGRATED_KEY)) return;

  try {
    // Migracja archiwum
    const rawArchive = localStorage.getItem('mygit_archive_v1');
    if (rawArchive) {
      const data = JSON.parse(rawArchive);
      const meta = data.meta || {};
      for (const id of (data.archived || [])) {
        try {
          await fetchJson(`/api/archive/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meta: meta[id] || {} }),
          });
        } catch {}
      }
    }

    // Migracja notatek
    const rawNotes = localStorage.getItem('mygit_notes_v1');
    if (rawNotes) {
      const notes = JSON.parse(rawNotes);
      for (const [id, note] of Object.entries(notes)) {
        try {
          await fetchJson(`/api/notes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note),
          });
        } catch {}
      }
    }

    localStorage.setItem(MIGRATED_KEY, '1');
    // Opcjonalnie wyczyść stare klucze
    localStorage.removeItem('mygit_archive_v1');
    localStorage.removeItem('mygit_notes_v1');
    console.log('✅ Migracja danych z localStorage zakończona');
  } catch (e) {
    console.warn('Błąd migracji localStorage:', e);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Migracja danych z localStorage do serwera (jednorazowa)
  await migrateFromLocalStorage();

  await loadNotes();
  await loadArchive();

  document.getElementById('repoSearch')?.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    filterAndRender();
  });

  // Listen for categories update to refresh label if current category was removed
  document.addEventListener('categoriesUpdated', () => {
    if (state.selectedCategory && !state.categories.includes(state.selectedCategory)) {
      window.selectCategory('');
    }
  });

  setupSearchClear();

  document.getElementById('snapshotBtn')?.addEventListener('click', openSnapshotDropdown);
  document.getElementById('snapDdSearchInput')?.addEventListener('input', e => filterSnaps(e.target.value));

  document.addEventListener('click', e => {
    const dd  = document.getElementById('snapshotDropdown');
    const btn = document.getElementById('snapshotBtn');
    if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target))
      dd.classList.remove('open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Close custom selects first
      const catOpen = document.getElementById('categoryFilterDd')?.classList.contains('open');
      const sortOpen = document.getElementById('sortFilterDd')?.classList.contains('open');
      if (catOpen || sortOpen) { closeBothSelects(); return; }

      // Close dropdown first
      const dd = document.getElementById('snapshotDropdown');
      if (dd?.classList.contains('open')) { dd.classList.remove('open'); return; }

      // Close any open modal first
      const modalIds = ['codeModal','mediaModal','confirmModal'];
      let closedModal = false;
      modalIds.forEach(id => {
        const el = document.getElementById(id);
        if (el?.classList.contains('open')) {
          el.classList.remove('open');
          closedModal = true;
        }
      });
      // Reset help modal size on close
      const confirmInner = document.getElementById('confirmModalInner');
      if (confirmInner) { confirmInner.classList.remove('modal-xl'); confirmInner.classList.add('modal-lg'); }
      if (state.currentEditor) { state.currentEditor.dispose(); state.currentEditor = null; }
      if (closedModal) return; // don't also navigate away

      // ESC z repo view → dashboard
      if (state.currentView === 'repo') window.showView('dashboard');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('repoSearch')?.focus();
    }
  });

  await loadRepos();
  window.showView('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
