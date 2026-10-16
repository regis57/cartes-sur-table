# Contribuer

Merci. Le projet est fait pour qu'ajouter un jeu soit un exercice cadré : un objet qui
respecte un contrat, des tests qui le prouvent, douze phrases. Le reste vient du socle.

## Avant tout

```bash
npm ci --ignore-scripts
git config core.hooksPath .githooks
npm run verify
```

Une pull request doit passer `npm run verify` (typage strict, tests, construction du
client, audit, hygiène) et les contrôles de la CI. La fusion se fait en « squash ».
Les commits portent une adresse `@users.noreply.github.com`.

## Ajouter un jeu

1. Copier `packages/games/huit-americain` (ou `tarot`, pour un jeu à plis avec enchères)
   vers `packages/games/<mon-jeu>` ; renommer le paquet (`@jdc/<mon-jeu>`) et le déclarer
   dans `packages/server/package.json` (le `Dockerfile` copie `packages/games` en entier).
2. Écrire `src/rules.ts` : l'état `S`, les coups `M`, la vue `V`, et l'objet
   `GameDefinition<S, M, V>`. Le contrat est documenté ligne par ligne dans
   `packages/core/src/contract.ts`. Trois règles sont non négociables :
   - les règles sont **pures** : `applyMove` renvoie un nouvel état, sans réseau, sans
     horloge, sans autre aléa que le `Rng` reçu ;
   - `view(state, seat)` ne contient **que** ce que le siège a le droit de voir, et rien
     d'interne (pas d'identifiants, pas de pioche, pas de mains adverses) ;
   - `determinize(state, seat, rng)` tire un monde possible **compatible avec la vue**.
   Un coup = un choix : si une décision porte sur plusieurs cartes (un écart), la découper
   en autant de coups ; c'est ce qui garde `legalMoves` énumérable et le bot capable de
   raisonner. Si le jeu a sa propre stratégie de bot, la brancher par `botMove` (facultatif) ;
   sinon le MCTS générique joue avec `rolloutMove`.
3. Enregistrer le jeu dans `packages/server/src/games.ts`.
4. Écrire les tests, en copiant la structure de `test/rules.test.ts` :
   - création de manche, coups légaux (clés uniques), coups illégaux refusés, fin de manche
     et de partie, scores ;
   - **la vue ne fuit rien** : une carte d'une main adverse n'apparaît jamais dans la vue
     d'un autre siège ;
   - **determinize** conserve la main du siège, les tailles et le multi-ensemble de cartes ;
   - des parties entières avec `rolloutMove` se terminent (pas de manche infinie) ;
   - le bot MCTS trouve un coup gagnant évident.
5. Ajouter les textes : `packages/client/public/i18n/fr.json` (nom, présentation, règles
   paragraphe par paragraphe sous `games.<mon-jeu>.rules`, douze phrases, succès), une page
   `packages/client/public/jeu/<mon-jeu>/index.html` et son script. Le script n'écrit que
   le rendu de la table et du bilan : il appelle `demarrerSalle` (`salle.ts`), qui fournit
   tout le parcours (identité, modes, file, table privée, niveau, nombre de joueurs, règles,
   menu, réactions, fin de manche, reprise). Les mots propres au jeu (« donne » plutôt que
   « manche ») se posent sous `games.<mon-jeu>.ui`.
6. Mettre à jour `README.md` et la page « À propos ».

## Ce qu'on ne fait pas

- Pas de messagerie libre entre joueurs, pas de pseudo affiché sans assainissement.
- Pas de dépendance ajoutée sans une bonne raison écrite dans la PR : le projet en a deux.
- Pas de `innerHTML`, pas de script ni de style en ligne, pas de ressource chargée depuis
  un tiers : la CSP et l'hygiène le refusent.
- Pas de collecte nouvelle sans mise à jour de la page « Vos données » et du registre.

## Signaler une faille

Voir [SECURITY.md](SECURITY.md) : signalement privé, pas de ticket public.
