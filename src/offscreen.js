// Het offscreen-document doet het zware werk: opnemen, media downloaden, nabewerken,
// omzetten naar mp3/wav en bewaren. Het heeft enkel chrome.runtime, dus instellingen
// en paginagegevens komen mee met de berichten.

let rec = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') startRecording(msg).catch(fail);
  else if (msg.type === 'stop') stopRecording();
  else if (msg.type === 'pause') rec?.recorder.state === 'recording' && rec.recorder.pause();
  else if (msg.type === 'resume') rec?.recorder.state === 'paused' && rec.recorder.resume();
  else if (msg.type === 'rip') rip(msg).catch(fail);
  else if (msg.type === 'rip-video') ripVideo(msg).catch(fail);
});

async function startRecording({ streamId, settings, meta }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  // Chrome dempt een opgenomen tabblad; we sturen het geluid terug naar de luidsprekers,
  // behalve als de gebruiker het stil wil of als het versneld (en dus vervormd) speelt.
  if (!settings.muteTab && meta.speed === 1) source.connect(ctx.destination);

  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);

  const samples = new Float32Array(analyser.fftSize);
  const levelTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    send({ target: 'popup', type: 'level', value: recorder.state === 'paused' ? 0 : peak });
  }, 100);

  rec = { recorder, stream, ctx, chunks, levelTimer, settings, meta };
}

function stopRecording() {
  if (!rec) return;
  const { recorder, stream, ctx, chunks, levelTimer, settings, meta } = rec;
  rec = null;
  clearInterval(levelTimer);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    try {
      if (!chunks.length) throw new Error('Er werd geen geluid opgenomen.');
      status('Opname verwerken…', null);
      const webm = new Blob(chunks, { type: 'audio/webm' });
      const decoded = await decode(await webm.arrayBuffer());
      await finish(decoded, settings, { ...meta, source: 'opname' }, meta.speed);
    } catch (err) {
      fail(err);
    }
  };
  recorder.state === 'inactive' ? recorder.onstop() : recorder.stop();
}

async function rip({ item, settings, meta }) {
  status('Media downloaden…', 0);
  const bytes = await downloadMedia(item, (fraction, received) => {
    if (fraction == null) status(`Media downloaden… ${formatSize(received)}`, null);
    else status('Media downloaden…', fraction * 0.6);
  });
  status('Audio uit de media halen…', 0.6);
  let decoded;
  try {
    decoded = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch {
    throw new Error('Chrome kan de audio uit dit bestand niet lezen (onbekend formaat of geen geluidsspoor).');
  }
  await finish(decoded, settings, { ...meta, source: 'media', mediaUrl: item.url }, 1, 0.65);
}

async function ripVideo({ item, settings, meta }) {
  status('Video downloaden…', 0);
  const { blob, ext, note } = await downloadVideo(item, (f) => status('Video downloaden…', f * 0.95));
  status('Video opslaan…', 1);
  const fileName = `${buildFileName(settings.fileNameTemplate, meta)}.${ext}`;
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
  send({
    target: 'background', type: 'done',
    result: { id: null, video: true, name: fileName, fileName, size: blob.size, note },
    download: { url, filename: fileName, saveAs: settings.askWhereToSave }
  });
}

async function decode(arrayBuffer) {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

async function finish(decoded, settings, meta, slowdown, progressStart = 0) {
  const label = settings.format === 'wav' ? 'wav' : 'mp3';
  status(`${label} maken…`, progressStart);
  const { blob, duration, ext } = await processAudio(decoded, settings, {
    slowdown,
    onProgress: (f) => status(`${label} maken…`, progressStart + f * (1 - progressStart))
  });
  const name = buildFileName(settings.fileNameTemplate, meta);
  const fileName = `${name}.${ext}`;

  let id = null;
  if (settings.saveToLibrary) {
    id = await recordingsDb.add({
      name, fileName, blob, duration, size: blob.size, format: ext,
      created: Date.now(), source: meta.source, pageTitle: meta.title, pageUrl: meta.url
    });
  }
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  send({
    target: 'background', type: 'done',
    result: { id, name, fileName, duration, size: blob.size },
    download: settings.autoDownload ? { url, filename: fileName, saveAs: settings.askWhereToSave } : null
  });
}

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function status(text, progress) {
  send({ target: 'background', type: 'status', text, progress });
}

function fail(err) {
  console.error(err);
  send({ target: 'background', type: 'error', text: err?.message || String(err) });
}
