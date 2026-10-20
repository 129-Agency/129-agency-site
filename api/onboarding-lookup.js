// POST /api/onboarding-lookup   (public)  { url }
//
// « Déjà sorti ? Collez un lien. » À partir d'un lien Spotify / Apple Music / Deezer
// (ou autre plateforme), on retrouve titre, artiste, pochette, date, ISRC si possible,
// et les liens des autres plateformes.
//
// Sources, toutes sans clé, interrogées en parallèle, chacune facultative :
//   - API Deezer et iTunes Lookup : stables, métadonnées riches (Deezer donne l'ISRC).
//   - oEmbed Spotify : titre + pochette.
//   - Odesli (song.link) : liens croisés. API v1-alpha.1 en fin de vie annoncée
//     (retrait prévu au 31/07/2026, encore active ensuite) : si elle renvoie 410/429,
//     on garde ce que les autres sources ont trouvé.
// Rien n'est bloquant : en cas d'échec total, le client remplit à la main.

import { readJson, clean } from './_onboarding.js';

const PLATFORM_HOSTS = /(^|\.)(spotify\.com|spotify\.link|apple\.com|deezer\.com|deezer\.page\.link|amazon\.[a-z.]+|youtube\.com|youtu\.be|tidal\.com|soundcloud\.com)$/i;

async function getJson(url, ms = 4500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : null);

function cleanLink(platform, raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (platform === 'apple') {
    const i = u.searchParams.get('i');
    u.search = i ? `?i=${i}` : '';          // retire les paramètres d'affiliation
  } else if (platform === 'youtube') {
    const v = u.searchParams.get('v');
    u.search = v ? `?v=${v}` : '';
  } else if (platform !== 'amazon') {
    u.search = '';
  }
  u.hash = '';
  return u.toString();
}

function platformOf(u) {
  const h = u.hostname;
  if (/spotify/.test(h)) return 'spotify';
  if (/apple\.com$/.test(h)) return 'apple';
  if (/deezer/.test(h)) return 'deezer';
  if (/amazon/.test(h)) return 'amazon';
  if (/youtu/.test(h)) return 'youtube';
  return null;
}

async function fromDeezer(u) {
  const m = u.pathname.match(/\/track\/(\d+)/);
  if (!m) return null;
  const d = await getJson(`https://api.deezer.com/track/${m[1]}`);
  if (d.error) return null;
  return {
    title: d.title, artist: d.artist?.name, artworkUrl: d.album?.cover_xl || d.album?.cover_big,
    releaseDate: isoDate(d.release_date), isrc: d.isrc, links: { deezer: d.link },
  };
}

async function fromApple(u) {
  const id = u.searchParams.get('i') || (u.pathname.match(/\/song\/[^/]*\/?(\d+)/) || [])[1];
  if (!id) return null;
  const d = await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`);
  const t = (d.results || []).find(r => r.wrapperType === 'track');
  if (!t) return null;
  return {
    title: t.trackName, artist: t.artistName,
    artworkUrl: t.artworkUrl100 ? t.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1000x1000bb.') : null,
    releaseDate: isoDate(t.releaseDate), links: { apple: t.trackViewUrl },
  };
}

async function fromSpotify(u) {
  if (!/\/track\//.test(u.pathname)) return null;
  const d = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(u.toString())}`);
  const out = { title: d.title, artworkUrl: d.thumbnail_url, links: { spotify: u.toString() } };
  // L'oEmbed ne donne pas l'artiste : la page publique du titre le porte dans ses balises meta.
  try {
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 129-onboarding)' } });
    const html = r.ok ? (await r.text()).slice(0, 200_000) : '';
    const meta = (name) => (html.match(new RegExp(`<meta[^>]+(?:name|property)="${name}"[^>]+content="([^"]*)"`, 'i')) || [])[1];
    const artist = meta('music:musician_description');
    if (artist) out.artist = decode(artist);
    const date = meta('music:release_date');
    if (date) out.releaseDate = isoDate(date);
  } catch { /* titre + pochette suffisent */ }
  return out;
}

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\s*[([](feat|ft|with)\.?[^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sameTrack = (artist, title, a2, t2) => norm(title) === norm(t2) && (norm(a2).includes(norm(artist)) || norm(artist).includes(norm(a2)));

// Avec artiste + titre, on retrouve Deezer (lien, ISRC, pochette HD) et Apple Music par recherche.
async function deezerSearch(artist, title) {
  const d = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=5`);
  const hit = (d.data || []).find(t => sameTrack(artist, title, t.artist?.name, t.title));
  if (!hit) return null;
  let isrc = null, releaseDate = null;
  try { const t = await getJson(`https://api.deezer.com/track/${hit.id}`); isrc = t.isrc; releaseDate = isoDate(t.release_date); } catch {}
  return { isrc, releaseDate, artworkUrl: hit.album?.cover_xl, links: { deezer: hit.link } };
}
async function appleSearch(artist, title) {
  const d = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=10`);
  const hit = (d.results || []).find(t => sameTrack(artist, title, t.artistName, t.trackName));
  if (!hit) return null;
  return { releaseDate: isoDate(hit.releaseDate), links: { apple: hit.trackViewUrl } };
}

async function fromOdesli(u) {
  const d = await getJson(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(u.toString())}&userCountry=FR&songIfSingle=true`, 6000);
  const ents = Object.values(d.entitiesByUniqueId || {});
  const main = d.entitiesByUniqueId?.[d.entityUniqueId] || ents[0] || {};
  const art = ents.filter(e => e.thumbnailUrl).sort((a, b) => (b.thumbnailWidth || 0) - (a.thumbnailWidth || 0))[0];
  const L = d.linksByPlatform || {};
  return {
    title: main.title, artist: main.artistName, artworkUrl: art?.thumbnailUrl,
    links: {
      spotify: L.spotify?.url, apple: L.appleMusic?.url, deezer: L.deezer?.url,
      amazon: L.amazonMusic?.url, youtube: L.youtube?.url || L.youtubeMusic?.url,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  let b;
  try { b = await readJson(req, 10_000); } catch (e) { return res.status(e.status || 400).json({ error: 'Unreadable request.' }); }

  let u;
  try {
    let raw = clean(b.url, 600);
    const uri = raw.match(/^spotify:track:([A-Za-z0-9]{22})$/);
    if (uri) raw = `https://open.spotify.com/track/${uri[1]}`;
    u = new URL(raw);
  } catch { return res.status(400).json({ error: 'That doesn’t look like a link.' }); }
  if (u.protocol !== 'https:' || !PLATFORM_HOSTS.test(u.hostname)) {
    return res.status(400).json({ error: 'Paste a Spotify, Apple Music, Deezer, Amazon or YouTube link.' });
  }
  // Les liens Spotify « intl-xx » et paramètres de partage n'apportent rien.
  if (/spotify\.com$/.test(u.hostname)) { u.pathname = u.pathname.replace(/^\/intl-[a-z]{2}(?=\/)/, ''); u.search = ''; }

  const own = platformOf(u);
  const tasks = [
    own === 'deezer' ? fromDeezer(u) : null,
    own === 'apple' ? fromApple(u) : null,
    own === 'spotify' ? fromSpotify(u) : null,
    fromOdesli(u),
  ].map(p => Promise.resolve(p).catch(() => null));
  const [deezer, apple, spotify, odesli] = await Promise.all(tasks);

  // Les sources « natives » priment sur Odesli pour les métadonnées ; Odesli complète.
  const out = { title: null, artist: null, artworkUrl: null, releaseDate: null, isrc: null, links: {} };
  for (const src of [deezer, apple, spotify, odesli]) {
    if (!src) continue;
    for (const k of ['title', 'artist', 'artworkUrl', 'releaseDate', 'isrc']) if (!out[k] && src[k]) out[k] = clean(src[k], 600);
    for (const [p, l] of Object.entries(src.links || {})) if (l && !out.links[p]) out.links[p] = cleanLink(p, l);
  }
  if (own && !out.links[own]) out.links[own] = cleanLink(own, u.toString());

  // Complément par recherche, si Odesli n'a pas fourni les liens croisés.
  if (out.artist && out.title) {
    const [dz, ap] = await Promise.all([
      out.links.deezer && out.isrc ? null : deezerSearch(out.artist, out.title).catch(() => null),
      out.links.apple ? null : appleSearch(out.artist, out.title).catch(() => null),
    ]);
    for (const src of [dz, ap]) {
      if (!src) continue;
      for (const k of ['releaseDate', 'isrc']) if (!out[k] && src[k]) out[k] = clean(src[k], 60);
      // Pochette Deezer 1000 px préférée à la vignette Spotify 640 px.
      if (src.artworkUrl && (!out.artworkUrl || /scdn\.co/.test(out.artworkUrl))) out.artworkUrl = src.artworkUrl;
      for (const [p, l] of Object.entries(src.links || {})) if (l && !out.links[p]) out.links[p] = cleanLink(p, l);
    }
  }
  for (const p of Object.keys(out.links)) if (!out.links[p]) delete out.links[p];

  const found = Boolean(out.title || out.artist || out.artworkUrl);
  return res.status(200).json({ ok: true, found, ...out, sources: { deezer: !!deezer, apple: !!apple, spotify: !!spotify, odesli: !!odesli } });
}
