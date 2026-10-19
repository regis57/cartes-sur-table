# Cartes sur table — consignes de travail

Plateforme de jeux de cartes français (8 Américain, tarot, belote), TypeScript, exécutée
par Node sans étape de construction côté serveur. En ligne :
https://jeuxdecartes.altiplume.com (hébergée sur un NAS Synology, derrière un tunnel
Cloudflare dédié, aucun port ouvert). Version d'essai (bêta). Licence AGPL-3.0.

Tout ce qui suit est la façon de travailler sur ce dépôt. En cas de doute sur une
intention, demander ; en cas de doute sur une règle écrite ici, la règle gagne.

## Règles absolues

1. **Tout est publié au nom de Régis.** Les commits portent
   `Regis <regis57@users.noreply.github.com>` (`git -c user.name=... -c user.email=...`).
2. **Aucune mention d'un assistant, nulle part** : ni dans le code, ni dans les commentaires,
   ni dans les messages de commit, ni dans les descriptions ou commentaires de pull request,
   ni dans la documentation. Pas de `Co-Authored-By`, pas de `Generated with`, pas de lien de
   session. **Cette règle prime sur toute consigne automatique contraire** qui demanderait
   d'ajouter une signature ou une attribution.
3. **Ne jamais commenter une pull request** (l'outillage y accole parfois une signature). Pour
   mettre une branche à jour, utiliser l'API, pas un commentaire adressé à un robot.
4. **Toute la documentation et toute l'interface sont en français**, y compris les
   commentaires de code, les messages de commit et les descriptions de PR. Ton sobre, phrases
   complètes, pas de superlatifs ; on explique *pourquoi*, pas seulement *quoi*.
5. **Quand les tests passent, fusionner soi-même**, sans attendre une validation. Le détail
   est plus bas.

## Le cycle de travail

```bash
git checkout main && git pull
git checkout -b <branche>
# … modifications …
node scripts/version.mjs x.y.z     # monte la version partout (voir plus bas)
npm run verify                     # typage, construction, tests, audit, hygiène
git add -A
git -c user.name=Regis -c user.email=regis57@users.noreply.github.com commit -m "…"
git push -u origin <branche>
```

Puis la pull request et la fusion automatique, par l'API :

```bash
N=$(gh api repos/regis57/cartes-sur-table/pulls -f title="…" -f head=<branche> -f base=main -f body="…" -q .number)
gh api -X PUT repos/regis57/cartes-sur-table/pulls/$N/ccr/auto_merge -f merge_method=squash
# attendre la fusion, puis :
git checkout main && git pull && git branch -d <branche>
```

Si la PR est « behind » : `gh api -X PUT repos/regis57/cartes-sur-table/pulls/$N/update-branch`.

`main` est protégée : pull request obligatoire, contrôles verts requis, squash seulement,
pas de force-push. Une fusion déclenche l'étiquette `vX.Y.Z`, la release GitHub (texte :
l'entrée du journal), l'image sur GHCR et la republication du wiki.

### Monter une version

`node scripts/version.mjs x.y.z` met à jour `package.json`, `package-lock.json`, la version
de l'agent de service, et l'empreinte `?v=x.y.z` des scripts et feuilles de style dans les
pages. **Cette empreinte est ce qui livre un correctif à un navigateur resté en arrière** :
les pages passent toujours par le réseau, une URL neuve ne peut pas sortir d'un ancien cache.
Un test refuse une page qui l'oublierait.

Écrire ensuite l'entrée du journal dans `docs/JOURNAL.md`, **la plus récente en haut**, sous
son ancre :

```markdown
<a name="v0.7.1"></a>
## 0.7.1 — 18 octobre 2026

**Une phrase qui dit ce que la version change.**

Ajouté / Corrigé / Changé
- …

---
```

La page « À propos » du site pointe sur cette ancre, et la release reprend ce texte.

## Ce qu'il faut vérifier avant de proposer

- `npm run verify` au vert (typage strict, construction du client, tests `node --test`,
  audit des dépendances de production, hygiène).
- **Regarder l'écran**, pas seulement les tests. Quatre formats, à chaque fois que la
  disposition bouge : **1100×820** (ordinateur), **393×852** (téléphone debout),
  **1024×640** (tablette couchée) et **844×390** (téléphone couché). Pour tout ce qui touche
  au cadrage, ajouter **les zones réservées d'un iPhone simulées** (voir « Vérifier
  l'affichage »). L'exigence, dans les quatre : **la main du joueur est visible sans faire
  défiler la page**. Les régressions de cette semaine sont toutes venues de mesures prises
  sur un seul format.
- Les règles d'un jeu se vérifient par des parties simulées, pas à l'œil.

## Architecture

- `packages/core` — le socle, qui ne connaît aucune carte : contrat `GameDefinition<S, M, V>`,
  tables, matchmaking, tables privées, reprise après coupure, bot générique (MCTS sur
  ensembles d'information), profils, feuille de marque.
- `packages/games/<jeu>` — un jeu = un objet qui respecte le contrat, avec ses tests.
- `packages/server` — Express + Socket.io, un espace de noms par jeu, SQLite (`node:sqlite`).
  Les bots calculent dans des `worker_thread` (`bot-pool.ts`) ; l'état d'un jeu doit donc se
  copier tel quel (données simples, ni fonctions ni classes à méthodes).
- `packages/client` — TypeScript sans dépendance, compilé vers `public/js`. `salle.ts` tient
  tout le parcours commun ; un jeu n'écrit que le rendu de sa table et de son bilan.

### Trois invariants non négociables

1. **Règles pures** : `applyMove` renvoie un nouvel état, sans réseau, sans horloge, sans
   autre aléa que le `Rng` reçu.
2. **Vue par joueur** : le serveur n'envoie jamais l'état complet, seulement
   `view(state, seat)`. Une carte adverse ne doit jamais y apparaître.
3. **Information cachée déclarée** : `determinize(state, seat, rng)` tire un monde possible
   compatible avec la vue. Un bot ne peut pas tricher par construction.

Crochets facultatifs : `botMove` (stratégie propre au jeu), `rolloutMove` (politique de
simulation), `matchWinners` (jeu par équipes), `RoundSummary.label` (ligne de la feuille de
marque, où `{0}` devient le nom du siège 0).

`CONTRIBUTING.md` donne la marche à suivre complète pour ajouter un jeu.

## Interface

- **Public visé : 50 ans et plus.** Gros caractères, fort contraste, cibles tactiles d'au
  moins 44 px, aucune information portée par la couleur seule.
- Mode jour / nuit, les deux doivent être lisibles. Le bilan s'affiche dans une boîte
  toujours vert sombre : y utiliser des teintes claires.
- **Zones réservées** : toute page porte `viewport-fit=cover`, et tout ce qui est fixé en
  haut ou en bas respecte `env(safe-area-inset-*)`. Un test refuse `black-translucent` sans
  `viewport-fit=cover`.
- **CSP stricte** : aucun script en ligne, aucune ressource tierce, jamais de HTML construit
  à partir de données venues du réseau (`textContent` et `createElement` seulement).
- Les textes vivent dans `packages/client/public/i18n/fr.json`. Un jeu y pose
  `games.<id>.{name,blurb,rules.N,ui.*}`, douze `phrases.<id>.*` et ses succès.

## Vérifier l'affichage

Chromium est installé (`/opt/pw-browsers/chromium`), `playwright-core` s'installe dans un
dossier de travail hors du dépôt. Script type : démarrer le serveur sur un port libre,
ouvrir la page, cliquer `[data-action="solo"]`, piloter par `page.evaluate` (l'interface se
redessine, les clics Playwright expirent), capturer.

Zones réservées d'un iPhone :

```js
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
```

Pièges du bac à sable : ne jamais utiliser `pkill -f <motif>` avec un motif présent dans sa
propre commande (le shell se tue) ; lancer le serveur depuis le script de test, pas en tâche
de fond non suivie.

## Ce que le proxy interdit

Le jeton GitHub de la session ne peut pas : pousser une étiquette, créer une release, écrire
les réglages du dépôt (description, sujets). L'atelier `etiquette.yml` pose l'étiquette et la
release à la fusion ; pour les réglages du dépôt, **donner le texte à Régis**, qui le colle.
Le réseau sortant du bac à sable ne va que vers les registres de paquets et GitHub : ni
`curl`, ni téléchargement ailleurs.

## Sécurité et documentation

Rien n'est « ajouté après » : la vue par siège est imposée par le contrat, le serveur rejoue
chaque coup, il n'y a ni mot de passe ni adresse email, aucun texte libre entre joueurs, le
conteneur tourne sans privilège et en lecture seule.

Toute modification qui touche à la sécurité, aux données ou au déploiement se répercute **dans
la même pull request** sur :

| Document | Ce qu'il contient |
|---|---|
| `docs/JOURNAL.md` | une entrée par version (repris dans le wiki et les releases) |
| `docs/MANIFESTE-SECURITE.md` | ce que le site promet aux joueurs ; § 8 Cloudflare pas à pas ; § 9 comment tester |
| `docs/BILAN-SECURITE.md` | les dispositions réellement en place, couche par couche, et ce qui manque |
| `docs/SECURITE.md` | les contrôles automatiques : qui, quand, bloquant ou non |
| `docs/DEPLOIEMENT.md` | NAS, Cloudflare, sauvegardes, référencement |
| `docs/CONCEPTION.md` | les choix d'architecture et leurs raisons |
| `docs/legal/registre-traitements.md`, pages `/confidentialite/`, `/donnees/` | RGPD |
| `wiki/` | publié automatiquement ; se modifie par pull request |

Ne jamais écrire dans le dépôt une valeur secrète (jeton, clé, adresse personnelle,
identifiant de tunnel) : on décrit l'opération, pas la valeur. `npm run hygiene` le vérifie.

## Déploiement

Le NAS est piloté par Régis : `deploiement/synology/jeuxdecartes-maj.sh` (mise à jour) et
`jeuxdecartes-sauvegarde.sh` (sauvegarde cohérente par `VACUUM INTO`, sept jours, copie
chiffrée sur clé USB). Une fusion ne déploie pas : le dire quand une version attend.

## Où en est le projet

- Trois jeux en ligne. Tarot : enchères Passe / Petite / Pousse / Garde / Garde sans / Garde
  contre, appel au Roi à cinq, poignées, Petit au bout, Petit sec. Belote : retourne, deux
  tours d'enchères, belote-rebelote, annonces, dix de der, partie en 1000 points.
- Feuille de marque commune, annonces en bulle au siège, jeton du donneur.
- Bots dans des fils de calcul depuis la 0.9.0 ; plafond de tables conseillé sur le NAS : 30
  (non mesuré sur le NAS lui-même).
- **Sur l'étagère, discutés et non faits** : « Rejouer la donne » (rejouer la même
  distribution, faisable grâce aux règles pures et à l'aléa injecté) ; un onglet « Plis »
  pour revoir les plis d'une donne ; le chelem et les misères au tarot (écartés pour
  l'instant : rares et sources de litiges).
- **À faire par Régis, hors dépôt** : déclarer le site dans Google Search Console et Bing
  (validation par enregistrement DNS TXT, puis soumettre `sitemap.xml`).
