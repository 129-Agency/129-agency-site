// Google Drive via compte de service (Workspace 129), sans dependance externe.
//
// Env vars Vercel :
//   GOOGLE_SERVICE_ACCOUNT_JSON - contenu complet du fichier JSON de cle du compte de service.
//   DRIVE_PARENT_FOLDER_ID      - dossier racine des onboardings, DANS un Drive partage
//                                 (un compte de service n'a pas de quota sur un « Mon Drive »).
//
// Les fichiers clients ne transitent jamais par Airtable : le navigateur les envoie
// par morceaux a /api/onboarding-chunk, qui les relaie vers une session d'upload Drive.

import crypto from 'crypto';

const SCOPE = 'https://www.googleapis.com/auth/drive';
let cached = { token: null, exp: 0 };

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON absent des variables Vercel.');
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON n\'est pas un JSON valide.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON incomplet (client_email / private_key).');
  return sa;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const sa = serviceAccount();
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`[Google auth] ${d.error_description || d.error || r.statusText}`);
  cached = { token: d.access_token, exp: now + (d.expires_in || 3600) };
  return cached.token;
}

async function drive(method, path, { query = {}, body } = {}) {
  const qs = new URLSearchParams({ supportsAllDrives: 'true', ...query });
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}?${qs}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`[Drive ${r.status}] ${d?.error?.message || r.statusText}`);
  return d;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function driveConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.DRIVE_PARENT_FOLDER_ID);
}

export function rootFolderId() {
  const id = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!id) throw new Error('DRIVE_PARENT_FOLDER_ID absent des variables Vercel.');
  return id;
}

// Retrouve un sous-dossier par nom, ou le cree. Idempotent.
export async function ensureFolder(name, parentId) {
  const found = await drive('GET', 'files', {
    query: {
      q: `name='${esc(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name,webViewLink)',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
      pageSize: '1',
    },
  });
  if (found.files?.length) return found.files[0];
  return drive('POST', 'files', {
    query: { fields: 'id,name,webViewLink' },
    body: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
  });
}

// Ouvre une session d'upload resumable. Renvoie l'URL de session (Location).
export async function startResumable({ name, mimeType, size, parentId }) {
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`[Drive upload ${r.status}] ${d?.error?.message || r.statusText}`);
  }
  const loc = r.headers.get('location');
  if (!loc) throw new Error('[Drive upload] pas d\'URL de session renvoyée.');
  return loc;
}

// Envoie un morceau sur une session existante. La session porte sa propre autorisation.
export async function putChunk(sessionUrl, buf, contentRange) {
  const r = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(buf.length), 'Content-Range': contentRange },
    body: buf,
  });
  if (r.status === 308) {
    const range = r.headers.get('range'); // ex. bytes=0-4194303
    const next = range ? Number(range.split('-')[1]) + 1 : 0;
    return { done: false, next };
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 200 || r.status === 201) return { done: true, file: d };
  throw new Error(`[Drive chunk ${r.status}] ${d?.error?.message || r.statusText}`);
}

export function isDriveSessionUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'www.googleapis.com' && x.pathname.startsWith('/upload/drive/v3/files');
  } catch { return false; }
}
