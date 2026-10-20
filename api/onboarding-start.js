// POST /api/onboarding-start   (public — lien générique /onboarding, ou lien prérempli ?k=)
//
// 1. Identifie le client : jeton ?k= si présent, sinon email -> Contact -> Compte.
//    Email inconnu : la campagne est créée sans Compte, marquée « à vérifier ».
// 2. Crée le dossier Drive de la campagne (si Google est configuré).
// 3. Crée (ou réutilise, à ISRC égal) la fiche Track, puis la fiche Campagne.
// 4. Ouvre une session d'upload Drive par fichier et renvoie un jeton signé par fichier,
//    plus un jeton de soumission pour /api/onboarding-finish.

import { T, F, FN, find, create, q, slugify } from './_airtable.js';
import { ensureFolder, rootFolderId, startResumable, driveConfigured } from './_google.js';
import { identify, signUpload, readJson, clean, cleanUrl, spotifyIdFrom } from './_onboarding.js';

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
    // --- Validation -------------------------------------------------------
    const who = b.identity || {}, t = b.track || {}, c = b.campaign || {};
    const idName = clean(who.name, 120), idEmail = clean(who.email, 200).toLowerCase(), idCompany = clean(who.company, 160);
    const artist = clean(t.artist, 200), title = clean(t.title, 200);
    const errors = [];
    if (!idName) errors.push('Your name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(idEmail)) errors.push('Your email');
    if (!idCompany) errors.push('Label / company');
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

    const drive = driveConfigured();
    const filesLink = cleanUrl(c.filesLink);
    // Sans Drive, seuls les métadonnées et l'artwork (inline, copié dans Airtable) passent.
    const files = drive && Array.isArray(b.files) ? b.files : [];
    if (files.length > MAX_FILES) errors.push(`Maximum ${MAX_FILES} files`);
    if (!b.hasArtwork && !filesLink) errors.push('Artwork (or a link to your files)');
    for (const f of files) {
      if (!KIND_FOLDER[f.kind] || !clean(f.name) || !(Number(f.size) > 0) || Number(f.size) > MAX_FILE_BYTES) {
        errors.push(`Invalid file: ${clean(f.name, 80) || '(no name)'}`);
      }
    }
    if (errors.length) return res.status(400).json({ error: 'Missing or invalid: ' + errors.join(', ') + '.' });

    // --- Identification --------------------------------------------------------
    const { compte, contact } = await identify({ k: b.k, email: idEmail });
    const cf = compte?.fields || {};
    const declared = `${idName} — ${idEmail} — ${idCompany}`;

    // --- Clé track ---------------------------------------------------------
    const clientSlug = slugify(cf[F.compte.slug] || cf[F.compte.name] || idCompany) || 'client';
    const trackKey = `${clientSlug}/${slugify(`${artist} ${title}`)}`;

    // --- Drive ---------------------------------------------------------------
    let campaignFolder = null;
    const sub = {};
    if (drive) {
      const clientFolderName = compte ? (clean(cf[F.compte.name], 120) || clientSlug) : `À vérifier — ${idCompany}`;
      const clientFolder = await ensureFolder(clientFolderName, rootFolderId());
      const today = new Date().toISOString().slice(0, 10);
      campaignFolder = await ensureFolder(`${today} ${artist} - ${title}`, clientFolder.id);
      for (const kind of new Set(files.map(f => f.kind))) {
        const name = KIND_FOLDER[kind];
        sub[name] = sub[name] || await ensureFolder(name, campaignFolder.id);
      }
    }

    // --- Track (réutilisée si même ISRC) ------------------------------------------
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
        [F.track.releaseType]: t.releaseType,
        [F.track.releaseDate]: t.releaseDate,
        [F.track.genre]: t.genre,
        [F.track.language]: t.language,
        [F.track.key]: trackKey,
        [F.track.dspStatus]: 'En attente',
        [F.track.discoveryMode]: t.discoveryMode === 'oui',
      };
      if (compte) tf[F.track.compte] = [compte.id];
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
    const today = new Date().toISOString().slice(0, 10);
    const warn = compte ? '' : '⚠ Client non reconnu (email absent des Contacts) : rattacher cette campagne et sa Track à un Compte avant de lancer.\n\n';
    const cfields = {
      [F.campagne.name]: `${artist} - ${title}`,
      [F.campagne.track]: [trackRec.id],
      [F.campagne.status]: 'Brief',
      [F.campagne.context]: compte ? 'Client existant' : 'Nouveau client',
      [F.campagne.type]: t.releaseDate < today ? 'Catalogue' : 'Release',
      [F.campagne.artist]: artist,
      [F.campagne.trackName]: title,
      [F.campagne.releaseDate]: t.releaseDate,
      [F.campagne.currency]: currency,
      [F.campagne.budgetRequested]: budget,
      [F.campagne.fanlinkStatus]: 'À générer',
      [F.campagne.metaStatus]: 'À créer',
      [F.campagne.declaredIdentity]: declared,
    };
    const copt = {
      [F.campagne.driveFolder]: campaignFolder?.webViewLink,
      [F.campagne.clientFilesLink]: filesLink,
      [F.campagne.spotifyUrl]: spotifyUrl,
      [F.campagne.objective]: clean(c.objective, 200),
      [F.campagne.territories]: clean(c.territories, 1000),
      [F.campagne.pageIgFb]: clean(c.pageIgFb, 300),
      [F.campagne.notes]: (warn + clean(c.notes, 4000)).trim(),
      [F.campagne.startDate]: /^\d{4}-\d{2}-\d{2}$/.test(String(c.startDate || '')) ? c.startDate : null,
      [F.campagne.parallelActions]: actions.length ? actions : null,
    };
    for (const [k, v] of Object.entries(copt)) if (v) cfields[k] = v;
    if (compte) {
      cfields[F.campagne.compte] = [compte.id];
      if (cf[F.compte.defaultAdAccount]?.length) cfields[F.campagne.adAccount] = cf[F.compte.defaultAdAccount];
    }
    if (contact) cfields[F.campagne.submittedBy] = [contact.id];
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

    return res.status(200).json({
      ok: true,
      campaignId: campaign.id,
      submission: signUpload({ c: campaign.id, finish: true }, 24 * 3600),
      drive,
      recognized: Boolean(compte),
      uploads,
    });
  } catch (e) {
    console.error('[onboarding-start]', e);
    return res.status(500).json({ error: 'Server error. Try again in a few minutes; if it persists, let 129 know.', detail: e.message });
  }
}
