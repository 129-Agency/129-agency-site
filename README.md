# 129 Agency — site (proposition B)

Static site, no build step. Deploy as-is (Vercel: framework "Other", output = root).

- `index.html` — whole site (CSS + JS inline)
- `img/` — covers and partner logos

To plug in:
- **Live campaigns**: replace the `LIVE` array with a call to a server route reading the Meta Marketing API (Insights). Token stays server-side.
- **Book a call**: paste the Lemcal embed inside `#lemcal-embed`. Bookings → Airtable via Lemcal webhook (or Make/Zapier).

## Internal tools (fusionnés depuis 129-Agency/internal-tools, 20/10/2026)

Même projet Vercel que le site : un seul jeu de variables d'environnement.

| URL | Rôle | Accès |
|---|---|---|
| `/internal-tools` | Hub des outils | Page sans données |
| `/internal-tools/fanlink` | Generator V2 : prompt Lovable, réécriture Airtable, création Meta en pause, liens formulaire client | Mot de passe `TOOLS_PASSWORD` |
| `/internal-tools/ads` | Ads Dashboard (sources 129 et CR2) | Mot de passe `TOOLS_PASSWORD` |
| `/onboarding?k=…` | Formulaire client (anglais), un lien par client | Jeton du client |
| `/client-report?…&sig=…` | Rapport client en lecture seule | Lien signé |
| `/api/*` | Fonctions serveur | Mot de passe, jeton client ou jeton d'upload signé |

Variables d'environnement : voir `.env.example`. Aucun secret dans le repo.
Le mot de passe d'accès (`TOOLS_PASSWORD`) et la clé de signature sont volontairement séparés : un lien client signé ne permet pas de retrouver le mot de passe.
Template des campagnes Meta : `config/meta-template.json`. Sources du dashboard : `config/sources.json`.
