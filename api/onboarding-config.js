// GET /api/onboarding-config  (public) — dit au formulaire si l'envoi de fichiers vers Drive est actif.
// Sans Google configuré, le formulaire passe en mode « lien vers vos fichiers » + artwork léger.

import { driveConfigured } from './_google.js';

export default function handler(req, res) {
  return res.status(200).json({ drive: driveConfigured(), maxArtworkInlineBytes: 3 * 1024 * 1024 });
}
