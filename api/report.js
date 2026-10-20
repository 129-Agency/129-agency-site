// GET /client-report -> /api/report?c=&t=&s=&sig=
// Vue client, sans authentification : la signature HMAC tient lieu d'acces.
// Whitelist stricte des champs. Les creas remontees sont les meilleures
// uniquement, et sans leur depense : le client voit ce qui marche,
// pas le detail de ce qui a ete teste puis coupe.

import { graph, resolveSource, verify, extractResults, primaryResult } from './_meta.js';

const TOP_ADS = 5;

export default async function handler(req, res) {
  const { c = '', t = '', s = '', sig = '' } = req.query;
  const ids = String(c).split(',').map(x => x.trim()).filter(Boolean);

  if (!ids.length || ids.length > 6 || ids.some(id => !/^\d{5,25}$/.test(id))) {
    return res.status(400).json({ error: 'Lien incomplet.' });
  }
  if (!sig || !verify(`${ids.join(',')}|${String(t)}|${String(s)}`, sig)) {
    return res.status(403).json({ error: 'Ce lien n\'est plus valide. Demande-nous un nouveau lien.' });
  }

  try {
    const src = resolveSource(String(s));
    const F = 'spend,impressions,reach,frequency,cpm,ctr,actions';

    const campaigns = await Promise.all(ids.map(async (id) => {
      const meta = await graph(id, { fields: 'name,start_time' });
      const since = meta.start_time ? meta.start_time.split('T')[0] : '2020-01-01';
      const until = new Date().toISOString().split('T')[0];
      const range = { time_range: JSON.stringify({ since, until }) };

      const [totals, daily, countries, adRows, adMeta] = await Promise.all([
        graph(`${id}/insights`, { ...range, fields: F }),
        graph(`${id}/insights`, { ...range, fields: `${F},date_start`, time_increment: '1', limit: '400' }),
        graph(`${id}/insights`, { ...range, fields: F, breakdowns: 'country', limit: '60' }),
        graph(`${id}/insights`, { ...range, level: 'ad', fields: `ad_id,ad_name,${F}`, limit: '200' }),
        graph(`${id}/ads`, { fields: 'id,preview_shareable_link,creative{thumbnail_url}', limit: '200' })
          .catch(() => ({ data: [] })),
      ]);

      const shape = (row) => {
        const r = extractResults(row.actions);
        const p = primaryResult(r);
        return {
          date: row.date_start, country: row.country,
          impressions: Number(row.impressions || 0), reach: Number(row.reach || 0),
          cpm: Number(row.cpm || 0), ctr: Number(row.ctr || 0),
          frequency: Number(row.frequency || 0),
          spend: Number(row.spend || 0),
          result_count: p.count, result_type: p.type,
        };
      };

      const metaById = Object.fromEntries((adMeta.data || []).map(a => [a.id, a]));
      const top = (adRows.data || [])
        .map(r => {
          const p = primaryResult(extractResults(r.actions));
          const m = metaById[r.ad_id] || {};
          return {
            name: r.ad_name,
            result_count: p.count, result_type: p.type,
            ctr: Number(r.ctr || 0),
            preview: m.preview_shareable_link || null,
            thumbnail: m.creative?.thumbnail_url || null,
          };
        })
        .filter(a => a.result_count > 0)
        .sort((a, b) => b.result_count - a.result_count)
        .slice(0, TOP_ADS);

      return {
        name: meta.name,
        start_time: meta.start_time || null,
        totals: totals.data?.[0] ? shape(totals.data[0]) : null,
        daily: (daily.data || []).map(shape),
        countries: (countries.data || []).map(shape).sort((a, b) => b.impressions - a.impressions),
        best_ads: top,
      };
    }));

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      title: String(t), currency: src.currency, campaigns,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Les données ne sont pas accessibles pour le moment.', detail: e.message });
  }
}
