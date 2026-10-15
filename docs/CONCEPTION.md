# Conception

## Une plateforme, pas un jeu

Le socle (`packages/core`) ne connaît ni carte, ni atout, ni enchère. Il connaît un
contrat, `GameDefinition<S, M, V>` (`src/contract.ts`), et tout ce qui est commun à tous
les jeux de cartes à plusieurs :

| Brique | Fichier | Ce qu'elle fait, une fois pour tous les jeux |
|---|---|---|
| Table | `table.ts` | Sièges, manches, parties, bots qui « réfléchissent », coups forcés, inactivité, coupure et reprise, réactions |
| Matchmaking | `lobby.ts` | File publique avec compte à rebours ; tables privées par code |
| Bot | `mcts.ts` | SO-ISMCTS générique : ne voit que `view`, raisonne sur `determinize` |
| Profils | `profiles.ts` | Jeton sans mot de passe, statistiques, succès, export, effacement, purge |
| Sécurité | `security.ts` | Assainissement, limites, origine, en-têtes, adresse derrière Cloudflare |
| Protocole | `protocol.ts` | Les événements client ↔ serveur, typés des deux côtés |

Le serveur (`packages/server`) monte chaque jeu sur un espace de noms Socket.io
`/jeu/<id>` et relie la table aux sockets par une `Outbox`. Le client (`packages/client`)
est du TypeScript compilé en modules ES, sans dépendance, qui ne construit jamais de HTML
à partir du réseau.

## Trois invariants

1. **Pureté des règles.** `applyMove(state, seat, move, rng)` renvoie un nouvel état. Les
   tests rejouent des parties entières ; le bot simule des milliers de coups sans effet
   de bord.
2. **Vue par joueur.** Le socle n'envoie jamais `state`, seulement `view(state, seat)`.
   C'est la propriété de confidentialité des mains, et elle est testée.
3. **Information déclarée.** `determinize` est la seule façon pour un bot d'imaginer les
   mains adverses. Un bot ne peut pas tricher par construction.

## Le bot

Recherche arborescente Monte-Carlo sur ensembles d'information, observateur unique
(Cowling, Powley & Whitehouse, 2012). À chaque itération : un monde possible est tiré,
l'arbre partagé est descendu (UCB1 avec comptage de disponibilité), un nœud est ajouté,
une partie est simulée avec `rolloutMove` (la politique de base du jeu), et les
récompenses sont rétropropagées par siège (chaque nœud garde la récompense de celui qui
a joué le coup qui y mène). Le coup le plus visité est joué.

Mesuré sur le 8 Américain, contre des adversaires aléatoires : hasard pur 3 % de manches
gagnées, politique de base 37 %, MCTS à 300 itérations 41 %, à 1 500 itérations 51 %.
Le 8 Américain est très dépendant de la donne ; l'écart sera bien plus grand à la belote
et au tarot, où la politique de base ne suffit pas.

## Identité sans compte

Le navigateur tire 256 bits d'aléa, encodés en base32 (52 caractères). Le serveur en
garde l'empreinte SHA-256 comme identifiant. Le jeton, groupé par quatre, est aussi le
code de récupération : il n'y a rien à réinitialiser, donc rien à envoyer, donc aucune
adresse à collecter. Un invité ne laisse rien sur le serveur.

## Pourquoi TypeScript exécuté par Node

Node 22.18+ retire les annotations de type au chargement : le serveur se lance avec
`node packages/server/src/main.ts`, sans étape de construction ni outil tiers. Le code
est écrit en syntaxe « effaçable » (pas d'`enum`, pas de propriétés de paramètre). Seul le
client est compilé (`tsc`), parce que le navigateur ne retire pas les types.

## Ajouter une langue

Le serveur n'envoie que des codes ; tout texte lisible vient de
`packages/client/public/i18n/<langue>.json` et des pages statiques de la langue. Ajouter
l'anglais = un `en.json` et des pages `/en/…`, aucune ligne de serveur.
