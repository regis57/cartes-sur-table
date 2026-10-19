/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import type { BotLevel, GameDefinition } from './contract.ts';
import { mctsChooseMove } from './mcts.ts';
import type { Rng } from './rng.ts';

/**
 * Le choix d'un coup par un bot, en une fonction pure de l'état : la même qu'on l'appelle
 * dans le processus du serveur ou dans un fil de calcul à part. C'est ce qui permet de
 * sortir la réflexion des bots du fil principal sans que les règles n'en sachent rien.
 */

/** Ce qu'il faut envoyer à un moteur de calcul pour qu'un bot joue. Tout est copiable tel quel. */
export interface BotJob {
  gameId: string;
  state: unknown;
  seat: number;
  level: BotLevel;
  /** Budget de réflexion (ms) ; le moteur peut le réduire s'il est chargé. */
  thinkMs: number;
  /** Graine du générateur de la décision : la décision est rejouable, et ne dépend pas du fil qui la calcule. */
  seed: number;
}

/**
 * Moteur de calcul des bots, facultatif. Une promesse qui échoue ou renvoie `null` n'est
 * jamais bloquante : la table joue alors un coup de secours.
 */
export interface BotEngine {
  choose(job: BotJob): Promise<unknown>;
}

/** Budget d'itérations du MCTS : le temps, plus que ce plafond, borne la réflexion. */
export const MCTS_MAX_ITERATIONS = 4000;

/**
 * Choisit le coup d'un bot. La stratégie propre au jeu passe la première, à tous les niveaux :
 * c'est elle qui sait jouer moins bien sans jouer n'importe quoi. Sans elle, « facile » s'en
 * tient à la politique de simulation et « normal » cherche (MCTS).
 */
export function chooseBotMove<S, M, V>(def: GameDefinition<S, M, V>, state: S, seat: number, level: BotLevel, thinkMs: number, rng: Rng): M | null {
  const legal = def.legalMoves(state, seat);
  if (legal.length === 0) return null;
  const propre = def.botMove?.(state, seat, legal, rng, level) ?? null;
  if (propre !== null) return propre;
  if (level === 'facile' || legal.length === 1) return simpleMove(def, state, seat, legal, rng);
  const res = mctsChooseMove(def, state, seat, { timeMs: thinkMs, maxIterations: MCTS_MAX_ITERATIONS, rng });
  return res ? res.move : (legal[0] as M);
}

/** Le coup le moins coûteux : la politique de simulation du jeu, ou un coup légal au hasard. */
export function simpleMove<S, M, V>(def: GameDefinition<S, M, V>, state: S, seat: number, legal: readonly M[], rng: Rng): M {
  return def.rolloutMove ? def.rolloutMove(state, seat, legal, rng) : (legal[rng.int(legal.length)] as M);
}
