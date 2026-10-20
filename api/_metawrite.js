// Creation Meta (ecriture). Separe de _meta.js, qui reste en lecture seule avec le
// token ads_read du dashboard.
//
// Env var Vercel : token System User avec ads_management. Nom accepte, par ordre :
//   META_SYSTEM_USER_TOKEN, META_SYSTEM_USER, META_WRITE_TOKEN
//
// Regle : tout est cree en PAUSED. Rien ne diffuse sans action humaine dans Ads Manager.

import fs from 'fs';
import path from 'path';
import { API_VERSION } from './_meta.js';

const TEMPLATE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/meta-template.json'), 'utf8'));
const TOKEN_NAMES = ['META_SYSTEM_USER_TOKEN', 'META_SYSTEM_USER', 'META_WRITE_TOKEN'];

export function writeTokenName() {
  return TOKEN_NAMES.find(n => process.env[n]) || null;
}

function writeToken() {
  const n = writeTokenName();
  if (!n) throw new Error(`Token d'écriture Meta absent des variables Vercel (attendu : ${TOKEN_NAMES.join(' ou ')}).`);
  return process.env[n];
}

async function post(objPath, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.set('access_token', writeToken());
  const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${objPath}`, { method: 'POST', body });
  const d = await r.json();
  if (d.error) {
    const e = d.error;
    const detail = e.error_user_msg || e.error_user_title || '';
    throw new Error(`[Meta ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''}] ${e.message}${detail ? ' — ' + detail : ''}`);
  }
  return d;
}

const minor = (amount) => Math.round(Number(amount) * 100);

function targeting(role, adAccountId) {
  const r = TEMPLATE[role];
  const t = {
    geo_locations: { countries: TEMPLATE.countries, location_types: TEMPLATE.location_types },
    age_min: r.age_min,
    age_max: r.age_max,
    device_platforms: TEMPLATE.device_platforms,
    publisher_platforms: TEMPLATE.publisher_platforms,
    facebook_positions: TEMPLATE.facebook_positions,
    instagram_positions: TEMPLATE.instagram_positions,
    targeting_automation: { advantage_audience: r.advantage_audience },
  };
  const excl = TEMPLATE.exclude_custom_audiences?.[adAccountId];
  if (excl) t.excluded_custom_audiences = [{ id: excl }];
  return t;
}

export function templateDefaults() {
  return {
    explore_daily_budget: TEMPLATE.explore.daily_budget,
    scale_daily_budget: TEMPLATE.scale.daily_budget,
    scale_cost_cap: TEMPLATE.scale.cost_cap,
  };
}

// Cree campagne + ad set pour un role (EXPLORE ou SCALE). Renvoie les IDs.
async function createRole(role, { adAccountId, pixelId, baseName, dailyBudget, costCap }) {
  const r = TEMPLATE[role];
  const label = role.toUpperCase();
  const campaign = await post(`act_${adAccountId}/campaigns`, {
    name: `${baseName.artistTitle} — ${label} — ${baseName.key}`,
    objective: TEMPLATE.objective,
    status: 'PAUSED',
    special_ad_categories: [],
    daily_budget: minor(dailyBudget),
    bid_strategy: r.bid_strategy,
  });
  // Si l'ad set echoue, on garde l'ID de campagne : elle existe chez Meta (en pause)
  // et doit etre tracee dans Airtable plutot que de devenir orpheline.
  try {
    const adset = await post(`act_${adAccountId}/adsets`, {
      name: `${label} — ${r.age_min}-${r.age_max} — Reels + Stories`,
      campaign_id: campaign.id,
      status: 'PAUSED',
      billing_event: 'IMPRESSIONS',
      optimization_goal: TEMPLATE.optimization_goal,
      destination_type: 'WEBSITE',
      promoted_object: { pixel_id: pixelId, custom_event_type: TEMPLATE.conversion_event },
      bid_amount: r.bid_strategy === 'COST_CAP' ? minor(costCap) : undefined,
      targeting: targeting(role, adAccountId),
    });
    return { campaignId: campaign.id, adsetId: adset.id };
  } catch (e) {
    return { campaignId: campaign.id, adsetId: null, adsetError: e.message };
  }
}

// existing : { explore: campaignId|null, scale: campaignId|null } — on ne recree jamais.
export async function createCampaigns({ adAccountId, pixelId, artistTitle, key, budgets, existing = {} }) {
  const out = { explore: null, scale: null, errors: [], notes: [] };
  if (!TEMPLATE.exclude_custom_audiences?.[adAccountId]) {
    out.notes.push('Aucune audience « Already Converted 60j » configurée pour ce compte : exclusion non appliquée.');
  }
  const base = { adAccountId, pixelId, baseName: { artistTitle, key } };
  for (const role of ['explore', 'scale']) {
    if (existing[role]) { out[role] = { campaignId: existing[role], skipped: true }; continue; }
    try {
      out[role] = await createRole(role, {
        ...base,
        dailyBudget: role === 'explore' ? budgets.explore : budgets.scale,
        costCap: budgets.costCap,
      });
      if (out[role].adsetError) out.errors.push(`${role.toUpperCase()} ad set : ${out[role].adsetError} (campagne ${out[role].campaignId} créée sans ad set)`);
    } catch (e) {
      out.errors.push(`${role.toUpperCase()} : ${e.message}`);
    }
  }
  return out;
}
