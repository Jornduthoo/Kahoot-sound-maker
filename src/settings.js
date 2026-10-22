// Gedeelde standaardinstellingen voor background, opties en popup.
const DEFAULT_SETTINGS = {
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash', // valt automatisch terug op het nieuwste flash-model
  muteTab: false,       // tabblad stil tijdens opname (opname gaat gewoon door)
  autoStopMinutes: 0,   // 0 = niet automatisch stoppen
  quality: 'normaal',   // zie QUALITY_PRESETS, enkel voor de gedownloade mp3
  stereo: false,
  downloadMp3: true,
  numQuestions: 10,
  grade: 6              // leerjaar, voor de moeilijkheid en de voettekst
};

// Enkel combinaties die de mp3-encoder ondersteunt
const QUALITY_PRESETS = {
  laag: { label: 'Laag – 64 kbps, 22 kHz (klein bestand)', bitrate: 64, sampleRate: 22050 },
  normaal: { label: 'Normaal – 128 kbps, 44,1 kHz', bitrate: 128, sampleRate: 44100 },
  hoog: { label: 'Hoog – 192 kbps, 44,1 kHz', bitrate: 192, sampleRate: 44100 },
  max: { label: 'Maximaal – 320 kbps, 48 kHz', bitrate: 320, sampleRate: 48000 }
};

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings', 'geminiApiKey', 'geminiModel']);
  // geminiApiKey/geminiModel stonden vroeger los opgeslagen
  const legacy = {};
  if (stored.geminiApiKey) legacy.geminiApiKey = stored.geminiApiKey;
  if (stored.geminiModel) legacy.geminiModel = stored.geminiModel;
  const settings = { ...DEFAULT_SETTINGS, ...legacy, ...stored.settings };
  return { ...settings, ...(QUALITY_PRESETS[settings.quality] ?? QUALITY_PRESETS.normaal), label: undefined };
}
