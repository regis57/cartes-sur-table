/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { createApp } from './app.ts';

const server = createApp();
server
  .start()
  .then((addr) => {
    console.log(`Serveur actif sur ${addr.address}:${addr.port} (proxy : ${server.cfg.trustProxy}, base : ${server.cfg.databasePath})`);
  })
  .catch((err: unknown) => {
    console.error('Démarrage impossible :', err instanceof Error ? err.message : err);
    process.exit(1);
  });

const shutdown = (): void => {
  server.close().then(() => process.exit(0), () => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
