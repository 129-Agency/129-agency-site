// GET /api/sign?c=<ids>&t=<titre>&source=<cle>
// Genere le lien client signe. Header requis : Authorization: Bearer <ADMIN_SECRET>
// Le secret ne transite jamais en query string, contrairement a la v1 ERA.

import { requireAdmin, sign, resolveSource } from './_meta.js';

export default function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  const ids = String(req.query.c || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length || ids.length > 6 || ids.some(id => !/^\d{5,25}$/.test(id))) {
    return res.status(400).json({ error: 'Sélectionne entre 1 et 6 campagnes.' });
  }
  try { resolveSource(req.query.source); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const c = ids.join(',');
  const t = String(req.query.t || '').slice(0, 120);
  const source = String(req.query.source);
  const sig = sign(`${c}|${t}|${source}`);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}/client-report?c=${encodeURIComponent(c)}&t=${encodeURIComponent(t)}&s=${encodeURIComponent(source)}&sig=${sig}`;

  return res.status(200).json({ url });
}
