# Journal des versions

Ce que l'on fait à chaque version, et pourquoi. La version est celle de `package.json`,
visible sur `/api/version` du site. Le journal est repris tel quel dans le wiki du dépôt
(dossier `wiki/`, synchronisé à chaque fusion sur `main`).

---

<a name="v0.6.8"></a>
## 0.6.8 — 17 octobre 2026

**La documentation rattrape le code.**

Mis à jour
- **README** : la bêta annoncée dès l'entrée, la feuille de marque dans la salle commune,
  et une section « Monter une version » — `node scripts/version.mjs x.y.z`, à quoi sert
  l'empreinte `?v=`, ce que la fusion pose toute seule (étiquette, release, wiki).
- **Conception** : deux chapitres neufs. « Ce que le socle tient pour tous les jeux »
  (feuille de marque, vainqueurs par équipes, `botMove`, parcours unique) et « Mettre à
  jour un joueur qui n'a rien demandé » — le piège du cache d'application, les trois
  dispositions qui l'évitent, et la règle qui les gouverne : un correctif ne doit jamais
  dépendre du correctif précédent pour être livré.
- **Déploiement** : § 6.3 réécrit (ce que voient les joueurs après une mise à jour, et où
  lire la version qui tourne vraiment) ; nouveau § 8 « Référencement », la seule partie qui
  passe encore par un compte — Search Console et Bing, validation par enregistrement DNS,
  soumission du plan du site.
- **Contrôles de sécurité** : pourquoi la livraison d'un correctif est elle-même une
  exigence de sécurité.
- **Guide de contribution** : `viewport-fit=cover` et zones réservées sur toute page
  nouvelle, et regarder sa table à 393 px avant de la proposer.
- **Wiki** et **page Confidentialité** (le repère de version gardé par le navigateur) au
  même niveau.

---

<a name="v0.6.7"></a>
## 0.6.7 — 17 octobre 2026

**Les enchères tiennent dans l'écran d'un téléphone.**

Corrigé
- Sur un téléphone, le centre de la table n'avait qu'un tiers de la largeur : les six
  contrats du tarot s'empilaient un par ligne et débordaient sur les sièges et la main. Les
  sièges de côté se serrent (ils ne portent qu'un avatar, un score et un dos de cartes) et
  les boutons d'enchère tiennent deux par ligne ; tout est visible sans rien recouvrir. La
  belote (Je passe / Je prends, puis les trois couleurs) et le 8 Américain en profitent.
- Pour mémoire, le chevauchement vu sur une ancienne version — statut sur le contrat, main
  sur les boutons — venait de la grille à hauteur fixe d'avant la 0.6.2 ; l'empreinte de
  version (0.6.6) fait que ces écrans-là ne reviendront pas.

---

<a name="v0.6.6"></a>
## 0.6.6 — 17 octobre 2026

**Le menu reste atteignable sur téléphone, et une version neuve chasse l'ancienne pour de bon.**

Corrigé
- **Dix pages sur treize se glissaient sous la barre d'état de l'iPhone** : elles déclaraient
  l'affichage sous la barre (`black-translucent`) sans demander les zones réservées
  (`viewport-fit=cover`), et `env(safe-area-inset-*)` y valait zéro. Les trois pages de jeu
  l'avaient ; l'accueil, le profil, les règles, non.
- **Le menu de table sur téléphone** : le bouton est plus grand, bien sous l'îlot dynamique,
  et un second bouton « Menu » attend sous la main, à portée de pouce — une main de tarot
  peut dépasser l'écran, aucun des deux ne doit être le seul chemin. Le bouton de thème
  s'efface du jeu sur petit écran ; le mode jour / nuit se règle depuis le menu.
- **La mise à jour atteint enfin les navigateurs restés en arrière.** Les correctifs
  précédents vivaient dans les nouveaux scripts : un navigateur servi par les anciens ne les
  exécutait jamais. Les pages, elles, sont toujours relues sur le réseau : elles demandent
  désormais leurs scripts et leurs styles avec l'empreinte de la version (`?v=x.y.z`). Une
  URL neuve ne peut pas être servie depuis un ancien cache — la nouvelle version arrive donc
  au premier chargement de page, quelle que soit la génération de l'agent de service.
  `node scripts/version.mjs x.y.z` pose le tout, et un test refuse une page qui l'oublierait.

---

<a name="v0.6.5"></a>
## 0.6.5 — 17 octobre 2026

**Tarot : relecture des règles face au règlement officiel.**

Vérifié, et déjà conforme : Garde sans et Garde contre ne montrent pas le chien et ne
donnent lieu à aucun écart ; le chien compte pour le preneur (sans) ou pour la défense
(contre). Un écran « Garde sans » avec le chien ouvert n'était pas le serveur mais un onglet
resté sur les anciens scripts, où le troisième contrat s'appelait encore Garde sans ; la
0.6.4 recharge ces onglets d'eux-mêmes. Un test joue désormais les deux contrats de bout en
bout et vérifie à qui vont les points du chien.

Ajouté
- **Petit sec** : une main dont le seul atout est le Petit, sans l'Excuse, annule la donne ;
  on redonne, le donneur tourne, et la table le dit.
- **Atouts écartés montrés** : quand le preneur, faute d'autre carte, écarte de l'atout, ces
  atouts sont visibles de tous pendant la donne, comme à la table.
- Les règles affichées disent tout cela.

Non retenu, en connaissance de cause : le chelem (annoncé ou non) et les misères, rares et
sources de litiges ; la donne par paquets de trois, sans effet sur le jeu.

---

<a name="v0.6.4"></a>
## 0.6.4 — 16 octobre 2026

**Un client périmé se reconnaît lui-même.**

Corrigé
- La carte d'entame invisible a été revue une fois encore, sur un onglet qui tournait avec
  les scripts d'avant la mise à jour. La 0.6.1 appliquait bien la nouvelle version, mais
  seulement depuis les nouveaux scripts : un onglet encore sur les anciens n'en savait rien.
  Désormais, à l'ouverture, la page demande sa version à l'agent qui la sert et au serveur
  la sienne ; si elles diffèrent, ou si l'agent est trop vieux pour répondre, la page se
  recharge (une fois par version et par onglet), ou prévient la salle si une table est en
  cours. Et par précaution, la minuterie qui efface le dernier pli est annulée dès qu'une
  carte est posée : même périmée, elle ne peut plus rien cacher.

---

<a name="v0.6.3"></a>
## 0.6.3 — 16 octobre 2026

**Version d'essai assumée, et le site lisible par les moteurs de recherche.**

Ajouté
- **Pastille « bêta »** à côté du titre de l'accueil, de chaque jeu et de la version dans
  « À propos », avec une phrase qui dit ce que cela veut dire : tout fonctionne, tout peut
  encore bouger, et où écrire.
- **Référencement** : titres et descriptions réécrits page par page (mots que les gens
  tapent : « belote en ligne gratuite », « tarot à 5 joueurs », « règles du tarot »), lien
  canonique partout, balises Open Graph pour un aperçu propre quand le lien est partagé,
  `robots.txt` (profil, hors-ligne, API exclus) et `sitemap.xml` des dix pages publiques.
  Le profil et la page hors-ligne sont marqués `noindex`. Aucun script, aucun service
  tiers : rien ne change pour la vie privée.

---

<a name="v0.6.2"></a>
## 0.6.2 — 16 octobre 2026

**iPhone en mode application : le menu redevient accessible, rien ne couvre la main.**

Corrigé
- Installé sur l'écran d'accueil d'un iPhone, le site occupe tout l'écran, barre d'état
  comprise : le bandeau de statut et les boutons menu et thème passaient sous l'heure et la
  batterie, le menu devenait inaccessible. Tout ce qui est fixé en haut (drapeau, statut,
  boutons) et en bas respecte maintenant les zones réservées de l'appareil
  (`env(safe-area-inset-*)`).
- La barre « Réactions / Phrases » flottait au-dessus de la main au 8 Américain et la
  cachait sur un petit écran : elle est dans le flux, sous les cartes, dans les trois jeux.
  La grille de table ne s'écrase plus : elle peut dépasser l'écran et la page défiler.
- Le bandeau de statut laisse la place aux deux boutons de droite au lieu de passer dessous.

---

<a name="v0.6.1"></a>
## 0.6.1 — 16 octobre 2026

**Une nouvelle version s'applique toute seule, au premier moment calme.**

Corrigé
- Après la mise à jour du serveur, une page déjà ouverte gardait ses anciens scripts (le
  cache les sert d'abord, et les rafraîchit en fond pour la fois suivante). Un vieux client
  face à un serveur neuf affichait des étiquettes fausses : au tarot, la Pousse apparaissait
  « Garde » et la Garde « Garde sans », alors que les points, eux, étaient justes. Désormais
  la nouvelle version prend la main dès qu'elle est prête ; hors table la page se recharge
  aussitôt, à table un message prévient et la page se recharge à la manche suivante ou au
  retour au lobby — la reprise rend le siège. La vérification de mise à jour se fait aussi à
  chaque retour sur la page.

---

<a name="v0.6.0"></a>
## 0.6.0 — 16 octobre 2026

**La Pousse au tarot, la feuille de marque pour tous les jeux, et une carte qui se cachait.**

Ajouté
- **Étiquettes et releases automatiques** : à chaque fusion sur `main`, si la version de
  `package.json` est nouvelle, `etiquette.yml` pose `vX.Y.Z` sur le commit de fusion et
  publie une release GitHub dont le texte est l'entrée du journal. L'image Docker portant
  ce numéro est publiée par `release.yml` depuis `main`.
- **Tarot : le contrat Pousse**, entre la Petite et la Garde. Il se joue comme la Petite
  (chien montré, écart, multiplicateur ×1) mais la donne vaut **45 points de base au lieu
  de 25** : vingt points de plus, gagnés ou perdus. Les enchères, l'écart, le décompte, le
  bot, les textes des règles et les succès (« Garde sans filet » et « Défense de fer »
  gardent leur sens : Garde sans et au-delà, Garde et au-delà) sont cohérents ; un test
  joue la même donne en Petite et en Pousse et vérifie l'écart de vingt points.
- **La feuille de marque**, dans le menu de table de tous les jeux (« Marque ») : une ligne
  par manche finie avec le mot du jeu (contrat et preneur au tarot, atout et preneur à la
  belote), les points de chacun, et les totaux. Le socle la tient lui-même à partir du
  bilan de chaque manche (`RoundSummary.label`, `SeatView.rounds`) : un nouveau jeu l'a sans
  rien écrire.

Corrigé
- **Tarot et belote : la carte d'entame restait invisible** quand on devait jouer juste
  après un pli. Le dernier pli est montré une seconde et demie puis effacé par une minuterie ;
  celle-ci redessinait le centre à partir de la vue qu'elle avait capturée, déjà périmée, et
  gommait la carte posée entre-temps. Elle relit maintenant la vue du moment.

---

<a name="v0.5.1"></a>
## 0.5.1 — 16 octobre 2026

**Le lien de version pointe sur le journal ; Cloudflare pas à pas dans le manifeste.**

Ajouté
- Manifeste § 8 « Cloudflare : créer un sous-domaine sûr, pas à pas » : le tunnel dédié,
  la route vers le nom du service (jamais une adresse), le proxy obligatoire, les trois
  options qui casseraient la CSP, la protection applicative, le cache, le nom lui-même
  (DNSSEC, CAA, courrier verrouillé), le verrou d'essai, et ce qu'on ne fait jamais. Sans
  aucune valeur secrète : les menus et les points à vérifier seulement.
- Manifeste § 9 « Tester la sécurité du site en ligne » : Observatory (A+, et on y reste),
  securityheaders, SSL Labs, Blacklight, DNSViz, MXToolbox, Lighthouse, `curl`, le flot
  sur `/socket.io/`, et le contrôle externe maison. Résultats à la mise en ligne consignés
  dans le bilan : Observatory A+, Blacklight 0 traceur / 0 cookie tiers.
- README : la configuration renvoie à ces deux chapitres.

Changé
- « À propos » renvoie vers l'entrée de la version dans ce journal, sous une ancre stable
  (`#vX.Y.Z`), plutôt que vers une étiquette du dépôt : l'étiquette n'est pas toujours posée,
  le journal est toujours là. Les titres de toutes les versions portent l'ancre.

---

<a name="v0.5.0"></a>
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
  cours (et la révision), avec un lien vers l'entrée de cette version dans ce journal, sur
  le dépôt. Chaque titre de version porte pour cela une ancre stable (`#vX.Y.Z`).
- Raccourci « Jouer à la belote » dans l'application installée.

À savoir
- Il n'existe pas de dépôt d'origine pour la belote, contrairement au 8 Américain et au
  tarot : les règles retenues sont celles de la belote classique française ; les points
  discutés d'une table à l'autre (annonces d'office, égalité en réserve, partie en 1000)
  sont écrits noir sur blanc dans la page des règles.

---

<a name="v0.4.2"></a>
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

<a name="v0.4.1"></a>
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

<a name="v0.4.0"></a>
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

<a name="v0.3.1"></a>
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

<a name="v0.3.0"></a>
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

<a name="v0.2.0"></a>
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

<a name="v0.1.0"></a>
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
