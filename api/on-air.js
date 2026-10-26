// GET /api/on-air — route PUBLIQUE de la home (section « On air »).
//
// Renvoie les records qu'on pousse en ce moment : titre, artistes, label, pochette,
// jour de campagne. AUCUN chiffre (spend, impressions, cout par resultat) et aucun
// identifiant Meta ne sort d'ici : c'est une vitrine, pas un reporting.
//
// Source de verite : les comptes pub listes dans config/on-air.json (129, CR2, ERA).
// Une campagne est retenue si elle a depense sur les N derniers jours ET si son nom
// suit notre convention « Artiste - Titre — EXPLORE|SCALE ». Le statut ACTIVE seul ne
// veut rien dire : le compte CR2 garde des centaines de vieilles campagnes « actives »
// sans diffusion, et leur equipe y lance aussi ses propres campagnes.
//
// Pochettes : override manuel, sinon recherche Deezer puis iTunes (API publiques, sans cle).
// Cache CDN Vercel d'une heure : Meta n'est appele qu'une fois par heure, quel que soit
// le trafic du site.

import fs from 'fs';
import path from 'path';
import { graph } from './_meta.js';

const CONF = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/on-air.json'), 'utf8'));
const NAME_RE = new RegExp(CONF.name_pattern || '(EXPLORE|SCALE)\\s*$', 'i');
const SUFFIX_RE = /[\s\-–—|]*\b(EXPLORE|SCALE)\b[\s\S]*$/i;

const iso = (d) => d.toISOString().split('T')[0];

// « SOLTO, BELLIL BROTHERS - HOW FAR CHALE — EXPLORE » -> clef, artistes, titre.
export function parseName(name) {
  const base = String(name).replace(SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
  const i = base.indexOf(' - ');
  const artists = i > 0 ? base.slice(0, i).trim() : '';
  const title = i > 0 ? base.slice(i + 3).trim() : base;
  return { key: base.toLowerCase(), artists, title };
}

// Les noms de campagne sont parfois tout en majuscules : on remet une casse lisible
// quand aucune source externe ne donne la graphie officielle.
function tidy(s) {
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s,(\-/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// On n'accepte une pochette que si l'artiste trouve recoupe le nom de campagne :
// mieux vaut le carre generique qu'une mauvaise pochette sur la home.
function artistMatches(found, wanted) {
  const f = norm(found), w = norm(wanted).split(' ').filter(t => t.length > 2);
  return w.length === 0 || w.some(t => f.includes(t));
}

async function fetchJson(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function lookupArtwork(artists, title) {
  const firstArtist = artists.split(/,|&| x | feat\.? /i)[0].trim();
  const q = `${firstArtist} ${title}`.trim();

  const dz = await fetchJson(`https://api.deezer.com/search?limit=5&q=${encodeURIComponent(q)}`);
  for (const t of dz?.data || []) {
    if (artistMatches(t.artist?.name, firstArtist) && t.album?.cover_xl) {
      return { cover: t.album.cover_xl, title: t.title_short || t.title, artist: t.artist.name };
    }
  }
  const it = await fetchJson(`https://itunes.apple.com/search?entity=song&limit=5&term=${encodeURIComponent(q)}`);
  for (const t of it?.results || []) {
    if (artistMatches(t.artistName, firstArtist) && t.artworkUrl100) {
      return { cover: t.artworkUrl100.replace('100x100bb', '600x600bb'), title: t.trackName, artist: t.artistName };
    }
  }
  return null;
}

async function liveCampaigns(acc) {
  const until = new Date();
  const since = new Date(); since.setDate(since.getDate() - (CONF.active_days || 3));
  // Insights ne renvoie que les campagnes qui ont diffuse sur la fenetre : pas besoin
  // de parcourir les centaines de campagnes du compte.
  const ins = await graph(`act_${acc.ad_account_id}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend',
    time_range: JSON.stringify({ since: iso(since), until: iso(until) }),
    limit: '200',
  });
  const rows = (ins.data || []).filter(r => Number(r.spend) > 0 && NAME_RE.test(r.campaign_name || ''));
  if (!rows.length) return [];

  // Date de lancement, pour le compteur « jour N ».
  const meta = await graph('', { ids: rows.map(r => r.campaign_id).join(','), fields: 'start_time,created_time' });
  return rows.map(r => ({
    name: r.campaign_name,
    start: meta[r.campaign_id]?.start_time || meta[r.campaign_id]?.created_time || null,
    label: acc.default_label,
  }));
}

export default async function handler(req, res) {
  const results = await Promise.allSettled((CONF.accounts || []).map(liveCampaigns));
  const errors = results.filter(r => r.status === 'rejected').length;

  // Un meme record tourne souvent en EXPLORE et en SCALE : une seule ligne,
  // datee du lancement le plus ancien.
  const byKey = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value) {
      const p = parseName(c.name);
      const prev = byKey.get(p.key);
      if (!prev) byKey.set(p.key, { ...p, start: c.start, label: c.label });
      else if (c.start && (!prev.start || c.start < prev.start)) prev.start = c.start;
    }
  }

  const items = [];
  for (const rec of byKey.values()) {
    const o = CONF.overrides?.[rec.key] || {};
    if (o.hide) continue;
    let title = o.title, artists = o.artists, cover = o.cover || null;
    if (!cover || !title || !artists) {
      const found = await lookupArtwork(rec.artists, rec.title);
      if (found) {
        cover ||= found.cover;
        // La graphie officielle n'est reprise que si le titre recoupe celui de la campagne.
        if (!title && norm(found.title).includes(norm(rec.title).split(' ')[0])) title = found.title;
      }
    }
    const day = rec.start ? Math.max(1, Math.ceil((Date.now() - new Date(rec.start).getTime()) / 86400000)) : null;
    items.push({
      title: title || tidy(rec.title),
      artists: artists || tidy(rec.artists),
      label: o.label || rec.label || null,
      cover,
      day,
    });
  }

  // Les plus recents d'abord : ce sur quoi on vient de demarrer.
  items.sort((a, b) => (a.day ?? 1e9) - (b.day ?? 1e9));

  // Si tous les comptes ont echoue (token mort...), on ne met pas en cache une liste vide :
  // la home garde sa liste de secours et on reessaie a la prochaine visite.
  if (errors && errors === results.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ items: [], error: 'unavailable' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=86400');
  return res.status(200).json({ updated_at: new Date().toISOString(), items: items.slice(0, CONF.max_items || 8) });
}
