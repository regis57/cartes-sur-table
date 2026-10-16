# Déployer sur le Synology DS218+, à côté d'Altiplume

Mode opératoire complet, pas à pas, pour servir `https://jeuxdecartes.altiplume.com`
depuis le NAS **sans ouvrir le moindre port**, avec un tunnel Cloudflare **dédié**
(`nas-jeuxdecartes`), indépendant de celui d'Altiplume.

Principe : le NAS *sort* vers Cloudflare, rien n'entre. La box reste close. Les deux
projets ont chacun leur tunnel, leur réseau Docker, leur volume : redéployer l'un ne
touche jamais l'autre.

Les chemins de menus ci-dessous sont ceux du tableau de bord Cloudflare d'**octobre 2026**
(nouvelle barre latérale : *Build*, *Protect & connect*, *Manage account*). Si un intitulé
a bougé, la barre **Quick search** (`Ctrl K`) en haut à gauche retrouve n'importe quel
écran par son nom : tapez « Tunnels », « Cache Rules », « Security rules ».

Temps estimé : 45 minutes la première fois, dont 15 sur le NAS.

---

## 0. Avant de commencer

- [ ] DSM à jour, vérification en deux étapes active, blocage automatique activé
      (déjà fait pour Altiplume).
- [ ] **Container Manager** installé ; dossier partagé `docker` existant.
- [ ] L'image `ghcr.io/regis57/cartes-sur-table` est publiée et **publique** : GitHub →
      votre profil → **Packages** → `cartes-sur-table` → **Package settings** →
      *Danger zone* → **Change visibility → Public**. Le workflow *Release* la publie à
      chaque fusion sur `main`.
- [ ] Un navigateur connecté à `dash.cloudflare.com` (compte `regis.hennequin@…`).

---

## 1. Cloudflare : le tunnel dédié

Le tunnel `nas-jeuxdecartes` existe déjà (créé le 15 octobre 2026) ; il est **Inactive**
avec **0 route** tant que le NAS n'est pas branché. Il reste à récupérer son jeton et à
lui donner une route.

### 1.1 Où le trouver

1. Page d'accueil du compte (**Account home**).
2. Barre latérale gauche, section *Protect & connect* → **Networking** → **Tunnels**.
   (Ancien chemin : *Zero Trust → Networks → Tunnels* ; il y mène aussi.)
3. Cliquez sur `nas-jeuxdecartes`.

### 1.2 Récupérer le jeton (secret)

4. Onglet **Overview**. Sous *Install and run a connector*, choisissez l'onglet
   **Docker**. La commande affichée se termine par `--token eyJ…` : la longue chaîne qui
   suit `--token` est le **jeton du tunnel**. Copiez-la **en entier** (elle fait plusieurs
   centaines de caractères).
5. C'est un secret : il ira dans le fichier `.env` du NAS (§ 3) et **nulle part ailleurs**.
   Ne l'envoyez pas par email, ne le collez pas dans un ticket.

### 1.3 Ajouter la route (le « hostname public »)

6. Onglet **Routes** → **Add route** (ou *Add a route*).
7. Type : **Published application** (c'est l'équivalent de l'ancien « Public hostname »).
8. Remplissez :

   | Champ | Valeur |
   |---|---|
   | Subdomain | `jeuxdecartes` |
   | Domain | `altiplume.com` |
   | Path | *(vide)* |
   | Service URL | `http://api:3000` |

   `api` est le nom du service dans `docker-compose.yml`, résolu dans le réseau privé du
   projet : **jamais une adresse IP du NAS**. Le trajet tunnel → conteneur est interne au
   NAS, en HTTP ; le HTTPS est entre le joueur et Cloudflare.
9. **Additional application settings** : ne rien changer (TLS, HTTP Host Header vides).
10. **Save**.

Cloudflare crée automatiquement l'enregistrement DNS `jeuxdecartes CNAME
<id>.cfargotunnel.com`, **proxié** (nuage orange). Vérifiez : **Domains →
`altiplume.com` → DNS → Records** ; la ligne `jeuxdecartes` doit être orange (*Proxied*).

Le tunnel reste **Inactive** jusqu'à l'étape 4. Comme pour Altiplume, l'ordre est :
d'abord le NAS, ensuite le vert chez Cloudflare.

---

## 2. Cloudflare : sécuriser le sous-domaine (gratuit, 10 minutes)

Tout ce qui suit se fait dans la **zone** : **Domains → `altiplume.com`**. La barre
latérale change alors pour celle de la zone (*Overview, Analytics, DNS, Email, SSL/TLS,
Security, Speed, Caching, Rules, Workers…*).

Les réglages déjà faits pour `altiplume.com` s'appliquent au sous-domaine : **Always Use
HTTPS**, **TLS minimum 1.2**, **CAA**, DNSSEC. Ce qui suit est **spécifique** aux jeux.

### 2.1 Ce qui casserait le jeu : à vérifier en premier

Le site a une CSP stricte (`script-src 'self'`, aucun script en ligne). Trois options
Cloudflare injectent du JavaScript dans les pages : elles seraient bloquées par la CSP,
ou casseraient la page.

1. **Speed → Settings** : repérez **Rocket Loader** → **Off**.
2. **Security → Settings** : repérez **Email Address Obfuscation** → **Off** (il injecte
   un script).
3. **Security → Settings** : **Replace insecure JavaScript libraries** → **Off** (le site
   ne charge aucune bibliothèque tierce ; l'option réécrirait des pages qu'elle n'a pas à
   toucher).
4. **Analytics & Logs → Web Analytics** : ne **pas** activer le *beacon* automatique sur
   le site. C'est de la mesure d'audience, et le projet n'en veut pas.

### 2.2 Protection applicative

5. **Security → Settings** : vérifier que **Cloudflare managed ruleset** est marqué
   *always active* (il l'est sur l'offre gratuite), **Browser integrity check** → **On**,
   **Bot fight mode** → **On** (les navigateurs des joueurs ne sont pas affectés ; les
   robots d'exploration agressifs, si).
6. **Security → Security rules** → carte **Rate limiting rules** (1 règle offerte) →
   **Create rule** :

   | Champ | Valeur |
   |---|---|
   | Rule name | `jeuxdecartes socket` |
   | If incoming requests match | *Hostname* `equals` `jeuxdecartes.altiplume.com` **And** *URI Path* `starts with` `/socket.io/` |
   | Characteristics | *IP* |
   | Rate | `60` requests per `10` seconds |
   | Then take action | **Block**, duration `10` seconds |

   Le jeu limite déjà par connexion ; cette règle arrête un flot **avant** le NAS.
7. **Security → Security rules** → carte **Custom rules** (5 offertes) : rien à créer
   pour l'instant. Si un jour il faut couper le site d'urgence sans toucher au NAS,
   c'est ici : *Hostname equals jeuxdecartes.altiplume.com → Block*.

### 2.3 Cache

8. **Caching → Cache Rules → Create rule** :

   | Champ | Valeur |
   |---|---|
   | Rule name | `jeuxdecartes socket sans cache` |
   | When incoming requests match | *Hostname* `equals` `jeuxdecartes.altiplume.com` **And** *URI Path* `starts with` `/socket.io/` |
   | Cache eligibility | **Bypass cache** |

   Cloudflare ne met pas le HTML en cache par défaut ; on écrit l'intention : rien de
   dynamique n'est jamais servi depuis le cache.
9. **Network** (dans la barre de zone) → **WebSockets : On** (c'est le défaut). Les
   connexions inactives sont fermées par Cloudflare après ~100 s ; le jeu envoie un
   *ping* toutes les 25 s, rien à faire.

### 2.4 Verrou de mise en service (tant que le site n'est pas prêt)

Tant que le site est en essai, personne d'autre que vous ne doit le voir.

10. Barre de zone → **Access** → bouton **Zero Trust** (ou directement
    *one.dash.cloudflare.com*) → **Access controls → Applications → Add an application**
    → **Self-hosted** :
    - Application name : `jeuxdecartes (essai)`
    - Public hostname : subdomain `jeuxdecartes`, domain `altiplume.com`
    - Policy : *Allow*, *Include* → **Emails** → votre adresse
    - Méthode d'identité : **One-time PIN** (un code par email, aucun compte à créer)

    Dès lors, toute visite demande un code envoyé à votre adresse. Le jour de l'ouverture,
    supprimez l'application : le site devient public en une minute. Jusqu'à 50
    utilisateurs c'est gratuit, pratique pour une bêta fermée avec des amis.

### 2.5 Hygiène DNS

Le sous-domaine n'enverra jamais d'email ; on le déclare, pour que personne ne puisse
usurper `@jeuxdecartes.altiplume.com`.

11. **DNS → Records → Add record**, trois fois :

    | Type | Name | Content | Priority |
    |---|---|---|---|
    | `TXT` | `jeuxdecartes` | `v=spf1 -all` | |
    | `MX` | `jeuxdecartes` | `.` | `0` |
    | `TXT` | `_dmarc.jeuxdecartes` | `v=DMARC1; p=reject;` | |

---

## 3. NAS : le fichier de secrets

Sur votre ordinateur, dans le Bloc-notes, collez en remplaçant la première valeur :

```
TUNNEL_TOKEN=eyJ…le jeton du tunnel nas-jeuxdecartes, en entier, sans espace ni retour à la ligne…
PUBLIC_ORIGIN=https://jeuxdecartes.altiplume.com
```

Enregistrez sous le nom **`.env`** : dans la boîte de dialogue, tapez le nom **avec des
guillemets** (`".env"`) et *Type : Tous les fichiers*, sinon Windows ajoute `.txt`.

Aucun autre secret n'existe : pas de base externe, pas de clé d'API, pas de service
d'email. Tout le reste de la configuration est dans `docker-compose.yml`, versionné.

---

## 4. NAS : créer le dossier et le projet (DSM 7.2 / 7.3)

### 4.1 Le dossier

1. Ouvrez **File Station**.
2. Dossier partagé **`docker`** → bouton **Créer → Créer un dossier** → nom
   `jeuxdecartes` → OK.
3. Entrez dans `docker/jeuxdecartes`. Menu **Charger → Charger – Ignorer** et choisissez
   le fichier `.env` de l'étape 3. Il n'apparaît pas dans la liste tant que
   *Paramètres → Afficher les fichiers cachés* n'est pas coché : c'est normal.
4. **Ce fichier ne quitte jamais le NAS.** Clic droit sur le dossier `jeuxdecartes` →
   **Propriétés → Autorisation** : seuls `admin` (votre compte) et `root` doivent y avoir
   accès ; retirez `users` ou `Everyone` s'ils y figurent.

### 4.2 Le projet

5. Ouvrez **Container Manager** (dans le menu principal DSM).
6. Menu de gauche **Projet** → bouton **Créer**.
7. Écran *Paramètres généraux* :

   | Champ | Valeur |
   |---|---|
   | Nom du projet | `jeuxdecartes` |
   | Chemin | cliquez **Définir le chemin** → `/docker/jeuxdecartes` |
   | Source | **Créer docker-compose.yml** |

   Container Manager vous prévient que le dossier contient déjà un fichier (`.env`) :
   confirmez, il ne touche qu'au `docker-compose.yml`.
8. Dans la zone de texte, collez le contenu de
   `https://raw.githubusercontent.com/regis57/cartes-sur-table/main/docker-compose.yml`
   (ouvrez l'adresse dans le navigateur, `Ctrl A`, `Ctrl C`, puis `Ctrl V` dans la zone).
9. **Suivant**. Écran *Paramètres du portail Web* : **ne rien cocher** (aucun port n'est
   publié, c'est voulu ; le seul chemin d'entrée est le tunnel).
10. **Suivant** → récapitulatif → **Terminé**.

Le NAS télécharge les deux images (`cartes-sur-table` ≈ 60 Mo, `cloudflared` ≈ 20 Mo),
crée le réseau `jeuxdecartes_jeuxdecartes`, le volume `jeuxdecartes_jeuxdecartes-data`
(la base SQLite des profils) et les conteneurs `jeuxdecartes-api` et
`jeuxdecartes-tunnel`. Le journal de construction défile ; à la fin, le projet passe
en **En cours d'exécution** (vert).

### 4.3 Ce qu'il ne faut pas « assouplir » depuis l'interface

Container Manager permet de modifier un conteneur à la main (*Détails → Paramètres*).
Ne le faites pas : la prochaine *Construction* du projet écraserait tout, et ces réglages
sont la sécurité du déploiement.

| Réglage | Valeur | Pourquoi |
|---|---|---|
| `ports:` | **absent** | Rien n'écoute sur le NAS ni sur le réseau local ; seul le tunnel entre. |
| `read_only: true` | api et tunnel | Le code et le système sont immuables ; seul `/data` s'écrit. |
| `cap_drop: [ALL]`, `no-new-privileges` | api et tunnel | Aucun privilège, même en cas de faille. |
| `pids_limit`, `mem_limit` | 128 processus, 512 Mo | Une fuite ou un abus ne peut pas affamer Altiplume ni DSM. |
| `TRUST_PROXY=cloudflare` | api | L'adresse du joueur est lue dans `CF-Connecting-IP`, jamais dans `X-Forwarded-For` (falsifiable). Sans ce réglage, tous les joueurs auraient l'adresse du tunnel et la limite par IP bloquerait le 11ᵉ joueur du site. |
| `ALLOWED_ORIGINS` | `https://jeuxdecartes.altiplume.com` | Un site tiers ne peut pas détourner la connexion WebSocket. |
| `PUBLIC_ORIGIN` | idem | Domaine et origine attendus par les passkeys (WebAuthn) ; sans lui, aucune passkey n'est acceptée. |

---

## 5. Vérifier

1. Cloudflare → **Networking → Tunnels** : `nas-jeuxdecartes` passe **Healthy**,
   *Connectors : 1*. `nas-altiplume` est toujours **Healthy** aussi (rien n'a bougé).
2. Container Manager → **Conteneur** : `jeuxdecartes-api` et `jeuxdecartes-tunnel`
   verts. Clic sur `jeuxdecartes-api` → **Journal** : la ligne `Serveur actif` ; sur
   `jeuxdecartes-tunnel` : `Registered tunnel connection` (quatre fois, c'est normal).
3. Depuis un **téléphone en 4G** (pas depuis la maison) :
   `https://jeuxdecartes.altiplume.com` affiche le tapis. Si le verrou Access est en
   place, un code arrive par email d'abord.
4. Depuis un ordinateur, en ligne de commande :
   ```
   curl -sI https://jeuxdecartes.altiplume.com | grep -iE "content-security-policy|strict-transport|cf-ray|server"
   ```
   On doit voir la CSP (`default-src 'none'`), HSTS, un `cf-ray` (la requête a traversé
   Cloudflare) et `server: cloudflare`. **Aucune** adresse IP domestique nulle part.
5. Une partie solo, puis une partie en ligne à deux appareils : les deux se voient dans
   l'attente, la partie démarre, un bot complète. Fermez un appareil en pleine partie :
   son siège passe au bot en quelques secondes, l'autre continue ; rouvrez-le dans les
   deux minutes : il reprend son siège.
6. Page **Profil** → créer un profil → **Ajouter une passkey sur cet appareil** : le
   téléphone ou le PC demande l'empreinte ou le code de verrouillage ; la passkey apparaît
   dans la liste. **Oublier ce profil sur cet appareil**, puis **Se connecter avec une
   passkey** : le profil revient sans code de récupération.
7. **Installation en application** : sur l'ordinateur, une icône d'écran avec une flèche
   vers le bas apparaît à droite de la barre d'adresse de Chrome ou d'Edge ; sur iPhone,
   Safari → Partager → « Sur l'écran d'accueil ». La page `/installer/` détaille tout, et
   sert aussi de vérification : elle doit reconnaître votre navigateur et afficher ses
   étapes. L'installation exige HTTPS — le tunnel s'en charge, rien à faire de plus.
8. Le contrôle externe hebdomadaire (`.github/workflows/securite.yml`) prend
   `jeuxdecartes.altiplume.com` comme cible : lancez-le une première fois à la main
   (GitHub → **Actions → Sécurité → Run workflow**) et lisez le rapport.

---

## 6. Mettre à jour

Chaque fusion sur `main` publie une nouvelle image `latest`, passée au crible de Trivy
avant publication. Le NAS ne se met **pas** à jour tout seul : c'est voulu, vous choisissez
le moment.

Container Manager → **Projet** → `jeuxdecartes` → bouton **Action** :

1. **Arrêter** ;
2. **Nettoyer** (supprime les conteneurs, **pas** le volume des profils) ;
3. **Construire** : l'image `latest` est retéléchargée, les conteneurs recréés ;
4. le projet redémarre seul ; sinon **Démarrer**.

Une minute d'indisponibilité ; les profils, passkeys et succès sont dans le volume, rien
n'est perdu.

Côté navigateurs, l'agent de service porte le numéro de version du projet : à la première
visite qui suit la mise à jour, il remplace son cache et sert la nouvelle version. Les
personnes qui ont installé l'application n'ont donc rien à réinstaller.

Pour figer une version précise plutôt que `latest` : dans le compose, remplacez
`image: ghcr.io/regis57/cartes-sur-table:latest` par `…@sha256:<empreinte>` (donnée par le
résumé du workflow *Release*), puis *Action → Construire*. La provenance se vérifie depuis
n'importe quelle machine :
`gh attestation verify oci://ghcr.io/regis57/cartes-sur-table@sha256:… --owner regis57`.

---

## 7. Sauvegarde et retrait

- **Sauvegarde** : le volume `jeuxdecartes_jeuxdecartes-data` contient la seule donnée qui
  compte (profils, passkeys, succès). Deux options :
  - **Hyper Backup** → tâche existante → *Modifier → Dossiers* → ajouter
    `/volume1/@docker/volumes/jeuxdecartes_jeuxdecartes-data` ;
  - ou **Panneau de configuration → Planificateur de tâches → Créer → Tâche planifiée →
    Script défini par l'utilisateur**, utilisateur `root`, chaque nuit :
    `cp /volume1/@docker/volumes/jeuxdecartes_jeuxdecartes-data/_data/jeuxdecartes.db /volume1/docker/jeuxdecartes/sauvegarde-$(date +%u).db`
    (sept fichiers tournants, un par jour de la semaine : c'est la rétention de sept jours
    annoncée aux joueurs). La base fait quelques Mo.
- **Retrait d'urgence** : Container Manager → Projet → `jeuxdecartes` → *Action →
  Arrêter*. Le tunnel se coupe, le site répond une page d'erreur Cloudflare, Altiplume
  continue. Rien d'autre à fermer : aucun port n'a jamais été ouvert. Variante sans toucher
  au NAS : règle *Custom rule* « Block » sur le hostname (§ 2.2, point 7).
- **Retrait définitif** : supprimer le projet (et le volume si vous le souhaitez), puis
  **Networking → Tunnels → `nas-jeuxdecartes` → Delete** ; l'enregistrement DNS part
  avec. Supprimer aussi les trois enregistrements DNS du § 2.5 et l'application Access.

---

## 8. Ce qui est volontairement différent d'Altiplume

| | Altiplume | Cartes sur table |
|---|---|---|
| Tunnel | `nas-altiplume` | `nas-jeuxdecartes` (dédié) |
| Secrets | jeton + clé email | jeton seulement |
| Comptes | email + passkeys | aucun email ; jeton local + code de récupération ; passkeys en option |
| Email sortant | Brevo | aucun |
| Base | `altiplume.db` | `jeuxdecartes.db` (volume séparé) |

Deux tunnels, deux cloisons : c'est le prix de l'indépendance, et il se compte en
dizaines de mégaoctets de mémoire.
