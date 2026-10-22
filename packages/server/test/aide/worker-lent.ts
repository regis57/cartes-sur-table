/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { parentPort } from 'node:worker_threads';

/**
 * Fil de calcul factice qui met longtemps à se charger (comme une petite machine qui lit les
 * trois jeux), puis répond « ok » à tout. Pour vérifier que le délai d'une demande ne court pas
 * pendant ce chargement.
 */
const port = parentPort;
if (!port) throw new Error('fil de calcul attendu');

const fin = Date.now() + 500;
while (Date.now() < fin) { /* chargement simulé */ }

port.on('message', (req: { id: number }) => port.postMessage({ id: req.id, move: 'ok' }));
port.postMessage({ ready: true });
