importScripts('settings.js');

const OFFSCREEN_URL = 'src/offscreen.html';

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Tab-audio opnemen, naar mp3 omzetten en naar Gemini sturen'
  });
}

function setState(state, text = '', extra = {}) {
  return chrome.storage.session.set({ state, statusText: text, endsAt: null, ...extra });
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
}

async function stop() {
  const { state } = await chrome.storage.session.get('state');
  if (state !== 'recording') return;
  await setState('processing', 'Opname verwerken…');
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop', settings: await loadSettings() });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'background') return;
  (async () => {
    if (msg.type === 'start') {
      const settings = await loadSettings();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, settings });
      const endsAt = settings.autoStopMinutes > 0 ? Date.now() + settings.autoStopMinutes * 60000 : null;
      await setState('recording', settings.muteTab ? 'Bezig met opnemen (tabblad gedempt)…' : 'Bezig met opnemen…', { endsAt });
    } else if (msg.type === 'stop' || msg.type === 'autostop') {
      await stop();
    } else if (msg.type === 'status') {
      await setState('processing', msg.text);
    } else if (msg.type === 'model') {
      // Het ingestelde model bestond niet meer; onthoud het model dat wel werkte
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, geminiModel: msg.model } });
    } else if (msg.type === 'mp3') {
      await chrome.downloads.download({ url: msg.url, filename: `karrewiet-${stamp()}.mp3` });
    } else if (msg.type === 'quiz') {
      await chrome.storage.local.set({ lastQuiz: msg.quiz });
      await setState('idle', 'Klaar! De quiz staat open in een nieuw tabblad.');
      await chrome.tabs.create({ url: 'src/quiz.html' });
    } else if (msg.type === 'error') {
      await setState('idle', `Fout: ${msg.text}`);
    }
    sendResponse({ ok: true });
  })();
  return true;
});
