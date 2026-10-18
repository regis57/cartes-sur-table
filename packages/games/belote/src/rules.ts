/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { repartir, shuffle, type BotLevel, type GameDefinition, type GameMeta, type Rng, type RoundSummary, type AchievementContext } from '@jdc/core';
import {
  SUITS, VALUES, buildDeck, cardKey, cardPoints, cardStrength, naturalRank, parseCardKey, sameCard, sortHand,
  type Card, type Suit, type Value,
} from './cartes.ts';

/**
 * Règles de la belote classique à quatre, par équipes (0 et 2 contre 1 et 3), pures et sans
 * réseau :
 *
 *  - 32 cartes ; cinq cartes à chacun (3 puis 2), une carte retournée ;
 *  - premier tour : à partir de la gauche du donneur, chacun prend la retourne (sa couleur
 *    devient l'atout) ou passe ; deuxième tour : chacun peut choisir une autre couleur ou
 *    passer ; si tout le monde passe deux fois, on redonne (la donne ne compte pas) ;
 *  - le preneur reçoit la retourne et deux cartes, les autres en reçoivent trois : huit chacun ;
 *  - il faut fournir ; sinon couper, et surcouper si l'on peut, sauf si le partenaire est
 *    maître du pli ; à l'atout, monter si l'on peut ; sans atout, on défausse ;
 *  - l'atout vaut V 20, 9 14, A 11, 10 10, R 4, D 3 ; les autres couleurs A 11, 10 10, R 4,
 *    D 3, V 2 ; dix de der pour le dernier pli : 162 points par donne ;
 *  - belote-rebelote (Roi et Dame d'atout) : 20 points, annoncés d'office à la pose de la
 *    première des deux, et toujours acquis ;
 *  - annonces (tierce 20, cinquante 50, cent 100 ; carré de Valets 200, de 9 150, d'As, de 10,
 *    de Rois ou de Dames 100) : déclarées d'office au premier pli, seule l'équipe qui détient la
 *    plus forte marque les siennes ;
 *  - le camp du preneur doit totaliser strictement plus que la défense (annonces comprises) ;
 *    sinon il est « dedans » et la défense marque 162 plus toutes les annonces ; égalité :
 *    la défense marque ses points, ceux du preneur vont au vainqueur de la donne suivante ;
 *  - capot (tous les plis) : 252 au lieu de 162 ;
 *  - la partie se joue en 1000 points.
 */

export const TARGET_SCORE = 1000;
export const TRICKS = 8;

export type Phase = 'bid1' | 'bid2' | 'play' | 'over';

export type Move =
  | { readonly type: 'pass' }
  | { readonly type: 'take'; readonly suit: Suit }
  | { readonly type: 'play'; readonly card: Card };

export interface TrickCard {
  readonly seat: number;
  readonly card: Card;
}

export type DeclarationKind = 'tierce' | 'cinquante' | 'cent' | 'carre';

export interface Declaration {
  readonly seat: number;
  readonly kind: DeclarationKind;
  readonly points: number;
  readonly cards: readonly Card[];
  /** Force pour départager : hauteur de la plus haute carte (suite) ou de la valeur (carré). */
  readonly height: number;
}

/** Ce qui vient de se passer, pour l'affichage (jamais nécessaire aux règles). */
export type LastEvent =
  | { readonly type: 'redeal' }
  | { readonly type: 'pass'; readonly seat: number }
  | { readonly type: 'take'; readonly seat: number; readonly suit: Suit }
  | { readonly type: 'belote'; readonly seat: number; readonly second: boolean }
  | { readonly type: 'declarations'; readonly team: 0 | 1; readonly points: number; readonly belote?: BeloteSaid }
  | { readonly type: 'trick'; readonly winner: number; readonly belote?: BeloteSaid };

/** « Belote » ou « rebelote » dite avec la carte qui ferme le pli : le pli ne doit pas l'effacer. */
export interface BeloteSaid {
  readonly seat: number;
  readonly second: boolean;
}

/** Le bilan d'une donne terminée. */
export interface DonneResult {
  readonly taker: number;
  readonly trump: Suit;
  /** Points de cartes (dix de der compris) par équipe, avant annonces et belote. */
  readonly cardPoints: readonly [number, number];
  readonly belote: readonly [number, number];
  readonly declarations: readonly [number, number];
  readonly capot: 0 | 1 | null;
  readonly made: boolean;
  /** Égalité 81 à 81 : les points du preneur sont mis en réserve. */
  readonly litige: boolean;
  /** Points marqués par chaque équipe pour la donne. */
  readonly scored: readonly [number, number];
}

export interface HistoryEntry {
  readonly round: number;
  readonly result: DonneResult;
  readonly scores: readonly [number, number];
}

export interface BeloteState {
  readonly seats: 4;
  readonly dealer: number;
  readonly roundNumber: number;
  readonly phase: Phase;
  readonly hands: readonly (readonly Card[])[];
  /** La carte retournée pendant les enchères. */
  readonly turned: Card;
  /** Le talon encore non distribué (après la retourne). */
  readonly talon: readonly Card[];
  readonly bidTurn: number;
  readonly bidsPlaced: number;
  readonly trump: Suit | null;
  readonly taker: number;
  readonly trick: readonly TrickCard[];
  readonly leadSeat: number;
  readonly current: number;
  readonly tricksPlayed: number;
  readonly lastTrick: { readonly cards: readonly TrickCard[]; readonly winner: number } | null;
  /** Cartes remportées par équipe. */
  readonly won: readonly [readonly Card[], readonly Card[]];
  readonly lastTrickTeam: 0 | 1 | null;
  readonly played: readonly Card[];
  /** Par siège, les couleurs dont il s'est montré dépourvu : sert au bot, jamais aux règles. */
  readonly voids: readonly (readonly string[])[];
  /** Siège qui a belote-rebelote et nombre de ses deux cartes déjà posées. */
  readonly beloteSeat: number;
  readonly belotePlayed: number;
  readonly beloteAnnounced: boolean;
  readonly declarations: readonly Declaration[];
  /** Équipe qui marque ses annonces, une fois le premier pli complet. */
  readonly declarationsTeam: 0 | 1 | null;
  readonly declarationsShown: boolean;
  /** Points en litige, à donner au vainqueur de la donne. */
  readonly litige: number;
  /** Scores par équipe (0 : sièges 0 et 2 ; 1 : sièges 1 et 3). */
  readonly teamScores: readonly [number, number];
  readonly roundOver: boolean;
  readonly result: DonneResult | null;
  readonly history: readonly HistoryEntry[];
  readonly lastEvent: LastEvent | null;
}

export interface BeloteView {
  readonly seats: 4;
  readonly me: number;
  readonly phase: Phase;
  readonly dealer: number;
  readonly roundNumber: number;
  readonly targetScore: number;
  readonly hand: readonly Card[];
  readonly handCounts: readonly number[];
  readonly turned: Card | null;
  readonly bidTurn: number;
  readonly trump: Suit | null;
  readonly taker: number;
  readonly trick: readonly TrickCard[];
  readonly lastTrick: { readonly cards: readonly TrickCard[]; readonly winner: number } | null;
  readonly current: number;
  readonly tricksPlayed: number;
  readonly totalTricks: number;
  /** Points de cartes déjà ramassés par chaque équipe (visibles : les plis sont publics). */
  readonly wonPoints: readonly [number, number];
  readonly beloteSeat: number;
  /** Annonces montrées à tous après le premier pli, avec l'équipe qui les marque. */
  readonly declarations: readonly Declaration[] | null;
  readonly declarationsTeam: 0 | 1 | null;
  readonly litige: number;
  readonly teamScores: readonly [number, number];
  /** Scores par siège (celui de son équipe), pour l'étiquette commune. */
  readonly scores: readonly number[];
  readonly roundOver: boolean;
  readonly result: DonneResult | null;
  readonly history: readonly HistoryEntry[];
  readonly lastEvent: LastEvent | null;
  readonly legal: readonly { key: string; move: Move }[];
}

// ---------- utilitaires ----------

export const teamOf = (seat: number): 0 | 1 => (seat % 2) as 0 | 1;

function without(hand: readonly Card[], card: Card): Card[] {
  const i = hand.findIndex((c) => sameCard(c, card));
  if (i < 0) return [...hand];
  return [...hand.slice(0, i), ...hand.slice(i + 1)];
}

function has(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => sameCard(c, card));
}

/** Siège maître du pli en cours (ou -1 si vide). */
export function trickMaster(trick: readonly TrickCard[], trump: Suit): number {
  if (trick.length === 0) return -1;
  const led = (trick[0] as TrickCard).card.suit;
  let best = trick[0] as TrickCard;
  for (const tc of trick.slice(1)) {
    const c = tc.card;
    const b = best.card;
    if (c.suit === trump && b.suit !== trump) best = tc;
    else if (c.suit === b.suit && cardStrength(c, trump) > cardStrength(b, trump)) best = tc;
    else if (c.suit === led && b.suit !== led && b.suit !== trump) best = tc;
  }
  return best.seat;
}

function highestTrumpIn(trick: readonly TrickCard[], trump: Suit): number {
  let best = -1;
  for (const tc of trick) if (tc.card.suit === trump) best = Math.max(best, cardStrength(tc.card, trump));
  return best;
}

// ---------- annonces ----------

const CARRE_POINTS: Partial<Record<Value, number>> = { V: 200, '9': 150, A: 100, '10': 100, R: 100, D: 100 };

/** Les annonces d'une main : carrés et suites d'au moins trois cartes (une carte ne sert qu'une fois par type). */
export function findDeclarations(hand: readonly Card[], seat: number): Declaration[] {
  const out: Declaration[] = [];
  for (const v of VALUES) {
    const pts = CARRE_POINTS[v];
    const cards = hand.filter((c) => c.value === v);
    if (pts && cards.length === 4) out.push({ seat, kind: 'carre', points: pts, cards, height: naturalRank(v) });
  }
  for (const suit of SUITS) {
    const ranks = hand.filter((c) => c.suit === suit).map((c) => naturalRank(c.value)).sort((a, b) => a - b);
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 3) {
        const len = Math.min(run.length, 5);
        const top = run[run.length - 1] as number;
        const picked = run.slice(-len);
        const kind: DeclarationKind = len === 3 ? 'tierce' : len === 4 ? 'cinquante' : 'cent';
        out.push({ seat, kind, points: len === 3 ? 20 : len === 4 ? 50 : 100, cards: picked.map((r) => ({ suit, value: VALUES[r] as Value })), height: top });
      }
      run = [];
    };
    for (const r of ranks) {
      if (run.length && r !== (run[run.length - 1] as number) + 1) flush();
      run.push(r);
    }
    flush();
  }
  return out;
}

/** L'équipe qui marque ses annonces, ou null si personne n'en a (ou égalité parfaite). */
export function declaringTeam(decls: readonly Declaration[], trump: Suit): 0 | 1 | null {
  if (decls.length === 0) return null;
  const rank = (d: Declaration): [number, number, number] => [d.points, d.height, d.kind !== 'carre' && (d.cards[0] as Card).suit === trump ? 1 : 0];
  let best: Declaration | null = null;
  let tie = false;
  for (const d of decls) {
    if (!best) { best = d; continue; }
    const a = rank(d);
    const b = rank(best);
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (cmp > 0) { best = d; tie = false; } else if (cmp === 0 && teamOf(d.seat) !== teamOf(best.seat)) tie = true;
  }
  return best && !tie ? teamOf(best.seat) : null;
}

// ---------- donne ----------

function deal(dealer: number, rng: Rng, base: Pick<BeloteState, 'roundNumber' | 'teamScores' | 'history' | 'litige'>, lastEvent: LastEvent | null): BeloteState {
  const deck = shuffle(buildDeck(), rng);
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 4; i++) hands[(dealer + 1 + i) % 4]!.push(...deck.splice(0, 3));
  for (let i = 0; i < 4; i++) hands[(dealer + 1 + i) % 4]!.push(...deck.splice(0, 2));
  const turned = deck.shift() as Card;
  return {
    seats: 4,
    dealer,
    roundNumber: base.roundNumber,
    phase: 'bid1',
    hands: hands.map((h) => sortHand(h, null)),
    turned,
    talon: deck,
    bidTurn: (dealer + 1) % 4,
    bidsPlaced: 0,
    trump: null,
    taker: -1,
    trick: [],
    leadSeat: (dealer + 1) % 4,
    current: (dealer + 1) % 4,
    tricksPlayed: 0,
    lastTrick: null,
    won: [[], []],
    lastTrickTeam: null,
    played: [],
    voids: [[], [], [], []],
    beloteSeat: -1,
    belotePlayed: 0,
    beloteAnnounced: false,
    declarations: [],
    declarationsTeam: null,
    declarationsShown: false,
    litige: base.litige,
    teamScores: [base.teamScores[0], base.teamScores[1]],
    roundOver: false,
    result: null,
    history: [...base.history],
    lastEvent,
  };
}

export function createRound(_seats: number, rng: Rng, previous?: BeloteState): BeloteState {
  if (previous) {
    return deal((previous.dealer + 1) % 4, rng, {
      roundNumber: previous.roundNumber + 1,
      teamScores: previous.teamScores,
      history: previous.history,
      litige: previous.litige,
    }, null);
  }
  return deal(rng.int(4), rng, { roundNumber: 1, teamScores: [0, 0], history: [], litige: 0 }, null);
}

// ---------- légalité ----------

export function currentSeat(state: BeloteState): number | null {
  switch (state.phase) {
    case 'bid1':
    case 'bid2': return state.bidTurn;
    case 'play': return state.current;
    case 'over': return null;
  }
}

/** Les cartes jouables, règle de la belote : fournir, couper, surcouper, sauf partenaire maître. */
export function legalCards(state: BeloteState, seat: number): Card[] {
  const hand = state.hands[seat] ?? [];
  const trump = state.trump as Suit;
  const trick = state.trick;
  if (trick.length === 0) return [...hand];
  const led = (trick[0] as TrickCard).card.suit;
  const trumps = hand.filter((c) => c.suit === trump);
  const master = trickMaster(trick, trump);
  const partnerMaster = teamOf(master) === teamOf(seat);

  if (led === trump) {
    // À l'atout : monter si l'on peut, sinon n'importe quel atout, sinon n'importe quoi.
    if (trumps.length === 0) return [...hand];
    const top = highestTrumpIn(trick, trump);
    const higher = trumps.filter((c) => cardStrength(c, trump) > top);
    return higher.length ? higher : trumps;
  }
  const same = hand.filter((c) => c.suit === led);
  if (same.length) return same;
  // Pas de la couleur : couper, sauf si le partenaire est maître ; surcouper si possible.
  if (trumps.length === 0 || partnerMaster) return [...hand];
  const top = highestTrumpIn(trick, trump);
  const higher = trumps.filter((c) => cardStrength(c, trump) > top);
  return higher.length ? higher : trumps;
}

export function legalMoves(state: BeloteState, seat: number): Move[] {
  if (currentSeat(state) !== seat) return [];
  if (state.phase === 'bid1') return [{ type: 'pass' }, { type: 'take', suit: state.turned.suit }];
  if (state.phase === 'bid2') return [{ type: 'pass' }, ...SUITS.filter((s) => s !== state.turned.suit).map((suit): Move => ({ type: 'take', suit }))];
  if (state.phase === 'play') return legalCards(state, seat).map((card): Move => ({ type: 'play', card }));
  return [];
}

export function forcedMove(state: BeloteState, seat: number): Move | null {
  const legal = legalMoves(state, seat);
  return legal.length === 1 && state.phase === 'play' ? (legal[0] as Move) : null;
}

export function moveKey(m: Move): string {
  switch (m.type) {
    case 'pass': return 'pass';
    case 'take': return `take:${m.suit}`;
    case 'play': return `play:${cardKey(m.card)}`;
  }
}

export function parseMoveKey(key: string): Move | null {
  if (key === 'pass') return { type: 'pass' };
  const [kind, rest] = key.split(':') as [string, string | undefined];
  if (kind === 'take' && rest && (SUITS as readonly string[]).includes(rest)) return { type: 'take', suit: rest as Suit };
  if (kind === 'play' && rest) {
    const card = parseCardKey(rest);
    return card ? { type: 'play', card } : null;
  }
  return null;
}

// ---------- application ----------

export function applyMove(state: BeloteState, seat: number, move: Move, rng: Rng): BeloteState {
  if (!legalMoves(state, seat).some((m) => moveKey(m) === moveKey(move))) throw new Error('coup illégal');
  switch (move.type) {
    case 'pass': return applyPass(state, seat, rng);
    case 'take': return applyTake(state, seat, move.suit);
    case 'play': return applyPlay(state, seat, move.card);
  }
}

function applyPass(state: BeloteState, seat: number, rng: Rng): BeloteState {
  const placed = state.bidsPlaced + 1;
  const next = (seat + 1) % 4;
  if (placed < 4) return { ...state, bidTurn: next, bidsPlaced: placed, lastEvent: { type: 'pass', seat } };
  if (state.phase === 'bid1') return { ...state, phase: 'bid2', bidTurn: (state.dealer + 1) % 4, bidsPlaced: 0, lastEvent: { type: 'pass', seat } };
  // Deux tours sans preneur : on redonne, donneur suivant, la donne ne compte pas.
  return deal((state.dealer + 1) % 4, rng, { roundNumber: state.roundNumber, teamScores: state.teamScores, history: state.history, litige: state.litige }, { type: 'redeal' });
}

function applyTake(state: BeloteState, seat: number, suit: Suit): BeloteState {
  const talon = [...state.talon];
  const hands = state.hands.map((h) => [...h]);
  hands[seat]!.push(state.turned);
  for (let i = 0; i < 4; i++) {
    const s = (state.dealer + 1 + i) % 4;
    hands[s]!.push(...talon.splice(0, s === seat ? 2 : 3));
  }
  const sorted = hands.map((h) => sortHand(h, suit));
  let beloteSeat = -1;
  sorted.forEach((h, i) => {
    if (has(h, { suit, value: 'R' }) && has(h, { suit, value: 'D' })) beloteSeat = i;
  });
  const declarations = sorted.flatMap((h, i) => findDeclarations(h, i));
  return {
    ...state,
    phase: 'play',
    hands: sorted,
    talon,
    trump: suit,
    taker: seat,
    bidTurn: -1,
    beloteSeat,
    declarations,
    declarationsTeam: declaringTeam(declarations, suit),
    lastEvent: { type: 'take', seat, suit },
  };
}

function applyPlay(state: BeloteState, seat: number, card: Card): BeloteState {
  const trump = state.trump as Suit;
  const hands = state.hands.map((h, i) => (i === seat ? without(h, card) : h));
  const trick = [...state.trick, { seat, card }];
  // Renonces observées : ne fournit pas la couleur demandée ; ne coupe pas alors qu'il devrait.
  const voids = state.voids.map((v) => [...v]);
  if (state.trick.length > 0) {
    const led = (state.trick[0] as TrickCard).card.suit;
    if (card.suit !== led && !voids[seat]!.includes(led)) voids[seat]!.push(led);
    const master = trickMaster(state.trick, trump);
    if (card.suit !== led && card.suit !== trump && teamOf(master) !== teamOf(seat) && !voids[seat]!.includes(trump)) voids[seat]!.push(trump);
  }
  let lastEvent: LastEvent | null = null;
  let belotePlayed = state.belotePlayed;
  let beloteAnnounced = state.beloteAnnounced;
  if (seat === state.beloteSeat && card.suit === trump && (card.value === 'R' || card.value === 'D')) {
    belotePlayed += 1;
    beloteAnnounced = true;
    lastEvent = { type: 'belote', seat, second: belotePlayed === 2 };
  }
  const next: BeloteState = {
    ...state,
    hands,
    trick,
    voids,
    played: [...state.played, card],
    current: (seat + 1) % 4,
    belotePlayed,
    beloteAnnounced,
    lastEvent,
  };
  return trick.length === 4 ? resolveTrick(next) : next;
}

function resolveTrick(state: BeloteState): BeloteState {
  const trump = state.trump as Suit;
  const winner = trickMaster(state.trick, trump);
  const team = teamOf(winner);
  const won: [Card[], Card[]] = [[...state.won[0]], [...state.won[1]]];
  won[team].push(...state.trick.map((t) => t.card));
  const tricksPlayed = state.tricksPlayed + 1;
  const said = state.lastEvent?.type === 'belote' ? { belote: { seat: state.lastEvent.seat, second: state.lastEvent.second } } : {};
  let lastEvent: LastEvent = { type: 'trick', winner, ...said };
  let declarationsShown = state.declarationsShown;
  if (!declarationsShown) {
    declarationsShown = true;
    if (state.declarationsTeam !== null) {
      const pts = state.declarations.filter((d) => teamOf(d.seat) === state.declarationsTeam).reduce((s, d) => s + d.points, 0);
      lastEvent = { type: 'declarations', team: state.declarationsTeam, points: pts, ...said };
    }
  }
  const next: BeloteState = {
    ...state,
    trick: [],
    lastTrick: { cards: state.trick, winner },
    leadSeat: winner,
    current: winner,
    tricksPlayed,
    won,
    lastTrickTeam: team,
    declarationsShown,
    lastEvent,
  };
  return tricksPlayed === TRICKS ? scoreRound(next) : next;
}

function scoreRound(state: BeloteState): BeloteState {
  const trump = state.trump as Suit;
  const takerTeam = teamOf(state.taker);
  const defTeam = (1 - takerTeam) as 0 | 1;
  const raw: [number, number] = [
    state.won[0].reduce((s, c) => s + cardPoints(c, trump), 0),
    state.won[1].reduce((s, c) => s + cardPoints(c, trump), 0),
  ];
  if (state.lastTrickTeam !== null) raw[state.lastTrickTeam] += 10;
  const capot: 0 | 1 | null = state.won[0].length === 32 ? 0 : state.won[1].length === 32 ? 1 : null;
  const belote: [number, number] = [0, 0];
  if (state.beloteSeat >= 0) belote[teamOf(state.beloteSeat)] = 20;
  const decl: [number, number] = [0, 0];
  if (state.declarationsTeam !== null) decl[state.declarationsTeam] = state.declarations.filter((d) => teamOf(d.seat) === state.declarationsTeam).reduce((s, d) => s + d.points, 0);

  const totalTaker = raw[takerTeam] + belote[takerTeam] + decl[takerTeam];
  const totalDef = raw[defTeam] + belote[defTeam] + decl[defTeam];
  const scored: [number, number] = [0, 0];
  let made = false;
  let litige = false;
  let reserve = state.litige;
  if (capot === takerTeam) {
    // Capot du preneur : 252 au lieu de ses points de cartes. Les annonces restent à l'équipe
    // qui détient la plus forte (règle 7) : la défense garde les siennes si c'est elle.
    made = true;
    scored[takerTeam] = 252 + decl[takerTeam] + belote[takerTeam];
    scored[defTeam] = decl[defTeam] + belote[defTeam];
  } else if (capot === defTeam) {
    // Capot de la défense : le preneur est dedans, la défense marque 252 et toutes les annonces.
    scored[defTeam] = 252 + decl[0] + decl[1] + belote[defTeam];
    scored[takerTeam] = belote[takerTeam];
  } else if (totalTaker > totalDef) {
    made = true;
    scored[takerTeam] = raw[takerTeam] + decl[takerTeam] + belote[takerTeam];
    scored[defTeam] = raw[defTeam] + decl[defTeam] + belote[defTeam];
  } else if (totalTaker < totalDef) {
    scored[defTeam] = 162 + decl[0] + decl[1] + belote[defTeam];
    scored[takerTeam] = belote[takerTeam];
  } else {
    litige = true;
    scored[defTeam] = raw[defTeam] + decl[defTeam] + belote[defTeam];
    scored[takerTeam] = belote[takerTeam];
    reserve += raw[takerTeam] + decl[takerTeam];
  }
  // Les points en litige d'une donne précédente vont au camp qui gagne celle-ci.
  if (!litige && state.litige > 0) {
    const winnerTeam = capot !== null ? capot : made ? takerTeam : defTeam;
    scored[winnerTeam] += state.litige;
    reserve = 0;
  }
  const result: DonneResult = { taker: state.taker, trump, cardPoints: raw, belote, declarations: decl, capot, made, litige, scored };
  const teamScores: [number, number] = [state.teamScores[0] + scored[0], state.teamScores[1] + scored[1]];
  return {
    ...state,
    phase: 'over',
    current: -1,
    teamScores,
    litige: reserve,
    roundOver: true,
    result,
    history: [...state.history, { round: state.roundNumber, result, scores: teamScores }],
  };
}

export function isMatchOver(state: BeloteState): boolean {
  return state.roundOver && (state.teamScores[0] >= TARGET_SCORE || state.teamScores[1] >= TARGET_SCORE) && state.teamScores[0] !== state.teamScores[1];
}

/** Les deux sièges de l'équipe gagnante. */
export function matchWinners(state: BeloteState): number[] {
  if (!isMatchOver(state)) return [];
  return state.teamScores[0] > state.teamScores[1] ? [0, 2] : [1, 3];
}

export function matchWinner(state: BeloteState): number | null {
  return matchWinners(state)[0] ?? null;
}

// ---------- vue ----------

export function view(state: BeloteState, seat: number): BeloteView {
  const legal = legalMoves(state, seat).map((move) => ({ key: moveKey(move), move }));
  const trump = state.trump;
  const bidding = state.phase === 'bid1' || state.phase === 'bid2';
  return {
    seats: 4,
    me: seat,
    phase: state.phase,
    dealer: state.dealer,
    roundNumber: state.roundNumber,
    targetScore: TARGET_SCORE,
    hand: state.hands[seat] ?? [],
    handCounts: state.hands.map((h) => h.length),
    turned: bidding ? state.turned : null,
    bidTurn: bidding ? state.bidTurn : -1,
    trump,
    taker: state.taker,
    trick: state.trick,
    lastTrick: state.lastTrick,
    current: state.phase === 'play' ? state.current : -1,
    tricksPlayed: state.tricksPlayed,
    totalTricks: TRICKS,
    wonPoints: trump ? [state.won[0].reduce((s, c) => s + cardPoints(c, trump), 0), state.won[1].reduce((s, c) => s + cardPoints(c, trump), 0)] : [0, 0],
    beloteSeat: state.beloteAnnounced ? state.beloteSeat : -1,
    declarations: state.declarationsShown ? state.declarations : null,
    declarationsTeam: state.declarationsShown ? state.declarationsTeam : null,
    litige: state.litige,
    teamScores: state.teamScores,
    scores: [0, 1, 2, 3].map((s) => state.teamScores[teamOf(s)]),
    roundOver: state.roundOver,
    result: state.result,
    history: state.history,
    lastEvent: state.lastEvent,
    legal,
  };
}

// ---------- information cachée ----------

/**
 * Un monde possible pour `seat` : ses cartes et celles tombées sont fixes ; ce que tout le
 * monde a vu reste où il est (la retourne chez le preneur, les annonces montrées, la seconde
 * carte de la belote une fois « belote » dite) ; le reste est redistribué en respectant les
 * renonces observées.
 */
export function determinize(state: BeloteState, seat: number, rng: Rng): BeloteState {
  const known = new Set<string>();
  for (const c of state.hands[seat] ?? []) known.add(cardKey(c));
  for (const c of state.played) known.add(cardKey(c));
  for (const t of state.trick) known.add(cardKey(t.card));
  const bidding = state.phase !== 'play' && state.phase !== 'over';
  if (bidding) known.add(cardKey(state.turned));

  // Les cartes publiques encore en main : chacune reste chez celui qui la tient.
  const fixed: Card[][] = [[], [], [], []];
  const fix = (holder: number, c: Card): void => {
    if (holder < 0 || holder === seat || known.has(cardKey(c))) return;
    if (!(state.hands[holder] ?? []).some((x) => sameCard(x, c))) return;
    known.add(cardKey(c));
    (fixed[holder] as Card[]).push(c);
  };
  if (!bidding) fix(state.taker, state.turned);
  if (state.declarationsShown) for (const d of state.declarations) for (const c of d.cards) fix(d.seat, c);
  if (state.trump && state.beloteAnnounced && state.belotePlayed === 1) {
    for (const value of ['R', 'D'] as const) fix(state.beloteSeat, { suit: state.trump, value });
  }

  const pool = buildDeck().filter((c) => !known.has(cardKey(c)));
  const others = [0, 1, 2, 3].filter((i) => i !== seat);
  const needs = others.map((i) => (state.hands[i]?.length ?? 0) - (fixed[i] as Card[]).length);
  const talonSize = pool.length - needs.reduce((a, b) => a + b, 0);
  // Les places : les trois autres mains, puis la pioche (pendant les enchères seulement).
  const contenances = [...needs, talonSize];
  const admis = (place: number, c: Card): boolean => place === others.length || !(state.voids[others[place] as number] ?? []).includes(c.suit);
  const placed = repartir(pool, contenances, admis, rng) ?? (repartir(pool, contenances, () => true, rng) as Card[][]);
  const hands: Card[][] = state.hands.map((h, i) => (i === seat ? [...h] : []));
  others.forEach((i, k) => {
    hands[i] = sortHand([...(fixed[i] as Card[]), ...(placed[k] as Card[])], state.trump);
  });
  const talon = bidding ? (placed[others.length] as Card[]) : state.talon;
  // La belote et les annonces suivent les mains de ce monde tant qu'elles ne sont pas publiques.
  let beloteSeat = state.beloteSeat;
  let declarations = state.declarations;
  let declarationsTeam = state.declarationsTeam;
  if (state.trump) {
    if (!state.beloteAnnounced) {
      beloteSeat = -1;
      hands.forEach((h, i) => {
        if (has(h, { suit: state.trump as Suit, value: 'R' }) && has(h, { suit: state.trump as Suit, value: 'D' })) beloteSeat = i;
      });
    }
    if (!state.declarationsShown) {
      // Avant la fin du premier pli, une main a au plus perdu la carte qu'elle vient d'y poser.
      declarations = hands.flatMap((h, i) => findDeclarations([...h, ...state.trick.filter((t) => t.seat === i).map((t) => t.card)], i));
      declarationsTeam = declaringTeam(declarations, state.trump);
    }
  }
  return { ...state, hands, talon, beloteSeat, declarations, declarationsTeam };
}

// ---------- évaluation ----------

export function evaluate(state: BeloteState, seat: number): number {
  const team = teamOf(seat);
  if (state.roundOver && state.result) {
    const d = state.result.scored[team] - state.result.scored[(1 - team) as 0 | 1];
    return 0.5 + 0.5 * Math.tanh(d / 120);
  }
  if (!state.trump) return 0.5;
  const trump = state.trump;
  const pts: [number, number] = [state.won[0].reduce((s, c) => s + cardPoints(c, trump), 0), state.won[1].reduce((s, c) => s + cardPoints(c, trump), 0)];
  const remaining = 152 - pts[0] - pts[1];
  const share = pts[0] + pts[1] > 0 ? pts[team] / (pts[0] + pts[1]) : 0.5;
  const projected = pts[team] + remaining * share;
  return 0.5 + 0.5 * Math.tanh((projected - 81) / 25);
}

// ---------- le bot ----------

/** Valeur d'une main si `suit` est l'atout : une estimation simple pour décider de prendre. */
export function handValue(hand: readonly Card[], suit: Suit, turned: Card | null, seat: number, dealerSeat: number): number {
  const full = turned && turned.suit === suit ? [...hand, turned] : [...hand];
  let v = 0;
  const trumps = full.filter((c) => c.suit === suit);
  for (const c of trumps) v += cardPoints(c, suit) + 4;
  for (const c of full) if (c.suit !== suit && (c.value === 'A')) v += 11;
  for (const c of full) if (c.suit !== suit && c.value === '10') v += 5;
  if (trumps.length >= 4) v += 10;
  if (has(full, { suit, value: 'R' }) && has(full, { suit, value: 'D' })) v += 12;
  // Le preneur donne la retourne à l'adversaire s'il laisse passer : donneur plus prudent.
  if (seat === dealerSeat && turned) v += 3;
  return v;
}

function botBid(state: BeloteState, seat: number, legal: readonly Move[]): Move {
  const hand = state.hands[seat] ?? [];
  let best: Move = { type: 'pass' };
  let bestV = state.phase === 'bid1' ? 46 : 54;
  for (const m of legal) {
    if (m.type !== 'take') continue;
    const v = handValue(hand, m.suit, state.turned, seat, state.dealer);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

/** Une carte est maîtresse si plus aucune carte supérieure de sa couleur n'est en circulation hors de nos mains. */
function isMaster(state: BeloteState, hand: readonly Card[], card: Card): boolean {
  const trump = state.trump as Suit;
  const str = cardStrength(card, trump);
  for (const v of VALUES) {
    const other: Card = { suit: card.suit, value: v };
    if (cardStrength(other, trump) <= str) continue;
    if (has(state.played, other) || has(hand, other) || state.trick.some((t) => sameCard(t.card, other))) continue;
    return false;
  }
  return true;
}

function botPlay(state: BeloteState, seat: number, legal: readonly Move[]): Move {
  const trump = state.trump as Suit;
  const hand = state.hands[seat] ?? [];
  const cards = legal.flatMap((m) => (m.type === 'play' ? [m.card] : []));
  if (cards.length === 1) return { type: 'play', card: cards[0] as Card };
  const pts = (c: Card): number => cardPoints(c, trump);
  const str = (c: Card): number => cardStrength(c, trump) + (c.suit === trump ? 10 : 0);
  const lowest = (cs: readonly Card[]): Card => [...cs].sort((a, b) => pts(a) - pts(b) || str(a) - str(b))[0] as Card;
  const highest = (cs: readonly Card[]): Card => [...cs].sort((a, b) => str(b) - str(a))[0] as Card;
  const trickPts = state.trick.reduce((s, t) => s + pts(t.card), 0);

  if (state.trick.length === 0) {
    // À l'entame : une maîtresse (atout d'abord si on est preneur et qu'il en reste), sinon une petite non-atout.
    const masters = cards.filter((c) => isMaster(state, hand, c));
    const trumpMasters = masters.filter((c) => c.suit === trump);
    if (teamOf(seat) === teamOf(state.taker) && trumpMasters.length && state.played.filter((c) => c.suit === trump).length < 6) return { type: 'play', card: highest(trumpMasters) };
    const plainMasters = masters.filter((c) => c.suit !== trump);
    if (plainMasters.length) return { type: 'play', card: highest(plainMasters) };
    const plain = cards.filter((c) => c.suit !== trump);
    return { type: 'play', card: lowest(plain.length ? plain : cards) };
  }

  const master = trickMaster(state.trick, trump);
  const partnerMaster = teamOf(master) === teamOf(seat);
  const wouldWin = (c: Card): boolean => trickMaster([...state.trick, { seat, card: c }], trump) === seat;
  const winners = cards.filter(wouldWin);
  const last = state.trick.length === 3;

  if (partnerMaster) {
    // Le partenaire tient le pli : charger si le pli est sûr (dernier à parler ou partenaire maître absolu), sinon petite carte.
    const safe = last || isMaster(state, hand, (state.trick.find((t) => t.seat === master) as TrickCard).card);
    if (safe) {
      const load = cards.filter((c) => c.suit !== trump).sort((a, b) => pts(b) - pts(a))[0];
      if (load && pts(load) >= 10) return { type: 'play', card: load };
    }
    return { type: 'play', card: lowest(cards) };
  }
  if (winners.length) {
    // Prendre le pli au moindre coût si cela vaut la peine (points dedans, ou dernier à parler).
    const cheapest = [...winners].sort((a, b) => str(a) - str(b))[0] as Card;
    if (last || trickPts >= 10 || isMaster(state, hand, cheapest)) return { type: 'play', card: cheapest };
    const cheapNonTrump = winners.filter((c) => c.suit !== trump);
    if (cheapNonTrump.length) return { type: 'play', card: lowest(cheapNonTrump) };
    return { type: 'play', card: lowest(cards) };
  }
  return { type: 'play', card: lowest(cards) };
}

export function botMove(state: BeloteState, seat: number, legal: readonly Move[], rng: Rng, level: BotLevel = 'normal'): Move | null {
  if (legal.length === 0) return null;
  if (state.phase === 'bid1' || state.phase === 'bid2') return botBid(state, seat, legal);
  if (state.phase === 'play') {
    // Au niveau facile, le bot prend avec bon sens mais joue une fois sur deux une carte
    // permise au hasard : il laisse passer des plis et gâche des points, sans tricher.
    if (level === 'facile' && legal.length > 1 && rng.int(2) === 0) return legal[rng.int(legal.length)] as Move;
    return botPlay(state, seat, legal);
  }
  return null;
}

export function rolloutMove(state: BeloteState, seat: number, legal: readonly Move[], rng: Rng): Move {
  return botMove(state, seat, legal, rng) ?? (legal[rng.int(legal.length)] as Move);
}

// ---------- bilan, succès, textes ----------

export function roundSummary(state: BeloteState): RoundSummary {
  const r = state.result;
  const winnerTeam: 0 | 1 | null = r ? (r.capot !== null ? r.capot : r.litige ? null : r.made ? teamOf(r.taker) : (1 - teamOf(r.taker)) as 0 | 1) : null;
  return {
    perSeat: [0, 1, 2, 3].map((i) => ({
      roundPoints: r?.scored[teamOf(i)] ?? 0,
      total: state.teamScores[teamOf(i)],
      detail: r ? { role: i === r.taker ? 'preneur' : teamOf(i) === teamOf(r.taker) ? 'partenaire' : 'defense', team: teamOf(i) } : null,
    })),
    roundWinner: winnerTeam === null ? null : (r && r.made && r.capot === null ? r.taker : winnerTeam),
    label: r ? `Atout ${r.trump} — {${r.taker}} · ${r.capot !== null ? 'capot' : r.litige ? 'égalité' : r.made ? 'réussie' : 'dedans'}` : undefined,
  };
}

export function achievements(state: BeloteState, seat: number, ctx: AchievementContext): string[] {
  const out: string[] = [];
  const r = state.result;
  if (r) {
    const team = teamOf(seat);
    const attack = team === teamOf(r.taker);
    if (r.capot === team) out.push('capot');
    if (seat === r.taker && r.made && r.cardPoints[team] >= 120) out.push('belle-prise');
    if (!attack && !r.made && !r.litige) out.push('dedans');
    if (state.beloteSeat === seat) out.push('belote-rebelote');
    if (state.declarationsTeam === team && state.declarations.some((d) => d.seat === seat && d.points >= 100)) out.push('cent');
  }
  if (ctx.matchOver && ctx.wonMatch) out.push('maitre-de-la-belote');
  return out;
}

export const PHRASES: readonly string[] = [
  'bien-joue', 'joli-pli', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va',
  'je-prends', 'je-passe', 'coupe', 'belote', 'rebelote', 'au-revoir',
];

export const META: GameMeta = { id: 'belote', nameKey: 'games.belote.name', seatCounts: [4], status: 'available' };

export const belote: GameDefinition<BeloteState, Move, BeloteView> = {
  id: 'belote',
  seatCounts: [4],
  timings: { botDelay: 1200, forcedDelay: 1400, afkTimeout: 150_000 },
  createRound,
  currentSeat,
  legalMoves,
  forcedMove,
  applyMove,
  moveKey,
  isRoundOver: (s) => s.roundOver,
  isMatchOver,
  scores: (s) => [0, 1, 2, 3].map((i) => s.teamScores[teamOf(i)]),
  matchWinner,
  matchWinners,
  view,
  determinize,
  evaluate,
  rolloutMove,
  botMove,
  roundSummary,
  achievements,
  phrases: PHRASES,
};
