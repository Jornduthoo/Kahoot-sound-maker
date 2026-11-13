// Bingel-bordboeken: alle filmpjes van een werkschrift (of heel het boek) in één keer downloaden.
// De lijst komt uit wat de bordboek-site zelf ophaalt met jouw eigen aanmelding;
// er wordt niets omzeild. De extensie leest gewoon de filmpjes die je ook zelf kan openen.

const BINGEL_HOST = 'bordboeken.bingel.be';

// Haalt boek en werkschrift uit een adres zoals
// https://bordboeken.bingel.be/#/boardbook/<boek>/subbook/<werkschrift>/pagespread/4
function parseBingelUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== BINGEL_HOST) return null;
    const book = u.hash.match(/boardbook\/([0-9a-f-]{36})/i)?.[1];
    if (!book) return null;
    return { book, subbook: u.hash.match(/subbook\/([0-9a-f-]{36})/i)?.[1] ?? null };
  } catch {
    return null;
  }
}

// Draait IN het Bingel-tabblad (via chrome.scripting), zodat de verzoeken met de
// aanmelding van de leerkracht gaan. Moet volledig op zichzelf staan.
// scope: 'subbook' (enkel het open werkschrift) of 'book' (alle werkschriften)
async function bingelCollectVideos(bookId, subbookId, scope) {
  const api = 'https://bordboeken.bingel.be/dbw/rest';
  const getJson = async (path) => {
    const res = await fetch(api + path, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Je bent niet (meer) aangemeld op Bingel. Herlaad de pagina en probeer opnieuw.');
    if (!res.ok) throw new Error(`Bingel antwoordde ${res.status}.`);
    return res.json();
  };
  const pageNumber = (title = '') => Number(title.match(/\d+/)?.[0] ?? 9999);

  const book = await getJson(`/boardbooks/${bookId}`);
  const subbooks = (book.subbooks || []).filter((s) => scope === 'book' || s.id === subbookId);
  if (!subbooks.length) throw new Error('Open eerst een werkschrift van het bordboek.');

  const entries = [];
  for (const sub of subbooks) {
    let list;
    try {
      list = await getJson(`/boardbooks/${bookId}/subbooks/${sub.id}/enrichments`);
    } catch (err) {
      if (scope === 'book') continue; // een werkschrift zonder extra's
      throw err;
    }
    for (const v of list?.content?.video || []) {
      entries.push({ ...v, subbookId: v.subbookId || sub.id, subbookTitle: sub.title || '' });
    }
  }

  // Dubbele (zelfde filmpje op dezelfde plek) eruit, en in volgorde van de bladzijden
  const seen = new Set();
  const unique = entries.filter((v) => !seen.has(v.enrichmentId) && seen.add(v.enrichmentId));
  unique.sort((a, b) => subbooks.findIndex((s) => s.id === a.subbookId) - subbooks.findIndex((s) => s.id === b.subbookId)
    || pageNumber(a.pageSpreadTitle) - pageNumber(b.pageSpreadTitle)
    || (a.side === b.side ? 0 : a.side === 'l' ? -1 : 1));

  // Per filmpje het echte videobestand opvragen (een paar tegelijk)
  const videos = new Array(unique.length);
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const i = next++;
      const v = unique[i];
      const item = { title: v.title || 'Filmpje', page: v.pageSpreadTitle || '', subbook: v.subbookTitle, url: null, reason: null };
      try {
        const ci = await getJson(`/boardbooks/${bookId}/subbooks/${v.subbookId}/pages/${v.pageSpreadId}/enrichments/${v.enrichmentId}/contentitem`);
        const sources = [];
        const walk = (node) => {
          if (Array.isArray(node)) return node.forEach(walk);
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node.sources)) sources.push(...node.sources);
          Object.values(node).forEach(walk);
        };
        walk(ci);
        const pick = sources.find((s) => /mp4/i.test(s.mimeType || '') && s.baseUri) ?? sources.find((s) => s.baseUri);
        if (pick) {
          item.url = pick.baseUri;
          item.mime = pick.mimeType || '';
        } else {
          item.reason = /youtu|vimeo/i.test(JSON.stringify(ci)) ? 'YouTube-filmpje' : 'Geen videobestand';
        }
      } catch (err) {
        item.reason = err.message;
      }
      videos[i] = item;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
  return {
    bookTitle: book.name || 'Bingel',
    subbookTitle: scope === 'book' ? '' : (subbooks[0].title || ''),
    videos
  };
}

// Bestandsnamen: Bingel/<boek>/<werkschrift>/<nr> p. 15-16 - <titel>.mp4
function bingelFileNames(result) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const counters = new Map();
  return result.videos.map((v) => {
    const sub = clean(v.subbook) || 'Bordboek';
    const n = (counters.get(sub) || 0) + 1;
    counters.set(sub, n);
    const ext = /webm/i.test(v.mime || '') ? 'webm' : 'mp4';
    const page = clean((v.page || '').replace(/\s*-\s*/, '-'));
    const name = clean(`${String(n).padStart(2, '0')} ${page ? `${page} - ` : ''}${v.title}`).slice(0, 150);
    return `Bingel/${clean(result.bookTitle).slice(0, 60) || 'Bingel'}/${sub.slice(0, 80)}/${name}.${ext}`;
  });
}
