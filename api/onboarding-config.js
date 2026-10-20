// GET /api/onboarding-config  (public) — ce que le formulaire doit savoir avant de s'afficher :
//   drive       : l'envoi de fichiers vers Google Drive est-il actif ? Sinon, mode « lien vers vos fichiers ».
//   businessId  : ID du business portfolio Meta de 129, affiché dans l'étape « Donnez-nous accès ».
//                 Ce n'est pas un secret : c'est l'identifiant qu'un client saisit pour partager une Page.

import { driveConfigured } from './_google.js';

export default function handler(req, res) {
  return res.status(200).json({
    drive: driveConfigured(),
    maxArtworkInlineBytes: 3 * 1024 * 1024,
    businessId: process.env.META_BUSINESS_ID || '2931318437227206',
  });
}
