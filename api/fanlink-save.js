// POST /api/fanlink-save   (header Authorization: Bearer <TOOLS_PASSWORD>)
//
// Le bouton du formulaire privé. En un clic :
//   1. valide et construit l'entrée fanlink + le prompt Lovable ;
//   2. réécrit Track et Campagne dans Airtable (ad account, slug, mood tags, liens DSP...) ;
//   3. si demandé, crée chez Meta EXPLORE + SCALE (campagne + ad set) EN PAUSE, et réécrit les IDs.

import { requireAdmin } from './_meta.js';
import { T, F, get, update } from './_airtable.js';
import { buildRelease, releasePrompt, setupPrompt, normalizeDspUrl, MOODS } from './_fanlink.js';
import { createCampaigns } from './_metawrite.js';
import { adAccounts } from './fanlink-campaign.js';
import { readJson } from './_onboarding.js';

const one = (v) => Array.isArray(v) ? v[0] : v;
const RELEASE_TYPES = ['Single', 'EP', 'Album', 'Compilation'];
const GENRES = ['afro_house', 'afrobeat', 'dance', 'deep_house', 'downtempo', 'house', 'indie_dance',
  'melodic_techno', 'organic_house', 'pop', 'progressive', 'slap_house'];
const LANGS = ['en', 'fr', 'es', 'pt', 'de', 'it', 'instrumental'];

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement.' });

  try {
    const b = await readJson(req);
    if (!/^rec[A-Za-z0-9]{14}$/.test(String(b.campaignId || ''))) return res.status(400).json({ error: 'Campagne inconnue.' });

    const campaign = await get(T.campagnes, b.campaignId);
    const cf = campaign.fields, C = F.campagne;
    const trackId = one(cf[C.track]);
    if (!trackId) return res.status(400).json({ error: 'Cette campagne n\'a pas de Track liée.' });
    const track = await get(T.tracks, trackId);

    const accounts = await adAccounts();
    const acc = accounts.find(a => a.id === b.adAccountId);
    if (!acc) return res.status(400).json({ error: 'Choisis un ad account.' });
    const missing = [!acc.metaId && 'ID compte Meta', !acc.pixelId && 'Pixel ID', !acc.prefix && 'Préfixe slug'].filter(Boolean);
    if (missing.length) return res.status(400).json({ error: `Ad account « ${acc.name} » incomplet dans Airtable : ${missing.join(', ')}.` });

    const t = b.track || {};
    const slug = String(b.slug || '').trim().toLowerCase();
    if (!slug.startsWith(acc.prefix.toLowerCase() + '/')) {
      return res.status(400).json({ error: `Le slug doit commencer par « ${acc.prefix}/ » pour l'ad account ${acc.name} (sinon le fanlink part sur le mauvais pixel).` });
    }
    if (!RELEASE_TYPES.includes(t.releaseType)) return res.status(400).json({ error: 'Type de sortie invalide.' });
    if (t.genre && !GENRES.includes(t.genre)) return res.status(400).json({ error: 'Genre invalide.' });
    if (t.language && !LANGS.includes(t.language)) return res.status(400).json({ error: 'Langue invalide.' });

    const moodTags = (b.moodTags || []).filter(m => MOODS.includes(m));
    const compteName = await (async () => {
      const id = one(cf[C.compte]);
      if (!id) return '';
      return (await get(T.comptes, id)).fields[F.compte.name] || '';
    })();

    const { release, errors, artworkFile } = buildRelease({
      slug, artist: t.artist, featuring: t.featuring, title: t.title,
      releaseType: t.releaseType, releaseDate: t.releaseDate, genre: t.genre, language: t.language,
      moodTags, label: compteName || acc.name, artworkExt: b.artworkExt,
      trackingMeta: b.trackingMeta !== false, dsps: b.dsps,
    });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    // --- Airtable : Track ----------------------------------------------------
    const dsp = Object.fromEntries((b.dsps || []).map(d => [d.key, d.enabled === false ? null : normalizeDspUrl(d.key, d.url)]));
    const R = F.track;
    const otherPrev = String(track.fields[R.otherDsp] || '').split('\n').filter(l => !/^\s*beatport\s*:/i.test(l));
    if (dsp.beatport) otherPrev.unshift(`Beatport: ${dsp.beatport}`);
    const trackFields = {
      [R.artist]: String(t.artist || '').trim(),
      [R.featuring]: String(t.featuring || '').trim(),
      [R.title]: String(t.title || '').trim(),
      [R.releaseType]: t.releaseType,
      [R.spotifyUrl]: dsp.spotify || null,
      [R.appleUrl]: dsp.apple_music || null,
      [R.deezerUrl]: dsp.deezer || null,
      [R.amazonUrl]: dsp.amazon_music || null,
      [R.youtubeUrl]: dsp.youtube || null,
      [R.otherDsp]: otherPrev.join('\n').trim(),
      [R.dspStatus]: dsp.spotify && dsp.apple_music ? 'Complet' : 'En attente',
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(t.releaseDate || ''))) trackFields[R.releaseDate] = t.releaseDate;
    if (t.genre) trackFields[R.genre] = t.genre;
    if (t.language) trackFields[R.language] = t.language;
    const sid = (dsp.spotify || '').match(/track\/([A-Za-z0-9]{22})/);
    if (sid) trackFields[R.spotifyId] = sid[1];
    await update(T.tracks, trackId, trackFields);

    // --- Airtable : Campagne ---------------------------------------------------
    await update(T.campagnes, campaign.id, {
      [C.adAccount]: [acc.id],
      [C.metaAccount]: acc.metaId,
      [C.moodTags]: moodTags,
      [C.trackingMeta]: b.trackingMeta !== false,
      [C.slug]: slug,
      [C.fanlinkUrl]: `https://fanlinkhub.com/${slug}`,
      [C.fanlinkStatus]: 'Prompt envoyé',
      [C.spotifyUrl]: dsp.spotify || null,
    });

    const prompt = releasePrompt({ release, artworkFile, prefix: acc.prefix, pixelId: acc.pixelId, adAccountName: acc.name });

    // --- Meta (optionnel) ------------------------------------------------------------
    let meta = null;
    if (b.meta?.create) {
      const budgets = {
        explore: Number(b.meta.explore), scale: Number(b.meta.scale), costCap: Number(b.meta.costCap),
      };
      if (!(budgets.explore > 0) || !(budgets.scale > 0) || !(budgets.costCap > 0)) {
        return res.status(400).json({ error: 'Budgets / cost cap Meta invalides.', prompt });
      }
      const key = track.fields[R.key] || slug;
      meta = await createCampaigns({
        adAccountId: acc.metaId,
        pixelId: acc.pixelId,
        artistTitle: `${release.artist} - ${release.title}`,
        key,
        budgets,
        existing: { explore: cf[C.campaignIdExplore] || null, scale: cf[C.campaignIdScale] || null },
      });
      const ok = !meta.errors.length && meta.explore?.campaignId && meta.scale?.campaignId;
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const lines = [`[Meta ${stamp} UTC] compte ${acc.metaId}`];
      for (const role of ['explore', 'scale']) {
        const r = meta[role];
        if (r && !r.skipped) lines.push(`${role.toUpperCase()} : campagne ${r.campaignId}${r.adsetId ? `, ad set ${r.adsetId}` : ''} (en pause)`);
      }
      lines.push(...meta.errors.map(e => '⚠ ' + e), ...meta.notes.map(n => 'ℹ ' + n));
      const fields = {
        [C.metaStatus]: ok ? 'Créée en pause' : 'Erreur',
        [C.notes]: ((cf[C.notes] || '') + '\n\n' + lines.join('\n')).trim().slice(0, 90000),
      };
      if (meta.explore?.campaignId) fields[C.campaignIdExplore] = meta.explore.campaignId;
      if (meta.scale?.campaignId) fields[C.campaignIdScale] = meta.scale.campaignId;
      if (ok && !cf[C.status]) fields[C.status] = 'Setup';
      if (ok && cf[C.status] === 'Brief') fields[C.status] = 'Setup';
      await update(T.campagnes, campaign.id, fields);
    }

    return res.status(200).json({
      ok: true,
      prompt,
      artworkFile,
      url: `https://fanlinkhub.com/${slug}`,
      setupPrompt: setupPrompt({ name: acc.name, prefix: acc.prefix, pixelId: acc.pixelId }),
      meta,
    });
  } catch (e) {
    console.error('[fanlink-save]', e);
    return res.status(500).json({ error: e.message });
  }
}
