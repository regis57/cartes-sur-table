/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import type { GameDefinition } from './contract.ts';
import type { Rng } from './rng.ts';

/**
 * Bot générique : recherche arborescente Monte-Carlo sur ensembles d'information
 * (SO-ISMCTS, Cowling, Powley & Whitehouse, 2012). Il fonctionne avec n'importe quel
 * jeu qui respecte le contrat, et il ne triche jamais : à chaque itération, un monde
 * possible est tiré par `determinize` à partir de ce que le siège a le droit de savoir,
 * puis une partie est simulée dans ce monde. L'arbre, lui, est partagé entre les
 * mondes : il accumule ce qui marche en moyenne, quelle que soit la main réelle des
 * adversaires.
 *
 * Multi-joueurs : chaque nœud mémorise la récompense du siège qui a joué le coup qui y
 * mène (« max^n » simplifié). Les coups des adversaires sont donc choisis pour eux,
 * et non contre le bot : c'est ce qui rend les simulations réalistes.
 */

export interface MctsOptions {
  /** Budget de temps (ms). La recherche s'arrête au premier des deux budgets atteint. */
  timeMs: number;
  /** Budget d'itérations. */
  maxIterations: number;
  rng: Rng;
  /** Constante d'exploration UCB1 ; 0,7 convient aux récompenses dans [0, 1]. */
  exploration?: number;
  /** Profondeur maximale d'une simulation avant d'évaluer l'état tel quel. */
  rolloutDepth?: number;
  now?: () => number;
}

export interface MctsResult<M> {
  move: M;
  iterations: number;
  /** Statistiques du premier niveau, pour les tests et le réglage. */
  rootStats: { key: string; visits: number; mean: number }[];
}

interface Node<M> {
  move: M | null;
  /** Siège qui a joué `move` pour arriver ici ; -1 pour la racine. */
  seat: number;
  visits: number;
  /** Nombre de fois où ce coup était disponible quand son parent a été visité. */
  avail: number;
  reward: number;
  children: Map<string, Node<M>>;
}

function newNode<M>(move: M | null, seat: number): Node<M> {
  return { move, seat, visits: 0, avail: 0, reward: 0, children: new Map() };
}

export function mctsChooseMove<S, M, V>(def: GameDefinition<S, M, V>, state: S, seat: number, opts: MctsOptions): MctsResult<M> | null {
  const rootLegal = def.legalMoves(state, seat);
  if (rootLegal.length === 0) return null;
  if (rootLegal.length === 1) {
    const only = rootLegal[0] as M;
    return { move: only, iterations: 0, rootStats: [{ key: def.moveKey(only), visits: 1, mean: 0 }] };
  }

  const now = opts.now ?? (() => Date.now());
  const c = opts.exploration ?? 0.7;
  const depthCap = opts.rolloutDepth ?? 300;
  const seats = def.scores(state).length;
  const root = newNode<M>(null, -1);
  const deadline = now() + opts.timeMs;
  let iterations = 0;

  while (iterations < opts.maxIterations && now() < deadline) {
    iterations += 1;
    let s = def.determinize(state, seat, opts.rng);
    let node = root;
    const path: Node<M>[] = [root];

    // Sélection et expansion.
    while (!def.isRoundOver(s)) {
      const cur = def.currentSeat(s);
      if (cur === null) break;
      const legal = def.legalMoves(s, cur);
      if (legal.length === 0) break;
      const untried: M[] = [];
      for (const m of legal) if (!node.children.has(def.moveKey(m))) untried.push(m);
      if (untried.length > 0) {
        const m = untried[opts.rng.int(untried.length)] as M;
        const child = newNode<M>(m, cur);
        child.avail = 1;
        node.children.set(def.moveKey(m), child);
        s = def.applyMove(s, cur, m, opts.rng);
        path.push(child);
        node = child;
        break;
      }
      let best: Node<M> | null = null;
      let bestScore = -Infinity;
      for (const m of legal) {
        const child = node.children.get(def.moveKey(m)) as Node<M>;
        child.avail += 1;
        const ucb = child.reward / child.visits + c * Math.sqrt(Math.log(child.avail) / child.visits);
        if (ucb > bestScore) {
          bestScore = ucb;
          best = child;
        }
      }
      if (best === null) break;
      s = def.applyMove(s, best.seat, best.move as M, opts.rng);
      path.push(best);
      node = best;
    }

    // Simulation.
    let depth = 0;
    while (!def.isRoundOver(s) && depth < depthCap) {
      const cur = def.currentSeat(s);
      if (cur === null) break;
      const legal = def.legalMoves(s, cur);
      if (legal.length === 0) break;
      const m = def.rolloutMove ? def.rolloutMove(s, cur, legal, opts.rng) : (legal[opts.rng.int(legal.length)] as M);
      s = def.applyMove(s, cur, m, opts.rng);
      depth += 1;
    }

    // Rétropropagation.
    const rewards: number[] = [];
    for (let i = 0; i < seats; i++) rewards.push(def.evaluate(s, i));
    for (const n of path) {
      n.visits += 1;
      if (n.seat >= 0) n.reward += rewards[n.seat] ?? 0;
    }
  }

  let chosen: Node<M> | null = null;
  const rootStats: MctsResult<M>['rootStats'] = [];
  for (const [key, child] of root.children) {
    rootStats.push({ key, visits: child.visits, mean: child.visits ? child.reward / child.visits : 0 });
    if (chosen === null || child.visits > chosen.visits) chosen = child;
  }
  rootStats.sort((a, b) => b.visits - a.visits);
  if (chosen === null || chosen.move === null) {
    // Budget nul : on joue un coup légal au hasard plutôt que de bloquer la table.
    return { move: rootLegal[opts.rng.int(rootLegal.length)] as M, iterations, rootStats };
  }
  return { move: chosen.move, iterations, rootStats };
}
