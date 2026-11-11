importScripts('settings.js');

const OFFSCREEN_URL = 'src/offscreen.html';
const IDLE = { state: 'idle', tabId: null, startedAt: null, pausedAt: null, pausedTotal: 0, endsAt: null, speed: 1, progress: null };

// ---------- Status ----------

async function getState() {
  return { ...IDLE, ...(await chrome.storage.session.get(null)) };
}

async function setState(changes) {
  await chrome.storage.session.set(changes);
  const { state } = await getState();
  const badge = {
    recording: ['REC', '#e5484d'],
    paused: ['II', '#f5a524'],
    processing: ['…', '#5b5bd6']
  }[state];
  await chrome.action.setBadgeText({ text: badge ? badge[0] : '' });
  if (badge) await chrome.action.setBadgeBackgroundColor({ color: badge[1] });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Tab-audio opnemen en audio omzetten naar mp3/wav'
  });
}

function toOffscreen(msg) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
}

// ---------- Opnemen ----------

async function startRecording(tabId) {
  const current = await getState();
  if (current.state !== 'idle') return;
  const settings = await loadSettings();
  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) throw new Error('Geen tabblad gevonden.');
  const speed = Number(settings.speed) || 1;

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();
  await toOffscreen({ type: 'start', streamId, settings, meta: { title: tab.title, url: tab.url, speed } });

  // Versnellen, terugspoelen en het einde van de video volgen gebeurt in de pagina zelf
  if (speed !== 1 || settings.restartMedia || settings.stopWhenMediaEnds) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: pageStart,
      args: [speed, settings.restartMedia, settings.stopWhenMediaEnds]
    }).catch(() => {}); // bv. chrome://-pagina's: gewoon opnemen zonder extra's
  }

  const now = Date.now();
  await setState({
    state: 'recording', tabId: tab.id, startedAt: now, pausedAt: null, pausedTotal: 0, speed,
    endsAt: settings.autoStopMinutes > 0 ? now + settings.autoStopMinutes * 60000 : null,
    statusText: statusWhileRecording(settings, speed), progress: null, error: null
  });
  scheduleAutoStop(settings.autoStopMinutes * 60000);
}

function statusWhileRecording(settings, speed) {
  if (speed !== 1) return `Versneld opnemen (${String(speed).replace('.', ',')}×), het tabblad is stil`;
  return settings.muteTab ? 'Bezig met opnemen (tabblad gedempt)' : 'Bezig met opnemen';
}

function scheduleAutoStop(ms) {
  chrome.alarms.clear('autostop');
  if (ms > 0) chrome.alarms.create('autostop', { when: Date.now() + ms });
}

async function stopRecording() {
  const st = await getState();
  if (st.state !== 'recording' && st.state !== 'paused') return;
  chrome.alarms.clear('autostop');
  await setState({ state: 'processing', statusText: 'Opname verwerken…', progress: null, endsAt: null });
  if (st.tabId) {
    chrome.scripting.executeScript({ target: { tabId: st.tabId, allFrames: true }, func: pageStop }).catch(() => {});
  }
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) return setState({ ...IDLE, statusText: '', error: 'De opname was onderbroken (Chrome sloot de opnamemodule).' });
  await toOffscreen({ type: 'stop' });
}

async function pauseRecording() {
  const st = await getState();
  if (st.state !== 'recording') return;
  await toOffscreen({ type: 'pause' });
  chrome.alarms.clear('autostop');
  await setState({ state: 'paused', pausedAt: Date.now(), statusText: 'Gepauzeerd' });
}

async function resumeRecording() {
  const st = await getState();
  if (st.state !== 'paused') return;
  await toOffscreen({ type: 'resume' });
  const pausedFor = Date.now() - st.pausedAt;
  const endsAt = st.endsAt ? st.endsAt + pausedFor : null;
  if (endsAt) scheduleAutoStop(endsAt - Date.now());
  const settings = await loadSettings();
  await setState({
    state: 'recording', pausedAt: null, pausedTotal: st.pausedTotal + pausedFor, endsAt,
    statusText: statusWhileRecording(settings, st.speed)
  });
}

// ---------- Media rechtstreeks ophalen ----------

async function rip(item, tabId, original) {
  const st = await getState();
  if (st.state !== 'idle') throw new Error('Wacht tot de huidige opname of download klaar is.');
  const settings = await loadSettings();
  const tab = await chrome.tabs.get(tabId).catch(() => ({}));
  const meta = { title: item.title || tab.title || '', url: tab.url || item.url };

  if (original) {
    const ext = (new URL(item.url).pathname.match(/\.(\w{2,4})$/) || [])[1] || 'mp4';
    await chrome.downloads.download({
      url: item.url,
      filename: `${buildFileName(settings.fileNameTemplate, meta)}.${ext}`,
      saveAs: settings.askWhereToSave
    });
    return;
  }
  await ensureOffscreen();
  await setState({ state: 'processing', statusText: 'Media downloaden…', progress: 0, error: null, tabId });
  await toOffscreen({ type: 'rip', item, settings, meta });
}

// ---------- Berichten ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'background') return;
  handle(msg, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch(async (err) => {
      if (msg.type === 'start' || msg.type === 'rip') await setState({ ...IDLE, statusText: '', error: err.message });
      sendResponse({ ok: false, error: err.message });
    });
  return true;
});

async function handle(msg, sender) {
  switch (msg.type) {
    case 'start': return startRecording(msg.tabId);
    case 'stop': return stopRecording();
    case 'pause': return pauseRecording();
    case 'resume': return resumeRecording();
    case 'rip': return rip(msg.item, msg.tabId, msg.original);
    case 'media-ended': {
      const st = await getState();
      if (st.state === 'recording' && sender.tab?.id === st.tabId && Date.now() - st.startedAt > 5000) {
        await stopRecording();
      }
      return;
    }
    case 'status':
      return setState({ statusText: msg.text, progress: msg.progress });
    case 'done': {
      const { result, download } = msg;
      await setState({ ...IDLE, statusText: '', lastResult: { ...result, at: Date.now() }, error: null });
      if (download) await chrome.downloads.download(download);
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#30a46c' });
      setTimeout(async () => {
        if ((await getState()).state === 'idle') chrome.action.setBadgeText({ text: '' });
      }, 4000);
      return;
    }
    case 'error': {
      const st = await getState();
      if (st.tabId) chrome.scripting.executeScript({ target: { tabId: st.tabId, allFrames: true }, func: pageStop }).catch(() => {});
      chrome.alarms.clear('autostop');
      return setState({ ...IDLE, statusText: '', error: msg.text });
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autostop') stopRecording();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return;
  const st = await getState();
  try {
    if (st.state === 'idle') await startRecording(tab?.id);
    else if (st.state === 'recording' || st.state === 'paused') await stopRecording();
  } catch (err) {
    await setState({ ...IDLE, statusText: '', error: err.message });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  forgetTab(tabId);
  const st = await getState();
  if (st.tabId === tabId && (st.state === 'recording' || st.state === 'paused')) stopRecording();
});

chrome.runtime.onStartup.addListener(() => chrome.storage.session.clear());
chrome.runtime.onInstalled.addListener(() => setState({ ...IDLE }));

// ---------- Media op pagina's herkennen ----------
// We kijken naar wat de pagina zelf laadt: losse audio/video-bestanden en
// streaming-playlists (HLS .m3u8 en DASH .mpd). Losse segmenten negeren we.

const FILE_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov|mkv)$/i;
const AUDIO_EXT = /\.(mp3|m4a|ogg|oga|opus|wav|flac)$/i;
const tabMedia = new Map();
let mediaLoaded = null;

function loadTabMedia() {
  mediaLoaded ??= chrome.storage.session.get('tabMedia').then(({ tabMedia: saved = {} }) => {
    for (const [id, list] of Object.entries(saved)) if (!tabMedia.has(Number(id))) tabMedia.set(Number(id), list);
  });
  return mediaLoaded;
}

function persistTabMedia() {
  return chrome.storage.session.set({ tabMedia: Object.fromEntries(tabMedia) });
}

function forgetTab(tabId) {
  if (tabMedia.delete(tabId)) persistTabMedia();
}

function classify(details, contentType) {
  let path;
  try { path = new URL(details.url).pathname.toLowerCase(); } catch { return null; }
  if (/mpegurl/i.test(contentType) || path.endsWith('.m3u8')) return 'hls';
  if (/dash\+xml/i.test(contentType) || path.endsWith('.mpd')) return 'dash';
  // Bij streams laadt de speler segmenten via xhr/fetch; echte bestanden laadt <video>/<audio> zelf
  if (details.type === 'media' && (/^(audio|video)\//i.test(contentType) || FILE_EXT.test(path))) return 'file';
  if (/^audio\//i.test(contentType) && AUDIO_EXT.test(path)) return 'file';
  return null;
}

chrome.webRequest.onHeadersReceived.addListener(async (details) => {
  if (details.tabId < 0 || details.statusCode >= 400) return;
  const header = (name) => details.responseHeaders?.find((h) => h.name.toLowerCase() === name)?.value || '';
  const contentType = header('content-type');
  const kind = classify(details, contentType);
  if (!kind) return;
  await loadTabMedia();
  let list = tabMedia.get(details.tabId);
  if (!list) tabMedia.set(details.tabId, (list = []));
  if (list.some((m) => m.url === details.url)) return;
  const range = header('content-range').match(/\/(\d+)$/);
  list.push({
    url: details.url,
    kind,
    mime: contentType.split(';')[0],
    size: range ? Number(range[1]) : Number(header('content-length')) || null,
    at: Date.now()
  });
  if (list.length > 40) list.splice(0, list.length - 40);
  persistTabMedia();
}, { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] }, ['responseHeaders']);

// Licentieverzoeken verraden DRM, ook voor de video speelt
chrome.webRequest.onBeforeRequest.addListener(async (details) => {
  if (details.tabId < 0 || details.method !== 'POST') return;
  if (!/widevine|playready|fairplay|license|drm/i.test(details.url)) return;
  const key = `drm:${details.tabId}`;
  await chrome.storage.session.set({ [key]: true });
}, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'other'] });

// Een nieuwe pagina in het tabblad: begin met een lege lijst.
// (Dit verzoek komt gegarandeerd vóór alles wat de nieuwe pagina laadt.)
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0) return;
  loadTabMedia().then(() => forgetTab(details.tabId));
  chrome.storage.session.remove(`drm:${details.tabId}`);
}, { urls: ['<all_urls>'], types: ['main_frame'] });

// ---------- Functies die in de pagina draaien ----------
// Deze worden met chrome.scripting in elk frame uitgevoerd en moeten op zichzelf staan.

function pageStart(speed, restart, watchEnd) {
  const findMedia = () => {
    const found = [];
    const walk = (root) => {
      root.querySelectorAll('video, audio').forEach((m) => found.push(m));
      root.querySelectorAll('*').forEach((el) => {
        const shadow = el.shadowRoot || chrome.dom?.openOrClosedShadowRoot?.(el);
        if (shadow) walk(shadow);
      });
    };
    walk(document);
    return found;
  };

  window.__soundRecorder?.cleanup?.();
  const touched = new Map();
  const onRate = (e) => {
    const m = e.target;
    if (m.playbackRate !== speed || m.preservesPitch) {
      m.preservesPitch = false;
      m.playbackRate = speed;
    }
  };
  const onEnded = (e) => {
    if (watchEnd && e.target.duration > 10) chrome.runtime.sendMessage({ target: 'background', type: 'media-ended' });
  };
  const apply = (m) => {
    if (touched.has(m)) return;
    touched.set(m, { rate: m.playbackRate });
    m.addEventListener('ended', onEnded);
    if (speed !== 1) {
      // Zonder toonhoogtecorrectie is versneld afspelen gewoon "resamplen",
      // wat we na de opname exact kunnen terugdraaien.
      m.preservesPitch = false;
      m.playbackRate = speed;
      m.addEventListener('ratechange', onRate);
    }
  };

  const media = findMedia();
  media.forEach(apply);
  if (restart && media.length) {
    const main = media
      .filter((m) => m.tagName === 'AUDIO' || m.getBoundingClientRect().width > 0)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] ?? media[0];
    main.currentTime = 0;
    main.play().catch(() => {});
  }
  const timer = setInterval(() => findMedia().forEach(apply), 1000);

  window.__soundRecorder = {
    cleanup() {
      clearInterval(timer);
      for (const [m, original] of touched) {
        m.removeEventListener('ended', onEnded);
        m.removeEventListener('ratechange', onRate);
        if (speed !== 1) {
          m.playbackRate = original.rate === speed ? 1 : original.rate;
          m.preservesPitch = true;
        }
      }
      touched.clear();
    }
  };
}

function pageStop() {
  window.__soundRecorder?.cleanup?.();
  window.__soundRecorder = null;
}
