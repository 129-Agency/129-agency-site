// Mail interne « New submission » envoyé à Antoine et Sacha à chaque formulaire d'onboarding clôturé.
//
// Transport : l'application web Apps Script « 129 Onboarding Drive » (action « mail », MailApp),
// déjà déployée pour Drive : pas de nouveau service ni de clé à gérer.
//
// Env vars Vercel :
//   NOTIFY_EMAILS - optionnel, destinataires séparés par des virgules
//                   (défaut : antoine@129agency.com, sacha@129agency.com).
//   GOOGLE_APPS_SCRIPT_URL / GOOGLE_APPS_SCRIPT_SECRET - les mêmes que pour Drive.
//
// Le contenu vient des fiches Airtable relues après écriture : le mail montre ce qui a
// réellement été enregistré, pas ce que le navigateur a envoyé.

import { BASE_ID, T, F, get } from './_airtable.js';

const DEFAULT_TO = ['antoine@129agency.com', 'sacha@129agency.com'];
const SITE = () => (process.env.PUBLIC_FORM_BASE || 'https://129agency.com/onboarding').replace(/\/onboarding\/?$/, '');

export function notifyConfigured() {
  return Boolean(process.env.GOOGLE_APPS_SCRIPT_URL && process.env.GOOGLE_APPS_SCRIPT_SECRET);
}

function recipients() {
  const raw = process.env.NOTIFY_EMAILS;
  const list = raw ? raw.split(/[\s,;]+/).map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) : [];
  return list.length ? list : DEFAULT_TO;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? (x.filename || x.url || '') : x)).filter(Boolean).join(', ');
  return String(v);
};
const isUrl = (s) => /^https?:\/\//i.test(s);
const fmtDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.split('-').reverse().join('/') : s);
const fmtMoney = (n, cur) => (Number.isFinite(Number(n)) && n !== '' && n != null
  ? `${Number(n).toLocaleString('fr-FR')} ${cur || ''}`.trim() : '');

// Construit puis envoie le mail. Ne lève jamais : renvoie { ok } ou { ok:false, error }.
export async function notifySubmission({ campaignId, uploaded = [] }) {
  try {
    if (!notifyConfigured()) return { ok: false, error: 'GOOGLE_APPS_SCRIPT_URL / SECRET absents : mail non envoyé.' };
    const campaign = await get(T.campagnes, campaignId);
    const cf = campaign.fields || {};
    const trackId = (cf[F.campagne.track] || [])[0];
    const compteId = (cf[F.campagne.compte] || [])[0];
    const [track, compte] = await Promise.all([
      trackId ? get(T.tracks, trackId).catch(() => null) : null,
      compteId ? get(T.comptes, compteId).catch(() => null) : null,
    ]);
    const tf = track?.fields || {};
    const kf = compte?.fields || {};

    const name = val(cf[F.campagne.name]) || `${val(cf[F.campagne.artist])} - ${val(cf[F.campagne.trackName])}`;
    const recognized = Boolean(compte);
    const airtableUrl = `https://airtable.com/${BASE_ID}/${T.campagnes}/${campaign.id}`;
    const declared = val(cf[F.campagne.declaredIdentity]);
    const replyTo = (declared.match(/[^\s@—]+@[^\s@—]+\.[^\s—]+/) || [])[0] || '';

    const sections = [
      ['Client', [
        ['Compte', recognized ? val(kf[F.compte.name]) : '⚠ Non reconnu — à rattacher à un Compte avant de lancer'],
        ['Contexte', val(cf[F.campagne.context])],
        ['Identité déclarée', declared],
      ]],
      ['Track', [
        ['Artiste', val(tf[F.track.artist]) || val(cf[F.campagne.artist])],
        ['Titre', val(tf[F.track.title]) || val(cf[F.campagne.trackName])],
        ['Featuring', val(tf[F.track.featuring])],
        ['Type de release', val(tf[F.track.releaseType])],
        ['Date de sortie', fmtDate(val(cf[F.campagne.releaseDate]) || val(tf[F.track.releaseDate]))],
        ['Genre', val(tf[F.track.genre])],
        ['Langue', val(tf[F.track.language])],
        ['Distributeur', val(tf[F.track.distributor])],
        ['Discovery Mode', val(tf[F.track.discoveryMode])],
        ['ISRC', val(tf[F.track.isrc])],
        ['UPC', val(tf[F.track.upc])],
        ['Spotify', val(tf[F.track.spotifyUrl]) || val(cf[F.campagne.spotifyUrl])],
        ['Apple Music', val(tf[F.track.appleUrl])],
        ['Deezer', val(tf[F.track.deezerUrl])],
        ['Amazon', val(tf[F.track.amazonUrl])],
        ['YouTube', val(tf[F.track.youtubeUrl])],
      ]],
      ['Campagne', [
        ['Type', val(cf[F.campagne.type])],
        ['Budget demandé', fmtMoney(cf[F.campagne.budgetRequested], val(cf[F.campagne.currency]))],
        ['Objectif', val(cf[F.campagne.objective])],
        ['Début souhaité', fmtDate(val(cf[F.campagne.startDate]))],
        ['Territoires', val(cf[F.campagne.territories])],
        ['Actions en parallèle', val(cf[F.campagne.parallelActions])],
        ['Page IG / FB', val(cf[F.campagne.pageIgFb])],
        ['Accès Page / IG', val(cf[F.campagne.pageAccess])],
        ['Conditions', [val(cf[F.campagne.termsVersion]), val(cf[F.campagne.termsAcceptedAt]).slice(0, 16).replace('T', ' ')].filter(Boolean).join(' — acceptées le ')
          || '⚠ Non acceptées'],
      ]],
      ['Fichiers', [
        ['Dossier Drive', val(cf[F.campagne.driveFolder])],
        ['Lien fichiers client', val(cf[F.campagne.clientFilesLink])],
        ['Artwork Airtable', (cf[F.campagne.artwork] || []).length ? 'Oui' : 'Non'],
        ['Reçus', uploaded.length
          ? uploaded.map(f => `${String(f.name || '').slice(0, 200)}${f.ok ? '' : ' (ÉCHEC)'}`).join('\n')
          : 'Aucun fichier déposé dans le formulaire'],
      ]],
      ['Notes', [['', val(cf[F.campagne.notes])]]],
    ];

    const failed = uploaded.filter(f => !f.ok).length;
    const flags = [!recognized && 'client non reconnu', failed && `${failed} fichier(s) en échec`].filter(Boolean);
    const subject = `New submission — ${name}${flags.length ? ` [${flags.join(', ')}]` : ''}`;

    const cell = (v) => esc(v).replace(/\n/g, '<br>');
    const link = (v) => (isUrl(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : cell(v));
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16181A;max-width:640px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6B6E70">129 · Onboarding</p>
<h2 style="margin:0 0 16px;font-size:20px">New submission — ${esc(name)}</h2>
${flags.length ? `<p style="background:#FFF4D6;border:1px solid #E0B84C;padding:8px 12px;margin:0 0 16px">⚠ ${esc(flags.join(' · '))}</p>` : ''}
<p style="margin:0 0 20px"><a href="${airtableUrl}">Ouvrir la campagne dans Airtable</a> · <a href="${SITE()}/internal-tools/fanlink">Fanlink Generator</a>${val(cf[F.campagne.driveFolder]) ? ` · <a href="${esc(val(cf[F.campagne.driveFolder]))}">Dossier Drive</a>` : ''}</p>
${sections.map(([title, rows]) => {
      const kept = rows.filter(([, v]) => v);
      if (!kept.length) return '';
      return `<h3 style="margin:20px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #16181A;padding-bottom:4px">${esc(title)}</h3>
<table style="border-collapse:collapse;width:100%">${kept.map(([k, v]) => k
        ? `<tr><td style="padding:4px 12px 4px 0;color:#6B6E70;vertical-align:top;white-space:nowrap;width:170px">${esc(k)}</td><td style="padding:4px 0;vertical-align:top">${link(v)}</td></tr>`
        : `<tr><td colspan="2" style="padding:4px 0">${cell(v)}</td></tr>`).join('')}</table>`;
    }).join('\n')}
<p style="margin:24px 0 0;font-size:12px;color:#6B6E70">Campagne ${esc(campaign.id)} · statut ${esc(val(cf[F.campagne.status]))}</p>
</div>`;

    const text = [`New submission — ${name}`, flags.length ? `⚠ ${flags.join(' · ')}` : '', `Airtable : ${airtableUrl}`, '',
      ...sections.flatMap(([title, rows]) => {
        const kept = rows.filter(([, v]) => v);
        return kept.length ? [`— ${title.toUpperCase()} —`, ...kept.map(([k, v]) => (k ? `${k} : ${v}` : v)), ''] : [];
      })].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

    const r = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.GOOGLE_APPS_SCRIPT_SECRET, action: 'mail', to: recipients(), subject, html, text, replyTo }),
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    const body = await r.text();
    let d;
    try { d = JSON.parse(body); } catch { return { ok: false, error: '[Apps Script] réponse non JSON au mail' }; }
    if (!d.sent) return { ok: false, error: `[Apps Script] ${d.error || 'mail non envoyé'}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
