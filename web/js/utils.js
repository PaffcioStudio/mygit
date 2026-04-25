// utils.js — Pomocnicze funkcje

export function escapeHtml(s) {
  return String(s || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

export function escapeJS(s) {
  return (s || '').replaceAll("'", "\\'").replaceAll('"', '\\"');
}

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const now = new Date();
  const diff = now - dt;
  if (diff < 60000)    return 'przed chwilą';
  if (diff < 3600000)  return `${Math.floor(diff/60000)} min temu`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)} godz. temu`;
  if (diff < 2592000000) return `${Math.floor(diff/86400000)} dni temu`;
  return dt.toLocaleDateString('pl-PL');
}

export function fmtDateFull(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const day   = String(dt.getDate()).padStart(2, '0');
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const year  = dt.getFullYear();
  const hh    = String(dt.getHours()).padStart(2, '0');
  const mm    = String(dt.getMinutes()).padStart(2, '0');
  const ss    = String(dt.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} · ${day}-${month}-${year}`;
}

export function humanSize(n) {
  if (!n || n === 0) return '0 B';
  const sizes = ['B','KB','MB','GB'];
  let i = 0;
  while (n > 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export async function fetchJson(path, opts = {}) {
  const url = path.startsWith('http') ? path : window.location.origin + path;
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const t = await r.text(); if (t) msg = JSON.parse(t).error || msg; } catch {}
    throw new Error(msg);
  }
  if (!ct.includes('application/json')) return {};
  const txt = await r.text();
  return txt ? JSON.parse(txt) : {};
}

export async function postJson(path, body) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Wyciągnij krótki hash z nazwy pliku snapshotu
export function snapHash(filename) {
  if (!filename) return '?';
  return filename.replace(/\.zip$/i, '').slice(-8);
}

// Wyciągnij opis z nazwy pliku
export function snapMessage(filename) {
  if (!filename) return '';
  // Format: YYYY-MM-DD_HH-MM-SS_opis.zip  lub  YYYY-MM-DD_HH-MM-SS.zip
  const base = filename.replace(/\.zip$/i, '');
  // Usuń timestamp (YYYY-MM-DD_HH-MM-SS lub YYYY-MM-DD_HH-MM-SS-mmm) i opcjonalne _
  const withoutTs = base.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?_?/, '');
  return withoutTs.replaceAll('_', ' ').trim();
}

export function snapDate(filename) {
  if (!filename) return '';
  // YYYY-MM-DD_HH-MM-SS...
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
  if (!m) return '';
  const dateStr = m[1] + 'T' + m[2].replaceAll('-', ':');
  return fmtDate(dateStr);
}

export function snapDateFull(filename) {
  if (!filename) return '';
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
  if (!m) return '';
  const dateStr = m[1] + 'T' + m[2].replaceAll('-', ':');
  return fmtDateFull(dateStr);
}
