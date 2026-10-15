# Journal des versions

Ce que l'on fait à chaque version, et pourquoi. La version est celle de `package.json`,
visible sur `/api/version` du site. Le journal est repris tel quel dans le wiki du dépôt
(dossier `wiki/`, synchronisé à chaque fusion sur `main`).

---

## 0.2.0 — 16 octobre 2026

**Passkeys, mode jour / nuit, lisibilité, documentation.**

Ajouté
- Passkeys (WebAuthn) sans dépendance : ajout, liste, retrait depuis le profil ;
  connexion par passkey sans code de récupération ; sessions révocables (« Déconnecter
  les autres appareils »), purgées après 180 jours sans usage. Avertissement affiché :
  une passkey est liée à une famille d'appareils, le code de récupération reste la clé
  de secours.
- Mode jour / nuit : bouton en haut à droite, préférence du système respectée, choix
  mémorisé dans le navigateur.
- Manifeste de sécurité, ce journal, wiki synchronisé, guide de déploiement réécrit
  avec les menus Cloudflare d'octobre 2026 et le pas-à-pas Synology.

Changé
- Texte de base agrandi (1,15 rem), boutons de 48 px minimum, cartes plus grandes sur
  tous les écrans, contrastes renforcés : le public a souvent plus de cinquante ans.
- Export JSON du profil : inclut les passkeys (nom, dates ; jamais la clé) et le nombre
  de sessions.
- Pages « Vos données », « Confidentialité » et registre des traitements : traitement
  « 1 bis. Passkeys et sessions ».

Sécurité
- Vérification WebAuthn : origine et domaine attendus (`PUBLIC_ORIGIN`), défi à usage
  unique de cinq minutes, compteur de signatures (détection de clone), algorithmes
  ES256 et RS256 seulement, attestation non demandée (`none`), 30 tentatives par heure
  et par adresse. Sept tests dont un authentificateur simulé.
- Node 26 (LTS) en production et en CI : image `node:26.10-alpine` épinglée par
  empreinte, `.nvmrc`, `@types/node` 26 ; mises à jour d'actions (Dependabot).
- Scorecard : image de base épinglée par empreinte dans le
  `Dockerfile` ; workflow du wiki sans permission au niveau global (`contents: write`
  sur le seul job). Alertes restantes rejetées avec commentaire : revue de code et
  protection de branche (dépôt à un seul mainteneur, protégé par ruleset), ancienneté
  (projet neuf), fuzzing et badge OpenSSF (non prévus), deux faux positifs CodeQL sur la
  limitation des routes passkeys.

---

## 0.1.0 — 15 octobre 2026

**Version initiale : le socle, le 8 Américain, la chaîne de fabrication.**

Ajouté
- Socle commun : contrat `GameDefinition` avec vue par siège obligatoire, tables,
  matchmaking, tables privées à code, reprise après coupure, bot générique SO-ISMCTS,
  profils sans mot de passe ni email, briques de sécurité.
- Jeu 8 Américain complet, avec quatre succès propres et douze phrases de table.
- Serveur Express + Socket.io, un espace de noms par jeu ; SQLite intégré à Node.
- Client TypeScript sans dépendance : tapis vert, drapeau arrondi, douze avatars,
  réactions toutes faites, pages Vos données, Confidentialité, Mentions légales,
  Soutenir, À propos.
- Pipeline : CI (typage, construction, tests, audit, hygiène), gitleaks, CodeQL (code et
  workflows), Opengrep, zizmor, revue des dépendances, image GHCR avec Trivy, SBOM et
  attestation, ZAP passif, contrôle externe hebdomadaire, Scorecard, Dependabot.
- Dépôt protégé : PR obligatoire, squash seulement, contrôles requis, pas de force-push.

Sécurité
- Revue initiale : tables zombies fermées, bots en pause sans humain, espace de noms par
  défaut refusé, socket AFK libéré, création de profils limitée (10 par heure et par IP),
  plafond de tables respecté par les tables privées, images Docker épinglées.
