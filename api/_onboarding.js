// Briques partagees par les routes publiques d'onboarding client.

import crypto from 'crypto';
import { T, F, FN, find, get, q } from './_airtable.js';
import { signingSecret } from './_meta.js';

const secret = () => signingSecret();

const b64u = (s) => Buffer.from(s).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');

// Jeton d'upload : l'URL de session Drive + l'ID campagne, signes et datés.
// Le relais /api/onboarding-chunk n'accepte que ces jetons : il ne peut pas
// servir de proxy vers autre chose qu'une session Drive ouverte par nous.
export function signUpload(payload, ttlSec = 6 * 3600) {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secret()).update(`upload.${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function readUpload(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw new Error('Invalid upload token.');
  const expected = crypto.createHmac('sha256', secret()).update(`upload.${body}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid upload token.');
  const p = JSON.parse(unb64u(body));
  if (p.exp < Math.floor(Date.now() / 1000)) throw new Error('Upload token expired: reload the form.');
  return p;
}

// Le lien de formulaire d'un client porte son « Token dashboard » (UUID).
export async function compteFromKey(k) {
  if (!/^[0-9a-f-]{20,64}$/i.test(String(k || ''))) return null;
  const rows = await find(T.comptes, `${FN.compteToken} = ${q(k)}`, { maxRecords: 2 });
  return rows.length === 1 ? rows[0] : null;
}

// Lien générique : le client s'identifie par son email.
//   1. Email exact d'un Contact rattaché à un Compte  -> via « email » (on connaît la personne).
//   2. Sinon, domaine de l'email listé dans Comptes → « Domaines email » -> via « domaine »
//      (on connaît l'équipe, pas la personne : le formulaire demande son nom et crée le Contact).
//   3. Sinon, inconnu : la campagne arrive sans Compte, marquée à vérifier.
// Un lien ?k= (prérempli) reste accepté et prime.
const PUBLIC_DOMAINS = /^(gmail|googlemail|hotmail|outlook|live|msn|windowslive|yahoo|ymail|rocketmail|icloud|me|mac|aol|proton|protonmail|pm|gmx|web|orange|free|sfr|laposte|wanadoo|bbox|neuf|numericable|yandex|mail|inbox|qq|163|126|zoho|hey|fastmail|tutanota|tuta|libero|virgilio|t-online|seznam|naver|daum)\.[a-z.]{2,}$/i;

export function emailDomain(email) {
  const m = String(email || '').trim().toLowerCase().match(/^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

export async function compteFromDomain(domain) {
  if (!domain || PUBLIC_DOMAINS.test(domain)) return null;
  const rows = await find(T.comptes, `${FN.compteDomains} != ''`, { maxRecords: 200 });
  const hits = rows.filter(r => String(r.fields?.[F.compte.domains] || '').toLowerCase()
    .split(/[\s,;]+/).map(d => d.replace(/^@/, '').trim()).filter(d => d && !PUBLIC_DOMAINS.test(d))
    .includes(domain));
  return hits.length === 1 ? hits[0] : null;   // deux comptes sur un même domaine : on ne devine pas
}

export async function identify({ k, email }) {
  const e = String(email || '').trim().toLowerCase();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  let contact = null;
  if (valid) {
    const contacts = await find(T.contacts, `LOWER(${FN.contactEmail}) = ${q(e)}`, { maxRecords: 2 });
    contact = contacts[0] || null;
  }
  if (k) {
    const compte = await compteFromKey(k);
    if (compte) return { compte, contact, via: 'lien' };
  }
  if (!valid) return { compte: null, contact: null, via: null };
  const compteId = contact?.fields?.[F.contact.compte]?.[0];
  if (compteId) return { compte: await get(T.comptes, compteId), contact, via: 'email' };
  const byDomain = await compteFromDomain(emailDomain(e));
  if (byDomain) return { compte: byDomain, contact, via: 'domaine' };
  return { compte: null, contact, via: null };
}

// Ce que le formulaire peut afficher d'un client reconnu : prénom, nom du compte,
// devise habituelle. Rien d'autre (ni artistes, ni budget, ni fee, ni notes) : la route
// est publique et la reconnaissance par domaine ne prouve pas que l'email appartient
// à la personne qui tape. La liste des artistes a été retirée avec le sélecteur (26/10/2026).
const CURRENCIES = ['EUR', 'USD', 'GBP'];

export async function publicProfile({ compte, contact, via }) {
  if (!compte) return { known: false };
  const cf = compte.fields || {};
  const firstName = clean(contact?.fields?.[F.contact.name], 120).split(/\s+/)[0] || '';
  const company = clean(cf[F.compte.name], 120);

  let currency = CURRENCIES.includes(cf[F.compte.currency]) ? cf[F.compte.currency] : null;
  const adAccountId = (cf[F.compte.defaultAdAccount] || [])[0];
  if (!currency && adAccountId) {
    try {
      const aa = await get(T.adAccounts, adAccountId);
      const c = aa.fields?.[F.adAccount.currency];
      if (CURRENCIES.includes(c)) currency = c;
    } catch { /* devise facultative */ }
  }

  // needsName : on connaît l'équipe (domaine ou lien) mais pas encore la personne.
  const returning = (cf[F.compte.campagnes] || []).length > 0;
  return { known: true, via, needsName: !firstName, firstName, company, currency, returning };
}

export function spotifyIdFrom(url) {
  const m = String(url || '').match(/(?:track[/:])([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

export async function readJson(req, limit = 4_000_000) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function clean(v, max = 300) {
  return String(v ?? '').trim().slice(0, max);
}

export function cleanUrl(v) {
  const s = clean(v, 600);
  if (!s) return null;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.toString() : null; }
  catch { return null; }
}
