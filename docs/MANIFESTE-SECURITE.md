# Manifeste de sécurité

Ce que Cartes sur table promet à ses joueurs, et ce qu'il s'interdit. Chaque ligne est
vérifiable dans le code public, et le [journal des versions](JOURNAL.md) dit à quelle
version elle est devenue vraie. Le détail des contrôles automatiques est dans
[SECURITE.md](SECURITE.md).

## 1. Le moins de données possible

- Un invité ne laisse **rien** sur le serveur : son pseudo et son avatar vivent dans son
  navigateur, la partie en mémoire, le temps de la table.
- Un profil n'existe que si le joueur le crée, et ne contient que ce qu'il faut pour
  afficher des statistiques et des succès : empreinte d'un jeton, pseudo, avatar, deux
  dates au jour près, des compteurs.
- **Jamais** d'adresse email, de mot de passe, d'adresse IP, de nom, de date de naissance,
  de sexe, d'historique de parties, d'empreinte de navigateur, de mesure d'audience, de
  cookie, de publicité.
- Ce qui n'est pas collecté ne peut être ni volé, ni vendu, ni réclamé.

## 2. Pas de mot de passe

- Le jeton de profil est tiré par le navigateur (256 bits) ; le serveur n'en garde que
  l'empreinte SHA-256. Une fuite de la base ne donne accès à aucun profil.
- Le code de récupération *est* ce jeton, groupé par quatre. Il n'est affiché en entier
  qu'une fois ; personne ne peut le renvoyer, parce que personne ne le connaît.
- Les passkeys (WebAuthn) sont une commodité, pas une dépendance : le serveur ne reçoit
  qu'une clé publique et vérifie une signature. Elles sont liées à une famille d'appareils ;
  le code de récupération reste la clé de secours, et le site le dit sans détour.

## 3. Le joueur ne voit que ce qu'il doit voir

- Un jeu ne sort du serveur que sous la forme d'une **vue par siège** : jamais les cartes
  des autres, jamais la pioche. C'est une obligation du contrat `GameDefinition`, pas une
  convention.
- Le serveur rejoue chaque coup contre les règles. Un client modifié peut tricher sur son
  écran, pas sur la table.
- Les bots ne voient pas plus que les humains : ils jouent sur des mondes déterminés au
  hasard à partir de la même vue.

## 4. Aucun texte libre entre joueurs

- Pas de messagerie. Les réactions sont des codes d'un catalogue fermé (émoticônes et
  douze phrases par jeu) ; le serveur ne transmet jamais une chaîne venue d'un joueur à un
  autre, hormis le pseudo, filtré et borné.
- Le client ne construit jamais de HTML à partir du réseau.

## 5. Un serveur qu'on ne peut pas joindre

- Aucun port ouvert sur le NAS ni sur la box : le seul chemin est un tunnel sortant vers
  Cloudflare, dédié au projet.
- Conteneur en lecture seule, sans privilège, sans gestionnaire de paquets, limité en
  processus et en mémoire ; seul `/data` s'écrit.
- CSP `default-src 'none'`, aucun script en ligne, aucune ressource tierce, aucun CDN.
  HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`.
- Adresse du joueur lue dans `CF-Connecting-IP` seulement, pour limiter les abus en
  mémoire ; jamais écrite.

## 6. Une chaîne de fabrication qui se vérifie

- Deux dépendances de production (`express`, `socket.io`), épinglées, auditées à chaque
  PR ; SQLite intégré à Node.
- Chaque PR passe : typage strict, tests, gitleaks, CodeQL, Opengrep, zizmor, revue des
  dépendances, construction de l'image, Trivy, ZAP. La branche `main` ne se modifie que
  par PR, en squash, contrôles verts requis.
- L'image publiée porte une attestation de provenance et un SBOM ; on vérifie depuis
  n'importe où d'où elle vient.
- Chaque lundi, le site en ligne est contrôlé de l'extérieur (en-têtes, DNS, cookies,
  version, ZAP) et l'image rescannée.

## 7. Transparence

- Code sous AGPL-3.0 : quiconque héberge une version modifiée doit en donner le code.
- Le [registre des traitements](legal/registre-traitements.md), la page « Vos données »
  et ce manifeste évoluent avec le code, dans la même PR.
- Une faille se signale comme indiqué dans [SECURITY.md](../SECURITY.md) ; elle est
  corrigée avant d'être racontée, puis racontée dans le journal.

## Ce que nous n'ajouterons pas

Publicité, pisteurs, mesure d'audience tierce, connexion par un réseau social, chat
libre, achat intégré, classement public nominatif sans accord explicite, collecte de
l'âge ou du sexe. Si l'un de ces points changeait, il faudrait d'abord réécrire ce
manifeste, et le dire dans le journal.
