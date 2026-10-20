// GET /api/campaigns?source=cr2|129|all&preset=last_30d
// Overview interne. Header requis : Authorization: Bearer <ADMIN_SECRET>
//
// Renvoie, par campagne : les metriques de la periode, celles de la periode
// precedente de meme longueur, et deux signaux (derive du cout par resultat,
// fatigue de frequence). Les montants ne sont JAMAIS consolides entre devises.

import { graph, sources, resolveSource, requireAdmin, extractResults, primaryResult } from './_meta.js';
import { windows, PRESETS } from './_windows.js';

const FIELDS = 'campaign_id,spend,impressions,reach,frequency,cpm,ctr,actions';

async function insights(accountId, range) {
  const params = { level: 'campaign', fields: FIELDS, limit: '500' };
  if (range) { params['time_range'] = JSON.stringify(range); }
  else { params['date_preset'] = 'maximum'; }
  const d = await graph(`act_${accountId}/insights`, params);
  return Object.fromEntries((d.data || []).map(r => [r.campaign_id, r]));
}

function shape(row) {
  const results = extractResults(row.actions);
  const primary = primaryResult(results);
  const spend = Number(row.spend || 0);
  return {
    spend,
    impressions: Number(row.impressions || 0),
    reach: Number(row.reach || 0),
    frequency: Number(row.frequency || 0),
    cpm: Number(row.cpm || 0),
    ctr: Number(row.ctr || 0),
    results,
    result_count: primary.count,
    result_type: primary.type,
    cost_per_result: primary.count ? spend / primary.count : null,
  };
}

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  const preset = PRESETS.includes(req.query.preset) ? req.query.preset : 'last_30d';
  const w = windows(preset);
  const keys = (req.query.source && req.query.source !== 'all') ? [req.query.source] : Object.keys(sources());

  const campaigns = [];
  const problems = [];

  for (const k of keys) {
    let src;
    try { src = resolveSource(k); }
    catch (e) { problems.push({ source: k, label: sources()[k]?.label || k, message: e.message }); continue; }

    try {
      const [list, cur, prev] = await Promise.all([
        graph(`act_${src.ad_account_id}/campaigns`, {
          fields: 'id,name,status,effective_status,objective,start_time,stop_time',
          limit: '300',
        }),
        insights(src.ad_account_id, w.current),
        w.previous ? insights(src.ad_account_id, w.previous) : Promise.resolve({}),
      ]);

      for (const c of (list.data || [])) {
        const now = shape(cur[c.id] || {});
        const before = shape(prev[c.id] || {});
        if (!now.spend && !before.spend) continue; // jamais diffuse sur la fenetre

        let cpr_delta = null;
        if (now.cost_per_result && before.cost_per_result) {
          cpr_delta = (now.cost_per_result - before.cost_per_result) / before.cost_per_result;
        }

        campaigns.push({
          source: k, source_label: src.label, currency: src.currency,
          id: c.id, name: c.name,
          status: c.effective_status || c.status,
          objective: c.objective,
          start_time: c.start_time || null,
          ...now,
          cpr_delta,
          flags: [
            ...(cpr_delta !== null && cpr_delta > 0.25 ? ['cpr_up'] : []),
            ...(now.frequency > 2.5 ? ['frequency'] : []),
          ],
        });
      }
    } catch (e) {
      problems.push({ source: k, label: src.label, message: e.message, meta_code: e.metaCode || null });
    }
  }

  campaigns.sort((a, b) => b.spend - a.spend);

  // Totaux par devise. Jamais additionnes entre eux.
  const totals = {};
  for (const c of campaigns) {
    const t = totals[c.currency] ||= { currency: c.currency, spend: 0, impressions: 0, results: 0, campaigns: 0 };
    t.spend += c.spend; t.impressions += c.impressions; t.results += c.result_count; t.campaigns += 1;
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    generated_at: new Date().toISOString(),
    preset, window: w.current, previous_window: w.previous,
    totals: Object.values(totals),
    campaigns, problems,
  });
}
