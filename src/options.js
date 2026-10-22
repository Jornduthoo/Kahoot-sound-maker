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

const testResult = document.getElementById('testResult');

// Test met de ingevulde waarden, ook als ze nog niet opgeslagen zijn
document.getElementById('test').addEventListener('click', async () => {
  const key = form.elements.geminiApiKey.value.trim();
  const requested = form.elements.geminiModel.value.trim() || DEFAULT_SETTINGS.geminiModel;
  showResult('', 'Bezig met testen…');
  if (!key) return showResult('err', '✗ Vul eerst een API-sleutel in.');

  try {
    const { text, model } = await generateWithFallback(key, requested, {
      contents: [{ parts: [{ text: 'Antwoord enkel met: OK' }] }]
    });
    let message = `✓ De sleutel werkt met ${model}. Gemini antwoordde: "${text.trim()}"`;
    if (model !== requested) {
      form.elements.geminiModel.value = model;
      form.requestSubmit();
      message = `✓ ${requested} is niet meer beschikbaar, dus de extensie gebruikt nu ${model} (opgeslagen).\n` +
        `Gemini antwoordde: "${text.trim()}"`;
    }
    showResult('ok', message);
  } catch (err) {
    const prefix = err instanceof GeminiError ? `${err.status}: ` : 'Geen verbinding met Gemini: ';
    showResult('err', `✗ ${prefix}${err.message}`);
  }
});

function showResult(kind, text) {
  testResult.className = kind;
  testResult.textContent = text;
}
