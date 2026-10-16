# Bilan : sécurité par conception et durcissement

État au 16 octobre 2026, version 0.4.0 — site en ligne. Ce document recense ce qui est **réellement en
place dans le code**, couche par couche, avec le fichier où le vérifier. Le
[manifeste](MANIFESTE-SECURITE.md) dit ce que le projet promet ; ce bilan dit comment.
Les contrôles automatiques qui surveillent le tout sont dans [SECURITE.md](SECURITE.md).

Trois principes guident l'ensemble : **ne pas collecter** (ce qui n'existe pas ne fuit
pas), **ne pas faire confiance au client** (tout est revalidé côté serveur), **réduire
la surface** (deux dépendances, aucun port ouvert, aucune ressource tierce).

---

## 1. Conception : la donnée qu'on n'a pas

| Disposition | Où | Effet |
|---|---|---|
| Aucun compte obligatoire : on joue en invité, rien n'est écrit | `app.ts`, `profile.ts` | Un visiteur ne laisse aucune trace serveur |
| Aucun mot de passe, aucune adresse email | partout | Rien à voler, rien à réinitialiser, aucun email à protéger |
| Jeton de profil tiré **par le navigateur** (256 bits, base32) | `client/src/profile.ts` | Le serveur ne choisit pas le secret et ne le voit qu'une fois |
| Le serveur ne stocke que l'**empreinte SHA-256** du jeton | `core/src/profiles.ts` | Une copie de la base ne donne accès à aucun profil |
| Jeton transmis en en-tête `Authorization`, jamais en URL ni en cookie | `client/src/profile.ts` | Pas de fuite par journaux, référents, historique ; pas de CSRF |
| Aucune adresse IP persistée (ni journal applicatif, ni base) | `core/src/security.ts`, `app.ts` | L'IP sert aux compteurs en mémoire, et disparaît avec eux |
| Dates arrondies au jour | `core/src/profiles.ts` | Pas de reconstitution d'habitudes de vie |
| Effacement réel et immédiat, en cascade | `profiles.ts` (`ON DELETE CASCADE`) | Le droit à l'effacement s'exerce sans formulaire ni délai |
| Purge automatique : profils à 365 jours, sessions à 180 jours | `app.ts` (minuterie de maintenance) | La donnée dormante finit par disparaître d'elle-même |
| Export JSON complet depuis la page Profil | `app.ts` `/api/profil/export` | Portabilité sans intervention humaine |

## 2. Règles du jeu : l'anti-triche est structurel

| Disposition | Où | Effet |
|---|---|---|
| `view(state, seat)` **obligatoire** dans le contrat de jeu | `core/src/contract.ts` | Un jeu ne peut pas livrer l'état complet : le socle n'envoie que la vue du siège |
| Le serveur rejoue chaque coup contre `legalMoves` | `core/src/table.ts` | Un client modifié triche sur son écran, pas sur la table |
| Coups désignés par une **clé opaque**, jamais par un objet reconstruit | `table.ts`, `protocol.ts` | Aucune donnée de jeu fabriquée par le client n'entre dans l'état |
| Les bots jouent par détermination aléatoire de la même vue | `core/src/mcts.ts`, `determinize` | Le bot ne voit pas les cartes adverses |
| Aléa cryptographique (`node:crypto` `randomInt`), jamais `Math.random` | `core/src/rng.ts`, `lobby.ts` | Donnes et codes d'invitation non prédictibles |

## 3. Entrées réseau : rien n'est cru sur parole

| Disposition | Où |
|---|---|
| Pseudos : normalisation NFC, retrait des caractères de contrôle, de formatage et **bidirectionnels** (« Trojan Source »), liste blanche de caractères, longueur 20 | `security.ts` `sanitizeName` |
| Chaque identifiant a son format validé : table (`^(solo\|online\|private)_…`), code d'invitation (alphabet sans 0/O/1/I), jeton (52 base32), clé de reprise (UUID v4), identifiant de passkey (base64url borné) | `security.ts`, `webauthn.ts` |
| Charge utile Socket.io plafonnée à **4 Ko** | `app.ts` (`maxHttpBufferSize`) |
| Tout objet reçu passe par `isPlainObject` / `isSmallInt` avant usage | `security.ts`, `app.ts` |
| Aucun texte libre entre joueurs : réactions et phrases sont des **codes d'un catalogue fermé** | `table.ts` `EMOJI_CODES`, `PHRASES` |
| Requêtes SQL exclusivement préparées et paramétrées | `profiles.ts` |

## 4. Transport et navigateur

| Disposition | Détail |
|---|---|
| CSP `default-src 'none'` | `script-src 'self'`, `style-src 'self'`, `worker-src 'self'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `upgrade-insecure-requests` |
| **Zéro script ou style en ligne**, zéro CDN | Vérifié à chaque commit par `scripts/hygiene.mjs` (échec si un `src=`/`href=` tiers ou un `onclick=` apparaît) |
| Le client ne construit jamais de HTML à partir du réseau | Uniquement `textContent` et création de nœuds (`ui.ts`) |
| En-têtes | HSTS 1 an + sous-domaines, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (géoloc, micro, caméra, paiement, USB, cohortes publicitaires toutes refusées), COOP/CORP/COEP, `X-Frame-Options: DENY`, `X-DNS-Prefetch-Control: off`, pas de `X-Powered-By` |
| Contrôle d'origine à l'établissement de la connexion WebSocket | `allowRequest` → `isOriginAllowed` : bloque le détournement depuis un site tiers (CSWSH) |
| Aucun cookie | Donc aucun bandeau à accepter, et aucune CSRF possible |
| Fichiers statiques : pas de fichiers cachés, pas d'échappement du dossier | `express.static` avec `dotfiles: 'ignore'` |
| Au bord du réseau : limitation de débit par adresse sur le chemin temps réel, contournement du cache sur ce qui est vivant, protection DDoS et jeu de règles managé actifs, contrôle d'intégrité du navigateur | Configuré chez l'intermédiaire réseau, décrit dans [DEPLOIEMENT.md](DEPLOIEMENT.md) § 2 |
| Aucune option de l'intermédiaire n'injecte de JavaScript dans les pages | Vérifié à la mise en ligne : ces options contrediraient la CSP |
| Aucune adresse n'est dispensée des contrôles | Les exemptions héritées d'anciennes configurations ont été auditées et supprimées |
| Agent de service (installation) : met en cache **uniquement** les fichiers publics ; `/api/`, `/socket.io/` et `/healthz` sont exclus par liste noire explicite | `public/sw.js` — aucune donnée de profil ni de partie ne touche le cache du navigateur |
| `/sw.js` servi sans cache, avec `Service-Worker-Allowed: /` | Une version corrigée de l'agent s'applique immédiatement, jamais dans une heure |

## 5. Passkeys (WebAuthn), vérifiées à la main

Implémentation sans dépendance (`core/src/webauthn.ts`), ce qui évite d'ajouter 40 paquets
dans la chaîne d'approvisionnement pour une fonction de 300 lignes.

- Seule la **clé publique** est stockée ; la clé privée ne quitte jamais l'appareil.
- Origine et domaine (`rpId`) comparés à `PUBLIC_ORIGIN` — sans lui, en production, aucune
  passkey n'est acceptée.
- Défi à **usage unique**, 5 minutes, lié au profil pour un enregistrement.
- **Compteur de signatures** vérifié : un authentificateur cloné est refusé.
- Algorithmes limités à ES256 et RS256 ; attestation non demandée (`none`) : pas de
  traçage du modèle d'appareil.
- Décodeur CBOR défensif : refus des formes ambiguës ou surdimensionnées.
- 30 tentatives par heure et par adresse ; sessions révocables en un clic.
- L'avertissement « une passkey est liée à une famille d'appareils » est affiché sur la
  page Profil : le code de récupération reste la clé de secours.

## 6. Disponibilité : un NAS familial ne doit pas tomber

| Disposition | Valeur | Où |
|---|---|---|
| Limitation HTTP par IP (fenêtre fixe) | configurable, défaut 300/min | `security.ts` `httpRateLimit` |
| Création de profil | 10 par heure et par IP | `app.ts` |
| Routes passkeys | 30 par heure et par IP | `app.ts` |
| Événements Socket.io | seau à jetons par connexion | `security.ts` `createRateLimiter` |
| Connexions simultanées par IP | plafonnées | `app.ts` `maxConnPerIp` |
| Nombre de tables | plafonné, tables privées comprises | `app.ts` `maxTables` |
| Tables zombies | détruites par `onDestroy` | `table.ts` |
| Bots | **en pause dès qu'aucun humain** n'est à la table | `table.ts` (`humansPresent === 0`) |
| Espace de noms Socket.io par défaut | refusé | `app.ts` (`io.of('/')`) |
| Adresse du client derrière Cloudflare | `CF-Connecting-IP` uniquement, jamais `X-Forwarded-For` | `security.ts` `getClientIp` |

Ce dernier point est à la fois sécurité et correction : sans lui, tous les joueurs
auraient l'adresse du tunnel et la limite par IP bloquerait le 11ᵉ joueur du site.

## 7. Exécution : l'image et le conteneur

| Disposition | Où |
|---|---|
| Image de base épinglée par **empreinte d'index** (`node:26.10-alpine@sha256:…`) | `Dockerfile` |
| **npm, npx, corepack et yarn supprimés** de l'image finale | `Dockerfile` — rien à installer depuis un conteneur compromis |
| Utilisateur non privilégié (`USER node`), fichiers possédés par `node` | `Dockerfile` |
| Système de fichiers **en lecture seule**, `/tmp` en tmpfs de 16 Mo | `docker-compose.yml` |
| `cap_drop: [ALL]`, `no-new-privileges:true` sur les deux conteneurs | `docker-compose.yml` |
| `pids_limit: 128`, `mem_limit: 512m` | `docker-compose.yml` — une fuite ne peut pas affamer le NAS ni Altiplume |
| **Aucun port publié** : le seul chemin est un tunnel sortant dédié | `docker-compose.yml`, `docs/DEPLOIEMENT.md` |
| Réseau Docker, volume et tunnel séparés d'Altiplume | `docker-compose.yml` |
| Journaux tournants (10 Mo × 3), sans adresse IP | `docker-compose.yml` |
| `HEALTHCHECK` interne sur `/healthz` | `Dockerfile` |
| Base SQLite : `foreign_keys = ON`, WAL, `busy_timeout` | `profiles.ts` |

## 8. Chaîne d'approvisionnement et fabrication

| Disposition | Où |
|---|---|
| **Deux dépendances de production** : `express`, `socket.io`. SQLite vient de Node | `package.json` |
| `npm ci --ignore-scripts` : aucun script d'installation n'est exécuté | `Dockerfile`, CI |
| Actions GitHub épinglées par **SHA de commit**, jamais par étiquette | `.github/workflows/*` |
| Outils de scan (Trivy, Opengrep, ZAP) pris dans leurs releases officielles, **empreinte SHA-256 vérifiée** | `release.yml` |
| Image publiée avec **SBOM et attestation de provenance** (`gh attestation verify`) | `release.yml` |
| Branche `main` protégée : PR obligatoire, **8 contrôles requis**, squash seul, pas de force-push | `.github/rulesets/protect-main.json` |
| Hooks locaux : secrets au commit, `npm run verify` au push | `.githooks/` |
| Hygiène du dépôt à chaque commit : secrets, adresses personnelles, chargements tiers, HTML en ligne, identités de commit | `scripts/hygiene.mjs` |
| Dependabot (npm, Actions, Docker) avec délai de 7 jours | `.github/dependabot.yml` |
| Contrôle **externe** hebdomadaire du site en ligne : en-têtes, DNS, cookies, redirection, Socket.io | `securite.yml`, `scripts/securite-check.mjs` |

## 9. Conformité et transparence

- Registre des traitements tenu à jour dans le dépôt
  ([`legal/registre-traitements.md`](legal/registre-traitements.md)), modifié dans la même
  PR que le code qu'il décrit.
- Pages « Vos données », « Confidentialité » et « Mentions légales » écrites en français
  clair, avec un tableau « ce qui est gardé / pourquoi / combien de temps ».
- **DNSSEC actif** : les réponses DNS du domaine sont signées, une réponse forgée ne peut
  pas détourner les visiteurs vers un faux serveur.
- **Émission de certificats restreinte** (CAA, noms exacts et joker) : seules les autorités
  employées par l'intermédiaire réseau peuvent délivrer un certificat pour le domaine ;
  toute autre doit refuser. À revoir si un service tiers doit un jour présenter un
  certificat sur un sous-domaine.
- **Le sous-domaine du jeu déclare n'envoyer ni ne recevoir de courrier** : usurper une
  adresse à son nom ne mène nulle part.
- Code sous AGPL-3.0 : toute version modifiée accessible par le réseau doit publier son
  code.

---

Mesures externes à la mise en ligne (16 octobre 2026) : Mozilla HTTP Observatory **A+** ;
Blacklight (The Markup) **0 traceur publicitaire, 0 cookie tiers**, aucune empreinte
navigateur, aucun enregistrement de session, aucun pixel, aucune société publicitaire ;
DNSSEC validé, CAA posés, courrier du sous-domaine verrouillé. La marche à suivre pour
refaire ces tests est dans le [manifeste](MANIFESTE-SECURITE.md) § 9.

## Ce qui reste à faire

| Point | Pourquoi ce n'est pas fait | Quand |
|---|---|---|
| Relecture par un second humain | Un seul mainteneur ; les contrôles automatiques compensent partiellement | Si un contributeur rejoint |
| Fuzzing continu (OSS-Fuzz) | Hors proportion pour le projet ; des simulations aléatoires de parties tournent à chaque CI | Non planifié |
| Badge OpenSSF Best Practices | Démarche déclarative | Non planifié |
| Signature des commits (Sigstore / GPG) | Le dépôt n'exige pas encore les commits signés | À activer |
| Sauvegarde **hors site** | La sauvegarde est faite : copie cohérente quotidienne, intégrité vérifiée, chiffrée côté client sur une clé USB, sept jours au plus. Mais la clé reste branchée au NAS : elle ne protège ni d'un sinistre, ni d'un logiciel malveillant qui prendrait la main sur le serveur | Débrancher la clé régulièrement, ou en faire tourner deux |
| Audit externe | Pas de budget | Si le projet grandit |

Un manque signalé ici vaut mieux qu'un manque ignoré : ce tableau fait partie du bilan.
