import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRng } from '@jdc/core';
import {
  belote as def, createRound, legalMoves, legalCards, applyMove, view, determinize, moveKey, parseMoveKey,
  findDeclarations, declaringTeam, trickMaster, teamOf, TARGET_SCORE, type BeloteState, type Move,
} from '../src/rules.ts';
import { buildDeck, cardKey, cardPoints, cardStrength, parseCardKey, sortHand, type Card } from '../src/cartes.ts';

const c = (key: string): Card => {
  const card = parseCardKey(key);
  if (!card) throw new Error(`carte invalide : ${key}`);
  return card;
};
const cards = (keys: string): Card[] => keys.split(' ').filter(Boolean).map(c);

/** Une donne en cours de jeu avec des mains choisies, pour tester une règle isolée. */
function playing(hands: string[], extra: Partial<BeloteState> = {}): BeloteState {
  const base = createRound(4, seededRng(3));
  const trump = extra.trump ?? '♠';
  const h = hands.map((s) => sortHand(cards(s), trump));
  return {
    ...base,
    phase: 'play',
    hands: h,
    trump,
    taker: 0,
    bidTurn: -1,
    current: 0,
    leadSeat: 0,
    trick: [],
    talon: [],
    ...extra,
  };
}

function play(state: BeloteState, seat: number, key: string): BeloteState {
  return applyMove(state, seat, { type: 'play', card: c(key) }, seededRng(1));
}

test('le paquet : 32 cartes, 152 points à l\'atout comme hors atout, V et 9 forts à l\'atout seulement', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 32);
  assert.equal(new Set(deck.map(cardKey)).size, 32);
  assert.equal(deck.reduce((s, x) => s + cardPoints(x, '♠'), 0), 152);
  assert.ok(cardStrength(c('V♠'), '♠') > cardStrength(c('A♠'), '♠'));
  assert.ok(cardStrength(c('9♠'), '♠') > cardStrength(c('A♠'), '♠'));
  assert.ok(cardStrength(c('A♥'), '♠') > cardStrength(c('V♥'), '♠'));
  assert.equal(cardPoints(c('V♠'), '♠'), 20);
  assert.equal(cardPoints(c('V♥'), '♠'), 2);
  assert.equal(cardPoints(c('9♥'), '♠'), 0);
});

test('la donne : 5 cartes chacun, une retourne, 11 au talon, enchères à gauche du donneur', () => {
  const s = createRound(4, seededRng(5));
  assert.equal(s.phase, 'bid1');
  assert.deepEqual(s.hands.map((h) => h.length), [5, 5, 5, 5]);
  assert.equal(s.talon.length, 11);
  assert.equal(s.bidTurn, (s.dealer + 1) % 4);
  const legal = legalMoves(s, s.bidTurn);
  assert.deepEqual(legal.map(moveKey).sort(), ['pass', `take:${s.turned.suit}`].sort());
  assert.deepEqual(legalMoves(s, (s.bidTurn + 1) % 4), [], 'pas son tour');
  // La vue ne montre que sa main, et la retourne à tous.
  const v = view(s, 2);
  assert.equal(v.hand.length, 5);
  assert.ok(v.turned && cardKey(v.turned) === cardKey(s.turned));
  assert.ok(!('hands' in v));
});

test('quatre passes → second tour aux autres couleurs ; huit passes → nouvelle donne, donneur suivant', () => {
  let s = createRound(4, seededRng(5));
  const dealer = s.dealer;
  for (let i = 0; i < 4; i++) s = applyMove(s, s.bidTurn, { type: 'pass' }, seededRng(1));
  assert.equal(s.phase, 'bid2');
  const legal = legalMoves(s, s.bidTurn).map(moveKey);
  assert.equal(legal.length, 4);
  assert.ok(!legal.includes(`take:${s.turned.suit}`), 'pas la couleur de la retourne');
  for (let i = 0; i < 4; i++) s = applyMove(s, s.bidTurn, { type: 'pass' }, seededRng(1));
  assert.equal(s.phase, 'bid1');
  assert.equal(s.dealer, (dealer + 1) % 4);
  assert.equal(s.roundNumber, 1, 'la donne ne compte pas');
  assert.deepEqual(s.lastEvent, { type: 'redeal' });
});

test('prendre : la retourne au preneur, 2 cartes à lui, 3 aux autres, huit chacun, l\'atout fixé', () => {
  let s = createRound(4, seededRng(5));
  const taker = s.bidTurn;
  const turned = s.turned;
  s = applyMove(s, taker, { type: 'take', suit: turned.suit }, seededRng(1));
  assert.equal(s.phase, 'play');
  assert.equal(s.trump, turned.suit);
  assert.equal(s.taker, taker);
  assert.deepEqual(s.hands.map((h) => h.length), [8, 8, 8, 8]);
  assert.ok(s.hands[taker]!.some((x) => cardKey(x) === cardKey(turned)));
  assert.equal(s.talon.length, 0);
  assert.equal(s.current, (s.dealer + 1) % 4, 'entame à gauche du donneur');
  const all = s.hands.flat().map(cardKey);
  assert.equal(new Set(all).size, 32);
});

test('fournir, couper, surcouper ; libre si le partenaire est maître ; monter à l\'atout', () => {
  const s = playing(['A♥ 7♠ 9♠ 8♦ 7♦ 10♣ 9♣ 8♣', '10♥ 8♠ V♠ A♦ 9♦ 7♣ D♣ R♣', 'D♥ 9♥ A♠ 10♠ R♦ D♦ V♣ A♣', 'R♥ V♥ 8♥ 7♥ R♠ D♠ V♦ 10♦']);
  // Siège 1 entame cœur ; siège 2 a du cœur : il doit fournir.
  let t = { ...s, current: 1, leadSeat: 1 };
  t = play(t, 1, '10♥');
  assert.deepEqual(legalCards(t, 2).map(cardKey).sort(), ['9♥', 'D♥'].sort());
  t = play(t, 2, '9♥');
  assert.deepEqual(legalCards(t, 3).map(cardKey).sort(), ['7♥', '8♥', 'R♥', 'V♥'].sort());
  t = play(t, 3, 'V♥');
  // Siège 0 a l'As de cœur : il fournit.
  assert.deepEqual(legalCards(t, 0).map(cardKey), ['A♥']);
  t = play(t, 0, 'A♥');
  assert.equal(t.tricksPlayed, 1);
  assert.equal(t.lastTrick?.winner, 0, 'l\'As de cœur gagne');
  assert.equal(t.current, 0);

  // Siège 0 entame carreau ; 1 fournit A♦ ; 2 doit fournir même si l'adversaire est maître ; 3 fournit.
  t = play(t, 0, '8♦');
  t = play(t, 1, 'A♦');
  assert.deepEqual(legalCards(t, 2).map(cardKey).sort(), ['D♦', 'R♦'].sort());
  t = play(t, 2, 'D♦');
  assert.deepEqual(legalCards(t, 3).map(cardKey).sort(), ['10♦', 'V♦'].sort());
  t = play(t, 3, '10♦');
  assert.equal(t.lastTrick?.winner, 1);

  // Siège 1 entame trèfle ; 2 fournit (A♣) ; 3 n'a pas de trèfle, l'adversaire est maître : il doit couper.
  t = play(t, 1, '7♣');
  t = play(t, 2, 'A♣');
  assert.deepEqual(legalCards(t, 3).map(cardKey).sort(), ['D♠', 'R♠'].sort());
  t = play(t, 3, 'D♠');
  assert.deepEqual(legalCards(t, 0).map(cardKey).sort(), ['10♣', '8♣', '9♣'].sort());
  t = play(t, 0, '8♣');
  assert.equal(t.lastTrick?.winner, 3, 'la coupe l\'emporte');

  // Siège 3 entame cœur (7♥) ; 0 n'en a plus, l'adversaire est maître : il coupe ; 1 n'en a plus, l'adversaire (0) a coupé : il doit surcouper ; 2 fournit.
  t = play(t, 3, '7♥');
  assert.deepEqual(legalCards(t, 0).map(cardKey).sort(), ['7♠', '9♠'].sort());
  t = play(t, 0, '7♠');
  assert.deepEqual(legalCards(t, 1).map(cardKey).sort(), ['8♠', 'V♠'].sort());
  t = play(t, 1, '8♠');
  assert.deepEqual(legalCards(t, 2).map(cardKey), ['D♥']);
  t = play(t, 2, 'D♥');
  assert.equal(t.lastTrick?.winner, 1);

  // Siège 1 entame atout (V♠) : les autres doivent monter s'ils peuvent, sinon n'importe quel atout.
  t = play(t, 1, 'V♠');
  assert.deepEqual(legalCards(t, 2).map(cardKey).sort(), ['10♠', 'A♠'].sort(), 'ne peut pas monter sur le Valet : tout atout');
  t = play(t, 2, '10♠');
  assert.deepEqual(legalCards(t, 3).map(cardKey), ['R♠']);
  t = play(t, 3, 'R♠');
  assert.deepEqual(legalCards(t, 0).map(cardKey), ['9♠']);
  t = play(t, 0, '9♠');
  assert.equal(t.lastTrick?.winner, 1);
});

test('surcouper si possible, et renonces mémorisées pour le bot', () => {
  const s = playing(['7♠ 9♠ A♥ 8♥ 7♥ 10♣ 9♣ 8♣', '8♠ V♠ 10♥ R♥ A♦ 9♦ 7♣ D♣', 'A♠ 10♠ D♥ 9♥ R♦ D♦ V♣ A♣', 'R♠ D♠ V♥ 8♦ 7♦ V♦ 10♦ R♣']);
  // Siège 0 entame carreau sans en avoir en face : 1 fournit, 2 fournit, 3 fournit… changeons : 3 entame carreau.
  let t = { ...s, current: 3, leadSeat: 3 };
  t = play(t, 3, '8♦');
  // Siège 0 n'a pas de carreau ; l'adversaire (3) est maître ; il a de l'atout : il coupe.
  assert.deepEqual(legalCards(t, 0).map(cardKey).sort(), ['7♠', '9♠'].sort());
  t = play(t, 0, '7♠');
  assert.ok(t.voids[0]!.includes('♦'));
  // Siège 1 a du carreau : il fournit (A♦ 9♦).
  assert.deepEqual(legalCards(t, 1).map(cardKey).sort(), ['9♦', 'A♦'].sort());
  t = play(t, 1, '9♦');
  // Siège 2 a du carreau : il fournit.
  assert.deepEqual(legalCards(t, 2).map(cardKey).sort(), ['D♦', 'R♦'].sort());
  t = play(t, 2, 'R♦');
  assert.equal(t.lastTrick?.winner, 0);
  // Siège 0 entame cœur ; siège 1 fournit ; siège 2 fournit ; 3 fournit (V♥).
  t = play(t, 0, '8♥');
  t = play(t, 1, '10♥');
  t = play(t, 2, '9♥');
  t = play(t, 3, 'V♥');
  assert.equal(t.lastTrick?.winner, 1);
  // Siège 1 entame cœur (R♥) ; 2 fournit (D♥) ; 3 n'a plus de cœur mais son partenaire (1) est maître : il est libre.
  t = play(t, 1, 'R♥');
  t = play(t, 2, 'D♥');
  assert.equal(legalCards(t, 3).length, t.hands[3]!.length);
  t = play(t, 3, 'R♠');
  // Siège 0 n'a plus que A♥ 7♥ en cœur : il fournit.
  assert.deepEqual(legalCards(t, 0).map(cardKey).sort(), ['7♥', 'A♥'].sort());
  t = play(t, 0, '7♥');
  assert.equal(t.lastTrick?.winner, 3);
  // Siège 3 entame trèfle (R♣) ; 0 fournit ; 1 fournit (7♣ D♣) ; 2 fournit.
  t = play(t, 3, 'R♣');
  t = play(t, 0, '10♣');
  t = play(t, 1, '7♣');
  // Siège 2 a V♣ A♣ : il fournit, et peut surcouper ? non, c'est une couleur : il fournit.
  assert.deepEqual(legalCards(t, 2).map(cardKey).sort(), ['A♣', 'V♣'].sort());
  t = play(t, 2, 'A♣');
  // Siège 2 entame carreau (D♦) ; siège 3 fournit et prend la main (10♦) ; siège 0 n'en a pas et l'adversaire est maître : il coupe avec son dernier atout ; 1 fournit.
  t = play(t, 2, 'D♦');
  t = play(t, 3, '10♦');
  assert.deepEqual(legalCards(t, 0).map(cardKey), ['9♠']);
  t = play(t, 0, '9♠');
  t = play(t, 1, 'A♦');
  assert.equal(t.lastTrick?.winner, 0);
  // Siège 0 entame trèfle (9♣) ; 1 fournit D♣ ; 2 fournit son dernier trèfle (V♣) ; 3 n'a plus de trèfle mais son partenaire (1) est maître : il est libre et peut garder son atout.
  t = play(t, 0, '9♣');
  t = play(t, 1, 'D♣');
  assert.deepEqual(legalCards(t, 2).map(cardKey), ['V♣']);
  t = play(t, 2, 'V♣');
  assert.deepEqual(legalCards(t, 3).map(cardKey).sort(), ['7♦', 'D♠', 'V♦'].sort());
  t = play(t, 3, '7♦');
  assert.equal(t.lastTrick?.winner, 1);
  // Siège 1 entame atout (V♠) ; 2 ne peut pas monter : tout atout ; 3 n'a que D♠ ; 0 n'a plus d'atout : libre.
  t = play(t, 1, 'V♠');
  assert.deepEqual(legalCards(t, 2).map(cardKey).sort(), ['10♠', 'A♠'].sort());
  t = play(t, 2, 'A♠');
  assert.deepEqual(legalCards(t, 3).map(cardKey), ['D♠']);
  t = play(t, 3, 'D♠');
  assert.equal(legalCards(t, 0).length, t.hands[0]!.length);
});

test('maître du pli : la coupe bat la couleur, la plus haute coupe bat la coupe, la couleur demandée bat la défausse', () => {
  assert.equal(trickMaster([{ seat: 0, card: c('A♥') }, { seat: 1, card: c('7♠') }], '♠'), 1);
  assert.equal(trickMaster([{ seat: 0, card: c('A♥') }, { seat: 1, card: c('7♠') }, { seat: 2, card: c('8♠') }], '♠'), 2);
  assert.equal(trickMaster([{ seat: 0, card: c('7♥') }, { seat: 1, card: c('A♦') }], '♠'), 0);
  assert.equal(trickMaster([{ seat: 0, card: c('9♠') }, { seat: 1, card: c('V♠') }, { seat: 2, card: c('A♠') }], '♠'), 1);
});

test('annonces : tierce, cinquante, cent, carrés ; la plus forte désigne l\'équipe qui marque', () => {
  const d1 = findDeclarations(cards('7♥ 8♥ 9♥ V♠ V♥ V♦ V♣ A♠'), 0);
  assert.deepEqual(d1.map((d) => [d.kind, d.points]).sort(), [['carre', 200], ['tierce', 20]].sort());
  const d2 = findDeclarations(cards('10♦ V♦ D♦ R♦ A♦ 7♠ 8♠ 9♠'), 1);
  assert.deepEqual(d2.map((d) => [d.kind, d.points]).sort(), [['cent', 100], ['tierce', 20]].sort());
  assert.equal(findDeclarations(cards('7♠ 8♠ 7♥ 8♥ 7♦ 8♦ 7♣ 8♣'), 0).length, 0, 'pas de carré de 7 ni de 8');
  assert.equal(declaringTeam([...d1, ...d2], '♠'), 0, 'le carré de Valets l\'emporte');
  // Deux tierces de même hauteur dans deux équipes : celle à l'atout gagne ; sinon personne.
  const t1 = findDeclarations(cards('7♥ 8♥ 9♥'), 0);
  const t2 = findDeclarations(cards('7♠ 8♠ 9♠'), 1);
  assert.equal(declaringTeam([...t1, ...t2], '♠'), 1);
  assert.equal(declaringTeam([...t1, ...t2], '♦'), null);
  const t3 = findDeclarations(cards('8♦ 9♦ 10♦'), 3);
  assert.equal(declaringTeam([...t1, ...t3], '♠'), 1, 'la tierce la plus haute gagne');
});

test('une donne entière au bot : 162 points, dix de der, belote d\'office, bilan et historique', () => {
  let s = createRound(4, seededRng(11));
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 200) {
    const seat = def.currentSeat(s) as number;
    const legal = legalMoves(s, seat);
    const m = def.botMove!(s, seat, legal, seededRng(guard)) ?? legal[0]!;
    s = applyMove(s, seat, m, seededRng(guard));
  }
  assert.equal(s.phase, 'over');
  const r = s.result!;
  assert.equal(r.cardPoints[0] + r.cardPoints[1], 162);
  assert.equal(s.won[0].length + s.won[1].length, 32);
  const expectedBelote = s.beloteSeat >= 0 ? 20 : 0;
  assert.equal(r.belote[0] + r.belote[1], expectedBelote);
  if (r.capot === null && !r.litige) {
    const takerTeam = teamOf(r.taker);
    const defTeam = (1 - takerTeam) as 0 | 1;
    if (r.made) assert.equal(r.scored[takerTeam], r.cardPoints[takerTeam] + r.declarations[takerTeam] + r.belote[takerTeam]);
    else assert.equal(r.scored[defTeam], 162 + r.declarations[0] + r.declarations[1] + r.belote[defTeam]);
  }
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.teamScores, r.scored);
  const summary = def.roundSummary(s);
  assert.equal(summary.perSeat[0]!.total, summary.perSeat[2]!.total, 'les partenaires partagent le score');
  const next = createRound(4, seededRng(12), s);
  assert.equal(next.roundNumber, 2);
  assert.deepEqual(next.teamScores, s.teamScores);
  assert.equal(next.dealer, (s.dealer + 1) % 4);
});

test('dedans : la défense marque 162 plus les annonces ; litige : les points du preneur attendent la donne suivante', () => {
  // Fin de donne fabriquée : le preneur (0) a ramassé 70 avec le dernier pli, la défense 82.
  const base = createRound(4, seededRng(2));
  const mk = (won0: string, won1: string, lastTeam: 0 | 1, litige = 0): BeloteState => ({
    ...base, phase: 'play', trump: '♠', taker: 0, bidTurn: -1, talon: [], litige,
    hands: [[], [], [], [c('7♦')]], current: 3, leadSeat: 3, tricksPlayed: 7,
    trick: [{ seat: 0, card: c('8♦') }, { seat: 1, card: c('9♦') }, { seat: 2, card: c('7♣') }],
    won: [sortHand(cards(won0), '♠'), sortHand(cards(won1), '♠')], lastTrickTeam: lastTeam, declarationsShown: true,
  });
  // Équipe 0 : A♠(11) 10♠(10) R♠(4) D♠(3) 9♠(14) 8♠ 7♠ V♠(20) = 62 ; équipe 1 : As (33) + 10 (30) + Rois (12) + Dames (9) + Valets (6) = 90 ; dernier pli 7♦ 8♦ 9♦ 7♣ = 0 pts à qui le gagne.
  let s = mk('A♠ 10♠ R♠ D♠ 9♠ 8♠ 7♠ V♠ 7♥ 8♥ 9♥ 10♥', 'A♥ A♦ A♣ R♥ R♦ R♣ D♥ D♦ D♣ V♥ V♦ V♣ 10♦ 10♣ 8♣ 9♣', 1);
  s = play(s, 3, '7♦');
  assert.equal(s.phase, 'over');
  assert.equal(s.result!.cardPoints[0] + s.result!.cardPoints[1], 162);
  assert.equal(s.result!.made, false);
  assert.equal(s.result!.scored[1], 162, 'dedans : tout à la défense');
  assert.equal(s.result!.scored[0], 0);

  // Égalité 81-81 : on ajuste les points. Équipe 0 : 62 + 10♥ (déjà 10) + … ; rendons les deux camps égaux via le dix de der.
  // Équipe 0 ramasse 71 de cartes, équipe 1 81, dernier pli (0 pt) à l'équipe 0 → 81 à 81.
  let e = mk('A♠ 10♠ R♠ D♠ 9♠ 8♠ 7♠ V♠ 7♥ 8♥ 9♥ 10♥ D♥ D♦ D♣', 'A♥ A♦ A♣ R♥ R♦ R♣ V♥ V♦ V♣ 10♦ 10♣ 8♣ 9♣', 0);
  e = play(e, 3, '7♦');
  assert.equal(e.result!.cardPoints[0], 81);
  assert.equal(e.result!.cardPoints[1], 81);
  assert.equal(e.result!.litige, true);
  assert.equal(e.result!.scored[1], 81);
  assert.equal(e.result!.scored[0], 0);
  assert.equal(e.litige, 81, 'en réserve');
  // La donne suivante réussie par qui que ce soit emporte la réserve.
  let f = mk('A♠ 10♠ R♠ D♠ 9♠ 8♠ 7♠ V♠ 7♥ 8♥ 9♥ 10♥ D♥ D♦ D♣ A♥ A♦', 'A♣ R♥ R♦ R♣ V♥ V♦ V♣ 10♦ 10♣ 8♣ 9♣', 0, 81);
  f = play(f, 3, '7♦');
  assert.equal(f.result!.made, true);
  assert.equal(f.result!.scored[0], f.result!.cardPoints[0] + 81);
  assert.equal(f.litige, 0);
});

test('capot : 252 pour l\'équipe qui fait tous les plis', () => {
  const base = createRound(4, seededRng(2));
  let s: BeloteState = {
    ...base, phase: 'play', trump: '♠', taker: 0, bidTurn: -1, talon: [],
    hands: [[], [], [], [c('7♦')]], current: 3, leadSeat: 3, tricksPlayed: 7,
    trick: [{ seat: 0, card: c('V♠') }, { seat: 1, card: c('9♦') }, { seat: 2, card: c('7♣') }],
    won: [sortHand(buildDeck().filter((x) => !['V♠', '9♦', '7♣', '7♦'].includes(cardKey(x))), '♠'), []], lastTrickTeam: 0, declarationsShown: true,
  };
  s = play(s, 3, '7♦');
  assert.equal(s.result!.capot, 0);
  assert.ok(s.result!.scored[0] >= 252);
  assert.equal(s.result!.made, true);
});

test('la partie se joue en 1000 points ; les deux partenaires gagnent', () => {
  let s = createRound(4, seededRng(2));
  s = { ...s, teamScores: [TARGET_SCORE + 5, 400], roundOver: true, phase: 'over', result: null };
  assert.ok(def.isMatchOver(s));
  assert.deepEqual(def.matchWinners!(s), [0, 2]);
  assert.equal(def.matchWinner(s), 0);
  assert.deepEqual(def.scores(s), [1005, 400, 1005, 400]);
  const tie: BeloteState = { ...s, teamScores: [1005, 1005] };
  assert.ok(!def.isMatchOver(tie), 'égalité : on continue');
});

test('determinize : un monde compatible avec ce que le siège voit, renonces respectées', () => {
  let s = createRound(4, seededRng(9));
  s = applyMove(s, s.bidTurn, { type: 'take', suit: s.turned.suit }, seededRng(1));
  // Siège 1 déclaré sans cœur.
  s = { ...s, voids: [[], ['♥'], [], []] };
  for (let k = 0; k < 20; k++) {
    const w = determinize(s, 0, seededRng(100 + k));
    assert.deepEqual(w.hands[0], s.hands[0]);
    assert.deepEqual(w.hands.map((h) => h.length), [8, 8, 8, 8]);
    assert.equal(new Set(w.hands.flat().map(cardKey)).size, 32);
    assert.ok(!w.hands[1]!.some((x) => x.suit === '♥'), 'le siège 1 n\'a pas de cœur');
  }
  // Pendant les enchères : la retourne reste la même et personne ne l'a en main.
  const b = createRound(4, seededRng(9));
  const w = determinize(b, 2, seededRng(4));
  assert.equal(cardKey(w.turned), cardKey(b.turned));
  assert.ok(!w.hands.flat().some((x) => cardKey(x) === cardKey(b.turned)));
  assert.equal(w.talon.length, 11);
});

test('clés de coups : aller-retour', () => {
  const moves: Move[] = [{ type: 'pass' }, { type: 'take', suit: '♥' }, { type: 'play', card: c('V♠') }];
  for (const m of moves) assert.deepEqual(parseMoveKey(moveKey(m)), m);
  assert.equal(parseMoveKey('take:X'), null);
  assert.equal(parseMoveKey('play:Z♠'), null);
  assert.equal(parseMoveKey('n\'importe'), null);
});

test('la définition : 12 phrases, succès connus, évaluation bornée', () => {
  assert.equal(def.phrases.length, 12);
  assert.deepEqual(def.seatCounts, [4]);
  const s = createRound(4, seededRng(1));
  const e = def.evaluate(s, 0);
  assert.ok(e >= 0 && e <= 1);
});

test('capot du preneur : la défense garde les annonces qu\'elle seule marque', () => {
  const base = createRound(4, seededRng(2));
  const tierce = { seat: 1, kind: 'tierce' as const, points: 20, cards: cards('8♥ 9♥ 10♥'), height: 10 };
  let s: BeloteState = {
    ...base, phase: 'play', trump: '♠', taker: 0, bidTurn: -1, talon: [],
    hands: [[], [], [], [c('7♦')]], current: 3, leadSeat: 3, tricksPlayed: 7,
    trick: [{ seat: 0, card: c('V♠') }, { seat: 1, card: c('9♦') }, { seat: 2, card: c('7♣') }],
    won: [sortHand(buildDeck().filter((x) => !['V♠', '9♦', '7♣', '7♦'].includes(cardKey(x))), '♠'), []], lastTrickTeam: 0,
    declarationsShown: true, declarations: [tierce], declarationsTeam: 1,
  };
  s = play(s, 3, '7♦');
  assert.equal(s.result!.capot, 0);
  assert.deepEqual(s.result!.scored, [252, 20], '252 au preneur, la tierce à la défense');
  // Capot de la défense : le preneur est dedans, la défense marque 252 et toutes les annonces.
  const d: BeloteState = { ...s, phase: 'play', roundOver: false, result: null, teamScores: [0, 0], hands: [[], [], [], [c('7♦')]], tricksPlayed: 7, current: 3, leadSeat: 3,
    trick: [{ seat: 0, card: c('9♦') }, { seat: 1, card: c('V♠') }, { seat: 2, card: c('7♣') }],
    won: [[], sortHand(buildDeck().filter((x) => !['V♠', '9♦', '7♣', '7♦'].includes(cardKey(x))), '♠')], lastTrickTeam: 1,
    declarations: [{ ...tierce, seat: 0 }], declarationsTeam: 0 };
  const fin = play(d, 3, '7♦');
  assert.equal(fin.result!.capot, 1);
  assert.equal(fin.result!.made, false);
  assert.deepEqual(fin.result!.scored, [0, 272]);
});

test('belote dite avec la carte qui ferme le pli : l\'annonce n\'est pas effacée par le pli', () => {
  let s = playing(['7♥ 8♣', '8♥ 9♣', '9♥ 10♣', 'D♠ V♣'], { beloteSeat: 3, current: 0, leadSeat: 0 });
  s = play(s, 0, '7♥');
  s = play(s, 1, '8♥');
  s = play(s, 2, '9♥');
  s = play(s, 3, 'D♠');
  assert.equal(s.lastEvent?.type, 'trick');
  assert.deepEqual(s.lastEvent?.type === 'trick' ? s.lastEvent.belote : null, { seat: 3, second: false });
});

test('determinize : ce que tout le monde a vu reste en place (retourne, annonces, belote)', () => {
  let s = createRound(4, seededRng(9));
  const taker = s.bidTurn;
  s = applyMove(s, taker, { type: 'take', suit: s.turned.suit }, seededRng(1));
  const voyeur = (taker + 1) % 4;
  const autre = (taker + 2) % 4;
  // Une annonce montrée par le siège `autre` : ses cartes sont connues de toute la table.
  const trump = s.trump!;
  const deck = buildDeck();
  const tenue = s.hands[autre]!.slice(0, 3);
  s = { ...s, declarationsShown: true, declarations: [{ seat: autre, kind: 'tierce', points: 20, cards: tenue, height: 0 }], declarationsTeam: teamOf(autre) };
  for (let k = 0; k < 30; k++) {
    const w = determinize(s, voyeur, seededRng(k));
    assert.ok(w.hands[taker]!.some((x) => cardKey(x) === cardKey(s.turned)), 'la retourne est chez le preneur');
    for (const x of tenue) assert.ok(w.hands[autre]!.some((y) => cardKey(y) === cardKey(x)), 'les cartes annoncées restent chez leur détenteur');
    assert.equal(new Set(w.hands.flat().map(cardKey)).size, 32);
  }
  // « Belote » dite (la Dame est tombée) : le Roi reste chez celui qui l'a dite.
  const roi = deck.find((x) => x.suit === trump && x.value === 'R') as Card;
  const dame = deck.find((x) => x.suit === trump && x.value === 'D') as Card;
  const b = playing(['7♥ 8♥ 9♥', '10♥ V♥ A♥', `7♣ 8♣ ${cardKey(roi)}`, '9♣ 10♣ V♣'], { trump, beloteSeat: 2, beloteAnnounced: true, belotePlayed: 1, played: [dame], voids: [[], [], [], []] });
  for (let k = 0; k < 30; k++) {
    const w = determinize(b, 0, seededRng(k));
    assert.ok(w.hands[2]!.some((x) => cardKey(x) === cardKey(roi)));
  }
});

test('niveau facile : des prises sensées, des cartes parfois jouées au hasard, jamais un coup illégal', () => {
  const rng = seededRng(4);
  let differe = 0;
  for (let partie = 0; partie < 8; partie++) {
    let s = createRound(4, rng);
    while (!s.roundOver) {
      const seat = def.currentSeat(s) as number;
      const legal = legalMoves(s, seat);
      const facile = def.botMove!(s, seat, legal, seededRng(partie * 100 + s.played.length), 'facile') as Move;
      const normal = def.botMove!(s, seat, legal, seededRng(partie * 100 + s.played.length), 'normal') as Move;
      assert.ok(legal.some((m) => moveKey(m) === moveKey(facile)));
      if (s.phase !== 'play') assert.equal(moveKey(facile), moveKey(normal));
      else if (moveKey(facile) !== moveKey(normal)) differe++;
      s = applyMove(s, seat, facile, rng);
    }
  }
  assert.ok(differe > 10, `le niveau facile doit jouer autrement (${differe})`);
});

test('annonces : à points égaux le carré bat la suite ; entre carrés, le plus haut (règles de la Fédération)', () => {
  const carre = (seat: number, v: string) => findDeclarations(cards(`${v}♠ ${v}♥ ${v}♣ ${v}♦`), seat)[0]!;
  const cent = (seat: number, suit: string, top: string) => {
    const ordre = ['7', '8', '9', '10', 'V', 'D', 'R', 'A'];
    const i = ordre.indexOf(top);
    return findDeclarations(cards(ordre.slice(i - 4, i + 1).map((v) => `${v}${suit}`).join(' ')), seat)[0]!;
  };
  // Carré de 10 (100) contre cent au Roi : le carré.
  assert.equal(declaringTeam([carre(0, '10'), cent(1, '♥', 'R')], '♠'), 0);
  // Carré d'As contre cent à l'As d'atout : le carré.
  assert.equal(declaringTeam([carre(0, 'A'), cent(1, '♠', 'A')], '♠'), 0);
  // Carré de Rois contre cent au Roi hors atout : le carré (on ne compare plus des hauteurs sans rapport).
  assert.equal(declaringTeam([carre(1, 'R'), cent(0, '♥', 'R')], '♠'), 1);
  // Entre deux carrés de 100 : le plus haut.
  assert.equal(declaringTeam([carre(0, 'D'), carre(1, 'A')], '♠'), 1);
  // Le carré de Valets (200) reste au-dessus de tout.
  assert.equal(declaringTeam([carre(0, 'V'), carre(1, '9')], '♠'), 0);
});
