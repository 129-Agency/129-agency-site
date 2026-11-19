// Gabarit du mail client « Release received » (validé par Antoine le 19/11/2026).
// Envoyé au client à la clôture du formulaire, Antoine et Sacha en copie.
//
// Mail-safe : tables, styles inline, polices du site (Barlow Condensed, Barlow, IBM Plex Mono)
// avec repli Arial Narrow / Arial / Menlo — Gmail n'utilise pas les polices web.
// Pas de pochette : les URLs de pièces jointes Airtable expirent, l'image casserait.

const C = { blue: '#0000FA', ink: '#020416', paper: '#F7F7F5', mute: '#5B5F70', soft: '#E6E7EE', lilac: '#C9CAFF', grey: '#9A9DAD' };
const DISPLAY = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
const BODY = "Barlow,'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dotDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.split('-').reverse().join('.') : String(s || ''));
const lbl = (txt, color = C.mute, mb = 14) => `<p style="margin:0 0 ${mb}px;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:${color}">${txt}</p>`;

export function parisDotDate(d = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/\//g, '.');
}

export function clientMailSubject(d) {
  return `Received: ${d.artist} – ${d.title}`;
}

function counts(files) {
  const ok = files.filter(f => f.ok), ko = files.filter(f => !f.ok);
  return { ok, ko, label: ko.length ? `${ok.length} of ${files.length} received` : `${files.length} received` };
}

function ctaText(ko) {
  return ko.length
    ? `${ko.length === 1 ? 'One file' : `${ko.length} files`} didn’t make it. Drop ${ko.length === 1 ? 'it' : 'them'} in your campaign folder, along with anything new: extra cuts, more videos, updated artwork. It reaches the team directly. No need to send the form again.`
    : 'Extra cuts, more videos, updated artwork: anything you add to your campaign folder reaches the team directly. No need to send the form again.';
}

// Bouton : dossier Drive partagé avec le client (folderUrl) ; sinon lien /drop (dropUrl), qui sert
// aussi de repli sous le bouton (« Can’t open it? ») quand le client est connecté à un autre compte Google.
function cta(d) {
  if (d.folderUrl) {
    return {
      href: d.folderUrl, label: 'Open the folder',
      note: `Google Drive · shared with ${esc(d.sharedWith)} only${d.dropUrl ? ` · <a href="${esc(d.dropUrl)}" style="color:${C.lilac};text-decoration:underline">Can’t open it? Upload here</a>` : ''}`,
      text: `Your campaign folder (Google Drive, shared with ${d.sharedWith} only): ${d.folderUrl}${d.dropUrl ? `\nCan’t open it? Upload here: ${d.dropUrl}` : ''}`,
    };
  }
  return { href: d.dropUrl, label: 'Add assets', note: 'No Google account needed · files go straight to your campaign folder', text: d.dropUrl };
}

// d : { firstName, artist, title, releaseType, releaseDate, clientName, dateLabel, siteUrl, logoUrl,
//       folderUrl, sharedWith, dropUrl, files:[{name, ok}] }
export function clientMailHtml(d) {
  const files = d.files || [];
  const { ko, label } = counts(files);
  const greet = d.firstName ? `It’s with us, ${esc(d.firstName)}.` : 'It’s with us.';
  const pre = `${d.artist} – ${d.title} is in.${files.length ? ` ${label}.` : ''} Need to add assets? The link is inside.`;

  const fileRows = files.map(f => f.ok
    ? `<tr><td style="padding:7px 0;border-top:1px solid ${C.soft};font-family:${MONO};font-size:13px;line-height:18px;color:${C.ink};word-break:break-all"><span style="color:${C.blue};font-weight:600">✓</span>&nbsp;&nbsp;${esc(f.name)}</td></tr>`
    : `<tr><td style="padding:7px 10px;background:${C.soft};border-top:1px solid ${C.soft};font-family:${MONO};font-size:13px;line-height:18px;color:${C.ink};word-break:break-all"><span style="font-weight:600">✕</span>&nbsp;&nbsp;${esc(f.name)}<br><span style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${C.mute}">Didn’t arrive — drop it in your folder below</span></td></tr>`).join('');

  const filesBlock = files.length ? `<tr><td style="padding:18px 16px 16px">
${lbl(`Files · ${label}`, ko.length ? C.ink : C.mute, 6)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${fileRows}</table>
</td></tr>` : '<tr><td style="padding:0 0 16px"></td></tr>';

  const meta = [d.clientName, d.dateLabel].filter(Boolean).map(esc).reverse().join(' · ');
  const release = [esc(d.releaseType || 'Release'), d.releaseDate ? `Out ${esc(dotDate(d.releaseDate))}` : ''].filter(Boolean).join(' · ');
  const btn = cta(d);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(clientMailSubject(d))}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
@media (max-width:620px){
  .px{padding-left:20px!important;padding-right:20px!important}
  .h1{font-size:46px!important;line-height:42px!important}
  .h2{font-size:30px!important;line-height:28px!important}
  .t1{font-size:34px!important;line-height:32px!important}
}
</style></head>
<body style="margin:0;padding:0;background:${C.soft};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft}">
<tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.paper};border:1px solid ${C.ink}">

<tr><td class="px" style="background:${C.blue};padding:14px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${esc(d.siteUrl)}" style="text-decoration:none"><img src="${esc(d.logoUrl)}" width="52" height="52" alt="129" style="display:block;border:0;width:52px;height:52px"></a></td>
<td valign="middle" align="right" style="font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.paper}">Release received</td>
</tr></table></td></tr>

<tr><td class="px" style="padding:40px 32px 28px">
${meta ? lbl(meta) : ''}
<h1 class="h1" style="margin:0;font-family:${DISPLAY};font-size:60px;line-height:54px;font-weight:700;letter-spacing:-.01em;text-transform:uppercase;color:${C.ink}">${greet}</h1>
<p style="margin:18px 0 0;font-family:${BODY};font-size:17px;line-height:25px;color:${C.ink}">Thanks. ${esc(d.artist)}, “${esc(d.title)}” is now in the 129 workflow.${files.length ? ' Here’s what reached us.' : ''}</p>
</td></tr>

<tr><td class="px" style="padding:0 32px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.ink}">
<tr><td style="background:${C.ink};padding:9px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.paper}">Your release</td>
<td align="right" style="font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.paper}">${release}</td>
</tr></table></td></tr>
<tr><td style="padding:20px 16px 4px">
<p class="t1" style="margin:0;font-family:${DISPLAY};font-size:40px;line-height:38px;font-weight:700;text-transform:uppercase;color:${C.ink}">${esc(d.title)}</p>
<p style="margin:6px 0 0;font-family:${BODY};font-size:16px;line-height:22px;color:${C.mute}">${esc(d.artist)}</p>
</td></tr>
${filesBlock}
</table></td></tr>

<tr><td class="px" style="background:${C.blue};padding:34px 32px 36px">
${lbl('Need to add assets?', C.lilac)}
<p class="h2" style="margin:0;font-family:${DISPLAY};font-size:38px;line-height:35px;font-weight:700;text-transform:uppercase;color:${C.paper}">Drop them in your folder.</p>
<p style="margin:14px 0 24px;font-family:${BODY};font-size:16px;line-height:24px;color:${C.paper}">${ctaText(ko)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${C.paper};border:1px solid ${C.paper}"><a href="${esc(btn.href)}" style="display:inline-block;padding:17px 22px;font-family:${MONO};font-size:14px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.ink};text-decoration:none">${btn.label}&nbsp;&nbsp;&nbsp;&nbsp;→</a></td>
</tr></table>
<p style="margin:14px 0 0;font-family:${MONO};font-size:11px;line-height:17px;letter-spacing:.04em;color:${C.lilac}">${btn.note}</p>
</td></tr>

<tr><td class="px" style="background:${C.ink};padding:24px 32px 26px">
<p style="margin:0;font-family:${BODY};font-size:15px;line-height:22px;color:${C.paper}">Questions? Reply to this email: Antoine and Sacha are copied.</p>
<p style="margin:14px 0 0;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:${C.grey}">129 Agency · Ads for records that last · <a href="${esc(d.siteUrl)}" style="color:${C.grey};text-decoration:underline">129agency.com</a></p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function clientMailText(d) {
  const files = d.files || [];
  const { ko, label } = counts(files);
  return [
    d.firstName ? `It’s with us, ${d.firstName}.` : 'It’s with us.',
    '',
    `Thanks. ${d.artist}, “${d.title}” is now in the 129 workflow.`,
    ...(files.length ? ['', `FILES · ${label.toUpperCase()}`, ...files.map(f => `${f.ok ? '✓' : '✕'} ${f.name}${f.ok ? '' : ' (didn’t arrive)'}`)] : []),
    '',
    'NEED TO ADD ASSETS?',
    ctaText(ko),
    cta(d).text,
    '',
    'Questions? Reply to this email: Antoine and Sacha are copied.',
    '129 Agency · Ads for records that last · 129agency.com',
  ].join('\n');
}
