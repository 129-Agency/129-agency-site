// POST /api/onboarding-chunk   (public — protégé par le jeton signé renvoyé par onboarding-start)
//
// Corps : octets bruts d'un morceau (<= 4 Mo, multiple de 256 Ko sauf le dernier).
// En-têtes : X-Upload-Token, X-Chunk-Start, X-Total-Size.
// Relaie le morceau vers la session d'upload Drive. Les fonctions Vercel plafonnent
// le corps à 4,5 Mo, d'où le découpage côté navigateur.

import { readUpload } from './_onboarding.js';
import { putChunk, isDriveSessionUrl } from './_google.js';

const MAX_CHUNK = 4 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });

  let p;
  try { p = readUpload(req.headers['x-upload-token']); }
  catch (e) { return res.status(403).json({ error: e.message }); }
  if (!isDriveSessionUrl(p.u)) return res.status(403).json({ error: 'Upload session refused.' });

  const start = Number(req.headers['x-chunk-start']);
  const total = Number(req.headers['x-total-size']);
  if (!Number.isInteger(start) || start < 0 || total !== p.s) {
    return res.status(400).json({ error: 'Invalid chunk headers.' });
  }

  // Lecture du flux brut : ne jamais toucher req.body ici (Vercel le parserait).
  const parts = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_CHUNK) return res.status(413).json({ error: 'Chunk too large.' });
    parts.push(c);
  }
  const buf = Buffer.concat(parts);
  if (!buf.length || start + buf.length > total) return res.status(400).json({ error: 'Empty or out-of-range chunk.' });

  try {
    const out = await putChunk(p.u, buf, `bytes ${start}-${start + buf.length - 1}/${total}`);
    if (out.done) return res.status(200).json({ done: true, fileId: out.file?.id || null, name: out.file?.name || null });
    return res.status(200).json({ done: false, next: out.next });
  } catch (e) {
    console.error('[onboarding-chunk]', e.message);
    return res.status(502).json({ error: 'Upload interrupted, retrying…', detail: e.message });
  }
}
