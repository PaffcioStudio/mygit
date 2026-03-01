// dashboard.js — Dashboard (light modern design)
import { state } from './state.js';
import { escapeHtml, fmtDate, humanSize } from './utils.js';
import { getArchivedList } from './archive.js';

export function renderDashboard() {
  const el = document.getElementById('dashView');
  if (!el) return;

  const repos   = state.repos;
  const favs    = repos.filter(r => r.isFavourite);
  const total   = repos.length;
  const snaps   = repos.reduce((s, r) => s + (r.snapshots || 0), 0);
  const archived = getArchivedList().length;

  const totalSz = repos.reduce((s,r)=>s+(r.size||0),0);
  const recent = [...repos]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 10);

  el.innerHTML = `
    <div style="padding:24px 32px">
      <div class="dash-header">
        <h2 class="dash-title">Dashboard</h2>
        <p class="dash-subtitle">Przegląd projektów mygit</p>
      </div>

      <div class="dash-stats" style="grid-template-columns:repeat(5,1fr)">
        <div class="stat-card">
          <div class="stat-icon blue">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>
            </svg>
          </div>
          <div><div class="stat-label">Repozytoria</div><div class="stat-value">${total}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M3 12a9 9 0 1 1 18 0A9 9 0 0 1 3 12z" opacity=".3"/>
            </svg>
          </div>
          <div><div class="stat-label">Snapshoty</div><div class="stat-value">${snaps}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon yellow">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
            </svg>
          </div>
          <div><div class="stat-label">Ulubione</div><div class="stat-value">${favs.length}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon purple">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
          </div>
          <div><div class="stat-label">Rozmiar</div><div class="stat-value">${humanSize(totalSz)}</div></div>
        </div>
        <div class="stat-card" style="cursor:pointer" onclick="window.showView('archive')" title="Przejdź do archiwum">
          <div class="stat-icon" style="background:var(--bg-muted);color:var(--text-muted)">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/>
              <line x1="10" y1="12" x2="14" y2="12"/>
            </svg>
          </div>
          <div><div class="stat-label">Archiwum</div><div class="stat-value">${archived}</div></div>
        </div>
      </div>

      ${favs.length ? `
      <div>
        <div class="section-title">Ulubione projekty</div>
        <div class="favs-grid" style="margin-bottom:28px">
          ${favs.map(r => `
            <div class="fav-card" onclick="window.clickRepo('${r.id}')">
              <div class="fav-card-icon">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                </svg>
              </div>
              <div style="min-width:0">
                <div class="fav-card-name">${escapeHtml(r.name)}</div>
                <div class="fav-card-meta">${r.snapshots || 0} snapshotów · ${fmtDate(r.updatedAt)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div>
        <div class="section-title">Ostatnia aktywność</div>
        <div class="recent-list">
          ${recent.length ? recent.map(r => `
            <div class="recent-item" onclick="window.clickRepo('${r.id}')">
              <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0"></div>
              <span class="recent-name">${escapeHtml(r.name)}</span>
              ${r.category ? `<span class="badge badge-snap">${escapeHtml(r.category)}</span>` : ''}
              <span class="badge badge-snap">${r.snapshots||0}s</span>
              <span class="recent-date">${fmtDate(r.updatedAt)}</span>
            </div>`).join('') : `
            <div class="empty-state" style="padding:32px">
              <h3>Brak repozytoriów</h3>
              <p>Użyj <code>mygit init</code> aby zacząć</p>
            </div>`}
        </div>
      </div>
    </div>`;
}