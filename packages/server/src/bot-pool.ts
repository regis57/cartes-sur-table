/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { Worker } from 'node:worker_threads';
import type { BotEngine, BotJob } from '@jdc/core';

/**
 * Réserve de fils de calcul pour les bots. La réflexion d'un bot (MCTS) occupe le processeur
 * pendant tout son budget ; dans le fil principal, elle ferait attendre toutes les autres
 * tables, les connexions et le service des pages. Ici, elle se fait ailleurs.
 *
 * Quatre garde-fous, pour qu'une table ne reste jamais bloquée :
 *  - les fils sont lancés à la première demande, et relancés s'ils tombent ;
 *  - une demande qui dépasse son délai est abandonnée, son fil est remplacé ;
 *  - quand la file s'allonge, chaque bot réfléchit moins longtemps (jamais moins de `minThinkMs`) :
 *    on joue un peu moins bien plutôt que de faire attendre les joueurs ;
 *  - une demande qui échoue répond « pas de coup » ; la table joue alors un coup de secours.
 */

export interface BotPoolOptions {
  /** Nombre de fils de calcul. */
  size: number;
  /** Délai au-delà duquel une demande est abandonnée (ms), en plus du budget de réflexion. */
  graceMs?: number;
  /** Plancher du budget de réflexion sous charge (ms). */
  minThinkMs?: number;
  /** Adresse du fil de calcul (surchargée par les tests). */
  workerUrl?: URL;
}

export interface BotPool extends BotEngine {
  /** Arrête les fils ; les demandes en attente répondent « pas de coup ». */
  close(): Promise<void>;
  stats(): { size: number; busy: number; queued: number; restarts: number };
}

interface Pending {
  id: number;
  job: BotJob;
  resolve: (move: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Slot {
  worker: Worker;
  current: Pending | null;
}

export function createBotPool(opts: BotPoolOptions): BotPool {
  const size = Math.max(1, Math.floor(opts.size));
  const graceMs = opts.graceMs ?? 3000;
  const minThinkMs = opts.minThinkMs ?? 30;
  const url = opts.workerUrl ?? new URL('./bot-worker.ts', import.meta.url);
  const slots: Slot[] = [];
  const queue: Pending[] = [];
  let nextId = 1;
  let restarts = 0;
  let closed = false;

  function spawn(): Slot {
    const slot: Slot = { worker: new Worker(url), current: null };
    slot.worker.on('message', (msg: { id: number; move: unknown; error?: string }) => {
      const p = slot.current;
      if (!p || p.id !== msg.id) return;
      if (msg.error) console.error('[bots] calcul :', msg.error);
      finish(slot, msg.move ?? null);
    });
    // Une erreur ou une sortie inattendue ne doit ni faire tomber le serveur ni garder une table en attente.
    slot.worker.on('error', (err) => {
      console.error('[bots] fil de calcul :', err instanceof Error ? err.message : err);
      replace(slot);
    });
    slot.worker.on('exit', () => {
      if (!closed && slots.includes(slot)) replace(slot);
    });
    slot.worker.unref();
    slots.push(slot);
    return slot;
  }

  function finish(slot: Slot, move: unknown): void {
    const p = slot.current;
    slot.current = null;
    if (p) {
      if (p.timer) clearTimeout(p.timer);
      p.resolve(move);
    }
    pump();
  }

  function replace(slot: Slot): void {
    const i = slots.indexOf(slot);
    if (i < 0) return;
    slots.splice(i, 1);
    const p = slot.current;
    slot.current = null;
    void slot.worker.terminate().catch(() => undefined);
    if (p) {
      if (p.timer) clearTimeout(p.timer);
      p.resolve(null);
    }
    if (closed) return;
    restarts += 1;
    spawn();
    pump();
  }

  function pump(): void {
    if (closed) return;
    while (queue.length > 0) {
      let slot = slots.find((s) => s.current === null);
      if (!slot && slots.length < size) slot = spawn();
      if (!slot) return;
      const p = queue.shift() as Pending;
      // Plus la file est longue, moins chaque bot réfléchit.
      const thinkMs = Math.max(minThinkMs, Math.min(p.job.thinkMs, Math.floor(p.job.thinkMs / (1 + queue.length / size))));
      slot.current = p;
      p.timer = setTimeout(() => {
        console.error('[bots] délai dépassé, fil remplacé');
        replace(slot as Slot);
      }, thinkMs + graceMs);
      try {
        slot.worker.postMessage({ id: p.id, job: { ...p.job, thinkMs } });
      } catch (err) {
        // État non copiable : la demande ne peut pas aboutir, la table jouera un coup de secours.
        console.error('[bots] envoi impossible :', err instanceof Error ? err.message : err);
        finish(slot, null);
        return;
      }
    }
  }

  return {
    choose(job) {
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        queue.push({ id: nextId++, job, resolve, timer: null });
        pump();
      });
    },
    async close() {
      closed = true;
      for (const p of queue.splice(0)) p.resolve(null);
      await Promise.all(slots.splice(0).map(async (s) => {
        if (s.current) {
          if (s.current.timer) clearTimeout(s.current.timer);
          s.current.resolve(null);
        }
        await s.worker.terminate().catch(() => undefined);
      }));
    },
    stats() {
      return { size, busy: slots.filter((s) => s.current !== null).length, queued: queue.length, restarts };
    },
  };
}
