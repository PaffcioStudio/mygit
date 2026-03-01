// archiveView.js - Widok archiwum
import { getArchivedList, unarchiveRepo, deleteArchivedRepo } from './archive.js';
import { escapeHtml, fmtDate } from './utils.js';
import { toast } from './toast.js';
import { loadRepos } from './sidebar.js';

export function renderArchiveView() {
  const el = document.getElementById('archiveView');
  if (!el) return;

  const list = getArchivedList();

  if (!list.length) {
    el.innerHTML = `<div style="padding:24px 32px"><div style="">
        <div style="margin-bottom:24px">
          <h2 style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px">Archiwum</h2>
          <p style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">Zarchiwizowane projekty nie są brane pod uwagę w CLI mygit</p>
        </div>
        <div class="empty-state" style="padding:60px">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
            <path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          <h3>Archiwum jest puste</h3>
          <p>Zarchiwizowane projekty pojawią się tutaj</p>
        </div>
      </div></div>`;
    return;
  }

  el.innerHTML = `<div style="padding:24px 32px"><div style="">
      <div style="margin-bottom:24px">
        <h2 style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px">Archiwum</h2>
        <p style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">
          ${list.length} zarchiwizowanych projektów - nie sa widoczne w CLI ani sidebarze
        </p>
      </div>

      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px">
        <div style="padding:10px 14px;background:var(--bg-overlay);border-bottom:1px solid var(--border);
          display:grid;grid-template-columns:1fr 80px 100px 160px;gap:8px;
          font-family:var(--font-mono);font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">
          <span>Projekt</span>
          <span>Ulubione</span>
          <span>Zarchiwizowano</span>
          <span></span>
        </div>
        ${list.map(item => `
          <div style="display:grid;grid-template-columns:1fr 80px 100px 160px;gap:8px;
            padding:12px 14px;border-bottom:1px solid var(--border-muted);align-items:center"
            id="archive-row-${escapeHtml(item.id)}">
            <div>
              <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-secondary);
                margin-bottom:2px">
                ${escapeHtml(item.name || item.id)}
              </div>
              ${item.description ? `<div style="font-size:11px;color:var(--text-muted);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${escapeHtml(item.description)}
              </div>` : ''}
            </div>
            <div>
              ${item.wasFav
                ? `<span class="archive-badge was-fav">★ Tak</span>`
                : `<span class="archive-badge">Nie</span>`}
            </div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">
              ${fmtDate(item.archivedAt)}
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end">
              <button onclick="unarchive('${escapeHtml(item.id)}')" class="btn btn-sm"
                title="Przywróć projekt">
                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M3 12a9 9 0 1 0 18 0A9 9 0 0 0 3 12z"/><polyline points="12 8 12 12 14 14"/>
                </svg>
                Przywróć
              </button>
              <button onclick="confirmDeleteArchived('${escapeHtml(item.id)}', '${escapeHtml(item.name||item.id)}')" class="btn btn-sm btn-danger"
                title="Usuń na zawsze">
                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
                Usuń
              </button>
            </div>
          </div>`).join('')}
      </div>

      <p style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);line-height:1.6">
        ⚠ Usunięte projekty są nieodwracalnie usuwane z dysku. Zarchiwizowane projekty zachowują wszystkie swoje pliki - jedynie znikaja z widoku CLI i sidebaru.
      </p>
    </div></div>`;
}

window.unarchive = async function(id) {
  await unarchiveRepo(id);
  await loadRepos();
  renderArchiveView();
};

window.confirmDeleteArchived = function(id, name) {
  const modal = document.getElementById('confirmModal');
  const title = document.getElementById('confirmTitle');
  const body  = document.getElementById('confirmBody');
  const okBtn = document.getElementById('confirmOk');
  if (!modal) return;

  if (title) title.textContent = `Usuń „${name}" na zawsze?`;
  if (body) body.innerHTML = `
    <div class="danger-icon">
      <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <p style="text-align:center;font-size:13px;color:var(--text-secondary);margin-bottom:6px">
      Projekt <strong style="color:var(--text-primary)">${escapeHtml(name)}</strong> zostanie trwale usunięty z dysku.
    </p>
    <p style="text-align:center;font-size:12px;color:var(--text-muted)">
      Tej operacji nie można cofnąć.
    </p>`;

  if (okBtn) {
    okBtn.className = 'btn btn-danger';
    okBtn.textContent = 'Usuń na zawsze';
    okBtn.onclick = async () => {
      closeConfirmModal();
      try {
        const { fetchJson } = await import('./utils.js');
        await fetchJson(`/api/repos/${id}`, { method: 'DELETE' });
        await deleteArchivedRepo(id);
        toast(`Projekt usunięty`, 'success');
        renderArchiveView();
      } catch (e) {
        // Jeśli API nie obsługuje - usuń tylko z archiwum
        await deleteArchivedRepo(id);
        toast('Usunięto z archiwum', 'info');
        renderArchiveView();
      }
    };
  }

  modal.classList.add('open');
};
