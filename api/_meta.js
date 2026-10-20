// Helpers partages par toutes les routes /api de 129 Internal Tools.
//
// Env vars Vercel :
//   META_ACCESS_TOKEN   - optionnel : token System User ads_read. A defaut, le token
//                         d'ecriture META_SYSTEM_USER_TOKEN sert aussi a la lecture.
//                         Ne JAMAIS mettre un token utilisateur ici : il expire.
//   TOOLS_PASSWORD      - mot de passe partage Antoine / Sacha, envoye en header
//                         Authorization: Bearer <mot de passe>. Protege les vues internes.
//   SIGNING_SECRET      - optionnel : cle de signature des liens client et des uploads.
//                         A defaut, derivee du token Meta (voir signingSecret).
//   META_API_VERSION    - optionnel, defaut v23.0

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Lecture par fs plutot qu'import assertion : la syntaxe des import assertions
// a change entre Node 20 et 22 et casse au deploiement.
const SOURCES = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'config/sources.json'), 'utf8')
);

export const API_VERSION = process.env.META_API_VERSION || 'v23.0';

export function sources() {
  return SOURCES;
}

export function resolveSource(key) {
  const s = SOURCES[key];
  if (!s) throw new Error(`Source inconnue : ${key}`);
  if (!s.ad_account_id) throw new Error(`Source "${s.label}" pas encore configuree (ad_account_id manquant dans config/sources.json).`);
  return s;
}

export async function graph(path, params = {}) {
  // Lecture : token ads_read dedie s'il existe, sinon le token System User d'ecriture
  // (meme projet Vercel, donc meme perimetre d'exposition ; ces routes ne font que lire).
  const token = process.env.META_ACCESS_TOKEN || process.env.META_SYSTEM_USER_TOKEN
    || process.env.META_SYSTEM_USER || process.env.META_WRITE_TOKEN;
  if (!token) throw new Error('Aucun token Meta dans les variables Vercel (META_ACCESS_TOKEN ou META_SYSTEM_USER_TOKEN).');
  const qs = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${path}?${qs}`);
  const d = await r.json();
  if (d.error) {
    const e = d.error;
    // On remonte le code Meta : 190 = token mort, 200/272 = permission,
    // compte desactive/impaye = message explicite cote Meta.
    const err = new Error(`[Meta ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''}] ${e.message}`);
    err.metaCode = e.code;
    throw err;
  }
  return d;
}

// Acces aux outils internes : un mot de passe choisi par Antoine, partage a Sacha.
export function requireAdmin(req) {
  const pwd = process.env.TOOLS_PASSWORD;
  if (!pwd) return { ok: false, status: 500, message: 'TOOLS_PASSWORD absent des variables Vercel.' };
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Comparaison a longueur fixe : ne revele ni le mot de passe ni sa longueur.
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  if (!crypto.timingSafeEqual(h(given), h(pwd))) {
    return { ok: false, status: 403, message: 'Mot de passe refuse.' };
  }
  return { ok: true };
}

// Signature des liens client et des jetons d'upload. Volontairement SEPARE du mot de
// passe : un mot de passe humain se casse hors ligne a partir d'un lien signe que le
// client possede. Cle forte derivee du token Meta (serveur uniquement), sauf si
// SIGNING_SECRET est defini. Changer le token Meta invalide les liens client en cours.
export function signingSecret() {
  if (process.env.SIGNING_SECRET) return process.env.SIGNING_SECRET;
  const t = process.env.META_SYSTEM_USER_TOKEN || process.env.META_SYSTEM_USER
    || process.env.META_WRITE_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error('Aucun secret de signature : definir SIGNING_SECRET ou un token Meta.');
  return crypto.createHmac('sha256', t).update('129-signing-v1').digest('hex');
}

export function sign(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
}

export function verify(payload, sig) {
  const expected = sign(payload);
  const a = Buffer.from(String(sig)), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Meta renvoie les resultats dans un tableau `actions` heterogene, et le type
// qui compte depend de l'objectif de la campagne. On prend le premier type
// disponible dans l'ordre de pertinence, et on dit lequel a ete retenu :
// afficher un cout par resultat sans dire de quel resultat il s'agit est
// exactement le genre de chiffre qu'on ne peut pas defendre devant un client.
const RESULT_ORDER = [
  ['offsite_content_view', 'Vues de contenu'],
  ['onsite_web_view_content', 'Vues de contenu'],
  ['landing_page_view', 'Vues de page'],
  ['link_click', 'Clics sur le lien'],
  ['post_engagement', 'Interactions'],
];

// Regroupe le tableau `actions` de Meta par famille de resultat.
// (Cette fonction manquait depuis la fusion des repos : /api/campaign et /api/report
// plantaient a l'import.)
export function extractResults(actions) {
  const out = { content_views: 0, landing_page_views: 0, link_clicks: 0, post_engagement: 0 };
  const key = {
    offsite_content_view: 'content_views',
    onsite_web_view_content: 'content_views',
    'offsite_conversion.fb_pixel_view_content': 'content_views',
    landing_page_view: 'landing_page_views',
    link_click: 'link_clicks',
    post_engagement: 'post_engagement',
  };
  const seenContent = new Set();
  for (const a of Array.isArray(actions) ? actions : []) {
    const k = key[a.action_type];
    if (!k) continue;
    // Meta peut renvoyer la meme vue de contenu sous deux noms : on garde le plus grand.
    if (k === 'content_views') { seenContent.add(Number(a.value || 0)); continue; }
    out[k] += Number(a.value || 0);
  }
  out.content_views = seenContent.size ? Math.max(...seenContent) : 0;
  return out;
}

// Resultat principal d'une campagne : on prend le signal le plus proche de
// l'intention (ecoute / visite) disponible, dans cet ordre.
export function primaryResult(r) {
  if (r.content_views)       return { type: 'Content views', count: r.content_views };
  if (r.landing_page_views)  return { type: 'Landing page views', count: r.landing_page_views };
  if (r.link_clicks)         return { type: 'Link clicks', count: r.link_clicks };
  if (r.post_engagement)     return { type: 'Post engagement', count: r.post_engagement };
  return { type: null, count: 0 };
}
