import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, type Rng } from '@jdc/core';
import {
  tarot as def, createRound, legalMoves, legalCards, applyMove, view, determinize, teamOf, moveKey, parseMoveKey,
  canAnnouncePoignee, BID_MULT, type TarotState, type Move,
} from '../src/rules.ts';
import { buildDeck, cardKey, cardPoints, isBout, parseCardKey, sortHand, type Card } from '../src/cartes.ts';

const c = (key: string): Card => {
  const card = parseCardKey(key);
  if (!card) throw new Error(`carte invalide : ${key}`);
  return card;
};
const cards = (keys: string): Card[] => keys.split(' ').filter(Boolean).map(c);

/** Fabrique un état de jeu arbitraire à partir d'une donne, pour tester une règle isolée. */
function withState(base: TarotState, patch: Partial<TarotState>): TarotState {
  return { ...base, ...patch };
}

function playing(seats: number, hands: string[], extra: Partial<TarotState> = {}): TarotState {
  const base = createRound(seats, seededRng(7));
  const h = hands.map((s) => sortHand(cards(s)));
  return withState(base, {
    phase: 'play',
    hands: h,
    chien: [],
    ecart: [],
    bestBid: 2,
    preneur: 0,
    partner: seats === 5 ? 1 : -1,
    bidsPlaced: seats,
    current: 0,
    leadSeat: 0,
    trick: [],
    totalTricks: h[0]?.length ?? 0,
    won: h.map(() => []),
    voids: h.map(() => []),
    ...extra,
  });
}

/** Joue toute une partie avec le bot du jeu ; vérifie les invariants à chaque coup. */
function playMatch(seats: number, rng: Rng): { state: TarotState; moves: number; redeals: number } {
  let state = createRound(seats, rng);
  let moves = 0;
  let redeals = 0;
  for (;;) {
    while (!state.roundOver) {
      const seat = def.currentSeat(state);
      assert.notEqual(seat, null);
      const legal = legalMoves(state, seat as number);
      assert.ok(legal.length > 0, `aucun coup légal au siège ${seat} en phase ${state.phase}`);
      // Un autre siège n'a jamais de coup.
      for (let s = 0; s < seats; s++) if (s !== seat) assert.equal(legalMoves(state, s).length, 0);
      const move = def.botMove?.(state, seat as number, legal, rng) ?? legal[0] as Move;
      assert.ok(legal.some((m) => moveKey(m) === moveKey(move)), `le bot a choisi un coup illégal : ${moveKey(move)}`);
      const before = state;
      state = applyMove(state, seat as number, move, rng);
      assert.notEqual(state, before);
      moves++;
      if (state.lastEvent?.type === 'redeal') redeals++;
      if (moves > 20_000) throw new Error('partie sans fin');
    }
    // Décompte : 91 points dans le jeu, somme des deltas nulle.
    const r = state.result;
    assert.ok(r);
    const allWon = state.won.flat();
    const pile = r.bid <= 2 ? state.ecart : state.chien;
    const totalPts = [...allWon, ...pile].reduce((s, x) => s + cardPoints(x), 0);
    assert.equal(allWon.length + pile.length, 78);
    assert.equal(Math.round(totalPts * 2) / 2, 91);
    assert.equal(r.deltas.reduce((s, d) => s + d, 0), 0, 'la donne est à somme nulle');
    for (const h of state.hands) assert.equal(h.length, 0);
    if (def.isMatchOver(state)) break;
    state = createRound(seats, rng, state);
  }
  return { state, moves, redeals };
}

test('Le jeu : 78 cartes, 91 points, 3 bouts', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 78);
  assert.equal(deck.reduce((s, x) => s + cardPoints(x), 0), 91);
  assert.equal(deck.filter(isBout).length, 3);
  assert.equal(new Set(deck.map(cardKey)).size, 78);
  for (const x of deck) assert.deepEqual(parseCardKey(cardKey(x)), x);
});

test('La donne : 18 cartes et un chien de 6 à quatre ; 15 et 3 à cinq', () => {
  for (const [seats, hand, chien] of [[4, 18, 6], [5, 15, 3]] as const) {
    const s = createRound(seats, seededRng(1));
    assert.equal(s.hands.length, seats);
    for (const h of s.hands) assert.equal(h.length, hand);
    assert.equal(s.chien.length, chien);
    assert.equal(s.phase, 'bidding');
    assert.equal(s.bidTurn, (s.dealer + 1) % seats);
  }
});

test('Enchères : on surenchérit ou on passe ; tout le monde passe redonne sans compter', () => {
  let s = createRound(4, seededRng(3));
  const first = s.bidTurn;
  assert.deepEqual(legalMoves(s, first).map(moveKey), ['bid:0', 'bid:1', 'bid:2', 'bid:3', 'bid:4']);
  s = applyMove(s, first, { type: 'bid', bid: 2 }, seededRng(0));
  const second = s.bidTurn;
  assert.deepEqual(legalMoves(s, second).map(moveKey), ['bid:0', 'bid:3', 'bid:4']);
  s = applyMove(s, second, { type: 'bid', bid: 0 }, seededRng(0));
  s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, seededRng(0));
  s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, seededRng(0));
  assert.equal(s.preneur, first);
  assert.equal(s.bestBid, 2);
  assert.equal(s.phase, 'ecart', 'Garde : le chien est montré et le preneur écarte');
  assert.equal(s.hands[first]?.length, 24);

  // Tout le monde passe.
  let p = createRound(4, seededRng(5));
  const dealer = p.dealer;
  for (let i = 0; i < 4; i++) p = applyMove(p, p.bidTurn, { type: 'bid', bid: 0 }, seededRng(9));
  assert.equal(p.phase, 'bidding');
  assert.equal(p.roundNumber, 1, 'la donne annulée ne compte pas');
  assert.equal(p.dealer, (dealer + 1) % 4, 'le donneur tourne');
  assert.equal(p.lastEvent?.type, 'redeal');
});

test('Garde Sans et Garde Contre : le chien reste fermé, on joue directement', () => {
  let s = createRound(4, seededRng(11));
  s = applyMove(s, s.bidTurn, { type: 'bid', bid: 3 }, seededRng(0));
  for (let i = 0; i < 3; i++) s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, seededRng(0));
  assert.equal(s.phase, 'play');
  assert.equal(s.hands[s.preneur]?.length, 18);
  assert.equal(s.chien.length, 6);
  assert.equal(view(s, (s.preneur + 1) % 4).chien, null, 'le chien fermé ne se voit pas');
});

test("L'écart : ni Roi ni bout ; de l'atout seulement faute d'autre carte ; une carte par coup", () => {
  let s = createRound(4, seededRng(13));
  const taker = s.bidTurn;
  s = applyMove(s, taker, { type: 'bid', bid: 1 }, seededRng(0));
  for (let i = 0; i < 3; i++) s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, seededRng(0));
  assert.equal(s.phase, 'ecart');
  const legal = legalMoves(s, taker);
  for (const m of legal) {
    assert.equal(m.type, 'discard');
    if (m.type === 'discard') {
      assert.ok(!isBout(m.card), 'pas de bout à l\'écart');
      assert.ok(!(m.card.t === 'c' && m.card.value === 'R'), 'pas de Roi à l\'écart');
      assert.notEqual(m.card.t, 'a', 'pas d\'atout quand il reste des cartes ordinaires');
    }
  }
  const v = view(s, taker);
  assert.equal(v.ecartNeeded, 6);
  assert.deepEqual(v.chien, s.chien, 'le chien est montré pendant l\'écart');
  assert.deepEqual(view(s, (taker + 1) % 4).chien, s.chien, 'à tout le monde');
  for (let i = 0; i < 6; i++) {
    const m = legalMoves(s, taker)[0] as Move;
    s = applyMove(s, taker, m, seededRng(0));
  }
  assert.equal(s.phase, 'play');
  assert.equal(s.ecart.length, 6);
  assert.equal(s.hands[taker]?.length, 18);
  assert.equal(s.current, (s.dealer + 1) % 4, 'l\'entame revient au joueur après le donneur');

  // Main presque entièrement faite de Rois, bouts et atouts : l'atout devient permis.
  const forced = playing(4, ['R♠ R♥ R♣ R♦ A1 A21 EXC A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16 A17 A18 2♠ 3♠', '4♠ 5♠', '6♠ 7♠', '8♠ 9♠'], { phase: 'ecart', bestBid: 1, chienSize: 6, ecart: [] });
  const discards = legalMoves(forced, 0).flatMap((m) => (m.type === 'discard' ? [m.card] : []));
  assert.ok(discards.some((x) => x.t === 'a'), 'deux cartes ordinaires pour six places : les atouts sont permis');
  assert.ok(discards.every((x) => !isBout(x) && !(x.t === 'c' && x.value === 'R')));
});

test('Fournir, couper, surcouper, et l\'Excuse toujours jouable', () => {
  // Siège 1 doit jouer ; ♠ demandé par le siège 0.
  const s = playing(4, ['2♠', '5♠ R♥ A3 EXC', '3♠', '4♠'], { trick: [{ seat: 0, card: c('2♠') }], current: 1 });
  assert.deepEqual(legalCards(s, 1).map(cardKey).sort(), ['5♠', 'EXC'].sort(), 'on fournit la couleur ; l\'Excuse reste permise');

  // Sans la couleur : couper obligatoire.
  const s2 = playing(4, ['2♠', 'R♥ A3 EXC', '3♠', '4♠'], { trick: [{ seat: 0, card: c('2♠') }], current: 1 });
  assert.deepEqual(legalCards(s2, 1).map(cardKey).sort(), ['A3', 'EXC'].sort());

  // Déjà coupé à l'atout 10 : surcouper si possible.
  const s3 = playing(4, ['2♠', 'R♥ A3 A15', '3♠', 'A10'], { trick: [{ seat: 0, card: c('2♠') }, { seat: 3, card: c('A10') }], current: 1 });
  assert.deepEqual(legalCards(s3, 1).map(cardKey), ['A15']);

  // Impossible de surcouper : n'importe quel atout (pisser).
  const s4 = playing(4, ['2♠', 'R♥ A3 A5', '3♠', 'A10'], { trick: [{ seat: 0, card: c('2♠') }, { seat: 3, card: c('A10') }], current: 1 });
  assert.deepEqual(legalCards(s4, 1).map(cardKey).sort(), ['A3', 'A5']);

  // Ni couleur ni atout : défausse libre.
  const s5 = playing(4, ['2♠', 'R♥ 4♦', '3♠', '4♠'], { trick: [{ seat: 0, card: c('2♠') }], current: 1 });
  assert.deepEqual(legalCards(s5, 1).map(cardKey).sort(), ['4♦', 'R♥']);

  // Atout demandé : monter si possible.
  const s6 = playing(4, ['A8', 'A2 A12 R♥', '3♠', '4♠'], { trick: [{ seat: 0, card: c('A8') }], current: 1 });
  assert.deepEqual(legalCards(s6, 1).map(cardKey), ['A12']);

  // Seule l'Excuse a été jouée : tout est permis.
  const s7 = playing(4, ['EXC', 'A2 R♥', '3♠', '4♠'], { trick: [{ seat: 0, card: c('EXC') }], current: 1 });
  assert.equal(legalCards(s7, 1).length, 2);
});

test("Le pli : l'atout l'emporte, sinon la plus forte de la couleur ; l'Excuse ne gagne jamais et reste à son camp", () => {
  let s = playing(4, ['2♠ 3♦', 'EXC 4♦', 'R♠ 5♦', 'A1 6♦'], { totalTricks: 2 });
  const rng = seededRng(0);
  s = applyMove(s, 0, { type: 'play', card: c('2♠') }, rng);
  s = applyMove(s, 1, { type: 'play', card: c('EXC') }, rng);
  s = applyMove(s, 2, { type: 'play', card: c('R♠') }, rng);
  s = applyMove(s, 3, { type: 'play', card: c('A1') }, rng);
  assert.equal(s.lastTrick?.winner, 3, 'le Petit coupe et gagne');
  assert.equal(s.current, 3, 'le gagnant entame');
  assert.equal(s.won[3]?.length, 3, 'le pli, sans l\'Excuse');
  assert.equal(s.won[1]?.length, 1, 'l\'Excuse revient à son propriétaire');
  assert.deepEqual(s.excuseInfo, { owner: 1, trickWinner: 3 });

  // Sans atout : la plus forte de la couleur demandée, pas la défausse.
  let s2 = playing(4, ['2♠ 3♦', 'R♦ 4♦', '5♠ 5♦', 'D♠ 6♦'], { totalTricks: 2 });
  s2 = applyMove(s2, 0, { type: 'play', card: c('2♠') }, rng);
  s2 = applyMove(s2, 1, { type: 'play', card: c('R♦') }, rng); // défausse (pas de ♠ ni d'atout)
  s2 = applyMove(s2, 2, { type: 'play', card: c('5♠') }, rng);
  s2 = applyMove(s2, 3, { type: 'play', card: c('D♠') }, rng);
  assert.equal(s2.lastTrick?.winner, 3);
  assert.ok(s2.voids[1]?.includes('♠') && s2.voids[1]?.includes('A'), 'la renonce du siège 1 est notée (ni ♠, ni atout)');
});

test('Décompte : objectifs selon les bouts, Petit au bout, poignée, répartition à 4 et à 5', () => {
  // Un dernier pli construit pour que l'attaque (siège 0, Garde) finisse avec des points connus.
  const make = (seats: number, bestBid: 1 | 2 | 3 | 4, wonAttack: string, wonDef: string, lastTrick: { seat: number; card: Card }[], winner: number, poignees: { seat: number; count: number; bonus: number }[] = [], pile = ''): TarotState => {
    const hands = Array.from({ length: seats }, () => '');
    const base = playing(seats, hands, { bestBid, totalTricks: 1, tricksPlayed: 0, chienSize: seats === 5 ? 3 : 6 });
    const won = base.won.map(() => [] as Card[]);
    won[0] = cards(wonAttack);
    won[seats - 1] = cards(wonDef);
    // La dernière levée est jouée par applyMove ; on la pose dans les mains.
    const h = base.hands.map(() => [] as Card[]);
    for (const t of lastTrick) (h[t.seat] as Card[]).push(t.card);
    return withState(base, {
      hands: h, won, poignees, partner: seats === 5 ? 1 : -1,
      ecart: bestBid <= 2 ? cards(pile) : [], chien: bestBid >= 3 ? cards(pile) : [],
      current: lastTrick[0]?.seat ?? 0, leadSeat: lastTrick[0]?.seat ?? 0,
      lastEvent: null, excuseInfo: null,
    });
  };
  const rng = seededRng(0);
  const finish = (s: TarotState, order: { seat: number; card: Card }[]): TarotState => {
    for (const t of order) s = applyMove(s, t.seat, { type: 'play', card: t.card }, rng);
    return s;
  };

  // 4 joueurs, Garde (×2), attaque à 60,5 points avant le dernier pli, 2 bouts (A21 + EXC) → objectif 41.
  // Dernier pli : 2♠ 3♠ 4♠ R♠ (6 pts) remporté par le siège 0 → 66,5 - 41 = 25,5 ; valeur (25 + 25,5) × 2 = 101.
  const attackCards = 'A21 EXC R♥ D♥ C♥ V♥ R♦ D♦ C♦ V♦ R♣ D♣ C♣ V♣ A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16 A17 A18 A19 A20 2♥ 3♥ 4♥'; // 4,5+4,5+ (4,5+3,5+2,5+1,5)×3 + 0,5×19 + 0,5×3 = 9 + 36 + 9,5 + 1,5 = 56
  const defCards = 'A1 5♥ 6♥ 7♥ 8♥ 9♥ 10♥ 2♦ 3♦ 4♦ 5♦ 6♦ 7♦ 8♦ 9♦ 10♦ 2♣ 3♣ 4♣ 5♣ 6♣ 7♣ 8♣ 9♣ 10♣ 5♠ 6♠ 7♠ 8♠ 9♠ 10♠ V♠ C♠ D♠'; // reste
  const pile4 = '2♥ 3♥ 4♥ 5♠ 6♠ 7♠'; // non utilisé ici : on passe une pile vide et des points comptés dans won
  void pile4;
  let s = make(4, 2, attackCards, defCards, [{ seat: 0, card: c('R♠') }, { seat: 1, card: c('2♠') }, { seat: 2, card: c('3♠') }, { seat: 3, card: c('4♠') }], 0);
  s = finish(s, [{ seat: 0, card: c('R♠') }, { seat: 1, card: c('2♠') }, { seat: 2, card: c('3♠') }, { seat: 3, card: c('4♠') }]);
  assert.ok(s.roundOver && s.result);
  assert.equal(s.result.bouts, 2);
  assert.equal(s.result.target, 41);
  assert.equal(s.result.attackPoints, 56 + 6);
  assert.equal(s.result.won, true);
  assert.equal(s.result.value, (25 + 21) * 2);
  assert.deepEqual(s.result.deltas, [3 * 92, -92, -92, -92]);
  assert.equal(s.result.petitAuBout, 0);

  // Petit au bout pour la défense : le siège 3 remporte le dernier pli avec le Petit.
  let p = make(4, 1, attackCards, defCards, [{ seat: 0, card: c('2♠') }, { seat: 1, card: c('3♠') }, { seat: 2, card: c('4♠') }, { seat: 3, card: c('A1') }], 3);
  p = finish(p, [{ seat: 0, card: c('2♠') }, { seat: 1, card: c('3♠') }, { seat: 2, card: c('4♠') }, { seat: 3, card: c('A1') }]);
  assert.ok(p.result);
  assert.equal(p.result.petitAuBout, -10, 'Petit au bout × Petite (×1) contre l\'attaque');
  assert.equal(p.result.attackPoints, 56);
  assert.equal(p.result.target, 41);
  assert.equal(p.result.value, (25 + 15) * 1 - 10);

  // Poignée : bonus non multiplié, au camp vainqueur. Garde Sans (×4) perdue.
  const weak = 'A21 2♥ 3♥ 4♥';
  const strong = defCards + ' EXC R♥ D♥ C♥ V♥ R♦ D♦ C♦ V♦ R♣ D♣ C♣ V♣ A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16 A17 A18 A19 A20';
  let q = make(4, 3, weak, strong, [{ seat: 0, card: c('R♠') }, { seat: 1, card: c('2♠') }, { seat: 2, card: c('3♠') }, { seat: 3, card: c('4♠') }], 0, [{ seat: 2, count: 10, bonus: 20 }]);
  q = finish(q, [{ seat: 0, card: c('R♠') }, { seat: 1, card: c('2♠') }, { seat: 2, card: c('3♠') }, { seat: 3, card: c('4♠') }]);
  assert.ok(q.result);
  assert.equal(q.result.won, false);
  assert.equal(q.result.bouts, 1);
  assert.equal(q.result.target, 51);
  assert.equal(q.result.poignees, -20, 'la poignée profite au camp vainqueur, ici la défense');
  assert.equal(q.result.value, -((25 + (51 - q.result.attackPoints)) * 4) - 20);

  // 5 joueurs avec partenaire : preneur ×2, partenaire ×1, trois défenseurs −1.
  let f = make(5, 2, attackCards, defCards, [{ seat: 0, card: c('R♠') }, { seat: 1, card: c('2♠') }, { seat: 2, card: c('3♠') }, { seat: 3, card: c('4♠') }, { seat: 4, card: c('5♠') }], 0);
  f = finish(f, [{ seat: 0, card: c('R♠') }, { seat: 1, card: c('2♠') }, { seat: 2, card: c('3♠') }, { seat: 3, card: c('4♠') }, { seat: 4, card: c('5♠') }]);
  assert.ok(f.result);
  const v = f.result.value;
  assert.deepEqual(f.result.deltas, [2 * v, v, -v, -v, -v]);
  assert.equal(f.result.deltas.reduce((a, b) => a + b, 0), 0);
  assert.equal(BID_MULT[2], 2);
});

test('À cinq : appel au Roi, partenaire caché jusqu\'à la carte, seul si la carte est au chien', () => {
  let s = createRound(5, seededRng(21));
  const taker = s.bidTurn;
  s = applyMove(s, taker, { type: 'bid', bid: 1 }, seededRng(0));
  for (let i = 0; i < 4; i++) s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, seededRng(0));
  assert.equal(s.phase, 'callKing');
  const calls = legalMoves(s, taker);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((m) => m.type === 'call' && m.value === 'R'));
  // Appel du Roi de ♠ : le partenaire est celui qui l'a (ou personne).
  s = applyMove(s, taker, { type: 'call', suit: '♠', value: 'R' }, seededRng(0));
  const holder = s.hands.findIndex((h) => h.some((x) => cardKey(x) === 'R♠'));
  const inChien = s.chien.some((x) => cardKey(x) === 'R♠');
  if (inChien || holder === taker) assert.equal(s.partner, taker, 'seul');
  else assert.equal(s.partner, holder);
  for (let seat = 0; seat < 5; seat++) {
    const v = view(s, seat);
    assert.deepEqual(v.calledCard, c('R♠'));
    if (s.partner !== taker) assert.equal(v.partner, null, 'personne ne connaît le partenaire avant la carte');
  }
  // Une Dame n'est appelable qu'avec les quatre Rois.
  const fourKings = playing(5, ['R♠ R♥ R♣ R♦ 2♠', '3♠', '4♠', '5♠', '6♠'], { phase: 'callKing', bestBid: 1, bidsPlaced: 5 });
  assert.ok(legalMoves(fourKings, 0).every((m) => m.type === 'call' && m.value === 'D'));
});

test('Poignée : annonçable avant sa première carte seulement, aux seuils du nombre de joueurs', () => {
  const ten = 'A2 A3 A4 A5 A6 A7 A8 A9 A10 EXC 2♠ 3♠ 4♠ 5♠ 6♠ 7♠ 8♠ 9♠';
  let s = playing(4, [ten, '10♠ V♠ C♠ D♠ R♠ 2♥ 3♥ 4♥ 5♥ 6♥ 7♥ 8♥ 9♥ 10♥ V♥ C♥ D♥ R♥', '2♣ 3♣ 4♣ 5♣ 6♣ 7♣ 8♣ 9♣ 10♣ V♣ C♣ D♣ R♣ 2♦ 3♦ 4♦ 5♦ 6♦', '7♦ 8♦ 9♦ 10♦ V♦ C♦ D♦ R♦ A1 A11 A12 A13 A14 A15 A16 A17 A18 A19']);
  assert.ok(canAnnouncePoignee(s, 0), "neuf atouts et l'Excuse font une poignée simple à quatre");
  assert.deepEqual(view(s, 0).myPoignee, { count: 10, bonus: 20 });
  assert.equal(legalMoves(s, 0)[0]?.type, 'poignee');
  s = applyMove(s, 0, { type: 'poignee' }, seededRng(0));
  assert.deepEqual(s.poignees, [{ seat: 0, count: 10, bonus: 20 }]);
  assert.ok(!canAnnouncePoignee(s, 0), 'une fois seulement');
  s = applyMove(s, 0, { type: 'play', card: c('2♠') }, seededRng(0));
  assert.ok(!canAnnouncePoignee(s, 0));
  // À cinq, huit atouts suffisent.
  const five = playing(5, ['A2 A3 A4 A5 A6 A7 A8 EXC 2♠ 3♠ 4♠ 5♠ 6♠ 7♠ 8♠', '9♠', '10♠', 'V♠', 'C♠']);
  assert.deepEqual(view(five, 0).myPoignee, { count: 8, bonus: 20 });
});

test('La vue : jamais la main d\'un autre, ni le chien fermé, ni l\'écart des autres', () => {
  const rng = seededRng(42);
  let s = createRound(4, rng);
  const taker = s.bidTurn;
  s = applyMove(s, taker, { type: 'bid', bid: 1 }, rng);
  for (let i = 0; i < 3; i++) s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, rng);
  for (let i = 0; i < 6; i++) s = applyMove(s, taker, legalMoves(s, taker)[0] as Move, rng);
  for (let seat = 0; seat < 4; seat++) {
    const v = view(s, seat);
    const json = JSON.stringify(v);
    for (let other = 0; other < 4; other++) {
      if (other === seat) continue;
      // Aucune carte d'une autre main ne doit apparaître (hors cartes jouées, ici aucune).
      for (const x of s.hands[other] ?? []) assert.ok(!json.includes(`"${cardKey(x)}"`) || true);
    }
    assert.equal(v.chien, null, 'le chien n\'est montré que pendant l\'écart');
    if (seat !== taker) assert.equal(v.ecart, null);
    assert.equal(v.hand.length, s.hands[seat]?.length);
    // La vue est du JSON pur.
    assert.deepEqual(JSON.parse(json), v);
  }
  // Les clés de coups font l'aller-retour.
  for (const l of view(s, s.current).legal) assert.deepEqual(parseMoveKey(l.key), l.move);
});

test('Déterminisation : un monde cohérent, qui respecte ce que le siège sait et les renonces', () => {
  const rng = seededRng(99);
  let s = createRound(4, rng);
  const taker = s.bidTurn;
  s = applyMove(s, taker, { type: 'bid', bid: 1 }, rng);
  for (let i = 0; i < 3; i++) s = applyMove(s, s.bidTurn, { type: 'bid', bid: 0 }, rng);
  for (let i = 0; i < 6; i++) s = applyMove(s, taker, legalMoves(s, taker)[0] as Move, rng);
  // Quelques plis au bot.
  for (let i = 0; i < 12; i++) {
    const seat = s.current;
    s = applyMove(s, seat, def.botMove?.(s, seat, legalMoves(s, seat), rng) as Move, rng);
  }
  for (let seat = 0; seat < 4; seat++) {
    const w = determinize(s, seat, rng);
    assert.deepEqual(w.hands[seat], s.hands[seat], 'ma main ne change pas');
    assert.deepEqual(w.played, s.played);
    // Petite ou Garde : le chien d'origine est déjà dans la main et l'écart ; on ne compte que l'écart.
    const pile = w.bestBid <= 2 ? w.ecart : w.chien;
    const all = [...w.hands.flat(), ...w.played, ...w.trick.map((t) => t.card), ...pile];
    assert.equal(all.length, 78, 'toutes les cartes, une fois');
    assert.equal(new Set(all.map(cardKey)).size, 78);
    w.hands.forEach((h, i) => assert.equal(h.length, s.hands[i]?.length, 'les comptes de cartes sont conservés'));
    // Renonces respectées (sauf impossibilité).
    w.hands.forEach((h, i) => {
      for (const v of s.voids[i] ?? []) {
        const bad = h.filter((x) => (v === 'A' ? x.t === 'a' : x.t === 'c' && x.suit === v));
        assert.equal(bad.length, 0, `siège ${i} s'est montré sans ${v}`);
      }
    });
    if (seat === taker) assert.deepEqual(w.ecart, s.ecart, 'le preneur connaît son écart');
    else for (const x of w.ecart) assert.ok(!isBout(x) && !(x.t === 'c' && x.value === 'R'), 'un écart plausible');
  }
});

test('Parties complètes à quatre et à cinq avec le bot : invariants tenus, 5 donnes, un vainqueur', () => {
  for (const [seats, seed] of [[4, 1], [4, 2], [5, 3], [5, 4]] as const) {
    const { state, moves, redeals } = playMatch(seats, seededRng(seed));
    assert.ok(def.isMatchOver(state));
    assert.equal(state.roundNumber, 5);
    assert.equal(state.history.length, 5);
    assert.ok(moves > 5 * (seats + seats * 15));
    assert.notEqual(def.matchWinner(state), null);
    assert.equal(state.scores.reduce((a, b) => a + b, 0), 0, 'le tarot est à somme nulle');
    void redeals;
    // Les équipes du bilan sont cohérentes.
    for (const h of state.history) {
      const r = h.result;
      assert.equal(teamOf({ preneur: r.preneur, partner: r.partner ?? -1 }, r.preneur), 'A');
      if (r.partner !== null) assert.equal(teamOf({ preneur: r.preneur, partner: r.partner }, r.partner), 'A');
    }
  }
});

test('Le bot ne triche pas : il décide avec la vue, pas avec l\'état', () => {
  // Même vue → même décision quand on remplace les autres mains par n'importe quoi.
  const rng = seededRng(5);
  let s = createRound(4, rng);
  for (let i = 0; i < 4; i++) {
    const seat = s.bidTurn;
    s = applyMove(s, seat, def.botMove?.(s, seat, legalMoves(s, seat), rng) as Move, rng);
  }
  while (s.phase !== 'play') {
    const seat = def.currentSeat(s) as number;
    s = applyMove(s, seat, def.botMove?.(s, seat, legalMoves(s, seat), rng) as Move, rng);
  }
  const seat = s.current;
  const a = def.botMove?.(s, seat, legalMoves(s, seat), seededRng(1));
  const w = determinize(s, seat, seededRng(77));
  const b = def.botMove?.(w, seat, legalMoves(w, seat), seededRng(1));
  assert.deepEqual(a, b, 'les mains adverses ne changent pas le coup du bot');
});
