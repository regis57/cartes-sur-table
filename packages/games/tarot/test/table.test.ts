import test from 'node:test';
import assert from 'node:assert/strict';
import { Table, seededRng, type Seat, type Outbox, type SeatView } from '@jdc/core';
import { tarot as def, type TarotView } from '../src/rules.ts';

const FAST = { botDelay: 3, forcedDelay: 3, afkTimeout: 80 };

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
  count(event: string) { return this.allEvents.filter((e) => e.event === event).length; }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Table de tarot : un humain et trois bots jouent une donne entière ; l\'humain suit le bot du jeu', async () => {
  const out = new Recorder();
  const t = new Table(Table.newId('solo'), def, [seat('Régis', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)], out, {
    timings: FAST, rng: seededRng(1), botThinkMs: 5,
  });
  t.start();
  const first = out.lastState(0);
  assert.ok(first && first.seat === 0 && first.game.hand.length === 18);
  assert.ok(!out.seatEvents.some((e) => e.seat !== 0 && e.event === 'state'), 'les bots ne reçoivent rien');

  let guard = 0;
  while (t.phase === 'playing' && guard++ < 3000) {
    const v = out.lastState(0)!;
    const mine = v.game.legal;
    if (mine.length > 0) {
      // L'humain joue ce que le bot du jeu jouerait : enchère, écart, carte.
      const choice = mine.find((l) => l.move.type !== 'poignee') ?? mine[0]!;
      const forced = mine.length === 1 && mine[0]!.move.type === 'play';
      if (!forced) assert.ok(t.onMove(0, choice.key), `coup refusé ${choice.key} en phase ${v.game.phase}`);
    }
    await tick(4);
  }
  assert.ok(t.phase === 'roundEnd' || t.phase === 'matchEnd', `phase ${t.phase}`);
  assert.equal(out.count('roundEnd'), 1);
  const end = out.allEvents.find((e) => e.event === 'roundEnd')!.payload as { summary: { perSeat: { roundPoints: number }[] }; achievements: string[][] };
  assert.equal(end.summary.perSeat.length, 4);
  assert.equal(end.summary.perSeat.reduce((s, p) => s + p.roundPoints, 0), 0, 'somme nulle');
  assert.equal(end.achievements.length, 4);
  const last = out.lastState(0)!;
  assert.ok(last.game.roundOver && last.game.result);
  assert.equal(last.game.history.length, 1);
  assert.equal(last.rounds.length, 1);
  assert.match(last.rounds[0]!.label ?? '', /^(Petite|Pousse|Garde|Garde sans|Garde contre) — \{\d\}/);
  assert.ok(t.nextRound(0));
  assert.equal(t.phase, 'playing');
  assert.equal(out.lastState(0)!.game.roundNumber, 2);
  t.destroy();
});

test('Table de tarot à cinq : les bots mènent une donne de bout en bout, l\'appel au Roi compris', async () => {
  const out = new Recorder();
  const seats = [seat('A', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false), seat('Marc', false)];
  const t = new Table(Table.newId('solo'), def, seats, out, { timings: { ...FAST, afkTimeout: 100_000 }, rng: seededRng(8), botThinkMs: 5 });
  t.start();
  let guard = 0;
  let sawCall = false;
  while (t.phase === 'playing' && guard++ < 4000) {
    const v = out.lastState(0)!;
    if (v.game.calledCard) sawCall = true;
    if (v.game.legal.length > 0) {
      const choice = v.game.legal.find((l) => l.move.type !== 'poignee') ?? v.game.legal[0]!;
      if (!(v.game.legal.length === 1 && v.game.legal[0]!.move.type === 'play')) t.onMove(0, choice.key);
    }
    await tick(4);
  }
  assert.ok(t.phase === 'roundEnd' || t.phase === 'matchEnd', `phase ${t.phase}`);
  assert.ok(sawCall, 'une carte a été appelée');
  const last = out.lastState(0)!;
  assert.equal(last.game.handCounts.length, 5);
  assert.equal(last.game.result?.deltas.length, 5);
  t.destroy();
});

test('Table de tarot : coups refusés hors tour ou hors phase, puis coupure et remplacement', async () => {
  const out = new Recorder();
  const seats = [seat('A', true), seat('B', true), seat('Anne', false), seat('Paul', false)];
  const t = new Table(Table.newId('online'), def, seats, out, {
    timings: { ...FAST, botDelay: 100_000, afkTimeout: 100_000 }, rng: seededRng(2), rejoinGraceMs: 150, botThinkMs: 5,
  });
  t.start();
  const v0 = out.lastState(0)!;
  const v1 = out.lastState(1)!;
  const who = v0.game.bidTurn;
  const other = who === 0 ? 1 : 0;
  assert.ok(!t.onMove(other, 'bid:0'), 'pas son tour');
  assert.ok(!t.onMove(who, 'play:A1'), 'pas la bonne phase');
  assert.ok(!t.onMove(who, 'bid:9'), 'enchère inconnue');
  assert.ok(!t.onMove(2, 'bid:0'), 'un bot ne joue pas par le réseau');
  if (seats[who]!.humanId) assert.ok(t.onMove(who, 'bid:0'));
  void v1;
  t.leave(0, 'disconnect');
  assert.ok(seats[0]!.isBot && t.publicSeats()[0]!.awaiting);
  assert.equal(t.rejoin(seats[0]!.rejoinKey!, 'h-A2'), 0);
  assert.ok(out.lastState(0), 'la vue est renvoyée au revenant');
  t.destroy();
});
