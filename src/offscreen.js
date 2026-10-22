let recorder;
let chunks = [];

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } }
    });
    // Geluid blijft hoorbaar voor de gebruiker tijdens het opnemen
    const ctx = new AudioContext();
    ctx.createMediaStreamSource(stream).connect(ctx.destination);

    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }));
      chrome.runtime.sendMessage({ target: 'background', type: 'recorded', url });
    };
    recorder.start();
  } else if (msg.type === 'stop') {
    recorder?.stop();
  }
});
