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
Le 8 Américain est très dépendant de la donne ; l'écart sera bien plus grand à la belote,
où la politique de base ne suffit pas.

**Quand le jeu impose sa stratégie.** Le contrat offre un crochet facultatif, `botMove` :
quand il renvoie un coup, le socle le joue tel quel ; quand il renvoie `null`, le MCTS
générique décide. Le tarot l'utilise pour toutes ses décisions, avec la stratégie du jeu
d'origine (regis57/tarot-francais-enligne) reprise point par point : évaluation de la main
pour les enchères, appel dans la couleur longue, écart des plus petites cartes ordinaires,
puis au jeu de la carte : maîtresses à points en entame, ramasser au moindre coût en dernier,
protéger les figures, garder l'Excuse pour l'avant-dernier pli. La belote fait de même avec une
heuristique plus courte (valeur de la main pour prendre, maîtresses en entame, charger le
partenaire quand le pli est sûr, ramasser au moindre coût), et c'est elle qui a imposé un
second crochet, `matchWinners` : dans un jeu par équipes, les deux partenaires gagnent la
partie, et le socle doit le savoir pour les statistiques et les succès. Une donne de tarot, c'est
cinq enchères, un écart et jusqu'à quatre-vingt-dix cartes : à 150 ms de réflexion le MCTS
ne converge pas, et il produirait des enchères fantaisistes. La même stratégie sert de
`rolloutMove`, de sorte qu'un MCTS reste possible en retirant le crochet — rien d'autre
à changer.

## Ce que le socle tient pour tous les jeux

Un jeu décrit ses règles et dessine sa table ; tout ce qui se répète d'un jeu à l'autre
vit une seule fois, dans le socle ou dans la salle.

- **La feuille de marque.** À la fin de chaque manche, le socle garde la ligne que le jeu
  lui donne (`RoundSummary.label`, où `{0}` est remplacé par le nom du siège 0), les points
  de chacun et les totaux, dans `SeatView.rounds`. Le menu de table l'affiche. Un nouveau
  jeu l'a sans écrire une ligne d'affichage.
- **Les vainqueurs.** `matchWinner` suffit à un jeu individuel ; un jeu par équipes renvoie
  aussi `matchWinners`, et les deux partenaires comptent la partie comme gagnée, dans les
  statistiques comme dans les succès.
- **La stratégie propre au jeu.** `botMove` court-circuite le MCTS quand le jeu sait mieux
  faire (le tarot et la belote s'en servent) ; `rolloutMove` reste la politique de
  simulation. Il reçoit le niveau de la table : c'est au jeu de jouer moins bien au niveau
  « facile » (le tarot et la belote enchérissent avec bon sens mais jouent une carte sur
  deux au hasard), parce que le socle ne sait pas ce qui relève du bon sens ou de la
  finesse. Sans cela, « Facile » jouait exactement comme « Normal ».
- **Les mondes possibles.** `repartir` (dans `rng.ts`) distribue des cartes entre des places
  qui ne les admettent pas toutes (« ce joueur n'a plus de pique »), en posant d'abord la
  carte la plus contrainte. Chaque `determinize` s'en sert ; un remplissage main par main
  violait les renonces alors qu'un monde valide existait.
- **Les étiquettes de siège.** `seatLabel` dessine avatar, nom, score, état, et pose le
  jeton du donneur ; `seatAnnounce` colle au siège une bulle qui reste — ce que la personne
  vient d'annoncer. Un jeu décide quoi y mettre, jamais comment le dessiner.
- **Le parcours**, enfin, est entièrement dans `salle.ts` : modes, file, table privée,
  niveau, règles, réactions, menu, marque, fin de manche, reprise après coupure.

## Reprendre son siège après une coupure

Un téléphone change de réseau, se met en veille, passe dans un tunnel : Socket.io se
reconnecte de lui-même, avec un nouvel identifiant que rien ne relie au siège. La page
redemande donc son siège **à chaque connexion**, avec la clé reçue au départ. Côté serveur,
la clé fait foi même si l'ancienne connexion semble encore vivante : le serveur ne
constate la mort d'une connexion qu'au bout de son délai de battement (près d'une minute),
alors que la nouvelle arrive en une seconde. L'ancienne est prévenue (`seatTaken`, au cas
où ce serait un second onglet bien vivant) puis déliée. La page ne cesse jamais de chercher
à se reconnecter.

## Mettre à jour un joueur qui n'a rien demandé

Le site s'installe comme une application : un agent de service garde une copie des fichiers
publics. C'est ce qui le rend instantané, et c'est aussi le piège classique — un onglet
peut tourner pendant des jours avec les scripts d'hier face à un serveur d'aujourd'hui, et
afficher des choses fausses sans que rien ne plante (vu au tarot : un contrat nommé d'après
l'ancienne liste d'enchères).

Trois dispositions, de la plus fiable à la plus fine :

1. **Les pages passent toujours par le réseau** (le cache n'est qu'un secours hors ligne),
   et elles demandent leurs scripts et leurs styles avec l'empreinte de la version
   (`?v=x.y.z`). Une URL neuve ne peut pas être servie depuis un ancien cache : la nouvelle
   version arrive au premier chargement, quelle que soit la génération de l'agent.
2. **L'agent neuf prend la main sans attendre** (`skipWaiting` dès l'installation), et la
   page se recharge quand il devient le sien — immédiatement hors table, à la fin de la
   manche si une partie est en cours, jamais au milieu d'un pli.
3. **La page vérifie elle-même** : elle demande sa version à l'agent qui la sert et au
   serveur la sienne ; si elles diffèrent, elle se recharge une fois.

La première suffit, les deux autres raccourcissent le délai. La règle qui les gouverne :
un correctif ne doit jamais dépendre du correctif précédent pour être livré.

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
