// POST /api/onboarding-start   (public — protégé par le lien client ?k=<Token dashboard>)
//
// 1. Résout le client par son jeton.
// 2. Crée le dossier Drive de la campagne (Client / AAAA-MM-JJ Artiste - Titre / Audio, Vidéos, Visuels).
// 3. Crée (ou réutilise, à ISRC égal) la fiche Track, puis la fiche Campagne.
// 4. Ouvre une session d'upload Drive par fichier et renvoie un jeton signé par fichier.
//
// Les fichiers eux-mêmes passent ensuite par /api/onboarding-chunk.

import { T, F, FN, find, create, q, slugify } from './_airtable.js';
import { ensureFolder, rootFolderId, startResumable } from './_google.js';
import { compteFromKey, signUpload, readJson, clean, cleanUrl, spotifyIdFrom } from './_onboarding.js';

const RELEASE_TYPES = ['Single', 'EP', 'Album', 'Compilation'];
const GENRES = ['afro_house', 'afrobeat', 'dance', 'deep_house', 'downtempo', 'house', 'indie_dance',
  'melodic_techno', 'organic_house', 'pop', 'progressive', 'slap_house'];
const LANGS = ['en', 'fr', 'es', 'pt', 'de', 'it', 'instrumental'];
const CURRENCIES = ['EUR', 'USD', 'GBP'];
const ACTIONS = ['Radio', 'Pitch playlist éditorial', 'Playlists tierces', 'TikTok / UGC', 'Influence',
  'Presse', 'Autre agence ads', 'Aucune'];
const KIND_FOLDER = { audio: 'Audio', video: 'Vidéos', visual: 'Visuels', artwork: 'Visuels' };
const MAX_FILES = 40;
const MAX_FILE_BYTES = 5 * 1024 ** 3;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });

  let b;
  try { b = await readJson(req); } catch (e) { return res.status(e.status || 400).json({ error: 'Unreadable request.' }); }

  try {
    const compte = await compteFromKey(b.k);
    if (!compte) return res.status(403).json({ error: 'Invalid form link. Ask 129 for a new one.' });
    const cf = compte.fields;

    // --- Validation -------------------------------------------------------
    const t = b.track || {}, c = b.campaign || {};
    const artist = clean(t.artist, 200), title = clean(t.title, 200);
    const errors = [];
    if (!artist) errors.push('Artist');
    if (!title) errors.push('Title');
    if (!RELEASE_TYPES.includes(t.releaseType)) errors.push('Release type');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.releaseDate || ''))) errors.push('Release date');
    if (!GENRES.includes(t.genre)) errors.push('Genre');
    if (!LANGS.includes(t.language)) errors.push('Language');
    const budget = Number(c.budget);
    if (!Number.isFinite(budget) || budget <= 0) errors.push('Budget');
    const currency = CURRENCIES.includes(c.currency) ? c.currency : null;
    if (!currency) errors.push('Currency');

    const files = Array.isArray(b.files) ? b.files : [];
    if (files.length > MAX_FILES) errors.push(`Maximum ${MAX_FILES} files`);
    if (!files.some(f => f.kind === 'artwork')) errors.push('Artwork');
    for (const f of files) {
      if (!KIND_FOLDER[f.kind] || !clean(f.name) || !(Number(f.size) > 0) || Number(f.size) > MAX_FILE_BYTES) {
        errors.push(`Invalid file: ${clean(f.name, 80) || '(no name)'}`);
      }
    }
    if (errors.length) return res.status(400).json({ error: 'Missing or invalid: ' + errors.join(', ') + '.' });

    // --- Clé track ---------------------------------------------------------
    const clientSlug = slugify(cf[F.compte.slug] || cf[F.compte.name]);
    const trackKey = `${clientSlug}/${slugify(`${artist} ${title}`)}`;

    // --- Drive ---------------------------------------------------------------
    const clientFolder = await ensureFolder(clean(cf[F.compte.name], 120) || clientSlug, rootFolderId());
    const today = new Date().toISOString().slice(0, 10);
    const campaignFolder = await ensureFolder(`${today} ${artist} - ${title}`, clientFolder.id);
    const sub = {};
    for (const kind of new Set(files.map(f => f.kind))) {
      const name = KIND_FOLDER[kind];
      sub[name] = sub[name] || await ensureFolder(name, campaignFolder.id);
    }

    // --- Track (réutilisée si même ISRC chez ce client) ------------------------
    const isrc = clean(t.isrc, 15).toUpperCase().replace(/[^A-Z0-9]/g, '');
    let trackRec = null;
    if (isrc) {
      const hits = await find(T.tracks, `${FN.trackIsrc} = ${q(isrc)}`, { maxRecords: 1 });
      trackRec = hits[0] || null;
    }
    const spotifyUrl = cleanUrl(t.spotifyUrl);
    if (!trackRec) {
      const tf = {
        [F.track.title]: title,
        [F.track.artist]: artist,
        [F.track.compte]: [compte.id],
        [F.track.releaseType]: t.releaseType,
        [F.track.releaseDate]: t.releaseDate,
        [F.track.genre]: t.genre,
        [F.track.language]: t.language,
        [F.track.key]: trackKey,
        [F.track.dspStatus]: 'En attente',
        [F.track.discoveryMode]: t.discoveryMode === 'oui',
      };
      const opt = {
        [F.track.featuring]: clean(t.featuring, 200),
        [F.track.isrc]: isrc,
        [F.track.upc]: clean(t.upc, 20).replace(/[^0-9]/g, ''),
        [F.track.spotifyUrl]: spotifyUrl,
        [F.track.spotifyId]: spotifyIdFrom(spotifyUrl),
        [F.track.appleUrl]: cleanUrl(t.appleUrl),
        [F.track.deezerUrl]: cleanUrl(t.deezerUrl),
        [F.track.amazonUrl]: cleanUrl(t.amazonUrl),
        [F.track.youtubeUrl]: cleanUrl(t.youtubeUrl),
        [F.track.distributor]: clean(t.distributor, 120),
      };
      for (const [k, v] of Object.entries(opt)) if (v) tf[k] = v;
      trackRec = await create(T.tracks, tf);
    }

    // --- Campagne ----------------------------------------------------------------
    const actions = (Array.isArray(c.parallelActions) ? c.parallelActions : []).filter(a => ACTIONS.includes(a));
    const isCatalogue = t.releaseDate < today;
    const cfields = {
      [F.campagne.name]: `${artist} - ${title}`,
      [F.campagne.compte]: [compte.id],
      [F.campagne.track]: [trackRec.id],
      [F.campagne.status]: 'Brief',
      [F.campagne.context]: 'Client existant',
      [F.campagne.type]: isCatalogue ? 'Catalogue' : 'Release',
      [F.campagne.artist]: artist,
      [F.campagne.trackName]: title,
      [F.campagne.releaseDate]: t.releaseDate,
      [F.campagne.currency]: currency,
      [F.campagne.budgetRequested]: budget,
      [F.campagne.driveFolder]: campaignFolder.webViewLink,
      [F.campagne.fanlinkStatus]: 'À générer',
      [F.campagne.metaStatus]: 'À créer',
    };
    const copt = {
      [F.campagne.spotifyUrl]: spotifyUrl,
      [F.campagne.objective]: clean(c.objective, 200),
      [F.campagne.territories]: clean(c.territories, 1000),
      [F.campagne.pageIgFb]: clean(c.pageIgFb, 300),
      [F.campagne.notes]: clean(c.notes, 4000),
      [F.campagne.startDate]: /^\d{4}-\d{2}-\d{2}$/.test(String(c.startDate || '')) ? c.startDate : null,
      [F.campagne.parallelActions]: actions.length ? actions : null,
    };
    for (const [k, v] of Object.entries(copt)) if (v) cfields[k] = v;
    if (cf[F.compte.defaultAdAccount]?.length) cfields[F.campagne.adAccount] = cf[F.compte.defaultAdAccount];
    const campaign = await create(T.campagnes, cfields);

    // --- Sessions d'upload ---------------------------------------------------------
    const uploads = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const folder = sub[KIND_FOLDER[f.kind]];
      const name = f.kind === 'artwork' ? `ARTWORK - ${clean(f.name, 180)}` : clean(f.name, 200);
      const session = await startResumable({ name, mimeType: clean(f.type, 120), size: Number(f.size), parentId: folder.id });
      uploads.push({ index: i, token: signUpload({ u: session, c: campaign.id, s: Number(f.size) }) });
    }

    return res.status(200).json({ ok: true, campaignId: campaign.id, trackKey, uploads });
  } catch (e) {
    console.error('[onboarding-start]', e);
    return res.status(500).json({ error: 'Server error. Try again in a few minutes; if it persists, let 129 know.', detail: e.message });
  }
}
