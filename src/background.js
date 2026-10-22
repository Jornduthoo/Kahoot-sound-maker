const OFFSCREEN_URL = 'src/offscreen.html';
const DEFAULT_MODEL = 'gemini-2.5-flash';

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Tab-audio opnemen, naar mp3 omzetten en naar Gemini sturen'
  });
}

function setState(state, text = '') {
  return chrome.storage.session.set({ state, statusText: text });
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'background') return;
  (async () => {
    if (msg.type === 'start') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId });
      await setState('recording', 'Bezig met opnemen…');
    } else if (msg.type === 'stop') {
      const { geminiApiKey, geminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);
      await setState('processing', 'Opname verwerken…');
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'stop',
        settings: { apiKey: geminiApiKey, model: geminiModel || DEFAULT_MODEL }
      });
    } else if (msg.type === 'status') {
      await setState('processing', msg.text);
    } else if (msg.type === 'mp3') {
      await chrome.downloads.download({ url: msg.url, filename: `karrewiet-${stamp()}.mp3` });
    } else if (msg.type === 'quiz') {
      await chrome.storage.local.set({ lastQuiz: msg.quiz });
      await setState('idle', 'Klaar! De quiz staat open in een nieuw tabblad.');
      await chrome.tabs.create({ url: 'src/quiz.html' });
      await chrome.offscreen.closeDocument();
    } else if (msg.type === 'error') {
      await setState('idle', `Fout: ${msg.text}`);
      await chrome.offscreen.closeDocument().catch(() => {});
    }
    sendResponse({ ok: true });
  })();
  return true;
});
