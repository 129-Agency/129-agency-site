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

// Lien générique : le client s'identifie par son email. Si l'email appartient à un
// Contact rattaché à un Compte, la campagne est rattachée à ce Compte. Sinon elle
// arrive sans Compte, marquée à vérifier. Un lien ?k= (prérempli) reste accepté.
export async function identify({ k, email }) {
  if (k) {
    const compte = await compteFromKey(k);
    if (compte) return { compte, contact: null, via: 'lien' };
  }
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { compte: null, contact: null, via: null };
  const contacts = await find(T.contacts, `LOWER(${FN.contactEmail}) = ${q(e)}`, { maxRecords: 2 });
  const contact = contacts[0] || null;
  const compteId = contact?.fields?.[F.contact.compte]?.[0];
  const compte = compteId ? await get(T.comptes, compteId) : null;
  return { compte, contact, via: compte ? 'email' : null };
}

// Ce que le formulaire peut afficher d'un client reconnu : prénom, nom du compte,
// devise habituelle, et ses artistes récents avec la dernière page IG/FB connue.
// Rien d'autre (pas de budget, pas de fee, pas de notes) : la route est publique.
const CURRENCIES = ['EUR', 'USD', 'GBP'];

export async function publicProfile({ compte, contact }) {
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

  // Artistes : les 30 dernières campagnes du compte, dédoublonnées, plus récentes d'abord.
  const artists = [];
  const ids = (cf[F.compte.campagnes] || []).slice(-30);
  if (ids.length) {
    try {
      const rows = await find(T.campagnes, `OR(${ids.map(id => `RECORD_ID() = ${q(id)}`).join(', ')})`, {
        maxRecords: 30, fields: [F.campagne.artist, F.campagne.pageIgFb],
      });
      const byId = new Map(rows.map(r => [r.id, r.fields || {}]));
      const seen = new Set();
      for (const id of ids.slice().reverse()) {
        const f = byId.get(id);
        const name = clean(f?.[F.campagne.artist], 120);
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        artists.push({ name, page: clean(f[F.campagne.pageIgFb], 300) });
        if (artists.length >= 8) break;
      }
    } catch { /* liste facultative */ }
  }

  return { known: true, firstName, company, currency, artists, returning: ids.length > 0 };
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
