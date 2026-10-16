import test from 'node:test';
import assert from 'node:assert/strict';
import { Table, seededRng, type Seat, type Outbox, type SeatView } from '@jdc/core';
import { belote as def, createRound, legalMoves, applyMove, type BeloteView } from '../src/rules.ts';

const FAST = { botDelay: 3, forcedDelay: 3, afkTimeout: 80 };

function seat(name: string, human: boolean): Seat {
  return { name, avatar: 0, isBot: !human, humanId: human ? `h-${name}` : null, rejoinKey: human ? Table.newRejoinKey() : null, rejoinDeadline: null, profileId: null };
}

class Recorder implements Outbox {
  seatEvents: { seat: number; event: string; payload: unknown }[] = [];
  allEvents: { event: string; payload: unknown }[] = [];
  toSeat(seat: number, event: string, payload: unknown) { this.seatEvents.push({ seat, event, payload }); }
  toAll(event: string, payload: unknown) { this.allEvents.push({ event, payload }); }
  lastState(seat: number): SeatView<BeloteView> | undefined {
    return [...this.seatEvents].reverse().find((e) => e.seat === seat && e.event === 'state')?.payload as SeatView<BeloteView> | undefined;
  }
  count(event: string) { return this.allEvents.filter((e) => e.event === event).length; }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Table de belote : un humain et trois bots jouent une donne entière ; les coéquipiers partagent le score', async () => {
  const out = new Recorder();
  const t = new Table(Table.newId('solo'), def, [seat('Régis', true), seat('Anne', false), seat('Paul', false), seat('Lucie', false)], out, {
    timings: FAST, rng: seededRng(1), botThinkMs: 5,
  });
  t.start();
  const first = out.lastState(0);
  assert.ok(first && first.seat === 0 && first.game.hand.length === 5 && first.game.turned);
  assert.ok(!out.seatEvents.some((e) => e.seat !== 0 && e.event === 'state'), 'les bots ne reçoivent rien');

  let guard = 0;
  while (t.phase === 'playing' && guard++ < 3000) {
    const v = out.lastState(0)!;
    const mine = v.game.legal;
    if (mine.length > 0) {
      const choice = mine.find((l) => l.move.type === 'take') ?? mine[0]!;
      const forced = mine.length === 1 && mine[0]!.move.type === 'play';
      if (!forced) assert.ok(t.onMove(0, choice.key), `coup refusé ${choice.key} en phase ${v.game.phase}`);
    }
    await tick(4);
  }
  assert.ok(t.phase === 'roundEnd' || t.phase === 'matchEnd', `phase ${t.phase}`);
  assert.equal(out.count('roundEnd'), 1);
  const end = out.allEvents.find((e) => e.event === 'roundEnd')!.payload as { summary: { perSeat: { roundPoints: number; total: number }[] }; achievements: string[][]; winners: number[] };
  assert.equal(end.summary.perSeat.length, 4);
  assert.equal(end.summary.perSeat[0]!.total, end.summary.perSeat[2]!.total);
  assert.equal(end.summary.perSeat[1]!.total, end.summary.perSeat[3]!.total);
  assert.deepEqual(end.winners, []);
  const last = out.lastState(0)!;
  assert.ok(last.game.roundOver && last.game.result);
  assert.equal(last.game.hand.length, 0);
  // La feuille de marque du socle : une ligne, le mot du jeu, les points et les totaux de chacun.
  assert.equal(last.rounds.length, 1);
  assert.match(last.rounds[0]!.label ?? '', /^Atout [♠♥♦♣] — \{\d\} · (réussie|dedans|capot|égalité)$/);
  assert.deepEqual(last.rounds[0]!.totals, end.summary.perSeat.map((p) => p.total));
  assert.ok(t.nextRound(0));
  assert.equal(t.phase, 'playing');
  assert.equal(out.lastState(0)!.game.roundNumber, 2);
  t.destroy();
});

test('Table de belote : coups refusés hors tour ou hors phase, puis coupure et remplacement', async () => {
  const out = new Recorder();
  const seats = [seat('A', true), seat('B', true), seat('Anne', false), seat('Paul', false)];
  const t = new Table(Table.newId('online'), def, seats, out, {
    timings: { ...FAST, botDelay: 100_000, afkTimeout: 100_000 }, rng: seededRng(2), rejoinGraceMs: 150, botThinkMs: 5,
  });
  t.start();
  const v0 = out.lastState(0)!;
  const who = v0.game.bidTurn;
  const other = who === 0 ? 1 : 0;
  assert.ok(!t.onMove(other, 'pass'), 'pas son tour');
  assert.ok(!t.onMove(who, 'play:A♠'), 'pas la bonne phase');
  assert.ok(!t.onMove(who, 'take:♪'), 'couleur inconnue');
  assert.ok(!t.onMove(2, 'pass'), 'un bot ne joue pas par le réseau');
  if (seats[who]!.humanId) assert.ok(t.onMove(who, 'pass'));
  t.leave(0, 'disconnect');
  assert.ok(seats[0]!.isBot && t.publicSeats()[0]!.awaiting);
  assert.equal(t.rejoin(seats[0]!.rejoinKey!, 'h-A2'), 0);
  assert.ok(out.lastState(0), 'la vue est renvoyée au revenant');
  t.destroy();
});

test('Simulation : 40 donnes au bot, invariants (162 points, 32 cartes, scores d\'équipe cohérents), et une partie jusqu\'à 1000', () => {
  let s = createRound(4, seededRng(2026));
  let donnes = 0;
  let guard = 0;
  let takerWins = 0;
  while (donnes < 40 && guard++ < 50_000) {
    if (s.phase === 'over') {
      const r = s.result!;
      assert.equal(r.cardPoints[0] + r.cardPoints[1], 162);
      assert.equal(s.won[0].length + s.won[1].length, 32);
      assert.equal(s.teamScores[0], s.history.reduce((a, h) => a + h.result.scored[0], 0));
      if (r.made) takerWins++;
      donnes++;
      s = createRound(4, seededRng(3000 + donnes), s);
      continue;
    }
    const seat = def.currentSeat(s) as number;
    const legal = legalMoves(s, seat);
    assert.ok(legal.length > 0, `aucun coup légal en phase ${s.phase}`);
    const m = def.botMove!(s, seat, legal, seededRng(guard)) ?? legal[0]!;
    s = applyMove(s, seat, m, seededRng(guard));
  }
  assert.equal(donnes, 40);
  assert.ok(takerWins >= 20, `le preneur devrait réussir plus souvent qu'il n'échoue (${takerWins}/40)`);
});
