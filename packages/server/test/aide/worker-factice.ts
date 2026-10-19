/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { parentPort } from 'node:worker_threads';

/**
 * Fil de calcul factice, pour tester le pool sans jouer. Il se comporte selon `job.gameId` :
 *  - « muet »  : ne répond jamais ;
 *  - « chute » : lève une erreur non rattrapée, ce qui fait tomber le fil ;
 *  - « budget » : répond avec le budget de réflexion reçu (pour voir la charge le réduire) ;
 *  - autre : répond « ok » après `job.state` millisecondes.
 */
const port = parentPort;
if (!port) throw new Error('fil de calcul attendu');

port.on('message', (req: { id: number; job: { gameId: string; state: number; thinkMs: number } }) => {
  const { id, job } = req;
  if (job.gameId === 'muet') return;
  if (job.gameId === 'chute') throw new Error('chute volontaire');
  const reply = job.gameId === 'budget' ? job.thinkMs : 'ok';
  setTimeout(() => port.postMessage({ id, move: reply }), job.state);
});
