# Cartes sur table

Jeux de cartes français, en ligne ou avec des amis.

## Sécurité / DevSecOps

- Branche `main` protégée (PR obligatoire, checks requis, pas de force-push)
- Scans à chaque PR : secrets (gitleaks), SAST (CodeQL), workflows (zizmor), dépendances
- Actions épinglées par SHA, permissions minimales, runners durcis (harden-runner)
- Builds attestés (provenance SLSA) et déploiement via l'environnement `production`
- Signalement de vulnérabilités : voir [SECURITY.md](SECURITY.md)
