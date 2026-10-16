# Cartes sur table

Des jeux de cartes français, jouables dans le navigateur, sur téléphone comme sur
ordinateur : seul contre des bots, avec d'autres joueurs, ou entre amis avec un code.
Sans compte obligatoire, sans publicité, sans pistage, sans messagerie.

Deux jeux : le **8 Américain** et le **tarot** (à 4 ou 5, avec appel au Roi). Prochain : la belote.

## Ce qu'il y a dedans

- **Un socle commun** (`packages/core`) qui ne connaît aucune carte : un contrat de jeu
  (`GameDefinition`), des tables, un matchmaking, des tables privées, la reprise après
  coupure, un bot générique par recherche Monte-Carlo sur ensembles d'information
  (SO-ISMCTS), des profils sans mot de passe ni email, et les briques de sécurité.
- **Un jeu = un objet qui respecte le contrat** (`packages/games/<jeu>`), avec ses tests.
  La vue par joueur est obligatoire : le serveur n'envoie jamais un état complet. Les
  règles du 8 Américain et du tarot sont celles des jeux d'origine (regis57/8americain,
  regis57/tarot-francais-enligne), reprises point par point.
- **Une salle commune** côté client (`salle.ts`) : identité, solo / en ligne / entre amis,
  niveau des bots, nombre de joueurs, règles, menu, réactions, fin de manche, reprise après
  coupure. Un jeu n'écrit que le rendu de sa table : le parcours est le même partout.
- **Un serveur** Express + Socket.io (`packages/server`), un espace de noms par jeu.
- **Un client** TypeScript sans dépendance (`packages/client`), tapis vert, CSP stricte,
  jamais de HTML construit à partir du réseau.

Deux dépendances de production : `express` et `socket.io`. Pas de base externe : SQLite
intégré à Node (`node:sqlite`). Node 22.18 ou plus récent (26 en production) ; TypeScript exécuté
directement par Node (retrait des types), sans étape de construction côté serveur.

La sécurité n'est pas une couche ajoutée : la vue par siège est imposée par le contrat de
jeu, le serveur rejoue chaque coup, il n'y a ni mot de passe ni adresse email à protéger,
aucun texte libre ne circule entre joueurs, et le conteneur tourne sans privilège, en
lecture seule, sans port ouvert. Le détail est dans le
[bilan sécurité](docs/BILAN-SECURITE.md).

## Démarrer

```bash
git clone https://github.com/regis57/cartes-sur-table.git
cd cartes-sur-table
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
| Chaque pull request | CI, gitleaks, CodeQL, zizmor, Opengrep, revue des dépendances, image Docker + Trivy, OWASP ZAP passif |
| Chaque fusion sur `main` | image publiée sur GHCR avec SBOM et attestation de provenance |
| Chaque lundi | contrôle externe du site en ligne, Trivy sur l'image publiée, ZAP sur le site |
| Chaque semaine | Dependabot (npm, Actions, Docker) ; OpenSSF Scorecard le mardi |

La branche `main` est protégée : pull request obligatoire, contrôles verts requis, commits
signés, squash seulement, pas de force-push (`.github/rulesets/protect-main.json`).

## Installer l'application

Le site s'installe comme une application — icône sur le bureau, le Dock ou l'écran
d'accueil, et ouverture dans sa propre fenêtre. En un clic sur Chrome, Edge, Opera,
Samsung Internet et Firefox pour Android ; à la main sur iPhone, iPad et Safari, parce
qu'Apple l'impose. La page `/installer/` détaille la marche à suivre pour chaque
navigateur, en affichant d'abord celui de la personne.

Un agent de service (`packages/client/public/sw.js`) rend le démarrage instantané et
l'accueil disponible sur réseau capricieux. Il ne met en cache que les fichiers publics :
ni `/api/`, ni `/socket.io/`, ni aucune page de profil. Jouer demande toujours une
connexion — les parties se déroulent sur le serveur, y compris contre les bots.

## Sécurité et journal

- [docs/MANIFESTE-SECURITE.md](docs/MANIFESTE-SECURITE.md) : ce que le site promet aux
  joueurs et ce qu'il s'interdit.
- [docs/BILAN-SECURITE.md](docs/BILAN-SECURITE.md) : le bilan des dispositions de sécurité
  par conception et de durcissement, couche par couche, avec le fichier où les vérifier —
  et la liste de ce qui reste à faire.
- [docs/JOURNAL.md](docs/JOURNAL.md) : ce que l'on fait à chaque version. Repris dans le
  [wiki](https://github.com/regis57/cartes-sur-table/wiki), synchronisé à chaque fusion.
- [docs/SECURITE.md](docs/SECURITE.md) : les contrôles automatiques, par qui, quand.
- [SECURITY.md](SECURITY.md) : signaler une faille, variables de configuration.

Toute la documentation est en français, README compris ; le wiki sera porté en anglais
si le site l'est.

## Ajouter un jeu

Lire [CONTRIBUTING.md](CONTRIBUTING.md) : le contrat, ligne par ligne, et la liste de ce
qu'un jeu doit prouver par ses tests. Le 8 Américain (`packages/games/huit-americain`)
est le modèle à copier.

## Données personnelles

Rien n'est enregistré pour un invité. Un profil (facultatif) ne contient qu'une empreinte
de jeton, un pseudo, un avatar, deux dates au jour près, des compteurs et des succès.
Jamais d'adresse email, de mot de passe ni d'adresse IP. Passkeys en option, sans
rien de plus sur le serveur qu'une clé publique. Export JSON et suppression
immédiate depuis la page Profil. Détail : la page « Vos données » du site et
[docs/legal/registre-traitements.md](docs/legal/registre-traitements.md).

## Licence

GNU Affero General Public License v3.0 ou ultérieure. Si vous hébergez une version
modifiée accessible par le réseau, vous devez en proposer le code source complet à vos
joueurs. Voir [LICENSE](LICENSE).
