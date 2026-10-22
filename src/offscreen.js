// Het offscreen-document doet het zware werk: opnemen, mp3 maken en Gemini aanroepen.
// Het heeft enkel toegang tot chrome.runtime, dus de API-sleutel komt mee met het stop-bericht.

const SAMPLE_RATE = 16000; // spraak: 16 kHz mono is ruim genoeg en houdt de mp3 klein
const KBPS = 48;

let recorder;
let chunks = [];
let playback;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg.streamId).catch(fail);
  else if (msg.type === 'stop') stop(msg.settings);
});

async function start(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  // Geluid blijft hoorbaar voor de gebruiker tijdens het opnemen
  playback = new AudioContext();
  playback.createMediaStreamSource(stream).connect(playback.destination);

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start(1000);
}

function stop(settings) {
  if (!recorder) return;
  recorder.onstop = () => {
    recorder.stream.getTracks().forEach((t) => t.stop());
    playback?.close();
    process(new Blob(chunks, { type: 'audio/webm' }), settings).catch(fail);
  };
  recorder.stop();
}

async function process(webm, settings) {
  status('mp3 maken…');
  const mp3 = await toMp3(webm);
  chrome.runtime.sendMessage({ target: 'background', type: 'mp3', url: URL.createObjectURL(mp3) });

  if (!settings.apiKey) throw new Error('Geen Gemini API-sleutel ingesteld (zie Opties).');
  status('Gemini maakt de vragen…');
  const quiz = await askGemini(mp3, settings);
  chrome.runtime.sendMessage({ target: 'background', type: 'quiz', quiz });
}

async function toMp3(blob) {
  const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
  // Downmixen naar mono en herbemonsteren naar SAMPLE_RATE
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  }

  const encoder = new lamejs.Mp3Encoder(1, SAMPLE_RATE, KBPS);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (buf.length) parts.push(buf);
  }
  parts.push(encoder.flush());
  return new Blob(parts, { type: 'audio/mpeg' });
}

const PROMPT = `Je krijgt de audio van een aflevering van Karrewiet, het jeugdjournaal van Ketnet/VRT.
Maak een quiz voor leerlingen van het 6de leerjaar met precies 10 meerkeuzevragen over deze aflevering.

Regels:
- Vraag 1 is altijd "Wie presenteert deze aflevering van Karrewiet?" met de opties Jensen, Jelle, Maurane, Aïda.
- Als het weerbericht een temperatuur voor morgen noemt, is vraag 10 "Hoeveel graden wordt het morgen volgens het weerbericht?".
- De andere vragen volgen de nieuwsitems in volgorde van de uitzending.
- Elke vraag heeft precies 4 korte, geloofwaardige antwoordopties; precies één is juist en moet letterlijk uit de audio blijken.
- Schrijf in eenvoudig, correct Nederlands (Vlaams), zonder letters A) B) voor de opties.
- Vul "datum" in (bv. "donderdag 15 oktober") als die in de aflevering genoemd wordt, anders laat je hem leeg.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    datum: { type: 'STRING' },
    vragen: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          vraag: { type: 'STRING' },
          opties: { type: 'ARRAY', items: { type: 'STRING' } },
          juist: { type: 'INTEGER', description: 'Index (0-3) van het juiste antwoord in opties' }
        },
        required: ['vraag', 'opties', 'juist']
      }
    }
  },
  required: ['vragen']
};

async function askGemini(mp3, { apiKey, model }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'audio/mp3', data: await toBase64(mp3) } },
          { text: PROMPT }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA }
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Gemini: ${body.error?.message ?? res.status}`);
  return JSON.parse(body.candidates[0].content.parts[0].text);
}

function toBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

function status(text) {
  chrome.runtime.sendMessage({ target: 'background', type: 'status', text });
}

function fail(err) {
  chrome.runtime.sendMessage({ target: 'background', type: 'error', text: err.message });
}
