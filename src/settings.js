// Gedeelde standaardinstellingen voor background, offscreen, popup en opties.
const DEFAULT_SETTINGS = {
  // Opname
  muteTab: false,           // tabblad stil tijdens de opname (opname gaat gewoon door)
  autoStopMinutes: 0,       // 0 = niet automatisch stoppen
  stopWhenMediaEnds: true,  // stoppen zodra de video/audio op de pagina afgelopen is
  speed: 1,                 // versneld afspelen tijdens de opname, achteraf hersteld
  restartMedia: false,      // video bij de start terug naar het begin zetten en afspelen

  // Bestand
  format: 'mp3',            // mp3 | wav
  quality: 'normaal',       // zie QUALITY_PRESETS
  stereo: true,
  trimSilence: true,        // stilte aan begin en einde wegknippen
  normalize: false,         // volume gelijktrekken tot net onder het maximum
  fileNameTemplate: '{titel} {datum} {tijd}',

  // Bewaren
  saveToLibrary: true,      // opnames bewaren in "Mijn opnames"
  autoDownload: true,       // meteen downloaden naar de map Downloads
  askWhereToSave: false     // "Opslaan als"-venster tonen
};

// Enkel combinaties die de mp3-encoder ondersteunt
const QUALITY_PRESETS = {
  spraak: { label: 'Spraak – 48 kbps, 22 kHz (heel klein)', bitrate: 48, sampleRate: 22050 },
  laag: { label: 'Laag – 96 kbps, 44,1 kHz', bitrate: 96, sampleRate: 44100 },
  normaal: { label: 'Normaal – 128 kbps, 44,1 kHz', bitrate: 128, sampleRate: 44100 },
  hoog: { label: 'Hoog – 192 kbps, 44,1 kHz', bitrate: 192, sampleRate: 44100 },
  max: { label: 'Maximaal – 320 kbps, 48 kHz', bitrate: 320, sampleRate: 48000 }
};

const SPEEDS = [1, 1.5, 2, 3, 4];

async function loadSettings() {
  const { settings: stored = {} } = await chrome.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in stored) settings[key] = stored[key];
  }
  if (!QUALITY_PRESETS[settings.quality]) settings.quality = DEFAULT_SETTINGS.quality;
  if (!SPEEDS.includes(Number(settings.speed))) settings.speed = 1;
  return settings;
}

async function saveSettings(changes) {
  const settings = { ...(await loadSettings()), ...changes };
  await chrome.storage.local.set({ settings });
  return settings;
}

function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Bestandsnaam uit het sjabloon, zonder tekens die Windows niet toelaat
function buildFileName(template, { title = '', url = '', date = new Date() } = {}) {
  let site = '';
  try { site = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const pad = (n) => String(n).padStart(2, '0');
  const values = {
    titel: title,
    site,
    datum: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    tijd: `${pad(date.getHours())}u${pad(date.getMinutes())}`
  };
  const name = (template || DEFAULT_SETTINGS.fileNameTemplate)
    .replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
    .trim();
  return name || `opname ${values.datum} ${values.tijd}`;
}
