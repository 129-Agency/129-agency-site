// GET /api/sources — alimente le selecteur de source de l'ecran interne.
import { sources, requireAdmin } from './_meta.js';

export default function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });
  const out = {};
  for (const [k, v] of Object.entries(sources())) {
    out[k] = { label: v.label, currency: v.currency, configured: Boolean(v.ad_account_id) };
  }
  return res.status(200).json({ sources: out });
}
