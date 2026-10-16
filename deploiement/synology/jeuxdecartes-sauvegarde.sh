#!/bin/sh
# Sauvegarde de la base de Jeux de cartes sur le Synology, en tâche planifiée
# (DSM → Panneau de configuration → Planificateur de tâches → Script défini par
# l'utilisateur, en root). La tâche ne contient qu'UNE ligne :
#   sh /volume1/docker/jeuxdecartes/jeuxdecartes-sauvegarde.sh
#
# POURQUOI PAS UN SIMPLE « cp » DU FICHIER .db
# La base tourne en mode WAL : les écritures récentes vivent dans un fichier à côté
# (-wal) jusqu'au prochain point de contrôle. Copier le .db seul, application en marche,
# donne une base incomplète — à l'essai, une base VIDE. On demande donc à SQLite lui-même
# une copie cohérente (VACUUM INTO), base ouverte et jeu en marche, puis on vérifie son
# intégrité avant de la garder.
#
# CE QUE ÇA PRODUIT
#   sauvegardes/jeuxdecartes-1.db … -7.db   une copie par jour de la semaine (lundi = 1),
#                                           chacune écrasée sept jours plus tard ;
#   sauvegardes-usb/jeuxdecartes.db         la dernière copie, seule : c'est ce dossier
#                                           que la tâche Hyper Backup chiffrée emporte
#                                           sur la clé USB.
#
# DURÉE DE CONSERVATION : SEPT JOURS AU PLUS, PARTOUT
# C'est ce que promettent la page « Confidentialité » et le registre des traitements : un
# profil effacé disparaît des sauvegardes au plus tard sept jours après. La tâche Hyper
# Backup doit donc garder au plus sept versions (une par jour). Ne pas allonger sans
# mettre ces deux textes à jour.
#
# Altiplume n'est jamais touché : on ne parle qu'au conteneur jeuxdecartes-api.
set -eu

DOCKER=/usr/local/bin/docker
API=jeuxdecartes-api
BASE=/data/jeuxdecartes.db
TEMP=/data/.sauvegarde-en-cours.db
ICI=/volume1/docker/jeuxdecartes
LOCAL=$ICI/sauvegardes
USB=$ICI/sauvegardes-usb
TRAVAIL=$ICI/.sauvegarde-en-cours.db
JOUR=$(date +%u)

# Quoi qu'il arrive, ne rien laisser traîner dans le conteneur ni à côté du projet.
nettoyer() {
  $DOCKER exec "$API" rm -f "$TEMP" >/dev/null 2>&1 || true
  rm -f "$TRAVAIL"
}
trap nettoyer EXIT

echo "== Jeux de cartes : sauvegarde $(date '+%Y-%m-%d %H:%M:%S')"
[ "$($DOCKER inspect -f '{{.State.Running}}' "$API" 2>/dev/null)" = "true" ] \
  || { echo "ERREUR : $API ne tourne pas, rien à sauvegarder"; exit 1; }
mkdir -p "$LOCAL" "$USB"
chmod 700 "$LOCAL" "$USB"

echo "-- 1/3 copie cohérente, dans le conteneur, jeu en marche"
$DOCKER exec "$API" node --no-warnings=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
fs.rmSync(dst, { force: true });
const db = new DatabaseSync(src);
db.prepare("VACUUM INTO ?").run(dst);
db.close();
const c = new DatabaseSync(dst, { readOnly: true });
const verdict = c.prepare("PRAGMA integrity_check").get().integrity_check;
const profils = c.prepare("SELECT count(*) AS n FROM profils").get().n;
c.close();
if (verdict !== "ok") { console.error("   ERREUR : intégrité « " + verdict + " »"); process.exit(2); }
console.log("   " + profils + " profil(s), " + fs.statSync(dst).size + " octets, intégrité ok");
' "$BASE" "$TEMP"

echo "-- 2/3 sortie du conteneur et rotation"
# On écrit à côté, puis on renomme : un fichier final n'est jamais à moitié écrit,
# même si Hyper Backup passe au mauvais moment.
$DOCKER cp "$API:$TEMP" "$TRAVAIL"
chmod 600 "$TRAVAIL"
cp -f "$TRAVAIL" "$USB/.jeuxdecartes.db.part" && mv -f "$USB/.jeuxdecartes.db.part" "$USB/jeuxdecartes.db"
mv -f "$TRAVAIL" "$LOCAL/jeuxdecartes-$JOUR.db"

echo "-- 3/3 bilan"
ls -l "$LOCAL" "$USB"
echo "== OK — exit 0"
exit 0
