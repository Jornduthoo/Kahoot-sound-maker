const button = document.getElementById('toggle');
const status = document.getElementById('status');

async function render() {
  const { state = 'idle', statusText = '' } = await chrome.storage.session.get(['state', 'statusText']);
  button.textContent = state === 'recording' ? 'Stop opname' : 'Start opname';
  button.disabled = state === 'processing';
  status.textContent = statusText;
}

button.addEventListener('click', async () => {
  const { state = 'idle' } = await chrome.storage.session.get('state');
  await chrome.runtime.sendMessage({ target: 'background', type: state === 'recording' ? 'stop' : 'start' });
  render();
});

chrome.storage.session.onChanged.addListener(render);
render();
