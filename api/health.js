// GET /api/health  (header Authorization: Bearer <TOOLS_PASSWORD>)
// Diagnostic complet : dit lequel des trois problemes possibles tu as,
// au lieu de te laisser deviner entre "token mort" et "compte desactive".

import { graph, sources, requireAdmin, API_VERSION } from './_meta.js';

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  const out = { api_version: API_VERSION, checked_at: new Date().toISOString() };

  // 1. Le token repond-il seulement ?
  try {
    const me = await graph('me', { fields: 'id,name' });
    out.token = { ok: true, identity: me.name || me.id };
  } catch (e) {
    out.token = { ok: false, message: e.message, meta_code: e.metaCode || null };
    if (e.metaCode === 190) {
      out.token.diagnostic = 'Token invalide ou expire. Signature typique d\'un token utilisateur : regenerer un token System User.';
    }
    return res.status(200).json(out); // inutile de tester les comptes
  }

  // 2. Chaque source repond-elle, et dans quel etat est le compte ?
  const STATUS = {
    1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED (solde impaye)',
    7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD',
    100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED',
  };
  out.sources = [];
  for (const [key, src] of Object.entries(sources())) {
    if (!src.ad_account_id) {
      out.sources.push({ key, label: src.label, ok: false, message: 'ad_account_id non renseigne dans config/sources.json' });
      continue;
    }
    try {
      const acc = await graph(`act_${src.ad_account_id}`, {
        fields: 'name,account_status,disable_reason,currency,amount_spent',
      });
      const status = STATUS[acc.account_status] || `code ${acc.account_status}`;
      out.sources.push({
        key, label: src.label, ok: acc.account_status === 1,
        account_name: acc.name, account_status: status,
        disable_reason: acc.disable_reason ?? null, currency: acc.currency,
        diagnostic: acc.account_status === 1 ? null
          : 'Le compte publicitaire lui-meme bloque la lecture. Ce n\'est pas un probleme de token.',
      });
    } catch (e) {
      out.sources.push({
        key, label: src.label, ok: false,
        message: e.message, meta_code: e.metaCode || null,
        diagnostic: e.metaCode === 200 || e.metaCode === 272
          ? 'Token valide mais sans permission ads_read sur ce compte : partager le compte avec le System User dans le Business Manager.'
          : null,
      });
    }
  }

  out.ok = out.token.ok && out.sources.every(s => s.ok);
  return res.status(200).json(out);
}
