import test from 'node:test';
import assert from 'node:assert/strict';
import { Table, seededRng, type Seat, type Outbox, type SeatView } from '@jdc/core';
import { huitAmericain as def, type HuitView } from '../src/rules.ts';

const FAST = { botDelay: 5, forcedDelay: 5, afkTimeout: 80 };

function seat(name: string, human: boolean): Seat {
  return { name, avatar: 0, isBot: !human, humanId: human ? `h-${name}` : null, rejoinKey: human ? Table.newRejoinKey() : null, rejoinDeadline: null, profileId: null };
}

class Recorder implements Outbox {
  seatEvents: { seat: number; event: string; payload: unknown }[] = [];
  allEvents: { event: string; payload: unknown }[] = [];
  toSeat(seat: number, event: string, payload: unknown) { this.seatEvents.push({ seat, event, payload }); }
  toAll(event: string, payload: unknown) { this.allEvents.push({ event, payload }); }
  lastState(seat: number): SeatView<HuitView> | undefined {
    return [...this.seatEvents].reverse().find((e) => e.seat === seat && e.event === 'state')?.payload as SeatView<HuitView> | undefined;
  }
  count(event: string) { return this.allEvents.filter((e) => e.event === event).length; }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('attente dépassée');
    await tick(5);
  }
};

test('Table : un humain et trois bots jouent une manche entière sans intervention', async () => {
  const out = new Recorder();
  let destroyed = false;
  const t = new Table(Table.newId('solo'), def, [seat('Régis', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)], out, {
    timings: FAST, rng: seededRng(1), botThinkMs: 5, onDestroy: () => { destroyed = true; },
  });
  t.start();
  assert.equal(out.count('tableStarted'), 1);
  const first = out.lastState(0);
  assert.ok(first && first.seat === 0 && first.game.hand.length === 6);
  assert.ok(!out.seatEvents.some((e) => e.seat !== 0 && e.event === 'state'), 'les bots ne reçoivent rien');

  // L'humain joue toujours son premier coup légal ; les pioches forcées sont jouées par la table.
  let guard = 0;
  while (t.phase === 'playing' && guard++ < 400) {
    const v = out.lastState(0)!;
    if (v.game.current === 0 && v.game.legal.length > 1) {
      const play = v.game.legal.find((l) => l.move.type === 'play') ?? v.game.legal[0]!;
      assert.ok(t.onMove(0, play.key));
    }
    await tick(8);
  }
  assert.ok(t.phase === 'roundEnd' || t.phase === 'matchEnd', `phase ${t.phase}`);
  assert.equal(out.count('roundEnd'), 1);
  const end = out.allEvents.find((e) => e.event === 'roundEnd')!.payload as { summary: { roundWinner: number | null }; achievements: string[][] };
  assert.ok(end.summary.roundWinner !== null);
  assert.equal(end.achievements.length, 4);
  assert.ok(!destroyed, 'un humain est présent : la table reste');
  assert.ok(t.nextRound(0) || t.restartMatch(0));
  assert.equal(t.phase, 'playing');
  t.destroy();
  assert.ok(destroyed);
  assert.equal(t.phase, 'destroyed');
});

test('Table : coups refusés — mauvais siège, mauvais tour, clé inconnue, bot, charge utile étrange', async () => {
  const out = new Recorder();
  const t = new Table(Table.newId('online'), def, [seat('A', true), seat('B', true), seat('Anne', false), seat('Paul', false)], out, {
    timings: { ...FAST, botDelay: 100_000 }, rng: seededRng(2), botThinkMs: 5,
  });
  t.start();
  const v0 = out.lastState(0)!;
  assert.equal(v0.game.current, 0);
  assert.ok(!t.onMove(1, v0.game.legal[0]!.key), 'pas son tour');
  assert.ok(!t.onMove(2, 'draw'), 'un bot ne joue pas par le réseau');
  assert.ok(!t.onMove(0, 'play:X♥'), 'clé inconnue');
  assert.ok(!t.onMove(0, { key: 'draw' }), 'objet au lieu de chaîne');
  assert.ok(!t.onMove(0, 'a'.repeat(100)), 'clé trop longue');
  assert.ok(!t.onMove(9, 'draw'), 'siège inexistant');
  assert.ok(t.onMove(0, 'draw'));
  assert.ok(!t.nextRound(0), 'manche en cours');
  assert.ok(!t.restartMatch(0), 'partie en cours');
  t.destroy();
});

test('Table : coupure → bot et reprise avec la clé ; départ définitif ; table vide détruite', async () => {
  const out = new Recorder();
  let destroyed = false;
  const seats = [seat('A', true), seat('B', true), seat('Anne', false), seat('Paul', false)];
  const t = new Table(Table.newId('online'), def, seats, out, {
    timings: { ...FAST, botDelay: 100_000 }, rng: seededRng(3), rejoinGraceMs: 200, botThinkMs: 5, onDestroy: () => { destroyed = true; },
  });
  t.start();
  const keyA = seats[0]!.rejoinKey!;
  t.leave(0, 'disconnect');
  assert.ok(seats[0]!.isBot);
  assert.ok(t.publicSeats()[0]!.awaiting, 'siège en attente de reprise');
  assert.equal(out.count('seats'), 1);
  assert.equal(t.rejoin('pas-la-bonne', 'h-X'), null);
  assert.equal(t.rejoin(keyA, 'h-A2'), 0);
  assert.ok(!seats[0]!.isBot && seats[0]!.humanId === 'h-A2');
  assert.ok(out.lastState(0), 'la vue est renvoyée au revenant');
  t.leave(0, 'quit');
  assert.equal(seats[0]!.rejoinKey, null, 'départ volontaire : pas de reprise');
  assert.equal(t.rejoin(keyA, 'h-A3'), null);
  assert.ok(!destroyed, 'B est encore là');
  t.leave(1, 'disconnect');
  assert.ok(!destroyed, 'B peut revenir pendant le délai de grâce');
  await waitFor(() => destroyed, 2000);
  assert.equal(t.phase, 'destroyed');
});

test('Table : inactivité à son tour → remplacement par un bot, prévenu', async () => {
  const out = new Recorder();
  const seats = [seat('A', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)];
  const t = new Table(Table.newId('solo'), def, seats, out, { timings: FAST, rng: seededRng(4), rejoinGraceMs: 100, botThinkMs: 5 });
  t.start();
  await waitFor(() => seats[0]!.isBot, 3000);
  assert.ok(out.seatEvents.some((e) => e.seat === 0 && e.event === 'afk'));
  await waitFor(() => t.phase === 'destroyed', 3000);
});

test('Table : émoticônes et phrases — catalogue seul, limitées en débit, diffusées à tous', () => {
  const out = new Recorder();
  const t = new Table(Table.newId('solo'), def, [seat('A', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)], out, {
    timings: { ...FAST, botDelay: 100_000 }, rng: seededRng(5),
  });
  t.start();
  assert.ok(t.onEmote(0, 'phrase', 'bien-joue'));
  assert.ok(t.onEmote(0, 'emoji', 'sourire'));
  assert.ok(!t.onEmote(0, 'phrase', '<script>'));
  assert.ok(!t.onEmote(0, 'texte', 'bonjour'), 'pas de texte libre');
  assert.ok(!t.onEmote(1, 'phrase', 'bien-joue'), 'un bot ne parle pas');
  assert.ok(t.onEmote(0, 'emoji', 'rire'));
  assert.ok(!t.onEmote(0, 'emoji', 'rire'), 'rafale épuisée');
  assert.equal(out.count('emote'), 3);
  t.destroy();
});

test('Table : sans humain, les bots s\'arrêtent et la table se libère même en pleine manche (pas de table zombie)', async () => {
  const out = new Recorder();
  let destroyed = false;
  const seats = [seat('A', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)];
  const t = new Table(Table.newId('solo'), def, seats, out, {
    timings: FAST, rng: seededRng(6), rejoinGraceMs: 150, botThinkMs: 5, onDestroy: () => { destroyed = true; },
  });
  t.start();
  await tick(30);
  const movesBefore = out.seatEvents.length;
  t.leave(0, 'disconnect');
  await tick(60);
  assert.equal(out.seatEvents.length, movesBefore, 'aucun coup joué sans humain');
  assert.equal(t.phase, 'playing');
  await waitFor(() => destroyed, 2000);
  assert.equal(t.phase, 'destroyed');
});

test('Table : à la reprise, une table mise en pause repart', async () => {
  const out = new Recorder();
  const seats = [seat('A', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)];
  const t = new Table(Table.newId('solo'), def, seats, out, { timings: FAST, rng: seededRng(7), rejoinGraceMs: 5000, botThinkMs: 5 });
  t.start();
  const key = seats[0]!.rejoinKey!;
  t.leave(0, 'disconnect');
  await tick(40);
  assert.equal(t.rejoin(key, 'h-A2'), 0);
  const v = out.lastState(0)!;
  assert.equal(v.game.current, 0, 'c\'est au revenant de jouer');
  assert.ok(t.onMove(0, v.game.legal[0]!.key));
  const before = out.seatEvents.filter((e) => e.event === 'state').length;
  await tick(120);
  assert.ok(out.seatEvents.filter((e) => e.event === 'state').length > before, 'les bots rejouent');
  t.destroy();
});

test('Table : le transport est prévenu quand un humain libère son siège (coupure, inactivité, départ)', async () => {
  const out = new Recorder();
  const released: string[] = [];
  const seats = [seat('A', true), seat('B', true), seat('Paul', false), seat('Lucie', false)];
  const t = new Table(Table.newId('online'), def, seats, out, {
    timings: { ...FAST, botDelay: 100_000 }, rng: seededRng(8), rejoinGraceMs: 100, botThinkMs: 5, onHumanReleased: (h) => released.push(h),
  });
  t.start();
  t.leave(1, 'quit');
  assert.deepEqual(released, ['h-B']);
  await waitFor(() => released.length === 2, 3000);
  assert.deepEqual(released, ['h-B', 'h-A'], 'inactivité → libération aussi');
  t.destroy();
});
