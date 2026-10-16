# Journal des versions

Ce que l'on fait à chaque version, et pourquoi. La version est celle de `package.json`,
visible sur `/api/version` du site. Le journal est repris tel quel dans le wiki du dépôt
(dossier `wiki/`, synchronisé à chaque fusion sur `main`).

---

## 0.5.0 — 16 octobre 2026

**La belote, et la version affichée dans « À propos ».**

Ajouté
- **La belote** (`packages/games/belote`) : la belote classique à quatre, par équipes, la
  retourne et ses deux tours d'enchères, l'atout (Valet 20, 9 14), l'obligation de fournir,
  de couper et de surcouper sauf partenaire maître, belote-rebelote annoncée d'office, les
  annonces (tierce, cinquante, cent, carrés) déclarées d'office et montrées après le
  premier pli, le dix de der, « dedans », l'égalité mise en réserve pour la donne suivante,
  le capot à 252, la partie en 1000 points. Solo, en ligne et entre amis, règles dans la
  page des règles, douze phrases, six succès. Le bot est une heuristique propre au jeu
  (`botMove`) ; la défausse libre et les renonces observées nourrissent le monde que tire
  `determinize` pour la recherche Monte-Carlo si on l'emploie.
- **Les jeux par équipes** : le contrat gagne `matchWinners` (facultatif). Les deux
  partenaires comptent la partie comme gagnée, dans les statistiques comme dans les succès ;
  l'écran de fin nomme les deux. Rien ne change pour les jeux à un vainqueur.
- **La version dans « À propos »** : la page lit `/api/version` et affiche la version en
  cours (et la révision), avec un lien vers l'étiquette `vX.Y.Z` de cette version dans le
  dépôt. Chaque version fusionnée sur `main` est donc étiquetée, ce qui lance aussi la
  publication de l'image portant ce numéro.
- Raccourci « Jouer à la belote » dans l'application installée.

À savoir
- Il n'existe pas de dépôt d'origine pour la belote, contrairement au 8 Américain et au
  tarot : les règles retenues sont celles de la belote classique française ; les points
  discutés d'une table à l'autre (annonces d'office, égalité en réserve, partie en 1000)
  sont écrits noir sur blanc dans la page des règles.

---

## 0.4.2 — 16 octobre 2026

**Sauvegarde et mise à jour du NAS, en tâches planifiées.**

Corrigé
- **La méthode de sauvegarde du guide de déploiement était fausse.** Elle copiait le
  fichier de la base à chaud. Or la base tourne en mode WAL : les écritures récentes vivent
  dans un journal à côté jusqu'au prochain point de contrôle. Reproduit à l'essai avec une
  application en marche : la copie obtenue était **vide**, les trois cents profils étant
  encore tous dans le journal. La seconde option du guide, sauvegarder le dossier du volume
  avec Hyper Backup, avait le même défaut, et sa rotation par défaut aurait conservé des
  profils effacés bien au-delà des sept jours promis.

Ajouté
- `deploiement/synology/jeuxdecartes-sauvegarde.sh` : SQLite produit lui-même une copie
  cohérente (`VACUUM INTO`), jeu en marche ; son intégrité est vérifiée avant qu'on la
  garde ; sept copies tournantes sur le NAS, et la dernière isolée pour la clé USB. Rien ne
  traîne en cas d'échec. Éprouvé contre une base vivante dont tout le contenu était encore
  dans le journal : trois cents profils sur trois cents.
- `deploiement/synology/jeuxdecartes-maj.sh` : la mise à jour sans un clic, qui refuse de
  partir sans `PUBLIC_ORIGIN` (sinon les passkeys seraient refusées sans bruit), attend que
  le jeu soit sain **et** que le tunnel se soit reconnecté, et ne touche jamais Altiplume —
  ni ses conteneurs, ni l'image `cloudflared` que les deux tunnels partagent.
- Guide de déploiement : tâches planifiées pas à pas, copie chiffrée sur clé USB par Hyper
  Backup (tâche distincte de celle d'Altiplume, sept versions, chiffrement côté client, clé
  de chiffrement rangée hors du NAS), restauration, et la limite d'une clé branchée en
  permanence.
- Registre des traitements : les sauvegardes y sont décrites.

À savoir
- DSM refuse d'enregistrer une tâche dont le script est collé en entier (« La connexion a
  échoué ») : la tâche ne contient qu'une ligne, qui appelle le fichier.

---

## 0.4.1 — 16 octobre 2026

**Pages : une page de règles dédiée, soutien, mentions légales.**

Ajouté
- **Page « Les règles »** (`/regles/`) : toutes les règles rassemblées, une ancre par jeu
  (`/regles/#tarot`), un sommaire et un bouton pour jouer. Elle est construite depuis le
  dictionnaire, comme la boîte « Règles du jeu » d'une table : une règle corrigée l'est
  partout, et un jeu ajouté y apparaît sans que personne n'y pense.
- Lien « Les règles » dans le pied de toutes les pages.

Changé
- **À propos** ne récite plus les règles du 8 Américain : il renvoie à la page dédiée,
  jeu par jeu. La page redevient ce qu'elle doit être — comment le site fonctionne, et
  comment ajouter un jeu.
- **Soutenir** : le don passe par Buy Me a Coffee (« offrir une bière »). Il reste sans
  contrepartie : rien à débloquer, aucun avantage, aucun effet sur le profil. Rien n'est
  chargé depuis le service de don avant le clic, et le site ne sait pas qui a donné.
- **Mentions légales** : la nature **non professionnelle** de la publication est énoncée
  explicitement (pas de vente, pas de publicité, pas de recette, dons sans contrepartie),
  avec le régime d'adresse qui en découle. Retrait d'une phrase héritée d'un autre projet,
  hors périmètre.
- Les deux derniers champs « à compléter » signalés à chaque construction sont résolus.

Corrigé
- Un lien s'était glissé au milieu d'une phrase de la page Soutenir, et le pied de la page
  hors ligne avait été oublié, lors de l'ajout automatique des liens d'installation.

---

## 0.4.0 — 16 octobre 2026

**Le tarot, et un parcours unique pour tous les jeux.**

Ajouté
- **Tarot français à 4 et 5 joueurs**, règles du jeu d'origine (regis57/tarot-francais-enligne)
  reprises point par point : enchères en un tour (Petite, Garde, Garde sans, Garde contre),
  tout le monde passe → nouvelle donne ; appel au Roi à cinq, partenaire caché jusqu'à ce
  que la carte tombe ; chien montré puis écart (ni Roi ni bout, atout en dernier recours),
  fait carte par carte ; fournir, couper, surcouper ; Excuse qui ne gagne jamais et reste à
  son camp ; objectifs 56 / 51 / 41 / 36 ; Petit au bout ; poignées 10 / 13 / 15 (8 / 10 / 13
  à cinq) ; répartition ×3 à quatre, ×2 + partenaire ×1 (ou ×4 seul) à cinq ; cinq donnes.
- Le bot du jeu d'origine, porté tel quel pour toutes les décisions (enchère, appel, écart,
  poignée, carte), branché par un nouveau crochet du contrat, `botMove` ; le MCTS générique
  reste la voie par défaut des autres jeux.
- Six succès propres au tarot et douze phrases de table.
- **Salle commune** (`salle.ts`) : le lobby, les modes, la file, la table privée, le niveau
  des bots, le choix du nombre de joueurs, le menu, les réactions, la fin de manche et la
  reprise sont désormais un seul code pour tous les jeux. Le 8 Américain l'utilise aussi.
- « Règles du jeu » depuis le lobby et depuis le menu, pour chaque jeu, en français clair.
- Lien « Tous les jeux » en tête de chaque lobby ; les mots changent avec le jeu (« donne
  suivante » au tarot, « manche suivante » au 8).

Changé
- Le bilan de fin de manche est commun (titre, boutons) et chaque jeu y pose son tableau :
  au tarot, contrat, points contre objectif, bouts, Petit au bout, poignées, valeur, rôle
  et points de chacun, et l'historique de la partie donne par donne.
- Accueil : le tarot passe de « bientôt » à jouable ; la belote reste annoncée.

Vérifié
- 17 tests pour le tarot : 78 cartes et 91 points, donne à 4 et à 5, enchères et redonne,
  chien fermé, écart (y compris le cas où l'atout devient permis), fournir / couper /
  surcouper / monter / Excuse, résolution des plis et retour de l'Excuse, décompte sur des
  cas construits (objectifs, Petit au bout dans les deux sens, poignée non multipliée,
  répartition à 4 et à 5), appel au Roi et Dame avec quatre Rois, poignée annonçable une
  fois, vue sans fuite et clés de coups réversibles, déterminisation respectant les
  renonces, quatre parties complètes à somme nulle, bot qui décide avec la vue seule, et
  trois tests de table (humain et bots, cinq joueurs, refus et reprise). 75 tests en tout.
- Parcours joué dans un navigateur réel à quatre et à cinq, de l'accueil au bilan.

### Mise en ligne — 16 octobre 2026

C'est la version mise en service, sur le NAS, derrière son tunnel dédié. Ce qui a été
fait ce jour-là, en plus du déploiement lui-même :

- **DNSSEC activé** sur le domaine : les réponses DNS sont désormais signées.
- **Émission de certificats restreinte** par des enregistrements CAA, pour les noms exacts
  comme pour le joker : seules les autorités employées par l'intermédiaire réseau peuvent
  délivrer un certificat du domaine.
- **Le sous-domaine déclare n'envoyer ni ne recevoir de courrier** (politique d'envoi,
  absence de serveur de réception, politique de rejet) : on ne peut pas écrire en son nom.
- **Limitation de débit au bord du réseau** sur le chemin temps réel, et **contournement
  du cache** pour tout ce qui est vivant : un flot est arrêté avant d'atteindre la maison.
- **Audit des exemptions** : des règles héritées d'une ancienne configuration dispensaient
  certaines adresses d'une partie des contrôles, sur l'ensemble du compte. Supprimées.
- **Vérification des options d'injection** : aucune option de l'intermédiaire n'ajoute de
  JavaScript aux pages — elles contrediraient la CSP du site.
- Installation de l'application vérifiée sur ordinateur depuis le domaine public.

Les valeurs exactes de cette configuration ne figurent pas dans ce dépôt : elles vivent
chez l'hébergeur et chez l'intermédiaire réseau. La marche à suivre, elle, est publique
dans [DEPLOIEMENT.md](DEPLOIEMENT.md).

---

## 0.3.1 — 16 octobre 2026

**Correction : les valeurs des cartes se lisent toujours à l'endroit.**

Corrigé
- Une carte portait deux index, dont celui du bas pivoté à 180°, comme sur une vraie
  carte tenue en éventail. Sur un écran, la carte ne tourne jamais : **un 6 pivoté se
  lisait « 9 »**. L'index retourné remontait de surcroît à côté de celui du haut, faute
  de placement de grille explicite, et dépassait sous la carte voisine dans la main —
  d'où un mélange d'indices à l'endroit et à l'envers, signalé depuis une tablette.
- Une carte porte désormais **un index unique, en haut à gauche, toujours à l'endroit**,
  agrandi, placé explicitement : c'est la seule zone qu'aucune carte voisine ne recouvre
  dans une main en éventail. Captures d'écran du manifeste refaites en conséquence.

---

## 0.3.0 — 16 octobre 2026

**Application installable, sur ordinateur comme sur téléphone.**

Ajouté
- Le site s'installe comme une application : icône sur le bureau, le menu Démarrer,
  le Dock ou l'écran d'accueil, et ouverture dans sa propre fenêtre, sans barre
  d'adresse. Manifeste complet (icônes 192, 512 et *maskable*, raccourcis vers le jeu
  et le profil, captures d'écran pour la fenêtre d'installation).
- Page « Installer l'application » : marche à suivre pas à pas pour chaque navigateur,
  celui de la personne affiché en premier, les autres dépliables. Bouton d'installation
  en un clic là où le navigateur le permet (Chrome, Edge, Opera, Samsung, Firefox Android).
- **iPhone et iPad** : Apple interdit l'installation automatique, le geste doit venir de
  la personne. Les cinq étapes Safari (bouton Partager, « Sur l'écran d'accueil »,
  « Ajouter ») sont détaillées, avec la raison dite franchement.
- Agent de service : démarrage rapide, accueil affiché même sur réseau capricieux, et
  page « Pas de connexion » honnête — une partie se joue sur le serveur, on ne fait pas
  semblant de jouer hors ligne.
- Bandeau d'installation discret sur l'accueil, écartable d'un clic, affiché uniquement
  quand le navigateur sait vraiment installer.

Sécurité et vie privée
- L'agent de service ne met en cache **que** les fichiers publics du site. Jamais `/api/`,
  jamais `/socket.io/`, jamais une page de profil, jamais une partie.
- CSP complétée par `worker-src 'self'` ; `/sw.js` servi sans cache et avec
  `Service-Worker-Allowed: /`, pour qu'une version corrigée s'applique tout de suite.
- Aucune autorisation d'appareil demandée, aucune donnée supplémentaire collectée.
- Deux tests d'intégration : manifeste complet et conforme, ressources citées réellement
  présentes, en-têtes de l'agent de service, version alignée sur `package.json`.

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
- Manifeste de sécurité, bilan des dispositions de sécurité et de durcissement, ce
  journal, wiki synchronisé, guide de déploiement réécrit avec les menus Cloudflare
  d'octobre 2026 et le pas-à-pas Synology.

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
