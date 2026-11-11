const form = document.getElementById('form');
let settings;
let toastTimer;

function toast() {
  const el = document.getElementById('toast');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

async function save(changes) {
  settings = await saveSettings(changes);
  render();
  toast();
}

function segmented(container, options, current, onPick) {
  container.innerHTML = '';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === current));
    b.onclick = () => onPick(value);
    container.append(b);
  }
}

function render() {
  for (const el of form.elements) {
    if (!(el.name in DEFAULT_SETTINGS)) continue;
    if (el === document.activeElement && el.type !== 'checkbox') continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = settings[el.name];
  }
  segmented(document.getElementById('speed'), SPEEDS.map((s) => [s, `${String(s).replace('.', ',')}×`]),
    Number(settings.speed), (speed) => save({ speed }));
  segmented(document.getElementById('format'), [['mp3', 'mp3'], ['wav', 'wav']],
    settings.format, (format) => save({ format }));
  document.getElementById('qualityRow').classList.toggle('hidden', settings.format === 'wav');
  document.getElementById('namePreview').textContent = `${buildFileName(form.elements.fileNameTemplate.value, {
    title: 'Karrewiet van 10 november', url: 'https://www.vrt.be/vrtmax/'
  })}.${settings.format}`;
}

const quality = document.getElementById('quality');
for (const [value, { label }] of Object.entries(QUALITY_PRESETS)) quality.add(new Option(label, value));

form.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el.name in DEFAULT_SETTINGS)) return;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number') value = Math.max(0, Math.round(Number(el.value) || 0));
  if (el.name === 'fileNameTemplate') value = el.value.trim() || DEFAULT_SETTINGS.fileNameTemplate;
  save({ [el.name]: value });
});
form.elements.fileNameTemplate.addEventListener('input', render);
form.addEventListener('submit', (e) => e.preventDefault());

document.getElementById('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
chrome.commands.getAll().then((commands) => {
  const shortcut = commands.find((c) => c.name === 'toggle-recording')?.shortcut;
  document.getElementById('shortcut').textContent = shortcut
    ? `Nu: ${shortcut}. Werkt op elke pagina, ook zonder de popup te openen.`
    : 'Nog geen sneltoets ingesteld.';
});

loadSettings().then((s) => {
  settings = s;
  render();
});
