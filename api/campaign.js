// GET /api/campaign?source=cr2&id=<campaign_id>&preset=last_30d
// Vue detail interne d'une campagne, creas comprises.
// Header requis : Authorization: Bearer <ADMIN_SECRET>

import { graph, resolveSource, requireAdmin, extractResults, primaryResult } from './_meta.js';
import { windows, PRESETS } from './_windows.js';

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  const id = String(req.query.id || '');
  if (!/^\d{5,25}$/.test(id)) return res.status(400).json({ error: 'Identifiant de campagne invalide.' });

  const preset = PRESETS.includes(req.query.preset) ? req.query.preset : 'last_30d';
  const w = windows(preset);
  const range = w.current ? { time_range: JSON.stringify(w.current) } : { date_preset: 'maximum' };

  try {
    const src = resolveSource(req.query.source);
    const F = 'spend,impressions,reach,frequency,cpm,ctr,actions';

    const [meta, daily, countries, adRows, adMeta] = await Promise.all([
      graph(id, { fields: 'name,status,effective_status,objective,start_time,stop_time' }),
      graph(`${id}/insights`, { ...range, fields: `${F},date_start`, time_increment: '1', limit: '400' }),
      graph(`${id}/insights`, { ...range, fields: F, breakdowns: 'country', limit: '100' }),
      graph(`${id}/insights`, { ...range, level: 'ad', fields: `ad_id,ad_name,${F}`, limit: '200' }),
      graph(`${id}/ads`, { fields: 'id,name,preview_shareable_link,creative{thumbnail_url}', limit: '200' })
        .catch(() => ({ data: [] })),
    ]);

    const metaById = Object.fromEntries((adMeta.data || []).map(a => [a.id, a]));

    const ads = (adRows.data || []).map(r => {
      const results = extractResults(r.actions);
      const primary = primaryResult(results);
      const spend = Number(r.spend || 0);
      const m = metaById[r.ad_id] || {};
      return {
        id: r.ad_id, name: r.ad_name,
        spend, impressions: Number(r.impressions || 0), reach: Number(r.reach || 0),
        ctr: Number(r.ctr || 0),
        result_count: primary.count, result_type: primary.type,
        cost_per_result: primary.count ? spend / primary.count : null,
        preview: m.preview_shareable_link || null,
        thumbnail: m.creative?.thumbnail_url || null,
      };
    }).sort((a, b) => b.spend - a.spend);

    const totalRow = (daily.data || []).reduce((acc, r) => {
      acc.spend += Number(r.spend || 0);
      acc.impressions += Number(r.impressions || 0);
      return acc;
    }, { spend: 0, impressions: 0 });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      source: req.query.source, source_label: src.label, currency: src.currency,
      preset, window: w.current,
      campaign: {
        id, name: meta.name, status: meta.effective_status || meta.status,
        objective: meta.objective, start_time: meta.start_time || null, stop_time: meta.stop_time || null,
      },
      totals: totalRow,
      daily: (daily.data || []).map(r => ({
        date: r.date_start, spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0), reach: Number(r.reach || 0),
        cpm: Number(r.cpm || 0), ctr: Number(r.ctr || 0),
        result_count: primaryResult(extractResults(r.actions)).count,
      })),
      countries: (countries.data || []).map(r => ({
        country: r.country, spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
        result_count: primaryResult(extractResults(r.actions)).count,
      })).sort((a, b) => b.spend - a.spend),
      ads,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message, meta_code: e.metaCode || null });
  }
}
