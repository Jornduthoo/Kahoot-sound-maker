const button = document.getElementById('toggle');
const status = document.getElementById('status');
const timer = document.getElementById('timer');
let endsAt = null;

async function render() {
  const session = await chrome.storage.session.get(['state', 'statusText', 'endsAt']);
  const state = session.state ?? 'idle';
  button.textContent = state === 'recording' ? 'Stop opname' : 'Start opname';
  button.disabled = state === 'processing';
  status.textContent = session.statusText ?? '';
  endsAt = state === 'recording' ? session.endsAt : null;
  tick();
}

function tick() {
  if (!endsAt) {
    timer.textContent = '';
    return;
  }
  const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  timer.textContent = `Stopt automatisch over ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

button.addEventListener('click', async () => {
  const { state = 'idle' } = await chrome.storage.session.get('state');
  await chrome.runtime.sendMessage({ target: 'background', type: state === 'recording' ? 'stop' : 'start' });
  render();
});

chrome.storage.session.onChanged.addListener(render);
setInterval(tick, 1000);
render();
