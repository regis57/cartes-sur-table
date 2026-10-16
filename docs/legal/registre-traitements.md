# Registre des traitements

Tenu au titre de l'article 30 du RGPD, bien que le projet, édité par une personne
physique à titre non professionnel, ne soit probablement pas tenu de le tenir : c'est la
liste exacte de ce qui est traité, et elle est courte.

Responsable du traitement : l'éditeur (voir les mentions légales du site). Pas de
délégué à la protection des données. Pas de sous-traitant autre que l'intermédiaire
réseau.

## 1. Profils de joueurs

| | |
|---|---|
| Finalité | Reconnaître un joueur d'une visite à l'autre pour lui afficher ses statistiques et ses succès |
| Base légale | Exécution du service demandé (création volontaire du profil) |
| Personnes | Joueurs ayant créé un profil |
| Données | Empreinte SHA-256 du jeton secret ; pseudo ; numéro d'avatar ; date de création et de dernière visite (au jour près) ; par jeu : parties, victoires, manches ; succès et date du jour d'obtention |
| Données explicitement absentes | Email, nom, mot de passe, adresse IP, historique de parties, empreinte de navigateur, mesure d'audience |
| Destinataires | L'éditeur seul |
| Durée | Tant que le profil existe ; effacement automatique après 365 jours sans visite ; effacement immédiat à la demande du joueur depuis le site |
| Lieu | Serveur de l'éditeur, en France (base SQLite dans un volume Docker) |
| Sauvegardes | Copie cohérente quotidienne, vérifiée, conservée **sept jours au plus** : sept copies tournantes sur le serveur, et une copie chiffrée côté client sur un support USB relié au serveur, en rotation de sept versions. Un profil effacé disparaît donc des sauvegardes au plus tard sept jours après |
| Sécurité | Jeton jamais stocké (empreinte seule) ; transport par en-tête Authorization en HTTPS ; serveur sans port ouvert, joignable par tunnel sortant seulement ; conteneur en lecture seule, sans privilèges |
| Droits | Accès et portabilité (export JSON), rectification (pseudo, avatar), effacement : depuis la page Profil, sans formulaire. Réclamation possible auprès de la CNIL |

## 1 bis. Passkeys et sessions (option du profil)

| | |
|---|---|
| Finalité | Permettre au joueur de retrouver son profil par un geste de son appareil (WebAuthn) plutôt qu'en saisissant son code de récupération |
| Base légale | Exécution du service demandé (ajout volontaire d'une passkey) |
| Personnes | Joueurs ayant ajouté une passkey |
| Données | Identifiant de la passkey ; clé publique ; algorithme ; compteur de signatures ; nom donné par le joueur ; date d'ajout et de dernier usage (au jour près). Pour chaque connexion par passkey : empreinte SHA-256 d'un jeton de session, date de création et de dernier usage (au jour près) |
| Données explicitement absentes | Clé privée (ne quitte jamais l'appareil), attestation du fabricant (non demandée : `attestation: none`), modèle d'appareil |
| Durée | Passkey : jusqu'à retrait par le joueur ou effacement du profil. Session : 180 jours sans usage, ou révocation par le joueur (« Déconnecter les autres appareils ») |
| Sécurité | Vérification de l'origine et du domaine, défi à usage unique (5 minutes), compteur de signatures (détection de clone), 30 tentatives par heure et par adresse |
| Droits | Liste, ajout et retrait depuis la page Profil ; export JSON inclus ; effacement en cascade avec le profil |

## 2. Parties en cours (invités et profils)

| | |
|---|---|
| Finalité | Faire jouer une partie |
| Base légale | Exécution du service demandé |
| Données | Pseudo et avatar déclarés ; coups ; codes de réaction ; identifiant de connexion ; clé de reprise de siège |
| Durée | En mémoire seulement, le temps de la table ; rien n'est écrit sur disque |
| Remarque | Les réactions sont des codes d'un catalogue fermé : aucun texte libre ne circule entre joueurs |

## 3. Limitation des abus

| | |
|---|---|
| Finalité | Limiter le nombre de connexions et le débit par adresse |
| Base légale | Intérêt légitime (disponibilité du service) |
| Données | Adresse IP (lue dans CF-Connecting-IP), compteurs |
| Durée | En mémoire seulement ; jamais journalisée ni écrite |

## 4. Intermédiaire réseau

Cloudflare, Inc. achemine le trafic et le protège des attaques. Il voit les adresses IP
en transit, selon sa propre politique de confidentialité. Offre gratuite ; transferts hors
UE encadrés par les clauses contractuelles types de la Commission européenne.

## Ce qui n'existe pas

Cookies, mesure d'audience, publicité, newsletter, formulaire de contact stocké,
journaux applicatifs contenant des adresses IP, sauvegardes au-delà de sept jours.

## Historique

- 2026-10-15 : création du registre, version initiale du site.
- 2026-10-16 : ajout des passkeys et des sessions (traitement 1 bis).
- 2026-10-16 : sauvegardes décrites (copie quotidienne vérifiée, chiffrée sur USB, sept jours au plus).
