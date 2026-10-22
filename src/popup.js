const button = document.getElementById('toggle');

async function render() {
  const { recording } = await chrome.storage.session.get('recording');
  button.textContent = recording ? 'Stop opname' : 'Start opname';
}

button.addEventListener('click', async () => {
  const { recording } = await chrome.storage.session.get('recording');
  await chrome.runtime.sendMessage({ target: 'background', type: recording ? 'stop' : 'start' });
  render();
});

render();
