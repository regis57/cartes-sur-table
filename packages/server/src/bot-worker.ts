/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { parentPort } from 'node:worker_threads';
import { chooseBotMove, seededRng, type BotJob } from '@jdc/core';
import { findGame } from './games.ts';

/**
 * Fil de calcul d'un bot : reçoit l'état d'une table, répond par le coup choisi. Il ne tient
 * aucune table et ne garde rien d'un appel à l'autre : l'état est copié à chaque envoi, et
 * c'est la table, dans le fil principal, qui reste seule maîtresse de la partie.
 */

interface Request { id: number; job: BotJob }

const port = parentPort;
if (!port) throw new Error('bot-worker doit être lancé comme fil de calcul');

port.on('message', (req: Request) => {
  try {
    const game = findGame(req.job.gameId);
    if (!game) throw new Error(`jeu inconnu : ${req.job.gameId}`);
    const move = chooseBotMove(game.def, req.job.state, req.job.seat, req.job.level, req.job.thinkMs, seededRng(req.job.seed));
    port.postMessage({ id: req.id, move });
  } catch (err) {
    port.postMessage({ id: req.id, move: null, error: err instanceof Error ? err.message : String(err) });
  }
});

// Le chargement des jeux est fini : le pool peut compter le délai d'une demande à partir d'ici.
port.postMessage({ ready: true });
