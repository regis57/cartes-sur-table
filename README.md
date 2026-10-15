# Jeux de cartes

Des jeux de cartes français, jouables dans le navigateur, sur téléphone comme sur
ordinateur : seul contre des bots, avec d'autres joueurs, ou entre amis avec un code.
Sans compte obligatoire, sans publicité, sans pistage, sans messagerie.

Premier jeu : le **8 Américain**. Prochains : la belote, le tarot.

## Ce qu'il y a dedans

- **Un socle commun** (`packages/core`) qui ne connaît aucune carte : un contrat de jeu
  (`GameDefinition`), des tables, un matchmaking, des tables privées, la reprise après
  coupure, un bot générique par recherche Monte-Carlo sur ensembles d'information
  (SO-ISMCTS), des profils sans mot de passe ni email, et les briques de sécurité.
- **Un jeu = un objet qui respecte le contrat** (`packages/games/<jeu>`), avec ses tests.
  La vue par joueur est obligatoire : le serveur n'envoie jamais un état complet.
- **Un serveur** Express + Socket.io (`packages/server`), un espace de noms par jeu.
- **Un client** TypeScript sans dépendance (`packages/client`), tapis vert, CSP stricte,
  jamais de HTML construit à partir du réseau.

Deux dépendances de production : `express` et `socket.io`. Pas de base externe : SQLite
intégré à Node (`node:sqlite`). Node 22.18 ou plus récent ; TypeScript exécuté
directement par Node (retrait des types), sans étape de construction côté serveur.

## Démarrer

```bash
git clone https://github.com/regis57/jeuxdecartes.git
cd jeuxdecartes
npm ci --ignore-scripts
npm run dev          # construit le client puis lance le serveur
```

Le site est sur `http://127.0.0.1:3000`. Par défaut, le serveur n'écoute que sur la
machine locale et garde les profils en mémoire ; voir [SECURITY.md](SECURITY.md) pour
les variables de configuration et [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) pour le
déploiement sur le NAS, derrière un tunnel Cloudflare, sans aucun port ouvert.

## Vérifier

```bash
git config core.hooksPath .githooks   # une fois par clone : contrôles locaux
npm run verify                        # typage strict, tests, construction, audit, hygiène
```

| Quand | Quoi |
|---|---|
| Avant chaque commit | hook `pre-commit` : refuse les secrets |
| Avant chaque push | hook `pre-push` : `npm run verify` |
| Chaque pull request | CI, CodeQL, Opengrep, revue des dépendances, image Docker + Trivy, OWASP ZAP passif |
| Chaque fusion sur `main` | image publiée sur GHCR avec SBOM et attestation de provenance |
| Chaque lundi | contrôle externe du site en ligne, Trivy sur l'image publiée, ZAP sur le site |
| Chaque semaine | Dependabot (npm, Actions, Docker) |

La branche `main` est protégée : pull request obligatoire, contrôles verts requis, commits
signés, squash seulement, pas de force-push (`.github/rulesets/protect-main.json`).

## Ajouter un jeu

Lire [CONTRIBUTING.md](CONTRIBUTING.md) : le contrat, ligne par ligne, et la liste de ce
qu'un jeu doit prouver par ses tests. Le 8 Américain (`packages/games/huit-americain`)
est le modèle à copier.

## Données personnelles

Rien n'est enregistré pour un invité. Un profil (facultatif) ne contient qu'une empreinte
de jeton, un pseudo, un avatar, deux dates au jour près, des compteurs et des succès.
Jamais d'adresse email, de mot de passe ni d'adresse IP. Export JSON et suppression
immédiate depuis la page Profil. Détail : la page « Vos données » du site et
[docs/legal/registre-traitements.md](docs/legal/registre-traitements.md).

## Licence

GNU Affero General Public License v3.0 ou ultérieure. Si vous hébergez une version
modifiée accessible par le réseau, vous devez en proposer le code source complet à vos
joueurs. Voir [LICENSE](LICENSE).
