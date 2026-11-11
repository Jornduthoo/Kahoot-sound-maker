// Audio nabewerken en omzetten naar mp3 of wav (draait in het offscreen-document).

// Zet een gedecodeerde opname om naar de gewenste samplerate/kanalen.
// slowdown > 1 herstelt een opname die versneld (zonder toonhoogtecorrectie) werd afgespeeld:
// we spelen hem even veel trager af, zodat tempo en toonhoogte weer kloppen.
async function renderAudio(decoded, { sampleRate, channels, slowdown = 1 }) {
  const length = Math.max(1, Math.ceil(decoded.duration * slowdown * sampleRate));
  const offline = new OfflineAudioContext(channels, length, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.playbackRate.value = 1 / slowdown;
  let node = src;
  if (slowdown > 1) {
    // Boven deze frequentie zat er bij de versnelde opname niets meer; filter de spiegelbeelden weg
    const lowpass = offline.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = Math.min(sampleRate / 2, decoded.sampleRate / 2 / slowdown) * 0.95;
    node.connect(lowpass);
    node = lowpass;
  }
  node.connect(offline.destination);
  src.start();
  return offline.startRendering();
}

// Stilte (onder -50 dB) aan begin en einde wegknippen, met een kleine marge.
function trimSilence(buffer, threshold = 0.003, marginSeconds = 0.3) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const loud = (i) => channels.some((ch) => Math.abs(ch[i]) > threshold);
  let start = 0;
  while (start < buffer.length && !loud(start)) start++;
  if (start >= buffer.length) return buffer; // alles stil: laat zoals het is
  let end = buffer.length - 1;
  while (end > start && !loud(end)) end--;
  const margin = Math.round(marginSeconds * buffer.sampleRate);
  start = Math.max(0, start - margin);
  end = Math.min(buffer.length, end + margin);
  if (start === 0 && end === buffer.length) return buffer;
  const out = new AudioBuffer({ numberOfChannels: channels.length, length: end - start, sampleRate: buffer.sampleRate });
  channels.forEach((ch, c) => out.copyToChannel(ch.subarray(start, end), c));
  return out;
}

// Luidste piek naar -1 dB brengen
function normalize(buffer, target = 0.89) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak < 1e-4) return buffer;
  const gain = target / peak;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  }
  return buffer;
}

// Volledige verwerking volgens de instellingen. Geeft { blob, duration, ext } terug.
async function processAudio(decoded, settings, { slowdown = 1, onProgress = () => {} } = {}) {
  const preset = QUALITY_PRESETS[settings.quality] ?? QUALITY_PRESETS.normaal;
  const channels = settings.stereo && decoded.numberOfChannels > 1 ? 2 : 1;
  const sampleRate = settings.format === 'wav' ? Math.max(preset.sampleRate, 44100) : preset.sampleRate;

  let buffer = await renderAudio(decoded, { sampleRate, channels, slowdown });
  if (settings.trimSilence) buffer = trimSilence(buffer);
  if (settings.normalize) buffer = normalize(buffer);

  const blob = settings.format === 'wav'
    ? toWav(buffer)
    : await toMp3(buffer, preset.bitrate, onProgress);
  return { blob, duration: buffer.duration, ext: settings.format === 'wav' ? 'wav' : 'mp3' };
}

async function toMp3(buffer, bitrate, onProgress = () => {}) {
  const channels = buffer.numberOfChannels;
  const pcm = Array.from({ length: channels }, (_, c) => toInt16(buffer.getChannelData(c)));
  const encoder = new lamejs.Mp3Encoder(channels, buffer.sampleRate, bitrate);
  const parts = [];
  const FRAME = 1152;
  const total = pcm[0].length;
  for (let i = 0, n = 0; i < total; i += FRAME, n++) {
    const frame = pcm.map((ch) => ch.subarray(i, i + FRAME));
    const out = encoder.encodeBuffer(...frame);
    if (out.length) parts.push(out);
    if (n % 500 === 499) {
      onProgress(i / total);
      await new Promise((r) => setTimeout(r)); // laat de rest van de pagina even ademen
    }
  }
  parts.push(encoder.flush());
  onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

function toInt16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

function toWav(buffer) {
  const channels = buffer.numberOfChannels;
  const data = Array.from({ length: channels }, (_, c) => toInt16(buffer.getChannelData(c)));
  const bytes = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset, s) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++, offset += 2) view.setInt16(offset, data[c][i], true);
  }
  return new Blob([view], { type: 'audio/wav' });
}
