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
- Au bord du réseau, devant le tunnel : limitation de débit par adresse sur le chemin
  temps réel, contournement du cache pour tout ce qui est vivant, protection DDoS et jeu
  de règles managé actifs, contrôle d'intégrité du navigateur. Les options de
  l'intermédiaire qui injectent du JavaScript dans les pages sont **toutes désactivées** :
  elles contrediraient la CSP, et le site n'exécute que son propre code.

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

## 7. Le nom de domaine lui-même

- **DNSSEC actif** : les réponses DNS sont signées, une réponse forgée ne peut pas
  détourner le domaine vers un faux serveur.
- **Émission de certificats restreinte** (enregistrements CAA) : seules les autorités
  employées par l'intermédiaire réseau peuvent émettre un certificat pour le domaine et
  ses sous-domaines ; toute autre doit refuser, y compris pour un certificat joker.
- **Le sous-domaine du jeu déclare qu'il n'écrit ni ne reçoit de courrier** : aucun
  message ne peut être envoyé en son nom sans être rejeté par le destinataire.
- Les règles d'exemption héritées d'anciennes configurations, qui court-circuitaient une
  partie des contrôles pour certaines adresses, ont été **auditées et supprimées** : plus
  aucune adresse n'est dispensée des vérifications.

## 8. Cloudflare : créer un sous-domaine sûr, pas à pas

Le site n'est joignable qu'au travers d'un intermédiaire réseau (Cloudflare) et d'un tunnel
sortant depuis le NAS. Chaque nouveau sous-domaine (un autre jeu, un essai, un second
site) suit la même marche. Aucune valeur secrète ici : les jetons, identifiants et adresses
restent dans le fichier de secrets du NAS et dans le tableau de bord ; les menus et les
points à vérifier, eux, sont publics. Les captures d'écran et les valeurs exactes des
règles sont dans le [guide de déploiement](DEPLOIEMENT.md), § 1, 2 et 5.

### 8.1 Avant de créer quoi que ce soit

- [ ] Le domaine parent a déjà **DNSSEC** actif et des enregistrements **CAA** : un
      sous-domaine en hérite. Vérifier plutôt que supposer (§ 8.5).
- [ ] Décider **un tunnel par site**. Un tunnel partagé entre deux sites fait tomber les
      deux à la première mise à jour de l'un : on crée un tunnel dédié, nommé d'après le
      site (`nas-<site>`), jamais réutilisé.
- [ ] Le serveur applicatif n'écoute que sur le **réseau privé du conteneur**, pas sur
      une adresse du NAS, et n'ouvre **aucun port** sur la box.

### 8.2 Le tunnel (Zero Trust → Networks → Tunnels)

1. **Create a tunnel → Cloudflared**, nom `nas-<site>`. Le **jeton** affiché est le seul
   secret : il va dans le fichier de secrets du NAS (§ 3 du guide) et nulle part
   ailleurs — ni dans le dépôt, ni dans un message, ni dans une capture d'écran. S'il a
   été montré par erreur : **Rotate token**, puis remplacer sur le NAS.
2. **Routes → Add route → Published application** : sous-domaine, domaine, **Service URL
   vers le nom du service Docker** (`http://api:3000`), jamais une adresse IP. Le trajet
   tunnel → application est interne au NAS ; le HTTPS est entre le joueur et Cloudflare.
3. Vérifier que l'enregistrement **DNS créé automatiquement** est un `CNAME` vers
   `cfargotunnel.com`, **proxié** (nuage orange). Un enregistrement gris exposerait
   l'origine : l'intermédiaire ne protègerait plus rien.
4. Le tunnel reste *Inactive* tant que le conteneur `cloudflared` ne tourne pas sur le
   NAS : d'abord le NAS, ensuite le vert chez Cloudflare.

### 8.3 Ce qui casserait le site : trois options à éteindre

La CSP du site (`script-src 'self'`, aucun script en ligne) refuse tout script injecté.
Dans la zone du domaine :

- [ ] **Speed → Settings → Rocket Loader : Off** ;
- [ ] **Security → Settings → Email Address Obfuscation : Off** ;
- [ ] **Security → Settings → Replace insecure JavaScript libraries : Off** ;
- [ ] **Analytics & Logs → Web Analytics** : pas de *beacon* automatique (le projet ne
      mesure pas son audience).

Le contrôle externe hebdomadaire vérifie que les en-têtes arrivent intacts : si l'une de
ces options est rallumée par mégarde, il échoue.

### 8.4 Protection applicative et cache

- [ ] **Security → Settings** : *managed ruleset* actif, **Browser integrity check : On**,
      **Bot fight mode : On** (à vérifier ensuite depuis un téléphone en 4G : les
      navigateurs ne doivent pas être gênés).
- [ ] **Security → Security rules → Rate limiting** : une règle sur le chemin des
      connexions temps réel (`/socket.io/`) du sous-domaine, par adresse IP, qui bloque
      quelques secondes. Le serveur limite déjà par connexion ; la règle arrête un flot
      **avant** le NAS.
- [ ] **Security → Security rules → Custom rules** : rien, mais savoir que c'est là qu'on
      coupe un site d'urgence (*Hostname equals … → Block*) sans toucher au NAS.
- [ ] **Caching → Cache Rules** : *Bypass cache* sur `/socket.io/` du sous-domaine. Rien
      de dynamique n'est jamais servi depuis un cache.
- [ ] **Network → WebSockets : On**.
- [ ] **SSL/TLS** : *Full (strict)* ou mieux au niveau du domaine, **Always Use HTTPS**,
      TLS minimum 1.2 — hérités, à relire.
- [ ] **Security → WAF → Tools → IP access rules** : **aucune règle *Allow* héritée**. Une
      exemption dispense une adresse de tous les contrôles ; on les a toutes supprimées et
      on n'en recrée pas.

### 8.5 Le nom lui-même

- [ ] **DNS → Settings → DNSSEC** : *Success* (chez Cloudflare Registrar, l'enregistrement
      DS est posé automatiquement).
- [ ] **DNS → Records** : enregistrements **CAA** `issue` et `issuewild` pour les seules
      autorités employées par Cloudflare ; toute autre doit refuser.
- [ ] Le sous-domaine **n'écrit ni ne reçoit de courrier** : `TXT v=spf1 -all`, `MX` nul
      (`.`, priorité 0), `TXT _dmarc.<site>` en `p=reject`.

### 8.6 Pendant l'essai, puis à l'ouverture

- [ ] Tant que le site n'est pas prêt : **Zero Trust → Access → Applications**, une
      application *self-hosted* sur le sous-domaine, politique *Allow* sur votre seule
      adresse, identité par code à usage unique. Personne d'autre ne voit le site.
- [ ] Le jour de l'ouverture : supprimer l'application Access, puis dérouler § 9 ci-dessous.

### 8.7 Ce qu'on ne fait jamais

Ouvrir un port sur la box ; mettre une adresse IP du NAS dans une route ou un
enregistrement DNS ; désactiver le proxy (nuage gris) « pour voir » ; coller un jeton dans
un ticket, un dépôt ou une tâche planifiée ; créer une exemption d'adresse.

## 9. Tester la sécurité du site en ligne

À faire après chaque changement de configuration réseau, et une fois par trimestre. Tout
est gratuit, sans compte, depuis un navigateur ; on garde la trace du résultat dans le
journal quand quelque chose change.

| Quoi | Où | Attendu |
|---|---|---|
| En-têtes et politique de contenu | [Mozilla HTTP Observatory](https://developer.mozilla.org/en-US/observatory) | **A+**, et on y reste : toute baisse se corrige avant la fusion |
| En-têtes, lecture détaillée | [securityheaders.com](https://securityheaders.com) | **A+** |
| TLS et certificat | [SSL Labs](https://www.ssllabs.com/ssltest/) | **A+**, TLS 1.2 et 1.3 seulement, pas de suite faible |
| Traceurs, cookies tiers, empreintes, pixels | [Blacklight (The Markup)](https://themarkup.org/blacklight) | **0** partout : aucun traceur, aucun cookie tiers, aucune société publicitaire |
| DNSSEC, chaîne de confiance | [DNSViz](https://dnsviz.net) | Toute la chaîne verte, aucun avertissement |
| CAA, SPF, MX, DMARC | [MXToolbox](https://mxtoolbox.com) (*CAA Lookup*, *SPF*, *DMARC*) ou `dig` | CAA présents ; SPF `-all` ; MX nul ; DMARC `p=reject` |
| Qualité d'application installable | Chrome → outils de développement → **Lighthouse** | PWA installable, accessibilité ≥ 95, pas de ressource tierce |
| Que l'origine n'est pas exposée | `curl -sI https://<site>` | `server: cloudflare`, un `cf-ray`, la CSP et HSTS ; **aucune** adresse domestique nulle part |
| En-têtes de Socket.io | `curl -sI https://<site>/socket.io/socket.io.esm.min.js` | `x-content-type-options: nosniff`, la CSP et `x-frame-options: DENY`, comme sur les pages |
| Comportement sous flot | depuis un terminal : 100 requêtes rapides sur `/socket.io/` | les dernières reçoivent un **429** de Cloudflare avant le NAS |
| Code et dépendances | `npm run verify`, puis GitHub → **Security** | 0 alerte ouverte CodeQL, Dependabot, gitleaks, Trivy, ZAP |
| Le contrôle externe maison | GitHub → **Actions → Sécurité → Run workflow** | vert ; il échoue si un en-tête manque, si un cookie apparaît, si le courrier n'est plus verrouillé |

Pour `jeuxdecartes.altiplume.com`, à la mise en ligne : Observatory **A+**, Blacklight
**0 traceur, 0 cookie tiers, aucune société publicitaire**, DNSSEC validé, CAA posés,
courrier verrouillé.

## 10. Transparence

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
