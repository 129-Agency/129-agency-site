// POST /api/onboarding-identify   (public)  { email } ou { k }
//
// Première étape du formulaire : le client tape son email. S'il appartient à un
// Contact rattaché à un Compte, on renvoie de quoi l'accueillir (prénom, compte,
// devise, artistes récents) et il ne retape ni son nom ni sa société.
//
// Limite assumée : la réponse confirme qu'un email est client de 129. C'est le prix
// d'un lien générique sans mot de passe ; on ne renvoie donc rien de commercial.

import { identify, publicProfile, readJson, clean } from './_onboarding.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  let b;
  try { b = await readJson(req, 10_000); } catch (e) { return res.status(e.status || 400).json({ error: 'Unreadable request.' }); }

  const email = clean(b.email, 200).toLowerCase();
  const k = clean(b.k, 80);
  if (!k && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });

  try {
    const who = await identify({ k, email });
    return res.status(200).json(await publicProfile(who));
  } catch (e) {
    console.error('[onboarding-identify]', e.message);
    // L'identification ne doit jamais bloquer le formulaire : on continue en « inconnu ».
    return res.status(200).json({ known: false, degraded: true });
  }
}
