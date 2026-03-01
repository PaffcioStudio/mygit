// fileicons.js — Ikony plików (git-style SVG)
const SVG = (cls, path) =>
  `<svg class="${cls}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">${path}</svg>`;

const DIR_PATH   = `<path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>`;
const FILE_PATH  = `<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>`;
const CODE_PATH  = `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`;
const IMG_PATH   = `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`;
const VIDEO_PATH = `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>`;
const AUDIO_PATH = `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`;
const ZIP_PATH   = `<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`;
const PDF_PATH   = `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M8 12h8m-8 4h4"/>`;
const DATA_PATH  = `<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>`;

export function getFileIcon(name, type) {
  if (type === 'dir') return SVG('icon-dir', DIR_PATH);
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (['js','jsx','ts','tsx','html','css','scss','py','java','c','cpp','h','go','rs','rb','php','sh','bash','zsh','vue','svelte'].includes(ext))
    return SVG('icon-code', CODE_PATH);

  if (['jpg','jpeg','png','gif','svg','webp','ico','bmp','tiff'].includes(ext))
    return SVG('icon-img', IMG_PATH);

  if (['mp4','mov','avi','mkv','webm'].includes(ext))
    return SVG('icon-media', VIDEO_PATH);

  if (['mp3','wav','ogg','flac','aac'].includes(ext))
    return SVG('icon-media', AUDIO_PATH);

  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext))
    return SVG('icon-bin', ZIP_PATH);

  if (ext === 'pdf')
    return SVG('icon-doc', PDF_PATH);

  if (['json','yaml','yml','toml','xml','csv','env','ini','cfg','conf'].includes(ext))
    return SVG('icon-data', DATA_PATH);

  if (['md','txt','log','readme'].includes(ext))
    return SVG('icon-doc', FILE_PATH);

  return SVG('icon-bin', FILE_PATH);
}

export function getExtLang(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    js:'JavaScript', jsx:'JavaScript/JSX', ts:'TypeScript', tsx:'TypeScript/TSX',
    html:'HTML', css:'CSS', scss:'SCSS', py:'Python', java:'Java',
    c:'C', cpp:'C++', h:'C/C++ Header', go:'Go', rs:'Rust', rb:'Ruby',
    php:'PHP', sh:'Shell', bash:'Bash', vue:'Vue', svelte:'Svelte',
    json:'JSON', yaml:'YAML', yml:'YAML', toml:'TOML', xml:'XML',
    md:'Markdown', txt:'Plain Text', env:'Env Config', csv:'CSV',
    sql:'SQL', graphql:'GraphQL',
  };
  return map[ext] || ext.toUpperCase() || 'Binary';
}
