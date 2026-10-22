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

const API = 'https://generativelanguage.googleapis.com/v1beta';
const testResult = document.getElementById('testResult');

// Test met de ingevulde waarden, ook als ze nog niet opgeslagen zijn
document.getElementById('test').addEventListener('click', async () => {
  const key = form.elements.geminiApiKey.value.trim();
  const model = form.elements.geminiModel.value.trim() || DEFAULT_SETTINGS.geminiModel;
  showResult('', 'Bezig met testen…');
  if (!key) return showResult('err', '✗ Vul eerst een API-sleutel in.');

  try {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Antwoord enkel met: OK' }] }] })
    });
    const body = await res.json();
    if (res.ok) {
      const answer = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      return showResult('ok', `✓ De sleutel werkt met ${model}. Gemini antwoordde: "${answer}"`);
    }
    let text = `✗ ${res.status}: ${body.error?.message ?? 'onbekende fout'}`;
    if (res.status === 404) text += await suggestModels(key);
    showResult('err', text);
  } catch (err) {
    showResult('err', `✗ Geen verbinding met Gemini: ${err.message}`);
  }
});

// Bij een onbekend model: toon welke modellen deze sleutel wel kan gebruiken
async function suggestModels(key) {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return '';
  const { models = [] } = await res.json();
  const names = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash|pro/.test(m.name))
    .map((m) => m.name.replace('models/', ''));
  return names.length ? `\n\nBeschikbare modellen:\n${names.join('\n')}` : '';
}

function showResult(kind, text) {
  testResult.className = kind;
  testResult.textContent = text;
}
