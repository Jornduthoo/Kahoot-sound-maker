const $ = (id) => document.getElementById(id);
let session = {};
let settings = {};
let tabId = null;
let tickTimer = null;

// ---------- Tabs ----------

function showTab(name) {
  for (const t of ['record', 'media']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).classList.toggle('hidden', t !== name);
  }
  if (name === 'media') loadMedia();
}
$('tab-record').onclick = () => showTab('record');
$('tab-media').onclick = () => showTab('media');

// ---------- Snelle instellingen ----------

function renderSettings() {
  const speed = $('speed');
  speed.innerHTML = '';
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.textContent = `${String(s).replace('.', ',')}×`;
    b.setAttribute('aria-pressed', String(Number(settings.speed) === s));
    b.onclick = async () => {
      settings = await saveSettings({ speed: s });
      renderSettings();
    };
    speed.append(b);
  }
  const sp = Number(settings.speed);
  $('speedHint').textContent = sp === 1 ? 'normaal afspelen'
    : `${Math.round(100 / sp)}% van de tijd${sp > 2 ? ', iets doffer geluid' : ''}`;
  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.checked = !!settings[input.dataset.setting];
  });
}

document.querySelectorAll('[data-setting]').forEach((input) => {
  input.addEventListener('change', async () => {
    settings = await saveSettings({ [input.dataset.setting]: input.checked });
  });
});

// ---------- Opname ----------

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ target: 'background', type, ...extra });
}

$('recButton').onclick = async () => {
  if (session.state === 'idle') {
    $('recButton').disabled = true;
    const res = await send('start', { tabId });
    if (!res?.ok) $('recButton').disabled = false;
  } else if (session.state === 'recording' || session.state === 'paused') {
    await send('stop');
  }
};
$('stopButton').onclick = () => send('stop');
$('pauseButton').onclick = () => send(session.state === 'paused' ? 'resume' : 'pause');

function elapsed() {
  if (!session.startedAt) return 0;
  const end = session.state === 'paused' ? session.pausedAt : Date.now();
  return (end - session.startedAt - (session.pausedTotal || 0)) / 1000;
}

function tick() {
  const active = session.state === 'recording' || session.state === 'paused';
  $('timer').textContent = formatDuration(active ? elapsed() : 0);
  if (active && session.speed > 1) {
    $('timer').title = `≈ ${formatDuration(elapsed() * session.speed)} audio`;
  }
  if (session.state === 'recording' && session.endsAt) {
    $('state').textContent = `${session.statusText} · stopt over ${formatDuration((session.endsAt - Date.now()) / 1000)}`;
  }
}

function render() {
  const state = session.state ?? 'idle';
  const active = state === 'recording' || state === 'paused';
  const rec = $('recorder');
  rec.classList.toggle('recording', state === 'recording');
  rec.classList.toggle('paused', state === 'paused');

  const button = $('recButton');
  button.innerHTML = icon(active ? 'stop' : 'mic');
  button.title = active ? 'Opname stoppen' : 'Opname starten';
  button.disabled = state === 'processing';

  $('recControls').classList.toggle('hidden', !active);
  $('pauseButton').innerHTML = icon(state === 'paused' ? 'play' : 'pause');
  $('pauseButton').title = state === 'paused' ? 'Hervatten' : 'Pauzeren';
  $('state').textContent = active ? session.statusText
    : state === 'processing' ? 'Even geduld…'
      : 'Klaar om het geluid van dit tabblad op te nemen';
  if (!active) $('level').style.width = '0';
  $('quick').classList.toggle('locked', state !== 'idle');

  // Voortgang
  const busy = state === 'processing';
  $('busy').classList.toggle('hidden', !busy);
  if (busy) {
    $('busyText').textContent = session.statusText || 'Bezig…';
    const p = session.progress;
    $('busyProgress').classList.toggle('indeterminate', p == null);
    $('busyProgress').firstElementChild.style.width = p == null ? '' : `${Math.round(p * 100)}%`;
    $('busyPercent').textContent = p == null ? '' : `${Math.round(p * 100)}%`;
  }

  renderMessage(state);
  tick();
  clearInterval(tickTimer);
  if (active) tickTimer = setInterval(tick, 250);
}

let shownResultAt = null;
async function renderMessage(state) {
  const box = $('message');
  if (state !== 'idle') {
    box.innerHTML = '';
    shownResultAt = null;
    return;
  }
  if (session.error) {
    box.innerHTML = `<div class="notice error">${icon('alert')}<div>${escapeHtml(session.error)}</div></div>`;
    return;
  }
  const r = session.lastResult;
  // Enkel het resultaat van de laatste 10 minuten tonen
  if (!r || Date.now() - r.at > 10 * 60 * 1000) {
    box.innerHTML = '';
    return;
  }
  if (shownResultAt === r.at) return;
  shownResultAt = r.at;
  box.innerHTML = `<div class="notice ok">${icon('check')}<div style="flex:1;min-width:0">
      Opgeslagen: <b>${escapeHtml(r.fileName)}</b>
      <span class="muted">(${formatDuration(r.duration)}, ${formatSize(r.size)})</span>
      ${r.id != null ? '<audio controls preload="metadata"></audio>' : ''}
      <div class="actions">
        ${r.id != null ? `<button class="btn" id="dlLast">${icon('download')}Downloaden</button>` : ''}
        <a class="btn" href="library.html" target="_blank">${icon('library')}Mijn opnames</a>
      </div></div></div>`;
  if (r.id != null) {
    const saved = await recordingsDbGet(r.id);
    if (!saved) return;
    const url = URL.createObjectURL(saved.blob);
    box.querySelector('audio').src = url;
    $('dlLast').onclick = () => chrome.downloads.download({ url, filename: saved.fileName, saveAs: settings.askWhereToSave });
  }
}

// Kleine IndexedDB-lezer, zodat de popup db.js niet volledig hoeft te laden
function recordingsDbGet(id) {
  return new Promise((resolve) => {
    const req = indexedDB.open('sound-recorder', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => {
      const get = req.result.transaction('recordings').objectStore('recordings').get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'popup' || msg.type !== 'level') return;
  // Logaritmische schaal: -60 dB = leeg, 0 dB = vol
  const db = 20 * Math.log10(Math.max(msg.value, 1e-6));
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  $('level').style.width = `${pct}%`;
  $('level').style.backgroundPosition = '0 0';
});

chrome.storage.session.onChanged.addListener(async (changes) => {
  session = { ...session, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) };
  render();
  if (changes.tabMedia || changes[`drm:${tabId}`]) loadMedia(true);
});

// ---------- Media op de pagina ----------

const KIND_LABEL = { file: 'Bestand', hls: 'Stream (HLS)', dash: 'Stream (DASH)' };
const inspected = new Map();
let pageInfo = { media: [], drm: false };

async function scanPage() {
  if (tabId == null) return { media: [], drm: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const found = [];
        const walk = (root) => {
          root.querySelectorAll('video, audio').forEach((m) => found.push(m));
          root.querySelectorAll('*').forEach((el) => {
            const shadow = el.shadowRoot || chrome.dom?.openOrClosedShadowRoot?.(el);
            if (shadow) walk(shadow);
          });
        };
        walk(document);
        return found.map((m) => ({
          src: m.currentSrc || m.src || m.querySelector('source')?.src || '',
          tag: m.tagName.toLowerCase(),
          drm: !!m.mediaKeys,
          duration: Number.isFinite(m.duration) ? m.duration : null
        }));
      }
    });
    const media = results.flatMap((r) => r.result || []);
    return { media, drm: media.some((m) => m.drm) };
  } catch {
    return { media: [], drm: false }; // bv. chrome://-pagina's of de Web Store
  }
}

async function loadMedia(skipScan = false) {
  if (!skipScan) pageInfo = await scanPage();
  const all = await chrome.storage.session.get(['tabMedia', `drm:${tabId}`]);
  const items = [...((all.tabMedia || {})[tabId] || [])];
  for (const m of pageInfo.media) {
    if (m.src && /^https?:/.test(m.src) && !items.some((i) => i.url === m.src)) {
      items.push({ url: m.src, kind: /\.m3u8(\?|$)/.test(m.src) ? 'hls' : 'file', duration: m.duration, mime: m.tag });
    }
  }
  const drm = pageInfo.drm || !!all[`drm:${tabId}`];
  $('drmNotice').classList.toggle('hidden', !drm);
  $('mediaCount').textContent = items.length;
  $('mediaCount').classList.toggle('hidden', !items.length);
  $('mediaEmpty').classList.toggle('hidden', items.length > 0);
  renderMediaList(items);
}

function renderMediaList(items) {
  const list = $('mediaList');
  list.innerHTML = '';
  // Streams eerst, daarna bestanden; het nieuwste bovenaan
  items.sort((a, b) => (a.kind === 'file') - (b.kind === 'file') || (b.at || 0) - (a.at || 0));
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'card media-item';
    const kindIcon = item.kind === 'file' ? (/^audio/.test(item.mime) ? 'music' : 'video') : 'stream';
    li.innerHTML = `
      <div class="kind">${icon(kindIcon)}</div>
      <div class="info">
        <div class="name" title="${escapeHtml(item.url)}">${escapeHtml(shortName(item.url))}</div>
        <div class="meta"><span class="badge">${KIND_LABEL[item.kind]}</span><span class="extra"></span></div>
      </div>
      <div class="buttons">
        <button class="btn primary rip" title="Audio eruit halen en bewaren">${icon('download')}${settings.format === 'wav' ? 'wav' : 'mp3'}</button>
        ${item.kind === 'file' ? `<button class="btn icon-only original" title="Origineel bestand downloaden">${icon('file')}</button>` : ''}
      </div>`;
    const extra = li.querySelector('.extra');
    const ripButton = li.querySelector('.rip');
    const badges = [];
    if (item.size && item.kind === 'file') badges.push(`<span class="badge">${formatSize(item.size)}</span>`);
    if (item.duration) badges.push(`<span class="badge">${formatDuration(item.duration)}</span>`);
    extra.outerHTML = badges.join('');

    ripButton.onclick = () => startRip(item, false);
    li.querySelector('.original')?.addEventListener('click', () => startRip(item, true));
    list.append(li);

    if (item.kind !== 'file') showInspection(item, li, ripButton);
  }
}

async function showInspection(item, li, ripButton) {
  if (!inspected.has(item.url)) {
    inspected.set(item.url, inspectMedia(item).then((info) => ({ ...info, ok: true }), (err) => ({
      ok: false, protected: err instanceof ProtectedMediaError, message: err.message
    })));
  }
  const info = await inspected.get(item.url);
  const meta = li.querySelector('.meta');
  if (info.protected) {
    li.classList.add('protected');
    li.querySelector('.kind').innerHTML = icon('lock');
    meta.insertAdjacentHTML('beforeend', `<span class="badge warn">${icon('lock')}Beveiligd</span>`);
    ripButton.disabled = true;
    ripButton.title = 'Beveiligd met DRM: gebruik Opnemen';
    $('drmNotice').classList.remove('hidden');
  } else if (!info.ok) {
    meta.insertAdjacentHTML('beforeend', `<span class="badge warn" title="${escapeHtml(info.message)}">Niet leesbaar</span>`);
  } else {
    if (info.live) {
      meta.insertAdjacentHTML('beforeend', '<span class="badge warn">Live</span>');
      ripButton.disabled = true;
      ripButton.title = 'Livestream: gebruik Opnemen';
    }
    if (info.duration) meta.insertAdjacentHTML('beforeend', `<span class="badge">${formatDuration(info.duration)}</span>`);
    if (!info.live) meta.insertAdjacentHTML('beforeend', `<span class="badge ok">${icon('check')}Downloadbaar</span>`);
  }
}

async function startRip(item, original) {
  const res = await send('rip', { item, tabId, original });
  if (res?.ok && !original) showTab('record');
}

$('rescan').onclick = () => {
  inspected.clear();
  loadMedia();
};

// ---------- Start ----------

(async () => {
  // ?tab=<id> laat de popup ook als gewone pagina werken (handig om te testen)
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = forced ? [{ id: forced }] : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  settings = await loadSettings();
  session = await chrome.storage.session.get(null);
  session.state ??= 'idle';
  renderSettings();
  render();
  loadMedia();
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === 'toggle-recording')?.shortcut;
  $('shortcut').textContent = shortcut ? `Sneltoets: ${shortcut}` : 'Geen sneltoets ingesteld';
})();
