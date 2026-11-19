# 129 Agency — site (proposition B)

Static site, no build step. Deploy as-is (Vercel: framework "Other", output = root).

- `index.html` — whole site (CSS + JS inline)
- `img/` — covers and partner logos

To plug in:
- **On air (home)**: `/api/on-air` lit les campagnes en diffusion sur les comptes 129, CR2 et ERA (`config/on-air.json`) et renvoie titre / artistes / label / pochette / jour de campagne, sans aucun chiffre. Règle : spend > 0 sur 3 jours ET nom en « Artiste - Titre — EXPLORE|SCALE ». Corrections de titre, pochette ou masquage d'un client : bloc `overrides` du même fichier. Cache CDN 1 h.
- **Book a call**: paste the Lemcal embed inside `#lemcal-embed`. Bookings → Airtable via Lemcal webhook (or Make/Zapier).

## Internal tools (fusionnés depuis 129-Agency/internal-tools, 20/10/2026)

Même projet Vercel que le site : un seul jeu de variables d'environnement.

| URL | Rôle | Accès |
|---|---|---|
| `/internal-tools` | Hub des outils | Page sans données |
| `/internal-tools/fanlink` | Generator V2 : prompt Lovable, réécriture Airtable, création Meta en pause, liens formulaire client | Mot de passe `TOOLS_PASSWORD` |
| `/internal-tools/ads` | Ads Dashboard (sources 129 et CR2) | Mot de passe `TOOLS_PASSWORD` |
| `/onboarding?k=…` | Formulaire client (anglais), un lien par client | Jeton du client |
| `/drop?t=…` | Dépôt d'assets supplémentaires par le client (lien du mail de confirmation) | Lien signé par campagne |
| `/client-report?…&sig=…` | Rapport client en lecture seule | Lien signé |
| `/api/*` | Fonctions serveur | Mot de passe, jeton client ou jeton d'upload signé |

Mails (transport : l'application Apps Script de `tools/google-apps-script/`, MailApp) — un échec est noté dans la Campagne, jamais montré au client :
- « New submission » : à chaque formulaire clôturé, `/api/onboarding-finish` envoie à Antoine et Sacha (`NOTIFY_EMAILS`) un récap complet relu dans Airtable (client, track, campagne, fichiers, notes, liens Airtable / Drive / generator).
- « Received » (19/11/2026) : juste après, confirmation au client (l'email saisi dans le formulaire), Antoine et Sacha en copie. Récap des fichiers reçus et bouton « Open the folder » : le dossier Drive de la campagne est partagé en écriture avec cet email, et lui seul, sans mail de Google. Si le partage échoue (adresse sans compte Google, partage externe bloqué), le bouton devient « Add assets » vers `/drop`. Sous le bouton Drive, un lien de secours « Can't open it? » mène aussi à `/drop`. Gabarit : `api/_clientmail.js`. Le partage et le lien de dépôt sont écrits dans les Notes de la Campagne.
- « New assets » : à chaque dépôt via `/drop`, liste des fichiers ajoutés et message éventuel du client, à Antoine et Sacha.

`/drop?t=…` : page publique de dépôt d'assets supplémentaires (repli du dossier Drive partagé), un lien signé par campagne (valable 180 jours). Les fichiers partent dans le dossier Drive de la Campagne (champ « Dossier Drive ») par le même relais que le formulaire ; le dossier reste privé et le client n'a besoin d'aucun compte Google. API : `/api/drop`.

Drive (onboarding) : un dossier par campagne, à plat dans le dossier racine (« Ad Campaigns Assets »), nommé « (Client) Artiste - Titre » (19/11/2026, sans date ; client = nom du Compte Airtable, sinon la société déclarée). Le nom sert de clé : même client et même titre réutilisent le même dossier. Tous les fichiers y vont ensemble, sans sous-dossiers ; la cover est préfixée `ARTWORK -`. Au moins une vidéo déposée est obligatoire (un lien peut la compléter, pas la remplacer).

Apps Script : après toute modification de `Code.gs`, publier une nouvelle version du déploiement existant (Déployer > Gérer les déploiements > crayon > Nouvelle version), sinon Vercel parle encore à l'ancienne. Tant que la version du 19/11/2026 n'est pas publiée, la copie de la confirmation client est ignorée : le site envoie alors une copie séparée à Antoine et Sacha.

Variables d'environnement : voir `.env.example`. Aucun secret dans le repo.
Le mot de passe d'accès (`TOOLS_PASSWORD`) et la clé de signature sont volontairement séparés : un lien client signé ne permet pas de retrouver le mot de passe.
Template des campagnes Meta : `config/meta-template.json`. Sources du dashboard : `config/sources.json`.
