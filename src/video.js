// Video's van streams downloaden (HLS en DASH), in de beste kwaliteit.
// Losse beeld- en geluidssporen (fMP4) worden samengevoegd tot één mp4.
// Gebruikt de hulpfuncties uit media.js; beveiligde media wordt ook hier geweigerd.

// ---------- HLS ----------

function hlsVariants(text, base) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const attrs = parseAttributes(line.slice(18));
    const uri = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'));
    if (!uri) return;
    const [w, h] = (attrs.RESOLUTION || '0x0').split('x').map(Number);
    variants.push({ url: new URL(uri.trim(), base).href, bandwidth: Number(attrs.BANDWIDTH) || 0, pixels: w * h, audioGroup: attrs.AUDIO, codecs: attrs.CODECS || '' });
  });
  return variants;
}

async function hlsSegments(url) {
  const text = await fetchText(url);
  if (hlsIsProtected(text)) throw new ProtectedMediaError();
  if (!text.includes('#EXT-X-ENDLIST')) {
    throw new UnsupportedMediaError('Dit is een livestream. Die kan je niet in één keer downloaden; gebruik "Opnemen".');
  }
  if (text.includes('#EXT-X-BYTERANGE')) {
    throw new UnsupportedMediaError('Deze stream gebruikt byte-ranges en wordt nog niet ondersteund.');
  }
  const urls = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((u) => new URL(u, url).href);
  const map = text.match(/#EXT-X-MAP:([^\n\r]*)/);
  return { init: map ? new URL(parseAttributes(map[1]).URI, url).href : null, urls };
}

async function hlsVideoTracks(url) {
  const text = await fetchText(url);
  if (!text.trimStart().startsWith('#EXTM3U')) throw new UnsupportedMediaError('Dit is geen geldige HLS-playlist.');
  if (hlsIsProtected(text)) throw new ProtectedMediaError();
  if (!text.includes('#EXT-X-STREAM-INF')) return [await hlsSegments(url)];

  const variants = hlsVariants(text, url);
  const video = variants.filter((v) => v.pixels || /avc|hvc|hev|vp0|vp9|av01/i.test(v.codecs));
  const pool = video.length ? video : variants;
  pool.sort((a, b) => b.pixels - a.pixels || b.bandwidth - a.bandwidth);
  const best = pool[0];
  const tracks = [await hlsSegments(best.url)];
  if (best.audioGroup) {
    const audio = [...text.matchAll(/#EXT-X-MEDIA:([^\n\r]*)/g)].map((m) => parseAttributes(m[1]))
      .filter((a) => a.TYPE === 'AUDIO' && a['GROUP-ID'] === best.audioGroup && a.URI);
    const pick = audio.find((a) => a.DEFAULT === 'YES') ?? audio[0];
    if (pick) tracks.push(await hlsSegments(new URL(pick.URI, url).href));
  }
  return tracks;
}

// ---------- DASH ----------

async function dashVideoTracks(url) {
  const { mpd } = await loadDash(url);
  if (mpd.getAttribute('type') === 'dynamic') {
    throw new UnsupportedMediaError('Dit is een livestream. Die kan je niet in één keer downloaden; gebruik "Opnemen".');
  }
  const period = childrenByName(mpd, 'Period')[0];
  if (!period) throw new UnsupportedMediaError('Lege DASH-manifest.');
  const typeOf = (set) => {
    const rep = childrenByName(set, 'Representation')[0];
    return (set.getAttribute('contentType') || set.getAttribute('mimeType') || rep?.getAttribute('mimeType') || '').split('/')[0];
  };
  const tracks = [];
  for (const kind of ['video', 'audio']) {
    const set = childrenByName(period, 'AdaptationSet').find((s) => typeOf(s) === kind);
    if (!set) continue;
    const reps = childrenByName(set, 'Representation').sort((a, b) =>
      (Number(b.getAttribute('height')) || 0) - (Number(a.getAttribute('height')) || 0) ||
      (Number(b.getAttribute('bandwidth')) || 0) - (Number(a.getAttribute('bandwidth')) || 0));
    if (!reps[0]) continue;
    const urls = dashSegmentUrls(mpd, period, set, reps[0], url);
    tracks.push(urls.hasInit ? { init: urls[0], urls: urls.slice(1) } : { init: null, urls });
  }
  if (!tracks.length) throw new UnsupportedMediaError('Geen video gevonden in deze DASH-stream.');
  return tracks;
}

// ---------- Downloaden en samenvoegen ----------

// Geeft { blob, ext } terug
async function downloadVideo(item, onProgress = () => {}) {
  const tracks = item.kind === 'dash' ? await dashVideoTracks(item.url) : await hlsVideoTracks(item.url);
  const total = tracks.reduce((n, t) => n + t.urls.length + (t.init ? 1 : 0), 0);
  let done = 0;
  const loaded = [];
  for (const t of tracks) {
    const urls = t.init ? [t.init, ...t.urls] : t.urls;
    const parts = await downloadSegments(urls, () => onProgress(++done / total));
    loaded.push(t.init ? { init: parts[0], segments: parts.slice(1) } : { init: null, segments: parts });
  }

  const first = loaded[0];
  const sample = first.init ?? first.segments[0] ?? new Uint8Array();
  if (isMpegTs(sample)) {
    // MPEG-TS kan je gewoon aan elkaar plakken; een los audiospoor kunnen we daar niet in mengen
    return {
      blob: new Blob(first.segments, { type: 'video/mp2t' }),
      ext: 'ts',
      note: loaded.length > 1 ? 'Deze stream heeft beeld en geluid apart; de video heeft geen geluid. Haal het geluid apart op met de mp3-knop.' : ''
    };
  }
  if (loaded.length === 1) {
    return { blob: new Blob(first.init ? [first.init, ...first.segments] : first.segments, { type: 'video/mp4' }), ext: 'mp4' };
  }
  return { blob: muxFragmentedMp4(loaded), ext: 'mp4' };
}

// ---------- fMP4 samenvoegen ----------
// Neemt per spoor een init-segment (ftyp+moov) en media-segmenten (moof+mdat)
// en maakt er één gefragmenteerde mp4 van met alle sporen, gesorteerd op tijd.

function readBoxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) break;
    boxes.push({ type, start: p, end: p + size, body: p + header });
    p += size;
  }
  return boxes;
}

function findBox(bytes, path, start = 0, end = bytes.length) {
  let box = null;
  for (const type of path) {
    box = readBoxes(bytes, start, end).find((b) => b.type === type);
    if (!box) return null;
    start = box.body;
    end = box.end;
  }
  return box;
}

function makeBox(type, parts) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function setUint32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value);
}

function getUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function trackIdOffset(bytes, tkhd) {
  return tkhd.body + (bytes[tkhd.body] === 1 ? 20 : 12);
}

function timescaleOf(bytes, trak) {
  const mdhd = findBox(bytes, ['mdia', 'mdhd'], trak.body, trak.end);
  return getUint32(bytes, mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12));
}

function muxFragmentedMp4(tracks) {
  const traks = [];
  const trexes = [];
  let end = 0;
  let ftyp = null;
  let moovRest = [];
  const fragments = [];

  tracks.forEach((track, index) => {
    const id = index + 1;
    const init = track.init.slice();
    const top = readBoxes(init);
    const moov = top.find((b) => b.type === 'moov');
    if (!moov) throw new UnsupportedMediaError('Onbekend videoformaat (geen moov).');
    if (index === 0) ftyp = top.find((b) => b.type === 'ftyp');

    const children = readBoxes(init, moov.body, moov.end);
    const trak = children.find((b) => b.type === 'trak');
    const mvex = children.find((b) => b.type === 'mvex');
    if (!trak || !mvex) throw new UnsupportedMediaError('Dit spoor is geen gefragmenteerde mp4.');
    setUint32(init, trackIdOffset(init, findBox(init, ['tkhd'], trak.body, trak.end)), id);
    const trex = readBoxes(init, mvex.body, mvex.end).find((b) => b.type === 'trex');
    setUint32(init, trex.body + 4, id);
    traks.push(init.slice(trak.start, trak.end));
    trexes.push(init.slice(trex.start, trex.end));
    if (index === 0) {
      moovRest = children.filter((b) => !['trak', 'mvex', 'udta'].includes(b.type))
        .map((b) => init.slice(b.start, b.end));
    }
    const timescale = timescaleOf(init, trak);
    const defaultDuration = getUint32(init, trex.body + 12);

    for (const segment of track.segments) {
      const seg = segment.slice();
      let current = null;
      for (const box of readBoxes(seg)) {
        if (box.type === 'moof') {
          for (const traf of readBoxes(seg, box.body, box.end).filter((b) => b.type === 'traf')) {
            const tfhd = findBox(seg, ['tfhd'], traf.body, traf.end);
            if (tfhd) setUint32(seg, tfhd.body + 4, id);
          }
          const traf = findBox(seg, ['traf'], box.body, box.end);
          const tfdt = traf && findBox(seg, ['tfdt'], traf.body, traf.end);
          let time = 0;
          if (tfdt) {
            const view = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
            time = seg[tfdt.body] === 1 ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4);
          }
          current = { time: time / timescale, track: index, parts: [seg.subarray(box.start, box.end)] };
          fragments.push(current);
          end = Math.max(end, (time + fragmentDuration(seg, traf, defaultDuration)) / timescale);
        } else if (box.type === 'mdat' && current) {
          current.parts.push(seg.subarray(box.start, box.end));
          current = null;
        }
      }
    }
  });

  // mvhd: totale duur en volgende vrije track-ID; mehd vertelt spelers hoe lang het geheel is
  const mvhd = moovRest.find((b) => String.fromCharCode(...b.subarray(4, 8)) === 'mvhd');
  let mehd = null;
  if (mvhd) {
    setUint32(mvhd, mvhd.length - 4, tracks.length + 1);
    const v1 = mvhd[8] === 1;
    const movieScale = getUint32(mvhd, v1 ? 28 : 20);
    const duration = Math.round(end * movieScale);
    if (v1) {
      new DataView(mvhd.buffer, mvhd.byteOffset).setBigUint64(32, BigInt(duration));
    } else {
      setUint32(mvhd, 24, Math.min(duration, 0xffffffff));
    }
    mehd = makeBox('mehd', [new Uint8Array(4), new Uint8Array(4)]);
    setUint32(mehd, 12, Math.min(duration, 0xffffffff));
  }

  fragments.sort((a, b) => a.time - b.time || a.track - b.track);
  fragments.forEach((f, i) => {
    const moof = f.parts[0];
    const mfhd = findBox(moof, ['mfhd'], 8, moof.length);
    if (mfhd) setUint32(moof, mfhd.body + 4, i + 1);
  });

  const moov = makeBox('moov', [...moovRest, ...traks, makeBox('mvex', mehd ? [mehd, ...trexes] : trexes)]);
  const head = ftyp ? tracks[0].init.subarray(ftyp.start, ftyp.end) : new Uint8Array();
  return new Blob([head, moov, ...fragments.flatMap((f) => f.parts)], { type: 'video/mp4' });
}

// Som van de sampleduren in één fragment (in de tijdschaal van het spoor)
function fragmentDuration(bytes, traf, trexDefault) {
  if (!traf) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tfhd = findBox(bytes, ['tfhd'], traf.body, traf.end);
  let fallback = trexDefault;
  if (tfhd) {
    const flags = view.getUint32(tfhd.body) & 0xffffff;
    let o = tfhd.body + 8;
    if (flags & 0x01) o += 8;
    if (flags & 0x02) o += 4;
    if (flags & 0x08) fallback = view.getUint32(o);
  }
  let total = 0;
  for (const trun of readBoxes(bytes, traf.body, traf.end).filter((b) => b.type === 'trun')) {
    const flags = view.getUint32(trun.body) & 0xffffff;
    const count = view.getUint32(trun.body + 4);
    if (!(flags & 0x100)) {
      total += count * fallback;
      continue;
    }
    let o = trun.body + 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0);
    const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
    for (let i = 0; i < count && o + 4 <= trun.end; i++, o += stride) total += view.getUint32(o);
  }
  return total;
}
