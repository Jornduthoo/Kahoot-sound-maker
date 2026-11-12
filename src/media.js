// Media rechtstreeks ophalen: losse bestanden, HLS (.m3u8) en DASH (.mpd).
// Beveiligde media (DRM of versleutelde segmenten) wordt herkend en NIET gedownload:
// daarvoor gebruik je gewoon de opname van het tabblad.

class ProtectedMediaError extends Error {
  constructor() {
    super('Deze media is beveiligd (DRM of versleuteld). Rechtstreeks downloaden kan niet; gebruik "Opnemen", eventueel versneld.');
    this.name = 'ProtectedMediaError';
  }
}

class UnsupportedMediaError extends Error {}

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Server antwoordde ${res.status} voor ${shortName(url)}`);
  return res.text();
}

async function fetchBytes(url, onBytes = () => {}) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Server antwoordde ${res.status} voor ${shortName(url)}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.length, total);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onBytes(received, total);
  }
  return concatBytes(parts);
}

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function shortName(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
  } catch {
    return url;
  }
}

// ---------- HLS ----------

function parseAttributes(line) {
  const attrs = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) attrs[m[1]] = m[2].replace(/^"|"$/g, '');
  return attrs;
}

function hlsIsProtected(text) {
  return [...text.matchAll(/#EXT-X-(?:SESSION-)?KEY:([^\n\r]*)/g)]
    .some((m) => parseAttributes(m[1]).METHOD !== 'NONE');
}

// Kiest in een master-playlist het beste audiospoor (of de kleinste variant)
function pickHlsVariant(text, base) {
  const audio = [...text.matchAll(/#EXT-X-MEDIA:([^\n\r]*)/g)]
    .map((m) => parseAttributes(m[1]))
    .filter((a) => a.TYPE === 'AUDIO' && a.URI);
  if (audio.length) {
    const pick = audio.find((a) => a.DEFAULT === 'YES') ?? audio[0];
    return new URL(pick.URI, base).href;
  }
  const lines = text.split(/\r?\n/);
  const variants = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const attrs = parseAttributes(line.slice(18));
    const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'));
    if (uri) variants.push({ uri: uri.trim(), bandwidth: Number(attrs.BANDWIDTH) || 0, codecs: attrs.CODECS || '' });
  });
  if (!variants.length) throw new UnsupportedMediaError('Geen afspeelbare stream gevonden in de playlist.');
  // Een variant met enkel audio is het kleinst; anders de laagste videokwaliteit (audio is meestal gelijk)
  const audioOnly = variants.filter((v) => v.codecs && !/avc|hvc|hev|vp0|vp9|av01/i.test(v.codecs));
  const pool = audioOnly.length ? audioOnly : variants;
  pool.sort((a, b) => a.bandwidth - b.bandwidth);
  return new URL(pool[0].uri, base).href;
}

async function loadHlsMediaPlaylist(url) {
  let text = await fetchText(url);
  if (!text.trimStart().startsWith('#EXTM3U')) throw new UnsupportedMediaError('Dit is geen geldige HLS-playlist.');
  if (hlsIsProtected(text)) throw new ProtectedMediaError();
  if (text.includes('#EXT-X-STREAM-INF')) {
    url = pickHlsVariant(text, url);
    text = await fetchText(url);
    if (hlsIsProtected(text)) throw new ProtectedMediaError();
  }
  return { url, text };
}

async function inspectHls(url) {
  const { text } = await loadHlsMediaPlaylist(url);
  const live = !text.includes('#EXT-X-ENDLIST');
  const duration = [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  return { live, duration };
}

async function downloadHls(url, onProgress) {
  const playlist = await loadHlsMediaPlaylist(url);
  const { text } = playlist;
  if (!text.includes('#EXT-X-ENDLIST')) {
    throw new UnsupportedMediaError('Dit is een livestream. Die kan je niet in één keer downloaden; gebruik "Opnemen".');
  }
  if (text.includes('#EXT-X-BYTERANGE')) {
    throw new UnsupportedMediaError('Deze stream gebruikt byte-ranges en wordt nog niet ondersteund; gebruik "Opnemen".');
  }
  const base = playlist.url;
  const urls = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((u) => new URL(u, base).href);
  const map = text.match(/#EXT-X-MAP:([^\n\r]*)/);
  if (map) urls.unshift(new URL(parseAttributes(map[1]).URI, base).href);
  const segments = await downloadSegments(urls, onProgress);
  return joinSegments(segments);
}

// ---------- DASH ----------

function parseIsoDuration(value = '') {
  const m = value.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 86400 + (Number(m[2]) || 0) * 3600 + (Number(m[3]) || 0) * 60 + (Number(m[4]) || 0);
}

function childrenByName(el, name) {
  return [...el.children].filter((c) => c.localName === name);
}

async function loadDash(url) {
  const text = await fetchText(url);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const mpd = doc.documentElement;
  if (mpd.localName !== 'MPD') throw new UnsupportedMediaError('Dit is geen geldige DASH-manifest.');
  if (doc.getElementsByTagNameNS('*', 'ContentProtection').length) throw new ProtectedMediaError();
  return { mpd, url };
}

async function inspectDash(url) {
  const { mpd } = await loadDash(url);
  return {
    live: mpd.getAttribute('type') === 'dynamic',
    duration: parseIsoDuration(mpd.getAttribute('mediaPresentationDuration') || '')
  };
}

function resolveBase(el, base) {
  const chain = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentNode) chain.unshift(node);
  for (const node of chain) {
    const b = childrenByName(node, 'BaseURL')[0];
    if (b) base = new URL(b.textContent.trim(), base).href;
  }
  return base;
}

function fillTemplate(template, rep, number, time) {
  return template.replace(/\$(RepresentationID|Number|Time|Bandwidth)(?:%0(\d+)d)?\$|\$\$/g, (all, key, width) => {
    if (all === '$$') return '$';
    const value = { RepresentationID: rep.getAttribute('id'), Number: number, Time: time, Bandwidth: rep.getAttribute('bandwidth') }[key];
    return width ? String(value).padStart(Number(width), '0') : String(value);
  });
}

function dashSegmentUrls(mpd, period, set, rep, mpdUrl) {
  const base = resolveBase(rep, mpdUrl);
  const template = childrenByName(rep, 'SegmentTemplate')[0] ?? childrenByName(set, 'SegmentTemplate')[0];
  const list = childrenByName(rep, 'SegmentList')[0] ?? childrenByName(set, 'SegmentList')[0];
  const urls = [];

  if (template) {
    const attr = (name, fallback) => template.getAttribute(name) ?? fallback;
    const init = attr('initialization');
    if (init) {
      urls.push(new URL(fillTemplate(init, rep, 0, 0), base).href);
      urls.hasInit = true;
    }
    const media = attr('media');
    const timescale = Number(attr('timescale', 1));
    let number = Number(attr('startNumber', 1));
    const timeline = childrenByName(template, 'SegmentTimeline')[0];
    if (timeline) {
      let time = 0;
      for (const s of childrenByName(timeline, 'S')) {
        if (s.hasAttribute('t')) time = Number(s.getAttribute('t'));
        const d = Number(s.getAttribute('d'));
        const repeat = Number(s.getAttribute('r') || 0);
        for (let i = 0; i <= repeat; i++) {
          urls.push(new URL(fillTemplate(media, rep, number++, time), base).href);
          time += d;
        }
      }
    } else {
      const duration = Number(attr('duration', 0));
      const total = parseIsoDuration(period.getAttribute('duration') || mpd.getAttribute('mediaPresentationDuration') || '');
      if (!duration || !total) throw new UnsupportedMediaError('De lengte van deze DASH-stream is onbekend.');
      const count = Math.ceil((total * timescale) / duration);
      for (let i = 0; i < count; i++) urls.push(new URL(fillTemplate(media, rep, number++, i * duration), base).href);
    }
  } else if (list) {
    const init = childrenByName(list, 'Initialization')[0];
    if (init?.getAttribute('sourceURL')) {
      urls.push(new URL(init.getAttribute('sourceURL'), base).href);
      urls.hasInit = true;
    }
    for (const seg of childrenByName(list, 'SegmentURL')) urls.push(new URL(seg.getAttribute('media'), base).href);
  } else {
    urls.push(base); // één bestand per spoor (SegmentBase)
  }
  return urls;
}

async function downloadDash(url, onProgress) {
  const { mpd } = await loadDash(url);
  if (mpd.getAttribute('type') === 'dynamic') {
    throw new UnsupportedMediaError('Dit is een livestream. Die kan je niet in één keer downloaden; gebruik "Opnemen".');
  }
  const urls = [];
  for (const period of childrenByName(mpd, 'Period')) {
    const sets = childrenByName(period, 'AdaptationSet');
    const isAudio = (el) => /audio/.test(el.getAttribute('contentType') || el.getAttribute('mimeType') || '');
    const set = sets.find((s) => isAudio(s) || childrenByName(s, 'Representation').some(isAudio)) ?? sets[0];
    if (!set) continue;
    const reps = childrenByName(set, 'Representation')
      .sort((a, b) => Number(b.getAttribute('bandwidth') || 0) - Number(a.getAttribute('bandwidth') || 0));
    // audio: beste kwaliteit (klein); gemengd spoor: kleinste
    const rep = isAudio(set) || isAudio(reps[0] ?? set) ? reps[0] : reps[reps.length - 1];
    if (rep) urls.push(...dashSegmentUrls(mpd, period, set, rep, url));
  }
  if (!urls.length) throw new UnsupportedMediaError('Geen audiospoor gevonden in deze DASH-stream.');
  const segments = await downloadSegments(urls, onProgress);
  return joinSegments(segments);
}

// ---------- Segmenten ----------

async function downloadSegments(urls, onProgress = () => {}) {
  const results = new Array(urls.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        try {
          results[i] = await fetchBytes(urls[i]);
          break;
        } catch (err) {
          if (attempt >= 2) throw err;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      onProgress(++done / urls.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return results;
}

// Plakt segmenten aan elkaar tot iets wat decodeAudioData begrijpt
function joinSegments(segments) {
  const first = segments.find((s) => s.length) ?? new Uint8Array();
  if (isMpegTs(first)) return demuxTsAudio(concatBytes(segments));
  return concatBytes(segments.map(stripId3));
}

function isMpegTs(bytes) {
  return bytes.length > 376 && bytes[0] === 0x47 && bytes[188] === 0x47;
}

// HLS-audiosegmenten beginnen vaak met een ID3-tag met de tijdstempel
function stripId3(bytes) {
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    return bytes.subarray(10 + size + (bytes[5] & 0x10 ? 10 : 0));
  }
  return bytes;
}

// Haalt het audiospoor (AAC of MP3) uit een MPEG-TS-stroom
function demuxTsAudio(bytes) {
  const PACKET = 188;
  let pmtPid = -1;
  let audioPid = -1;
  const out = [];
  for (let i = 0; i + PACKET <= bytes.length; i += PACKET) {
    if (bytes[i] !== 0x47) {
      const sync = bytes.indexOf(0x47, i + 1);
      if (sync < 0) break;
      i = sync - PACKET;
      continue;
    }
    const start = (bytes[i + 1] & 0x40) !== 0;
    const pid = ((bytes[i + 1] & 0x1f) << 8) | bytes[i + 2];
    const adaptation = (bytes[i + 3] >> 4) & 3;
    let p = i + 4;
    if (adaptation & 2) p += 1 + bytes[p];
    if (!(adaptation & 1) || p >= i + PACKET) continue;

    if (pid === 0 && start && pmtPid < 0) {
      p += 1 + bytes[p];
      const end = p + 3 + (((bytes[p + 1] & 0x0f) << 8) | bytes[p + 2]) - 4;
      for (let q = p + 8; q < end; q += 4) {
        if (((bytes[q] << 8) | bytes[q + 1]) !== 0) {
          pmtPid = ((bytes[q + 2] & 0x1f) << 8) | bytes[q + 3];
          break;
        }
      }
    } else if (pid === pmtPid && start && audioPid < 0) {
      p += 1 + bytes[p];
      const end = p + 3 + (((bytes[p + 1] & 0x0f) << 8) | bytes[p + 2]) - 4;
      const infoLength = ((bytes[p + 10] & 0x0f) << 8) | bytes[p + 11];
      for (let q = p + 12 + infoLength; q < end;) {
        const type = bytes[q];
        const esPid = ((bytes[q + 1] & 0x1f) << 8) | bytes[q + 2];
        // 0x0f = AAC (ADTS), 0x03/0x04 = MPEG-audio
        if ([0x0f, 0x03, 0x04].includes(type)) {
          audioPid = esPid;
          break;
        }
        q += 5 + (((bytes[q + 3] & 0x0f) << 8) | bytes[q + 4]);
      }
    } else if (pid === audioPid) {
      if (start) p += 9 + bytes[p + 8]; // PES-header overslaan
      if (p < i + PACKET) out.push(bytes.subarray(p, i + PACKET));
    }
  }
  if (audioPid < 0) throw new UnsupportedMediaError('Geen audiospoor gevonden in deze stream.');
  return concatBytes(out);
}

// ---------- Algemeen ----------

async function inspectMedia(item) {
  if (item.kind === 'hls') return inspectHls(item.url);
  if (item.kind === 'dash') return inspectDash(item.url);
  return { live: false };
}

async function downloadMedia(item, onProgress = () => {}) {
  if (item.kind === 'hls') return downloadHls(item.url, onProgress);
  if (item.kind === 'dash') return downloadDash(item.url, onProgress);
  return fetchBytes(item.url, (received, total) => onProgress(total ? received / total : null, received));
}
