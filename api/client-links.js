// GET  /api/client-links            -> clients et leur lien de formulaire
// POST /api/client-links {id}       -> génère le jeton du client s'il n'en a pas, renvoie le lien
// Header requis : Authorization: Bearer <ADMIN_SECRET>
//
// Le lien porte le « Token dashboard » du compte (UUID aléatoire, jamais le Record ID).
// PUBLIC_FORM_BASE (optionnel) : URL publique du formulaire, ex. https://129agency.com/onboarding.

import crypto from 'crypto';
import { requireAdmin } from './_meta.js';
import { T, F, FN, find, get, update } from './_airtable.js';
import { readJson } from './_onboarding.js';

function base(req) {
  if (process.env.PUBLIC_FORM_BASE) return process.env.PUBLIC_FORM_BASE.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/onboarding`;
}

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  try {
    if (req.method === 'GET') {
      const rows = await find(T.comptes, `${FN.compteStatut} != 'Perdu'`, { maxRecords: 200 });
      const items = rows.map(r => ({
        id: r.id,
        name: r.fields[F.compte.name] || '(sans nom)',
        hasAdAccount: Boolean(r.fields[F.compte.defaultAdAccount]?.length),
        link: r.fields[F.compte.token] ? `${base(req)}?k=${r.fields[F.compte.token]}` : null,
      })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { id } = await readJson(req);
      if (!/^rec[A-Za-z0-9]{14}$/.test(String(id || ''))) return res.status(400).json({ error: 'Compte inconnu.' });
      const rec = await get(T.comptes, id);
      let tok = rec.fields[F.compte.token];
      if (!tok) {
        tok = crypto.randomUUID();
        await update(T.comptes, id, { [F.compte.token]: tok });
      }
      return res.status(200).json({ link: `${base(req)}?k=${tok}` });
    }

    return res.status(405).json({ error: 'GET ou POST.' });
  } catch (e) {
    console.error('[client-links]', e);
    return res.status(500).json({ error: e.message });
  }
}
