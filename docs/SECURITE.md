# Sécurité : ce qui est vérifié, par qui, à quelle fréquence

| Contrôle | Où | Quand | Verdict |
|---|---|---|---|
| Typage strict, tests (unitaires, intégration, simulation de parties), construction | `npm run verify`, CI | chaque commit, chaque PR | bloquant |
| Audit des dépendances de production | `npm audit`, CI | chaque PR | bloquant au niveau « élevé » |
| Revue des dépendances (vulnérabilités, licences) | `dependency-review` | chaque PR | bloquant |
| Hygiène du dépôt : secrets, adresses personnelles, inline, tiers, identités de commit | `scripts/hygiene.mjs`, hooks, CI | chaque commit, push, PR | bloquant |
| Secrets dans l'historique | gitleaks | chaque PR, chaque lundi | bloquant |
| Analyse statique | CodeQL (security-extended, code et workflows), Opengrep | chaque PR, chaque lundi | bloquant (ERROR) |
| Audit des workflows | zizmor | chaque PR | bloquant |
| Posture du dépôt | OpenSSF Scorecard | chaque mardi | publié |
| Image : construction, démarrage, absence de gestionnaire de paquets, Trivy | `release.yml` | chaque PR, chaque fusion | bloquant (critique corrigée) |
| Provenance et SBOM de l'image | `release.yml`, attestation GitHub | chaque fusion | vérifiable par `gh attestation verify` |
| OWASP ZAP passif sur l'image | `zap.yml` | chaque PR, chaque lundi | bloquant (moyen ou haut) |
| Contrôle externe du site en ligne (Observatory, DNS, en-têtes, cookies, redirection, version, Socket.io) | `securite.yml` → `scripts/securite-check.mjs` | chaque lundi, à la demande | bloquant |
| Trivy sur l'image publiée | `securite.yml` | chaque lundi | bloquant |
| ZAP passif sur le site en ligne | `securite.yml` | chaque lundi | bloquant |
| Mises à jour | Dependabot (npm, Actions, Docker) | chaque semaine | PR à fusionner |
| Wiki (journal, manifeste) | `wiki.yml` | chaque fusion sur `main` | publié |

Les binaires de scan (Trivy, Opengrep, ZAP) sont pris dans leurs releases officielles,
version et empreinte SHA-256 fixées dans les workflows, jamais par une action tierce.
Les actions GitHub sont épinglées par SHA.

## Réglages Cloudflare attendus

Marche à suivre et points à vérifier dans le [manifeste](MANIFESTE-SECURITE.md) § 8,
valeurs des règles dans [DEPLOIEMENT.md](DEPLOIEMENT.md) § 2 ; tests externes (Observatory,
Blacklight, SSL Labs, DNSViz…) dans le manifeste § 9. Le contrôle externe
vérifie ceux qui se voient de l'extérieur : HTTPS forcé, en-têtes intacts (pas de Rocket
Loader ni de beacon), aucun cookie, SPF `-all`, MX nul, DMARC `reject`.

## Ce que le serveur ne peut pas faire

Envoyer un email, écrire ailleurs que dans `/data`, charger une ressource tierce,
exécuter un script d'installation de dépendance, être joint directement depuis Internet.
