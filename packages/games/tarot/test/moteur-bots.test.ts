import test from 'node:test';
import assert from 'node:assert/strict';
import { Table, chooseBotMove, seededRng, type BotEngine, type BotJob, type Seat, type Outbox, type SeatView } from '@jdc/core';
import { tarot as def, type TarotView, type Move } from '../src/rules.ts';

const FAST = { botDelay: 3, forcedDelay: 3, afkTimeout: 5000 };

function seat(name: string, human: boolean): Seat {
  return { name, avatar: 0, isBot: !human, humanId: human ? `h-${name}` : null, rejoinKey: human ? Table.newRejoinKey() : null, rejoinDeadline: null, profileId: null };
}

class Recorder implements Outbox {
  seatEvents: { seat: number; event: string; payload: unknown }[] = [];
  allEvents: { event: string; payload: unknown }[] = [];
  toSeat(seat: number, event: string, payload: unknown) { this.seatEvents.push({ seat, event, payload }); }
  toAll(event: string, payload: unknown) { this.allEvents.push({ event, payload }); }
  lastState(seat: number): SeatView<TarotView> | undefined {
    return [...this.seatEvents].reverse().find((e) => e.seat === seat && e.event === 'state')?.payload as SeatView<TarotView> | undefined;
  }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function table(engine: BotEngine, out: Recorder) {
  return new Table(Table.newId('solo'), def, [seat('Régis', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)], out, {
    timings: FAST, rng: seededRng(1), botThinkMs: 5, botEngine: engine,
  });
}

/** L'humain joue le premier coup qu'on lui propose, jusqu'à la fin de la donne. */
async function jouerJusquAuBilan(t: Table<unknown, unknown, unknown>, out: Recorder): Promise<void> {
  let garde = 0;
  while (t.phase === 'playing' && garde++ < 3000) {
    const v = out.lastState(0);
    const mine = v?.game.legal ?? [];
    const choix = mine.find((l) => l.move.type !== 'poignee') ?? mine[0];
    const force = mine.length === 1 && mine[0]!.move.type === 'play';
    if (choix && !force) t.onMove(0, choix.key);
    await tick(4);
  }
}

/** Un moteur qui calcule vraiment, mais plus tard : comme un fil de calcul. */
function moteurDifféré(appels: BotJob[]): BotEngine {
  return {
    choose: async (job) => {
      appels.push(job);
      await tick(8);
      return chooseBotMove(def, job.state as never, job.seat, job.level, job.thinkMs, seededRng(job.seed));
    },
  };
}

test('Moteur de bots : une donne entière se joue quand les bots répondent plus tard', async () => {
  const out = new Recorder();
  const appels: BotJob[] = [];
  const t = table(moteurDifféré(appels), out);
  t.start();
  await jouerJusquAuBilan(t as never, out);
  assert.ok(t.phase === 'roundEnd' || t.phase === 'matchEnd', `phase ${t.phase}`);
  assert.ok(appels.length > 10, `les bots ont calculé par le moteur (${appels.length} appels)`);
  assert.ok(appels.every((a) => a.gameId === 'tarot' && Number.isInteger(a.seed) && a.seat !== 0));
  t.destroy();
});

test('Moteur de bots : une réponse illégale, absente ou rejetée n\'arrête jamais la partie', async () => {
  for (const [nom, choose] of [
    ['illégale', async () => ({ type: 'inconnu' })],
    ['absente', async () => null],
    ['rejetée', async () => { throw new Error('moteur en panne'); }],
    ['non copiable', async () => ({ moveKeyBad: 1n })],
  ] as const) {
    const out = new Recorder();
    const t = table({ choose }, out);
    t.start();
    await jouerJusquAuBilan(t as never, out);
    assert.ok(t.phase === 'roundEnd' || t.phase === 'matchEnd', `réponse ${nom} : phase ${t.phase}`);
    t.destroy();
  }
});

test('Moteur de bots : une réponse qui arrive après la fermeture de la table est ignorée', async () => {
  const out = new Recorder();
  let relâcher: ((m: unknown) => void) | null = null;
  let job: BotJob | null = null;
  const engine: BotEngine = { choose: (j) => new Promise((r) => { job = j; relâcher = r; }) };
  const t = table(engine, out);
  t.start();
  let garde = 0;
  while (!job && garde++ < 2000) {
    const v = out.lastState(0);
    const mine = v?.game.legal ?? [];
    const choix = mine.find((l) => l.move.type !== 'poignee') ?? mine[0];
    const force = mine.length === 1 && mine[0]!.move.type === 'play';
    if (choix && !force) t.onMove(0, choix.key);
    await tick(4);
  }
  assert.ok(job, 'un bot a demandé un calcul');
  const avant = out.allEvents.length + out.seatEvents.length;
  t.destroy();
  const j = job as BotJob;
  const coup = chooseBotMove(def, j.state as never, j.seat, 'facile', 1, seededRng(1)) as Move;
  (relâcher as unknown as (m: unknown) => void)(coup);
  await tick(30);
  assert.equal(t.phase, 'destroyed');
  assert.equal(out.allEvents.length + out.seatEvents.length, avant, 'rien n\'est diffusé après la fermeture');
});

test('Moteur de bots : un humain qui reprend son siège pendant le calcul garde la main', async () => {
  const out = new Recorder();
  let relâcher: ((m: unknown) => void) | null = null;
  let job: BotJob | null = null;
  const engine: BotEngine = { choose: (j) => new Promise((r) => { job = j; relâcher = r; }) };
  // Deux humains : l'un part, un bot le remplace et demande un calcul ; l'autre reste, la table vit.
  const t = new Table(Table.newId('solo'), def, [seat('Régis', true), seat('Anne', true), seat('Paul', false), seat('Lucie', false)], out, {
    timings: FAST, rng: seededRng(1), botThinkMs: 5, botEngine: engine, rejoinGraceMs: 60_000,
  });
  t.start();
  let garde = 0;
  while (!job && garde++ < 2000) {
    for (const s of [0, 1]) {
      const mine = out.lastState(s)?.game.legal ?? [];
      const choix = mine.find((l) => l.move.type !== 'poignee') ?? mine[0];
      const force = mine.length === 1 && mine[0]!.move.type === 'play';
      if (choix && !force) t.onMove(s, choix.key);
    }
    await tick(4);
  }
  assert.ok(job, 'un bot a demandé un calcul');
  const j = job as BotJob;
  // Le siège du bot qui calcule est repris par un humain avant la réponse.
  const s = t.seats[j.seat]!;
  s.isBot = false;
  s.humanId = 'h-retour';
  const avant = JSON.stringify(t.state);
  const coup = chooseBotMove(def, j.state as never, j.seat, 'facile', 1, seededRng(1));
  (relâcher as unknown as (m: unknown) => void)(coup);
  await tick(30);
  assert.equal(JSON.stringify(t.state), avant, 'le coup du bot n\'est pas joué à la place de l\'humain');
  t.destroy();
});
