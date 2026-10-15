# Déployer sur le Synology DS218+, à côté d'Altiplume

Mode opératoire complet, pas à pas, pour servir `https://jeuxdecartes.altiplume.com`
depuis le NAS **sans ouvrir le moindre port**, avec un tunnel Cloudflare **dédié**,
indépendant de celui d'Altiplume.

Principe, identique à Altiplume : le NAS *sort* vers Cloudflare, rien n'entre. La box
reste close. Les deux projets ont chacun leur tunnel, leur réseau Docker, leur volume :
redéployer l'un ne touche jamais l'autre.

Temps estimé : 30 à 40 minutes la première fois.

## 0. Avant de commencer

- [ ] DSM à jour, vérification en deux étapes, blocage automatique (déjà fait pour Altiplume).
- [ ] Container Manager installé ; dossier partagé `docker` ; créer le sous-dossier `jeuxdecartes`.
- [ ] L'image `ghcr.io/regis57/<nom-du-dépôt>` est publiée (le workflow *Release* la publie à
      chaque fusion sur `main`) et **publique** (GitHub → profil → Packages → *Package settings*).
- [ ] Un navigateur connecté à Cloudflare et à `altiplume.com`.

> Remplacez `<nom-du-dépôt>` par le nom choisi pour le dépôt GitHub, partout.

## 1. Cloudflare : créer le tunnel dédié

1. Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Type **Cloudflared**. Nom : `nas-jeuxdecartes`. **Save tunnel**.
3. Écran « Install and run a connector » : ne rien installer. Copiez seulement le **jeton**
   (la longue chaîne `eyJ…` après `--token` dans la commande affichée). C'est un **secret** :
   il ira dans le fichier `.env` du NAS, nulle part ailleurs.
4. **Next**. Onglet **Public Hostname** → **Add a public hostname** :
   - Subdomain : `jeuxdecartes`
   - Domain : `altiplume.com`
   - Path : *(vide)*
   - Type : `HTTP`
   - URL : `api:3000` (le nom du service dans `docker-compose.yml`, résolu dans le réseau
     privé du projet — jamais une adresse IP du NAS)
   - **Additional application settings → TLS** : laisser tout par défaut (le trajet
     tunnel → conteneur est interne au NAS, en HTTP ; le HTTPS est entre le joueur et Cloudflare).
   - **HTTP Settings → HTTP Host Header** : vide.
5. **Save hostname**. Cloudflare crée automatiquement l'enregistrement DNS
   `jeuxdecartes CNAME <id>.cfargotunnel.com`, **proxié** (nuage orange). Vérifiez dans
   **DNS → Records** qu'il est bien là et orange.

Le tunnel s'affichera **Inactive** tant que le conteneur du NAS ne s'est pas connecté :
c'est normal, et c'est l'étape 4. Comme Altiplume, l'ordre est : d'abord le NAS, ensuite
le vert chez Cloudflare.

## 2. Cloudflare : sécuriser le sous-domaine (gratuit, 10 minutes)

Les réglages de zone déjà faits pour `altiplume.com` s'appliquent au sous-domaine :
**Always Use HTTPS**, **TLS minimum 1.2**, **CAA**, DNSSEC. À vérifier une fois, puis
ce qui suit est **spécifique** aux jeux.

### 2.1 Ce qui casserait le jeu — à vérifier en premier

Le site a une CSP stricte (`script-src 'self'`, aucun script en ligne). Deux options
Cloudflare injectent du JavaScript dans les pages et seraient donc **bloquées par la CSP**,
ou pire, casseraient la page :

1. **Speed → Optimization → Content Optimization → Rocket Loader : Off.**
2. **Analytics & Logs → Web Analytics** : ne **pas** activer le *beacon* automatique sur
   le site. Il injecte un script et c'est de la mesure d'audience : le projet n'en veut pas.
3. **Scrape Shield → Email Address Obfuscation : Off** (injecte aussi un script).

### 2.2 Protection applicative

4. **Security → WAF → Managed rules** : vérifier que le **Cloudflare Managed Ruleset**
   (gratuit) est actif sur la zone.
5. **Security → WAF → Rate limiting rules → Create rule** (une règle est offerte) :
   - Nom : `jeuxdecartes socket`
   - *If incoming requests match* : `Hostname equals jeuxdecartes.altiplume.com`
     **and** `URI Path starts with /socket.io/`
   - *Rate* : `60` requêtes par `10` secondes, par **IP**
   - *Action* : **Block** pendant `10` secondes.
   Le jeu lui-même en limite déjà par connexion ; cette règle arrête un flot *avant* le NAS.
6. **Security → Bots → Bot Fight Mode : On.** Les navigateurs des joueurs ne sont pas
   affectés ; les robots d'exploration agressifs, si.
7. **Security → Settings → Security Level : Medium** (zone) ; pas besoin de plus.

### 2.3 Règles propres au sous-domaine

8. **Rules → Cache Rules → Create rule** : `jeuxdecartes pas de cache` —
   `Hostname equals jeuxdecartes.altiplume.com` **and** `URI Path starts with /socket.io/`
   → **Bypass cache**. (Cloudflare ne met pas le HTML en cache par défaut, mais on
   écrit l'intention : rien de dynamique n'est jamais servi depuis le cache.)
9. **Network → WebSockets : On** (c'est le défaut ; à vérifier). Les connexions
   WebSocket inactives sont fermées par Cloudflare après ~100 s : le jeu envoie un
   *ping* toutes les 25 s, donc rien à faire.

### 2.4 Verrou de mise en service (recommandé tant que le site n'est pas prêt)

Tant que le site est en essai, personne d'autre que vous ne doit le voir :

10. **Zero Trust → Access → Applications → Add an application → Self-hosted** :
    - Nom : `jeuxdecartes (essai)` ; domaine : `jeuxdecartes.altiplume.com`.
    - Policy : *Allow* — *Include* : **Emails** → votre adresse.
    - Méthode d'identité : **One-time PIN** (un code par email, aucun compte à créer).
    Dès lors, toute visite demande un code envoyé à votre adresse. Le jour de l'ouverture,
    supprimez l'application : le site devient public en une minute. Jusqu'à 50
    utilisateurs, c'est gratuit — pratique pour une bêta fermée avec des amis.

### 2.5 Hygiène DNS du sous-domaine

Le sous-domaine n'enverra jamais d'email. On le déclare, pour que personne ne puisse
usurper `@jeuxdecartes.altiplume.com` :

11. **DNS → Records → Add** :
    - `TXT` `jeuxdecartes` → `v=spf1 -all`
    - `MX` `jeuxdecartes` → `.` priorité `0` (« null MX » : ce nom ne reçoit pas de courrier)
    - `TXT` `_dmarc.jeuxdecartes` → `v=DMARC1; p=reject;`

## 3. NAS : le fichier de secrets

Sur votre ordinateur, Bloc-notes, collez en remplaçant les valeurs :

```
TUNNEL_TOKEN=eyJ...le jeton du tunnel nas-jeuxdecartes, en entier, sans espace...
PUBLIC_ORIGIN=https://jeuxdecartes.altiplume.com
```

Enregistrez sous le nom **`.env`** (avec les guillemets dans la boîte de dialogue :
`".env"`, sinon Windows ajoute `.txt`). Dans **File Station**, téléversez-le dans
`docker/jeuxdecartes`. Il est invisible tant que l'affichage des fichiers cachés n'est pas
activé : normal. **Ce fichier ne quitte jamais le NAS.**

Aucun autre secret n'existe : pas de base externe, pas de clé d'API, pas de service
d'email. Tout le reste de la configuration est dans `docker-compose.yml`, versionné.

## 4. NAS : créer le projet

**Container Manager → Projet → Créer.**

- Nom du projet : `jeuxdecartes`
- Chemin : `/docker/jeuxdecartes`
- Source : *Créer docker-compose.yml*, puis collez le contenu de
  `https://raw.githubusercontent.com/regis57/<nom-du-dépôt>/main/docker-compose.yml`
- Portail web : **ne rien configurer** (aucun port n'est publié, c'est voulu).

**Suivant → Terminé.** Le NAS télécharge l'image, crée le réseau `jeuxdecartes`, le
volume `jeuxdecartes-data` (la base SQLite des profils) et les deux conteneurs
`jeuxdecartes-api` et `jeuxdecartes-tunnel`.

Ce que le projet impose, et qu'il ne faut pas « assouplir » depuis l'interface :

| Réglage | Valeur | Pourquoi |
|---|---|---|
| `ports:` | **absent** | Rien n'écoute sur le NAS ni sur le réseau local ; seul le tunnel entre. |
| `read_only: true` | api et tunnel | Le code et le système sont immuables ; seul `/data` s'écrit. |
| `cap_drop: [ALL]`, `no-new-privileges` | api et tunnel | Aucun privilège, même en cas de faille. |
| `TRUST_PROXY=cloudflare` | api | L'adresse du joueur est lue dans `CF-Connecting-IP`, jamais dans `X-Forwarded-For` (falsifiable). Sans ce réglage, tous les joueurs auraient l'adresse du tunnel et la limite « connexions par IP » bloquerait le 11ᵉ joueur du site. |
| `ALLOWED_ORIGINS` | `https://jeuxdecartes.altiplume.com` | Un site tiers ne peut pas détourner la connexion WebSocket. |

## 5. Vérifier

1. Cloudflare → Zero Trust → Tunnels : `nas-jeuxdecartes` **Healthy**, *Active replicas : 1*.
   `nas-altiplume` est toujours **Healthy** aussi (rien n'a bougé pour lui).
2. Container Manager : les deux conteneurs verts ; journal de `jeuxdecartes-api` :
   *Serveur actif*.
3. Depuis un téléphone en 4G (pas depuis la maison) : `https://jeuxdecartes.altiplume.com`
   affiche le tapis. Si le verrou Access est en place, un code arrive par email d'abord.
4. Depuis un ordinateur, en ligne de commande :
   ```
   curl -sI https://jeuxdecartes.altiplume.com | grep -iE "content-security-policy|strict-transport|cf-ray|server"
   ```
   On doit voir la CSP (`default-src 'none'`), HSTS, un `cf-ray` (la requête a traversé
   Cloudflare) et `server: cloudflare`. **Aucune** adresse IP domestique nulle part.
5. Une partie solo, puis une partie en ligne à deux appareils : les deux se voient dans
   l'attente, la partie démarre, un bot complète. Fermez un appareil en pleine partie :
   son siège passe au bot en quelques secondes, l'autre continue.
6. Le contrôle externe hebdomadaire (`.github/workflows/securite.yml`) prend
   `jeuxdecartes.altiplume.com` comme cible : lancez-le à la main une première fois
   (*Actions → Sécurité → Run workflow*) et lisez le rapport.

## 6. Mettre à jour

Chaque fusion sur `main` publie une nouvelle image `latest`, passée au crible de Trivy
avant publication. Le NAS ne se met **pas** à jour tout seul : c'est voulu.

Comme pour Altiplume sur DSM 7.3 : **Container Manager → Projet → `jeuxdecartes` →
Action → Arrêter**, puis **Action → Construire** s'il existe, sinon **Action → Nettoyer**
puis **Démarrer** : l'image `latest` est retéléchargée. Une minute d'indisponibilité ;
les profils sont dans le volume, rien n'est perdu.

Pour figer une version précise plutôt que `latest`, remplacez dans le compose
`image: ghcr.io/regis57/<nom-du-dépôt>:latest` par `…@sha256:<empreinte>` donnée par le
résumé du workflow *Release*. La provenance se vérifie depuis n'importe quelle machine :
`gh attestation verify oci://ghcr.io/regis57/<nom-du-dépôt>@sha256:… --owner regis57`.

## 7. Sauvegarde et retrait

- **Sauvegarde** : le volume `jeuxdecartes-data` contient la seule donnée qui compte
  (profils et succès). Hyper Backup → inclure `/volume1/@docker/volumes/jeuxdecartes-data`
  ou, plus simple, une tâche planifiée DSM qui copie `jeuxdecartes.db` vers un dossier
  sauvegardé. La base est petite (quelques Mo).
- **Retrait d'urgence** : arrêter le projet `jeuxdecartes` dans Container Manager. Le
  tunnel se coupe, le site répond une page d'erreur Cloudflare, Altiplume continue. Rien
  d'autre à fermer : aucun port n'a jamais été ouvert.
- **Retrait définitif** : supprimer le projet (et le volume si vous le souhaitez), puis
  Zero Trust → Tunnels → `nas-jeuxdecartes` → *Delete* ; l'enregistrement DNS part avec.

## 8. Ce qui est volontairement différent d'Altiplume

| | Altiplume | Jeux de cartes |
|---|---|---|
| Tunnel | `nas-altiplume` | `nas-jeuxdecartes` (dédié) |
| Secrets | jeton + clé email | jeton seulement |
| Comptes | email + passkeys | aucun email ; jeton local + code de récupération ; passkeys plus tard |
| Email sortant | Brevo | aucun |
| Base | `altiplume.db` | `jeuxdecartes.db` (volume séparé) |

Deux tunnels, deux cloisons : c'est le prix de l'indépendance, et il se compte en
dizaines de mégaoctets de mémoire.
