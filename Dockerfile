# syntax=docker/dockerfile:1

# Image du serveur et du client. Construite pour tourner sur un NAS : petite, non-root,
# système de fichiers en lecture seule, aucun gestionnaire de paquets embarqué.

ARG APP_VERSION
ARG APP_REVISION
ARG APP_BUILT_AT

# --- Étape 1 : construire le client (TypeScript → JavaScript, dépendances de développement)
FROM node:26.11-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/games/huit-americain/package.json packages/games/huit-americain/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --ignore-scripts
COPY packages ./packages
RUN npm run build

# --- Étape 2 : dépendances de production seulement
FROM node:26.11-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/games/huit-americain/package.json packages/games/huit-americain/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --ignore-scripts

# --- Étape 3 : image finale
FROM node:26.11-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS runtime
ARG APP_VERSION
ARG APP_REVISION
ARG APP_BUILT_AT
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/jeuxdecartes.db \
    APP_VERSION=$APP_VERSION \
    APP_REVISION=$APP_REVISION \
    APP_BUILT_AT=$APP_BUILT_AT

LABEL org.opencontainers.image.title="Jeux de cartes" \
      org.opencontainers.image.source="https://github.com/regis57/cartes-sur-table" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_REVISION \
      org.opencontainers.image.created=$APP_BUILT_AT
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node packages/core ./packages/core
COPY --chown=node:node packages/games ./packages/games
COPY --chown=node:node packages/server ./packages/server
COPY --chown=node:node packages/client/package.json ./packages/client/package.json
COPY --from=build --chown=node:node /app/packages/client/public ./packages/client/public

# /data est le seul endroit écrit (base SQLite), monté en volume. Et l'image n'a rien à
# installer : npm, npx, corepack et yarn s'en vont — moins de code, moins de failles.
RUN mkdir -p /data && chown node:node /data \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node:sqlite reste marqué expérimental (API figée) :
# on neutralise l'avertissement, et rien d'autre.
CMD ["node", "--no-warnings=ExperimentalWarning", "packages/server/src/main.ts"]
