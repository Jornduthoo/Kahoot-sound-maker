const list = document.getElementById('list');
const search = document.getElementById('search');
const urls = new Map();
let recordings = [];
let settings = {};

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function blobUrl(rec) {
  if (!urls.has(rec.id)) urls.set(rec.id, URL.createObjectURL(rec.blob));
  return urls.get(rec.id);
}

function site(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const dateFormat = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function load() {
  recordings = await recordingsDb.list();
  render();
}

function render() {
  const q = search.value.trim().toLowerCase();
  const shown = recordings.filter((r) => !q || `${r.name} ${r.pageTitle} ${r.pageUrl}`.toLowerCase().includes(q));
  const total = recordings.reduce((n, r) => n + (r.size || 0), 0);
  document.getElementById('summary').textContent = recordings.length
    ? `${recordings.length} opname${recordings.length === 1 ? '' : 's'} · ${formatSize(total)} · ${formatDuration(recordings.reduce((n, r) => n + (r.duration || 0), 0))} in totaal`
    : 'Hier komen je opnames terecht.';
  document.getElementById('empty').classList.toggle('hidden', recordings.length > 0);
  document.getElementById('clearAll').classList.toggle('hidden', !recordings.length);

  list.innerHTML = '';
  for (const rec of shown) {
    const li = document.createElement('li');
    li.className = 'card rec';
    const from = site(rec.pageUrl);
    li.innerHTML = `
      <div class="rec-icon ${rec.source === 'media' ? 'media' : ''}">${icon(rec.source === 'media' ? 'video' : 'mic')}</div>
      <div class="rec-main">
        <div class="rec-title">
          <span class="name" title="Klik om te hernoemen">${escapeHtml(rec.name)}</span>
          <span class="badge accent">${rec.format.toUpperCase()}</span>
        </div>
        <div class="rec-meta muted small">
          <span>${icon('clock')}${formatDuration(rec.duration)}</span>
          <span>${formatSize(rec.size)}</span>
          <span>${dateFormat.format(rec.created)}</span>
          ${from ? `<a href="${escapeHtml(rec.pageUrl)}" target="_blank" title="${escapeHtml(rec.pageTitle || '')}">${escapeHtml(from)}</a>` : ''}
        </div>
        <audio controls preload="none"></audio>
      </div>
      <div class="rec-actions">
        <button class="btn icon-only" data-act="download" title="Downloaden">${icon('download')}</button>
        <button class="btn icon-only" data-act="rename" title="Hernoemen">${icon('edit')}</button>
        <button class="btn icon-only danger" data-act="delete" title="Verwijderen">${icon('trash')}</button>
      </div>`;
    const audio = li.querySelector('audio');
    audio.src = blobUrl(rec);
    li.querySelector('[data-act=download]').onclick = () => chrome.downloads.download({
      url: blobUrl(rec), filename: `${rec.name}.${rec.format}`, saveAs: settings.askWhereToSave
    });
    const rename = () => startRename(li, rec);
    li.querySelector('[data-act=rename]').onclick = rename;
    li.querySelector('.name').onclick = rename;
    li.querySelector('[data-act=delete]').onclick = async () => {
      if (!confirm(`"${rec.name}" verwijderen?`)) return;
      await recordingsDb.remove(rec.id);
      URL.revokeObjectURL(urls.get(rec.id));
      urls.delete(rec.id);
      load();
    };
    list.append(li);
  }
}

function startRename(li, rec) {
  const name = li.querySelector('.name');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = rec.name;
  input.className = 'rename';
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = buildFileName(input.value, {});
    if (save && input.value.trim() && value !== rec.name) {
      rec.name = value;
      rec.fileName = `${value}.${rec.format}`;
      await recordingsDb.put(rec);
    }
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

document.getElementById('clearAll').onclick = async () => {
  if (!confirm('Alle opnames definitief verwijderen? Gedownloade bestanden blijven bewaard.')) return;
  await recordingsDb.clear();
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  load();
};

search.addEventListener('input', render);

// Nieuwe opname klaar terwijl deze pagina openstaat
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.lastResult) load();
});

loadSettings().then((s) => { settings = s; });
load();
