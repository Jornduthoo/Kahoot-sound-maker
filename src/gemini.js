// Gedeelde Gemini-aanroep voor offscreen en opties.
// Google haalt oudere modellen geregeld weg; dan kiezen we zelf het nieuwste flash-model.

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }

  get modelUnavailable() {
    return this.status === 404 || /no longer available|not found|not supported|deprecated/i.test(this.message);
  }
}

async function generate(key, model, payload) {
  const res = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  if (!res.ok) throw new GeminiError(res.status, body.error?.message ?? `HTTP ${res.status}`);
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function listModels(key) {
  const res = await fetch(`${GEMINI_API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return [];
  const { models = [] } = await res.json();
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''));
}

// Nieuwste stabiele "gemini-X.Y-flash"; anders de nieuwste flash-variant (bv. preview)
function newestFlash(models, exclude) {
  const version = (name) => (name.match(/^gemini-([\d.]+)/)?.[1] ?? '0').split('.').map(Number);
  const byVersion = (a, b) => {
    const [va, vb] = [version(a), version(b)];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((vb[i] ?? 0) !== (va[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
    }
    return a.length - b.length;
  };
  const candidates = models.filter((m) => m !== exclude && /^gemini-[\d.]+-flash/.test(m) && !/lite|image|tts|live|audio/.test(m));
  const stable = candidates.filter((m) => /^gemini-[\d.]+-flash$/.test(m));
  return (stable.length ? stable : candidates).sort(byVersion)[0];
}

// Geeft { text, model } terug; model is het model dat uiteindelijk gebruikt werd
async function generateWithFallback(key, model, payload) {
  try {
    return { text: await generate(key, model, payload), model };
  } catch (err) {
    if (!(err instanceof GeminiError) || !err.modelUnavailable) throw err;
    const fallback = newestFlash(await listModels(key), model);
    if (!fallback) throw err;
    return { text: await generate(key, fallback, payload), model: fallback };
  }
}
