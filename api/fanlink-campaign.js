// GET /api/fanlink-campaign            -> file des campagnes à traiter
// GET /api/fanlink-campaign?id=recXXX  -> une campagne + sa track + les ad accounts, pour préremplir le generator
// Header requis : Authorization: Bearer <TOOLS_PASSWORD>

import { requireAdmin } from './_meta.js';
import { T, F, FN, find, get, q } from './_airtable.js';
import { templateDefaults, writeTokenName } from './_metawrite.js';

const one = (v) => Array.isArray(v) ? v[0] : v;
const nameOf = (v) => (v && typeof v === 'object') ? v.name : v;

export async function adAccounts() {
  const rows = await find(T.adAccounts, 'TRUE()', { maxRecords: 50 });
  return rows.map(r => ({
    id: r.id,
    name: r.fields[F.adAccount.name] || '',
    metaId: r.fields[F.adAccount.metaId] || '',
    currency: nameOf(r.fields[F.adAccount.currency]) || '',
    pixelId: r.fields[F.adAccount.pixelId] || '',
    prefix: r.fields[F.adAccount.slugPrefix] || '',
    status: nameOf(r.fields[F.adAccount.status]) || '',
  }));
}

async function compteNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = await find(T.comptes, `OR(${uniq.map(id => `RECORD_ID()=${q(id)}`).join(',')})`, {
    maxRecords: 100, fields: [F.compte.name],
  });
  return Object.fromEntries(rows.map(r => [r.id, r.fields[F.compte.name] || '']));
}

function parseBeatport(other) {
  const m = String(other || '').match(/beatport\s*:\s*(\S+)/i);
  return m ? m[1] : '';
}

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  try {
    if (!req.query.id) {
      const C = F.campagne;
      const formula = `AND(${FN.campTrack} != '', OR(${FN.campFanlinkStatus} = 'À générer', ${FN.campFanlinkStatus} = 'Prompt envoyé', ${FN.campMetaStatus} = 'Erreur', ${FN.campMetaStatus} = 'À créer'))`;
      const rows = await find(T.campagnes, formula, { maxRecords: 100 });
      const names = await compteNames(rows.map(r => one(r.fields[C.compte])));
      const items = rows.map(r => ({
        id: r.id,
        name: r.fields[C.name] || '',
        compte: names[one(r.fields[C.compte])] || '',
        declared: r.fields[C.declaredIdentity] || '',
        fanlinkStatus: nameOf(r.fields[C.fanlinkStatus]) || '',
        metaStatus: nameOf(r.fields[C.metaStatus]) || '',
        releaseDate: r.fields[C.releaseDate] || null,
        createdTime: r.createdTime,
      })).sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
      return res.status(200).json({ items });
    }

    const id = String(req.query.id);
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ error: 'ID campagne invalide.' });
    const c = await get(T.campagnes, id);
    const cf = c.fields, C = F.campagne;
    const trackId = one(cf[C.track]);
    const t = trackId ? (await get(T.tracks, trackId)).fields : {};
    const R = F.track;
    const names = await compteNames([one(cf[C.compte])]);
    const art = one(t[R.artwork]) || one(cf[C.artwork]) || null;

    return res.status(200).json({
      campaign: {
        id: c.id,
        name: cf[C.name] || '',
        compteId: one(cf[C.compte]) || null,
        compteName: names[one(cf[C.compte])] || '',
        budgetRequested: cf[C.budgetRequested] ?? null,
        currency: nameOf(cf[C.currency]) || '',
        objective: cf[C.objective] || '',
        territories: cf[C.territories] || '',
        parallelActions: (cf[C.parallelActions] || []).map(nameOf),
        pageIgFb: cf[C.pageIgFb] || '',
        notes: cf[C.notes] || '',
        driveFolder: cf[C.driveFolder] || '',
        clientFilesLink: cf[C.clientFilesLink] || '',
        pageAccess: cf[C.pageAccess] || '',
        declaredIdentity: cf[C.declaredIdentity] || '',
        startDate: cf[C.startDate] || null,
        adAccountId: one(cf[C.adAccount]) || null,
        moodTags: (cf[C.moodTags] || []).map(nameOf),
        trackingMeta: cf[C.trackingMeta] ?? null,
        slug: cf[C.slug] || '',
        fanlinkStatus: nameOf(cf[C.fanlinkStatus]) || '',
        metaStatus: nameOf(cf[C.metaStatus]) || '',
        campaignIdExplore: cf[C.campaignIdExplore] || '',
        campaignIdScale: cf[C.campaignIdScale] || '',
      },
      track: {
        id: trackId || null,
        key: t[R.key] || '',
        artist: t[R.artist] || cf[C.artist] || '',
        featuring: t[R.featuring] || '',
        title: t[R.title] || cf[C.trackName] || '',
        releaseType: nameOf(t[R.releaseType]) || 'Single',
        releaseDate: t[R.releaseDate] || cf[C.releaseDate] || '',
        genre: nameOf(t[R.genre]) || '',
        language: nameOf(t[R.language]) || '',
        isrc: t[R.isrc] || '',
        dsp: {
          spotify: t[R.spotifyUrl] || cf[C.spotifyUrl] || '',
          apple_music: t[R.appleUrl] || '',
          deezer: t[R.deezerUrl] || '',
          amazon_music: t[R.amazonUrl] || '',
          youtube: t[R.youtubeUrl] || '',
          beatport: parseBeatport(t[R.otherDsp]),
        },
        artwork: art ? { url: art.url, filename: art.filename, type: art.type } : null,
      },
      adAccounts: await adAccounts(),
      metaDefaults: templateDefaults(),
      metaTokenVar: writeTokenName(),
    });
  } catch (e) {
    console.error('[fanlink-campaign]', e);
    return res.status(500).json({ error: e.message });
  }
}
