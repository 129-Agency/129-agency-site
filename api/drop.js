// /api/drop   (public — protégé par le lien signé du mail de confirmation client)
//
// Le client ajoute des assets à sa campagne sans compte Google : les fichiers partent dans le
// dossier Drive de la Campagne (champ « Dossier Drive »), par le même relais d'upload que le
// formulaire (/api/onboarding-chunk). Le dossier reste privé.
//
//   GET  ?t=…                          -> { artist, title, client } pour afficher la page
//   POST { action:'start', t, files }  -> une session d'upload Drive + un jeton signé par fichier
//   POST { action:'finish', submission, uploaded, note }
//                                      -> trace dans les Notes de la Campagne + mail « New assets »
//                                         à Antoine et Sacha. Un échec du mail ne bloque pas le client.

import { T, F, get, update } from './_airtable.js';
import { readDrop, readUpload, signUpload, readJson, clean } from './_onboarding.js';
import { startResumable, driveConfigured, folderIdFrom } from './_google.js';
import { notifyDrop } from './_notify.js';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 5 * 1024 ** 3;

async function campaignFor(c) {
  const campaign = await get(T.campagnes, c).catch(() => null);
  if (!campaign) throw Object.assign(new Error('This campaign no longer exists. Contact your 129 team.'), { status: 404 });
  const cf = campaign.fields || {};
  const folderId = folderIdFrom(cf[F.campagne.driveFolder]);
  return { campaign, cf, folderId };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const p = readDrop(req.query?.t);
      const { cf, folderId } = await campaignFor(p.c);
      if (!folderId || !driveConfigured()) return res.status(409).json({ error: 'Uploads aren’t open for this campaign yet. Reply to your 129 confirmation email with a link to your files.' });
      const compteId = (cf[F.campagne.compte] || [])[0];
      const compte = compteId ? await get(T.comptes, compteId).catch(() => null) : null;
      return res.status(200).json({
        artist: clean(cf[F.campagne.artist], 200),
        title: clean(cf[F.campagne.trackName], 200),
        client: clean(compte?.fields?.[F.compte.name], 160),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only.' });
    const b = await readJson(req, 200_000);

    if (b.action === 'start') {
      const p = readDrop(b.t);
      const files = Array.isArray(b.files) ? b.files : [];
      if (!files.length) return res.status(400).json({ error: 'Add at least one file.' });
      if (files.length > MAX_FILES) return res.status(400).json({ error: `${MAX_FILES} files at most per upload. Send the rest in a second round.` });
      for (const f of files) {
        if (!clean(f.name) || !(Number(f.size) > 0) || Number(f.size) > MAX_FILE_BYTES) {
          return res.status(400).json({ error: `Invalid file: ${clean(f.name, 80) || '(no name)'} (5 GB max per file).` });
        }
      }
      const { campaign, folderId } = await campaignFor(p.c);
      if (!folderId || !driveConfigured()) return res.status(409).json({ error: 'Uploads aren’t open for this campaign yet.' });

      const uploads = await mapLimit(files, 6, async (f, i) => {
        const session = await startResumable({ name: clean(f.name, 200), mimeType: clean(f.type, 120), size: Number(f.size), parentId: folderId });
        return { index: i, token: signUpload({ u: session, c: campaign.id, s: Number(f.size) }) };
      });
      return res.status(200).json({ ok: true, uploads, submission: signUpload({ c: campaign.id, drop: true }, 24 * 3600) });
    }

    if (b.action === 'finish') {
      let p;
      try { p = readUpload(b.submission); } catch (e) { return res.status(403).json({ error: e.message }); }
      if (!p.drop || !/^rec[A-Za-z0-9]{14}$/.test(String(p.c || ''))) return res.status(403).json({ error: 'Invalid upload.' });
      const { campaign, cf } = await campaignFor(p.c);
      const uploaded = (Array.isArray(b.uploaded) ? b.uploaded : []).slice(0, MAX_FILES).map(f => ({ name: clean(f.name, 200), ok: Boolean(f.ok) }));
      const note = clean(b.note, 2000);
      const failed = uploaded.filter(f => !f.ok).length;
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const recap = `\n\n[Dépôt client ${stamp} UTC] ${uploaded.length - failed} fichier(s) ajouté(s)${failed ? `, ${failed} en échec` : ''} :\n`
        + uploaded.map(f => `- ${f.name}${f.ok ? '' : ' (ÉCHEC)'}`).join('\n')
        + (note ? `\nMessage : ${note}` : '');
      let notes = (String(cf[F.campagne.notes] || '') + recap).trim().slice(0, 90000);
      const mail = await notifyDrop({ campaignId: campaign.id, uploaded, note });
      if (!mail.ok) {
        console.error('[drop] mail', mail.error);
        notes = `${notes}\n⚠ mail « New assets » non envoyé : ${mail.error}`.slice(0, 90000);
      }
      await update(T.campagnes, campaign.id, { [F.campagne.notes]: notes });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[drop]', e);
    return res.status(500).json({ error: 'Server error. Try again in a few minutes; if it persists, reply to your 129 email.', detail: e.message });
  }
}

async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}
