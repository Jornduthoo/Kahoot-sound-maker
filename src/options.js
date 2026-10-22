const key = document.getElementById('key');
const model = document.getElementById('model');

chrome.storage.local.get(['geminiApiKey', 'geminiModel']).then(({ geminiApiKey, geminiModel }) => {
  key.value = geminiApiKey ?? '';
  model.value = geminiModel ?? '';
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ geminiApiKey: key.value.trim(), geminiModel: model.value.trim() });
  document.getElementById('status').textContent = 'Opgeslagen';
});
