const input = document.getElementById('key');

chrome.storage.local.get('geminiApiKey').then(({ geminiApiKey }) => {
  input.value = geminiApiKey ?? '';
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ geminiApiKey: input.value.trim() });
  document.getElementById('status').textContent = 'Opgeslagen';
});
