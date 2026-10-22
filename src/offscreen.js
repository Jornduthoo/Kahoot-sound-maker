// Het offscreen-document doet het zware werk: opnemen, mp3 maken en Gemini aanroepen.
// Het heeft enkel toegang tot chrome.runtime, dus de instellingen komen mee met de berichten.

// Gemini krijgt altijd een compacte spraakversie, zodat ook lange opnames onder de
// limiet van 20 MB voor inline audio blijven, los van de kwaliteit van de download.
const GEMINI_AUDIO = { sampleRate: 16000, bitrate: 32, stereo: false };

let recorder;
let chunks = [];
let playback;
let autoStopTimer;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg.streamId, msg.settings).catch(fail);
  else if (msg.type === 'stop') stop(msg.settings);
});

async function start(streamId, settings) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  // Chrome dempt een opgenomen tabblad; we sturen het geluid terug naar de luidsprekers
  // tenzij de gebruiker het tabblad stil wil tijdens de opname.
  if (!settings.muteTab) {
    playback = new AudioContext();
    playback.createMediaStreamSource(stream).connect(playback.destination);
  }

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm', audioBitsPerSecond: 256000 });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start(1000);

  if (settings.autoStopMinutes > 0) {
    autoStopTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ target: 'background', type: 'autostop' });
    }, settings.autoStopMinutes * 60000);
  }
}

function stop(settings) {
  clearTimeout(autoStopTimer);
  if (!recorder || recorder.state === 'inactive') return;
  recorder.onstop = () => {
    recorder.stream.getTracks().forEach((t) => t.stop());
    playback?.close();
    playback = null;
    process(new Blob(chunks, { type: 'audio/webm' }), settings).catch(fail);
  };
  recorder.stop();
}

async function process(webm, settings) {
  status('mp3 maken…');
  const decoded = await new AudioContext().decodeAudioData(await webm.arrayBuffer());

  if (settings.downloadMp3) {
    const mp3 = await toMp3(decoded, settings);
    chrome.runtime.sendMessage({ target: 'background', type: 'mp3', url: URL.createObjectURL(mp3) });
  }

  if (!settings.geminiApiKey) throw new Error('Geen Gemini API-sleutel ingesteld (zie Opties).');
  status('Gemini maakt de vragen…');
  const quiz = await askGemini(await toMp3(decoded, GEMINI_AUDIO), settings);
  quiz.klas = settings.grade;
  chrome.runtime.sendMessage({ target: 'background', type: 'quiz', quiz });
}

async function toMp3(decoded, { sampleRate, bitrate, stereo }) {
  const channels = stereo && decoded.numberOfChannels > 1 ? 2 : 1;
  const offline = new OfflineAudioContext(channels, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const pcm = Array.from({ length: channels }, (_, c) => toInt16(rendered.getChannelData(c)));

  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
  const parts = [];
  for (let i = 0; i < pcm[0].length; i += 1152) {
    const frame = pcm.map((ch) => ch.subarray(i, i + 1152));
    const buf = encoder.encodeBuffer(...frame);
    if (buf.length) parts.push(buf);
  }
  parts.push(encoder.flush());
  return new Blob(parts, { type: 'audio/mpeg' });
}

function toInt16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  }
  return pcm;
}

const prompt = ({ numQuestions, grade }) => `Je krijgt de audio van een aflevering van Karrewiet, het jeugdjournaal van Ketnet/VRT.
Maak een quiz voor leerlingen van het ${grade}de leerjaar met precies ${numQuestions} meerkeuzevragen over deze aflevering.

Regels:
- Vraag 1 is altijd "Wie presenteert deze aflevering van Karrewiet?" met de opties Jensen, Jelle, Maurane, Aïda.
- Als het weerbericht een temperatuur voor morgen noemt, is de laatste vraag "Hoeveel graden wordt het morgen volgens het weerbericht?".
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

async function askGemini(mp3, settings) {
  const payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'audio/mp3', data: await toBase64(mp3) } },
        { text: prompt(settings) }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA }
  };
  try {
    const { text, model } = await generateWithFallback(settings.geminiApiKey, settings.geminiModel, payload);
    if (model !== settings.geminiModel) {
      chrome.runtime.sendMessage({ target: 'background', type: 'model', model });
    }
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini: ${err.message}`);
  }
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
