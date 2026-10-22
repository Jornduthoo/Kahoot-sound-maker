const OFFSCREEN_URL = 'src/offscreen.html';

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Tab-audio opnemen met MediaRecorder'
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'background') return;
  (async () => {
    if (msg.type === 'start') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId });
      await chrome.storage.session.set({ recording: true });
    } else if (msg.type === 'stop') {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
      await chrome.storage.session.set({ recording: false });
    } else if (msg.type === 'recorded') {
      // TODO: mp3-conversie, Gemini-aanroep en PDF-export
      await chrome.downloads.download({ url: msg.url, filename: `opname-${Date.now()}.webm` });
    }
    sendResponse({ ok: true });
  })();
  return true;
});
