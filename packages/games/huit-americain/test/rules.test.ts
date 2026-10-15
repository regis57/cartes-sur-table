import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, cryptoRng, mctsChooseMove } from '@jdc/core';
import {
  huitAmericain as def, createDeck, createRound, legalMoves, applyMove, forcedMove, view, determinize, isPlayable,
  cardPoints, moveKey, MATCH_LIMIT, HAND_SIZE, type HuitState, type Card, type Move, type Suit, type Value,
} from '../src/rules.ts';

const c = (value: Value, suit: Suit): Card => ({ value, suit });

/** Fabrique un état précis pour tester une règle isolément. */
function state(partial: Partial<HuitState> & { hands: Card[][]; discard: Card[] }): HuitState {
  const seats = partial.hands.length;
  const top = partial.discard[partial.discard.length - 1] as Card;
  return {
    seats,
    deck: [],
    current: 0,
    direction: 1,
    activeSuit: top.suit,
    scores: new Array<number>(seats).fill(0),
    roundOver: false,
    roundWinner: null,
    roundPoints: new Array<number>(seats).fill(0),
    lastAction: null,
    draws: new Array<number>(seats).fill(0),
    lastPlayed: new Array<Card | null>(seats).fill(null),
    replaying: false,
    ...partial,
  };
}

test('jeu de 52 cartes, donne de 6, première carte retournée', () => {
  assert.equal(createDeck().length, 52);
  assert.equal(new Set(createDeck().map((x) => x.value + x.suit)).size, 52);
  const s = createRound(4, seededRng(1));
  assert.ok(s.hands.every((h) => h.length === HAND_SIZE));
  assert.equal(s.deck.length, 52 - 4 * HAND_SIZE - 1);
  assert.equal(s.discard.length, 1);
  assert.equal(s.activeSuit, s.discard[0]?.suit);
  assert.equal(def.currentSeat(s), 0);
});

test('isPlayable et points', () => {
  assert.ok(isPlayable(c('5', '♥'), '♥', 'R'));
  assert.ok(isPlayable(c('R', '♣'), '♥', 'R'));
  assert.ok(!isPlayable(c('5', '♣'), '♥', 'R'));
  assert.ok(isPlayable(c('8', '♣'), '♥', 'R'));
  assert.ok(!isPlayable(c('8', '♣'), '♥', '8'), 'pas de 8 sur un 8');
  assert.equal(cardPoints('8'), 32);
  assert.equal(cardPoints('A'), 11);
  assert.equal(cardPoints('2'), 2);
});

test('coups légaux : clés uniques, 8 décliné en 4 couleurs, pioche toujours proposée', () => {
  const s = state({ hands: [[c('8', '♣'), c('5', '♥'), c('5', '♥'), c('2', '♠')], [], [], []], discard: [c('R', '♥')] });
  const legal = legalMoves(s, 0);
  const keys = legal.map(moveKey);
  assert.equal(new Set(keys).size, keys.length, 'pas de doublon même avec deux cartes identiques');
  assert.equal(keys.filter((k) => k.startsWith('play:8♣>')).length, 4);
  assert.ok(keys.includes('play:5♥'));
  assert.ok(!keys.includes('play:2♠'));
  assert.ok(keys.includes('draw'));
  assert.deepEqual(legalMoves(s, 1), [], 'pas son tour');
  assert.equal(forcedMove(s, 0), null);
  const stuck = state({ hands: [[c('2', '♠')], [], [], []], discard: [c('R', '♥')] });
  assert.deepEqual(forcedMove(stuck, 0), { type: 'draw' });
});

test('applyMove : pureté, refus des coups illégaux, 7 rejoue, 10 inverse, 8 change de couleur', () => {
  const s0 = state({ hands: [[c('7', '♥'), c('10', '♥'), c('8', '♠'), c('3', '♣')], [c('A', '♦')], [c('A', '♦')], [c('A', '♦')]], discard: [c('R', '♥')] });
  const before = JSON.stringify(s0);
  const s1 = applyMove(s0, 0, { type: 'play', card: c('7', '♥') }, seededRng(1));
  assert.equal(JSON.stringify(s0), before, 'état d\'origine intact');
  assert.equal(s1.current, 0, 'le 7 fait rejouer');
  assert.ok(s1.replaying);
  const s2 = applyMove(s1, 0, { type: 'play', card: c('10', '♥') }, seededRng(1));
  assert.equal(s2.direction, -1);
  assert.equal(s2.current, 3, 'sens inversé');
  // Coups illégaux : état renvoyé tel quel.
  assert.equal(applyMove(s2, 0, { type: 'draw' }, seededRng(1)), s2, 'pas son tour');
  assert.equal(applyMove(s0, 0, { type: 'play', card: c('3', '♣') }, seededRng(1)), s0, 'carte injouable');
  assert.equal(applyMove(s0, 0, { type: 'play', card: c('8', '♠') }, seededRng(1)), s0, '8 sans couleur');
  assert.equal(applyMove(s0, 0, { type: 'play', card: c('A', '♥') }, seededRng(1)), s0, 'carte absente de la main');
  const s3 = applyMove(s0, 0, { type: 'play', card: c('8', '♠'), suit: '♦' }, seededRng(1));
  assert.equal(s3.activeSuit, '♦');
  assert.equal(s3.current, 1);
});

test('pioche : rebat la défausse, passe quand tout est épuisé, compte les pioches', () => {
  const s = state({ hands: [[c('2', '♠')], [c('3', '♠')], [c('4', '♠')], [c('5', '♠')]], discard: [c('9', '♦'), c('K' as Value, '♦'), c('R', '♥')], deck: [] });
  const d = applyMove(s, 0, { type: 'draw' }, seededRng(3));
  assert.equal(d.hands[0]?.length, 2);
  assert.equal(d.discard.length, 1, 'défausse rebattue sauf le dessus');
  assert.equal(d.discard[0]?.value, 'R');
  assert.equal(d.deck.length, 1);
  assert.equal(d.draws[0], 1);
  assert.equal(d.lastAction?.type, 'draw');
  const empty = state({ hands: [[c('2', '♠')], [c('3', '♠')], [c('4', '♠')], [c('5', '♠')]], discard: [c('R', '♥')], deck: [] });
  const p = applyMove(empty, 0, { type: 'draw' }, seededRng(3));
  assert.equal(p.hands[0]?.length, 1, 'aucune carte fantôme');
  assert.equal(p.lastAction?.type, 'pass');
  assert.equal(p.current, 1);
});

test('fin de manche et de partie : points, vainqueur, succès', () => {
  const s = state({
    hands: [[c('A', '♥')], [c('8', '♠'), c('A', '♦')], [c('2', '♣')], []],
    discard: [c('R', '♥')],
    scores: [0, 170, 10, 199],
  });
  const end = applyMove(s, 0, { type: 'play', card: c('A', '♥') }, seededRng(1));
  assert.ok(def.isRoundOver(end));
  assert.equal(def.currentSeat(end), null);
  assert.equal(end.roundWinner, 0);
  assert.deepEqual(end.roundPoints, [0, 43, 2, 0]);
  assert.deepEqual(def.scores(end), [0, 213, 12, 199]);
  assert.ok(def.isMatchOver(end), `${MATCH_LIMIT} atteints`);
  assert.equal(def.matchWinner(end), 0);
  const summary = def.roundSummary(end);
  assert.equal(summary.roundWinner, 0);
  assert.equal(summary.perSeat[1]?.roundPoints, 43);
  assert.deepEqual(def.achievements(end, 0, { matchOver: true, wonMatch: true, rounds: 1 }).sort(), ['manche-parfaite', 'sans-pioche']);
  assert.deepEqual(def.achievements(end, 1, { matchOver: true, wonMatch: false, rounds: 1 }), []);
  // Manche suivante : scores conservés, le vainqueur ouvre.
  const next = createRound(4, seededRng(2), end);
  assert.deepEqual(next.scores, [0, 213, 12, 199]);
  assert.equal(next.current, 0);
  assert.ok(!next.roundOver);
});

test('vue par joueur : main privée, pas de pioche ni de mains adverses, coups légaux au tour', () => {
  const s = createRound(4, seededRng(5));
  const v0 = view(s, 0);
  const v1 = view(s, 1);
  assert.equal(v0.hand.length, HAND_SIZE);
  assert.deepEqual(v0.handCounts, [6, 6, 6, 6]);
  assert.ok(v0.legal.length > 0 && v1.legal.length === 0);
  const json = JSON.stringify(v1);
  assert.ok(!json.includes('"deck"'));
  for (const card of s.hands[0] ?? []) {
    // Une carte de la main du siège 0 peut apparaître chez 1 seulement si c'est la défausse.
    const k = `{"suit":"${card.suit}","value":"${card.value}"}`;
    const occurrences = json.split(k).length - 1;
    assert.ok(occurrences <= (JSON.stringify(v1.discardTop) === k ? 1 : 0), `fuite de ${k}`);
  }
});

test('determinize : respecte ce que le siège sait, et seulement ça', () => {
  const s = createRound(4, seededRng(9));
  for (let i = 0; i < 20; i++) {
    const d = determinize(s, 2, seededRng(i));
    assert.deepEqual(d.hands[2], s.hands[2], 'ma main est fixe');
    assert.deepEqual(d.hands.map((h) => h.length), s.hands.map((h) => h.length));
    assert.equal(d.deck.length, s.deck.length);
    const all = (x: HuitState) => [...x.hands.flat(), ...x.deck, ...x.discard].map((k) => k.value + k.suit).sort();
    assert.deepEqual(all(d), all(s), 'même multi-ensemble de cartes');
  }
});

test('simulation : des parties entières avec la politique de base se terminent', () => {
  const rng = seededRng(11);
  for (let g = 0; g < 20; g++) {
    let s = createRound(4, rng);
    let moves = 0;
    while (!def.isRoundOver(s) && moves < 2000) {
      const seat = def.currentSeat(s) as number;
      const legal = def.legalMoves(s, seat);
      const m = def.rolloutMove!(s, seat, legal, rng);
      s = def.applyMove(s, seat, m, rng);
      moves += 1;
    }
    assert.ok(def.isRoundOver(s), `manche ${g} interminable`);
    assert.ok(s.roundWinner !== null);
  }
});

test('MCTS : joue le coup qui gagne tout de suite, et un coup légal même sans budget', () => {
  const s = state({
    hands: [[c('A', '♠')], [c('8', '♠'), c('A', '♦'), c('5', '♣')], [c('2', '♣'), c('9', '♣')], [c('3', '♦'), c('4', '♦')]],
    discard: [c('R', '♠')],
    deck: [c('6', '♣'), c('7', '♣'), c('9', '♥'), c('10', '♥')],
  });
  const res = mctsChooseMove(def, s, 0, { timeMs: 5000, maxIterations: 200, rng: seededRng(1) });
  assert.ok(res);
  assert.equal(def.moveKey(res!.move), 'play:A♠');
  assert.ok(res!.iterations <= 200 && res!.iterations > 50);
  const res2 = mctsChooseMove(def, s, 0, { timeMs: 0, maxIterations: 0, rng: seededRng(1) });
  assert.ok(res2 && ['play:A♠', 'draw'].includes(def.moveKey(res2.move)), 'budget nul : un coup légal quand même');
  const forced = state({ hands: [[c('2', '♥')], [c('3', '♦')], [c('4', '♦')], [c('5', '♦')]], discard: [c('R', '♠')] });
  assert.equal(def.moveKey(mctsChooseMove(def, forced, 0, { timeMs: 5000, maxIterations: 50, rng: seededRng(1) })!.move), 'draw', 'un seul coup : pas de recherche');
});

test('MCTS : nettement meilleur que le hasard contre des adversaires qui jouent au hasard', () => {
  // Déterministe : même graine, pas de coupure au temps. Référence mesurée : hasard pur
  // 3 %, politique de base 37 %, MCTS à 300 itérations 41 %, à 1500 itérations 51 %.
  const rng = seededRng(2026);
  let wins = 0;
  const games = 40;
  for (let g = 0; g < games; g++) {
    let s = createRound(4, rng);
    let moves = 0;
    while (!def.isRoundOver(s) && moves < 1000) {
      const seat = def.currentSeat(s) as number;
      const legal = def.legalMoves(s, seat);
      let m: Move;
      if (seat === 0) m = mctsChooseMove(def, s, seat, { timeMs: 60_000, maxIterations: 200, rng })?.move ?? (legal[0] as Move);
      else {
        const plays = legal.filter((x) => x.type === 'play');
        m = plays.length ? (plays[rng.int(plays.length)] as Move) : (legal[0] as Move);
      }
      s = def.applyMove(s, seat, m, rng);
      moves += 1;
    }
    if (s.roundWinner === 0) wins += 1;
  }
  assert.ok(wins >= games * 0.25, `MCTS a gagné ${wins}/${games}`);
});

test('aléa crypto : une vraie donne reste valide', () => {
  const s = createRound(4, cryptoRng);
  assert.equal(s.deck.length + s.discard.length + s.hands.flat().length, 52);
});
