const form = document.getElementById('form');
const quality = document.getElementById('quality');

for (const [value, { label }] of Object.entries(QUALITY_PRESETS)) {
  quality.add(new Option(label, value));
}

loadSettings().then((settings) => {
  for (const el of form.elements) {
    if (!(el.name in DEFAULT_SETTINGS)) continue;
    if (el.type === 'checkbox') el.checked = settings[el.name];
    else el.value = settings[el.name];
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = {};
  for (const el of form.elements) {
    if (!(el.name in DEFAULT_SETTINGS)) continue;
    if (el.type === 'checkbox') settings[el.name] = el.checked;
    else if (el.type === 'number') settings[el.name] = Number(el.value) || DEFAULT_SETTINGS[el.name];
    else settings[el.name] = el.value.trim() || DEFAULT_SETTINGS[el.name];
  }
  await chrome.storage.local.set({ settings });
  document.getElementById('status').textContent = 'Opgeslagen';
});
