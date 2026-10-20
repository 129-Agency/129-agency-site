// POST /api/onboarding-finish   (public — lien client ?k=)
//
// Clôture la soumission : artwork copié dans Airtable (Track + Campagne, pour la
// prévisualisation dans le generator), récapitulatif des fichiers reçus dans les notes.
// Les fichiers maîtres restent sur Drive.

import { T, F, get, update, uploadAttachment } from './_airtable.js';
import { compteFromKey, readJson, clean } from './_onboarding.js';

const IMG = ['image/jpeg', 'image/png', 'image/webp'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });

  let b;
  try { b = await readJson(req, 4_400_000); } catch (e) { return res.status(e.status || 400).json({ error: 'Unreadable request.' }); }

  try {
    const compte = await compteFromKey(b.k);
    if (!compte) return res.status(403).json({ error: 'Invalid form link.' });
    if (!/^rec[A-Za-z0-9]{14}$/.test(String(b.campaignId || ''))) return res.status(400).json({ error: 'Unknown campaign.' });

    const campaign = await get(T.campagnes, b.campaignId);
    if (!(campaign.fields[F.campagne.compte] || []).includes(compte.id)) {
      return res.status(403).json({ error: 'This campaign does not belong to this client.' });
    }
    const trackId = (campaign.fields[F.campagne.track] || [])[0];

    const warnings = [];
    const a = b.artwork;
    if (a && IMG.includes(a.contentType) && typeof a.base64 === 'string') {
      const payload = { contentType: a.contentType, filename: clean(a.filename, 150) || 'artwork', base64: a.base64 };
      try {
        await uploadAttachment(campaign.id, F.campagne.artwork, payload);
        if (trackId) await uploadAttachment(trackId, F.track.artwork, payload);
      } catch (e) { warnings.push('artwork Airtable : ' + e.message); }
    } else if (a) {
      warnings.push('artwork non copié dans Airtable (format ou taille) : il reste disponible sur Drive');
    }

    const received = (Array.isArray(b.uploaded) ? b.uploaded : []).map(f => `- ${clean(f.name, 200)}${f.ok ? '' : ' (ÉCHEC)'}`);
    const failed = (b.uploaded || []).filter(f => !f.ok).length;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const prev = campaign.fields[F.campagne.notes] || '';
    const recap = `\n\n[Formulaire ${stamp} UTC] ${received.length} fichier(s) envoyé(s)${failed ? `, ${failed} en échec` : ''} :\n${received.join('\n')}`
      + (warnings.length ? `\n${warnings.map(w => '⚠ ' + w).join('\n')}` : '');
    await update(T.campagnes, campaign.id, { [F.campagne.notes]: (prev + recap).trim().slice(0, 90000) });

    return res.status(200).json({ ok: true, warnings });
  } catch (e) {
    console.error('[onboarding-finish]', e);
    return res.status(500).json({ error: 'Server error while closing the submission. Let 129 know the track title.', detail: e.message });
  }
}
