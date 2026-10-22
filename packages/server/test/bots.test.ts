import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, type BotJob } from '@jdc/core';
import { createBotPool } from '../src/bot-pool.ts';
import { GAMES } from '../src/games.ts';

const FACTICE = new URL('./aide/worker-factice.ts', import.meta.url);

function job(gameId: string, state: unknown, over: Partial<BotJob> = {}): BotJob {
  return { gameId, state, seat: 0, level: 'normal', thinkMs: 20, seed: 1, ...over };
}

test('Pool de bots : chaque jeu joue une manche entière dont tous les coups passent par un fil de calcul', async () => {
  const pool = createBotPool({ size: 2 });
  try {
    for (const game of GAMES) {
      const def = game.def;
      const rng = seededRng(7);
      const seats = def.seatCounts[0] as number;
      let state = def.createRound(seats, rng);
      let coups = 0;
      while (!def.isRoundOver(state) && coups < 600) {
        const seat = def.currentSeat(state);
        assert.notEqual(seat, null);
        const legal = def.legalMoves(state, seat as number);
        const answer = await pool.choose(job(game.meta.id, state, { seat: seat as number, thinkMs: 5, seed: coups + 1 }));
        const move = legal.find((m) => def.moveKey(m) === def.moveKey(answer as never));
        assert.ok(move !== undefined, `${game.meta.id} : coup illégal ou absent au coup ${coups}`);
        state = def.applyMove(state, seat as number, move, rng);
        coups += 1;
      }
      assert.ok(def.isRoundOver(state), `${game.meta.id} : manche non terminée en ${coups} coups`);
    }
  } finally {
    await pool.close();
  }
});

test('Pool de bots : un calcul qui occupe un fil ne bloque pas le fil principal', async () => {
  // Un fil factice qui calcule sans pause pendant 300 ms : la durée ne dépend pas de la machine
  // (le MCTS réel, lui, s'arrête aussi à son plafond d'itérations, et peut finir plus tôt).
  const pool = createBotPool({ size: 1, workerUrl: FACTICE });
  try {
    let last = Date.now();
    let worst = 0;
    const tick = setInterval(() => {
      const now = Date.now();
      worst = Math.max(worst, now - last);
      last = now;
    }, 10);
    const t0 = Date.now();
    assert.equal(await pool.choose(job('occupe', 300)), 'ok');
    const duree = Date.now() - t0;
    clearInterval(tick);
    assert.ok(duree >= 290, `le calcul a bien occupé un fil (${duree} ms)`);
    assert.ok(worst < 150, `le fil principal est resté libre (pire intervalle ${worst} ms)`);
  } finally {
    await pool.close();
  }
});

test('Pool de bots : jeu inconnu ou état non copiable répondent « pas de coup », sans bloquer', async () => {
  const pool = createBotPool({ size: 1 });
  try {
    assert.equal(await pool.choose(job('inconnu', {})), null);
    assert.equal(await pool.choose(job('tarot', { f: () => 1 })), null, 'une fonction ne se copie pas');
    // Le pool reste utilisable après ces échecs.
    const game = GAMES.find((g) => g.meta.id === 'huit-americain')!;
    const state = game.def.createRound(4, seededRng(2));
    const seat = game.def.currentSeat(state) as number;
    assert.notEqual(await pool.choose(job('huit-americain', state, { seat, thinkMs: 5 })), null);
  } finally {
    await pool.close();
  }
});

test('Pool de bots : un fil qui tombe est remplacé, un fil muet est abandonné au délai', async () => {
  const origine = console.error;
  console.error = () => undefined;
  const pool = createBotPool({ size: 1, workerUrl: FACTICE, graceMs: 150 });
  try {
    assert.equal(await pool.choose(job('chute', 0)), null);
    assert.equal(pool.stats().restarts, 1);
    assert.equal(await pool.choose(job('ok', 0)), 'ok', 'le fil de remplacement répond');
    const t0 = Date.now();
    assert.equal(await pool.choose(job('muet', 0, { thinkMs: 30 })), null);
    assert.ok(Date.now() - t0 >= 150, 'le délai a été respecté');
    assert.equal(pool.stats().restarts, 2);
    assert.equal(await pool.choose(job('ok', 0)), 'ok');
  } finally {
    console.error = origine;
    await pool.close();
  }
});

test('Pool de bots : sous charge, chaque bot réfléchit moins longtemps, sans descendre sous le plancher', async () => {
  const pool = createBotPool({ size: 1, workerUrl: FACTICE, minThinkMs: 30 });
  try {
    // « budget » répond avec le budget reçu, après 20 ms.
    const reponses = await Promise.all(Array.from({ length: 6 }, () => pool.choose(job('budget', 20, { thinkMs: 200 }))));
    const budgets = reponses as number[];
    assert.equal(budgets[0], 200, 'le premier arrive sur un pool libre : budget entier');
    assert.ok(budgets.slice(1, 5).every((b) => b < 200), 'ceux qui ont attendu réfléchissent moins');
    assert.ok(budgets.every((b) => b >= 30), 'jamais sous le plancher');
    assert.equal(budgets[5], 200, 'le dernier trouve la file vide');
  } finally {
    await pool.close();
  }
});

test('Pool de bots : la fermeture libère les demandes en attente', async () => {
  const pool = createBotPool({ size: 1, workerUrl: FACTICE, graceMs: 60_000 });
  const attente = pool.choose(job('muet', 0));
  const derriere = pool.choose(job('ok', 0));
  await pool.close();
  assert.equal(await attente, null);
  assert.equal(await derriere, null);
  assert.equal(await pool.choose(job('ok', 0)), null, 'un pool fermé ne répond plus rien');
});

test('Configuration : BOT_WORKERS règle le nombre de fils, 0 les désactive', async () => {
  const { loadConfig } = await import('../src/config.ts');
  assert.equal(loadConfig({ BOT_WORKERS: '0' }).botWorkers, 0);
  assert.equal(loadConfig({ BOT_WORKERS: '3' }).botWorkers, 3);
  assert.equal(loadConfig({ BOT_WORKERS: '999' }).botWorkers, 16, 'plafonné');
  const par_defaut = loadConfig({}).botWorkers;
  assert.ok(par_defaut >= 1 && par_defaut <= 4, `par défaut entre 1 et 4 (${par_defaut})`);
});

test('Pool de bots : le délai d\'une demande ne court pas pendant le chargement du fil', async () => {
  const LENT = new URL('./aide/worker-lent.ts', import.meta.url);
  // Le fil met 500 ms à se charger ; la marge de la demande n'est que de 100 ms.
  const pool = createBotPool({ size: 1, workerUrl: LENT, graceMs: 100 });
  try {
    assert.equal(await pool.choose(job('ok', 0, { thinkMs: 20 })), 'ok');
    assert.equal(pool.stats().restarts, 0, 'le fil lent n\'a pas été remplacé');
  } finally {
    await pool.close();
  }
  // Un fil qui met plus longtemps que le délai de démarrage est remplacé, et la demande répond « pas de coup ».
  const origine = console.error;
  console.error = () => undefined;
  const impatient = createBotPool({ size: 1, workerUrl: LENT, bootMs: 100 });
  try {
    assert.equal(await impatient.choose(job('ok', 0)), null);
    assert.ok(impatient.stats().restarts >= 1);
  } finally {
    console.error = origine;
    await impatient.close();
  }
});
