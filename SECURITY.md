# Politique de sécurité

## Signaler une vulnérabilité

**Ne créez pas de ticket public** pour une faille de sécurité.

Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a
vulnerability** (<https://github.com/regis57/cartes-sur-table/security/advisories/new>).

Merci d'indiquer : la version ou le commit, les étapes de reproduction, l'impact estimé.
Un accusé de réception est envoyé sous 72 heures ; un correctif ou un plan de correction
sous 30 jours selon la gravité.

## Versions prises en charge

Seule la branche `main` (et l'image `latest` qui en est publiée) reçoit des correctifs.

## Principes de conception

- **Le serveur est la seule autorité.** Le client n'envoie que des intentions (la clé d'un
  coup, un code de réaction), revalidées contre les coups légaux calculés par le serveur.
- **La vue par joueur est obligatoire.** Le socle n'envoie jamais un état complet : il
  envoie `view(state, seat)`. Un jeu ne peut divulguer une main adverse que volontairement,
  dans cette fonction, où un relecteur le verra ; les tests du 8 Américain le prouvent.
- **Les bots ne trichent pas.** Ils raisonnent sur des mondes possibles tirés par
  `determinize`, jamais sur l'état réel.
- **Aucune donnée réseau n'est interprétée comme du HTML.** Le client n'utilise ni
  `innerHTML` ni script ou style en ligne ; l'hygiène du dépôt le vérifie. La CSP
  (`default-src 'none'`, sans `unsafe-*`) est une seconde ligne de défense.
- **Pas de texte libre entre joueurs.** Réactions et phrases sont des codes d'un catalogue
  fermé ; il n'y a pas de messagerie.
- **Entrées non fiables** : pseudos assainis (longueur, caractères, Unicode bidirectionnel),
  charge utile Socket.io limitée à 4 Ko, corps JSON limité à 4 Ko, identifiants validés
  par expression régulière et liés à la connexion.
- **Résistance aux abus** : limitation de débit par connexion et par IP, plafond de
  connexions par IP, plafond de tables, joueur inactif remplacé par un bot, tables
  abandonnées libérées, tables privées en attente expirées.
- **Aléa cryptographique** : mélange des cartes avec `crypto.randomInt` (Fisher-Yates) ;
  l'aléa déterministe ne sert qu'aux tests et aux simulations des bots.
- **Détournement WebSocket (CSWSH)** : l'en-tête `Origin` est contrôlé.
- **Identité sans secret partagé** : pas de mot de passe, pas d'email. Un jeton de 256 bits
  généré par le navigateur, dont le serveur ne garde que l'empreinte SHA-256, porté par
  l'en-tête `Authorization` (jamais dans une URL, jamais en cookie : rien à voler par CSRF).
- **Aucune adresse IP sur disque.** Elle n'existe qu'en mémoire, pour les limites.
- **Derrière Cloudflare**, l'adresse du client est lue dans `CF-Connecting-IP`, jamais dans
  `X-Forwarded-For` (`TRUST_PROXY=cloudflare`).
- **Sûr par défaut** : écoute sur `127.0.0.1` et base en mémoire tant que rien n'est configuré.
- **Chaîne d'approvisionnement** : 2 dépendances directes, `package-lock.json` versionné,
  `npm ci --ignore-scripts`, Dependabot, CodeQL, Opengrep, revue des dépendances, Actions
  épinglées par SHA, binaires de scan (Trivy, Opengrep, ZAP) épinglés par empreinte,
  image sans gestionnaire de paquets, SBOM et provenance attestés.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `HOST` | `127.0.0.1` | Interface d'écoute (`0.0.0.0` seulement derrière le tunnel ou un proxy) |
| `TRUST_PROXY` | `none` | `cloudflare` (CF-Connecting-IP) ou `xff` (X-Forwarded-For, proxy local de confiance) |
| `ALLOWED_ORIGINS` | *(même origine, ou PUBLIC_ORIGIN)* | Origines autorisées, séparées par des virgules |
| `PUBLIC_ORIGIN` | *(aucune)* | Origine publique : redirection HTTP → HTTPS derrière le tunnel ; domaine et origine attendus par les passkeys (sans elle, en production, aucune passkey n'est acceptée) |
| `DATABASE_PATH` | `:memory:` | Base SQLite des profils |
| `MAX_CONN_PER_IP` | `10` | Connexions simultanées par IP |
| `MAX_TABLES` | `300` | Tables simultanées (30 conseillé sur le NAS) |
| `MATCHMAKING_SECONDS` | `60` | Attente avant complément par des bots |
| `RATE_BURST` / `RATE_PER_SEC` | `20` / `5` | Messages par connexion |
| `HTTP_MAX_PER_MINUTE` | `300` | Requêtes HTTP par IP et par minute |
| `BOT_THINK_MS` | `150` | Budget de réflexion du bot (ms) ; réduit automatiquement quand la file d'attente s'allonge |
| `BOT_WORKERS` | un de moins que les cœurs, de 1 à 4 | Fils de calcul des bots ; `0` = dans le fil principal |
| `REJOIN_GRACE_MS` | `90000` | Délai pour reprendre son siège après une coupure |
| `PURGE_DAYS` | `365` | Profils sans visite effacés après ce délai |

Le seul secret du déploiement est le jeton du tunnel Cloudflare, dans `.env` sur le NAS.
