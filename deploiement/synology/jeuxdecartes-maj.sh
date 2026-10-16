#!/bin/sh
# Redéploiement de Jeux de cartes sur le Synology, en une tâche planifiée (DSM → Panneau
# de configuration → Planificateur de tâches → Script défini par l'utilisateur, en root).
#
# Le script vit dans un fichier, la tâche ne contient qu'UNE ligne :
#   sh /volume1/docker/jeuxdecartes/jeuxdecartes-maj.sh
# Coller le script entier dans la boîte de DSM fait échouer l'enregistrement
# (« La connexion a échoué ») : la requête est trop grosse. Charger ce fichier tel quel
# par File Station, sans l'ouvrir dans un éditeur Windows (fins de ligne CRLF).
#
# Fait exactement ce que la procédure manuelle faisait, sans clic :
#   1. arrête le projet et nettoie ses conteneurs ;
#   2. supprime l'image ghcr.io/regis57/cartes-sur-table locale ;
#   3. retélécharge les images et recrée les conteneurs depuis docker/jeuxdecartes ;
#   4. vérifie /healthz DANS le conteneur (aucun port n'est publié) et finit en « exit 0 ».
#
# Le volume de données (jeuxdecartes_jeuxdecartes-data : profils, passkeys, succès) et le
# fichier .env ne sont jamais touchés.
#
# ALTIPLUME N'EST JAMAIS TOUCHÉ. Deux précautions pour cela :
#   - toutes les commandes compose portent « -p jeuxdecartes » : elles ne voient que les
#     conteneurs, le réseau et le volume de ce projet ;
#   - l'image cloudflare/cloudflared est PARTAGÉE par les deux tunnels : on ne la supprime
#     pas. « compose pull » la met à jour si besoin, sans jamais la retirer sous les pieds
#     du tunnel d'Altiplume.
set -eu

PROJET=/volume1/docker/jeuxdecartes
COMPOSE="/usr/local/bin/docker-compose -p jeuxdecartes"
DOCKER=/usr/local/bin/docker
API=jeuxdecartes-api
TUNNEL=jeuxdecartes-tunnel

echo "== Jeux de cartes : redéploiement $(date '+%Y-%m-%d %H:%M:%S')"
cd "$PROJET"
[ -f .env ] || { echo "ERREUR : $PROJET/.env introuvable"; exit 1; }
grep -q '^PUBLIC_ORIGIN=' .env || { echo "ERREUR : PUBLIC_ORIGIN manquant dans .env (les passkeys seraient refusées)"; exit 1; }

echo "-- 1/4 arrêt et nettoyage du projet"
$COMPOSE down --remove-orphans

echo "-- 2/4 suppression de l'image applicative locale"
# Seulement la nôtre : cloudflared est partagée avec Altiplume et reste en place.
for img in ghcr.io/regis57/cartes-sur-table:latest; do
  if $DOCKER image rm -f "$img" >/dev/null 2>&1; then echo "   supprimée : $img"; else echo "   absente   : $img"; fi
done

echo "-- 3/4 téléchargement et recréation"
$COMPOSE pull --quiet
$COMPOSE up -d --force-recreate

echo "-- 4/4 vérification"
i=0
until [ "$($DOCKER inspect -f '{{.State.Health.Status}}' "$API" 2>/dev/null)" = "healthy" ]; do
  i=$((i + 1))
  if [ "$i" -gt 45 ]; then
    echo "ERREUR : $API n'est pas sain après 90 s. Journal :"
    $DOCKER logs --tail 40 "$API"
    exit 1
  fi
  sleep 2
done
$DOCKER exec "$API" wget -qO- http://127.0.0.1:3000/healthz; echo

# Le tunnel doit avoir rouvert ses connexions sortantes, sinon le site répond 1033.
i=0
until $DOCKER logs --tail 50 "$TUNNEL" 2>&1 | grep -q 'Registered tunnel connection'; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "ERREUR : $TUNNEL n'a pas enregistré de connexion après 60 s. Journal :"
    $DOCKER logs --tail 40 "$TUNNEL"
    exit 1
  fi
  sleep 2
done
echo "   tunnel reconnecté"

$COMPOSE ps
# Ne retire que les images orphelines (sans étiquette et sans conteneur) : une image
# utilisée par un conteneur en cours, Altiplume compris, ne peut pas en faire partie.
$DOCKER image prune -f >/dev/null
echo "== OK — exit 0"
exit 0
