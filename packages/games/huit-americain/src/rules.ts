/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { shuffle, type GameDefinition, type GameMeta, type Rng, type RoundSummary, type AchievementContext } from '@jdc/core';

/**
 * Règles du 8 Américain, pures et sans réseau. L'état est immuable : chaque coup
 * renvoie un nouvel état. Rien ici ne sait ce qu'est un joueur humain, un bot ou une
 * socket.
 *
 * Règles de la maison (celles du jeu d'origine) :
 *  - on pose une carte de la couleur demandée ou de la même valeur que la carte visible ;
 *  - le 8 se pose sur tout sauf un 8, et son poseur choisit la couleur ;
 *  - le 7 fait rejouer immédiatement, le 10 inverse le sens ;
 *  - sans carte jouable, on pioche (et on passe) ; pioche vide : la défausse est rebattue ;
 *  - la manche s'arrête quand une main est vide ; chacun marque les points de ce qui
 *    lui reste ; à 200 points la partie s'arrête et le moins chargé gagne.
 */

export const SUITS = ['♥', '♦', '♣', '♠'] as const;
export type Suit = (typeof SUITS)[number];
export const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'A'] as const;
export type Value = (typeof VALUES)[number];
export const HAND_SIZE = 6;
export const MATCH_LIMIT = 200;

export interface Card {
  readonly suit: Suit;
  readonly value: Value;
}

export type Move = { readonly type: 'play'; readonly card: Card; readonly suit?: Suit } | { readonly type: 'draw' };

export interface LastAction {
  readonly seat: number;
  readonly type: 'play' | 'draw' | 'pass';
  readonly card?: Card;
  readonly suit?: Suit;
}

export interface HuitState {
  readonly seats: number;
  readonly hands: readonly (readonly Card[])[];
  readonly deck: readonly Card[];
  readonly discard: readonly Card[];
  readonly current: number;
  readonly direction: 1 | -1;
  readonly activeSuit: Suit;
  readonly scores: readonly number[];
  readonly roundOver: boolean;
  readonly roundWinner: number | null;
  readonly roundPoints: readonly number[];
  readonly lastAction: LastAction | null;
  /** Pioches de chaque siège dans la manche (pour les succès). */
  readonly draws: readonly number[];
  /** Dernière carte posée par chaque siège dans la manche. */
  readonly lastPlayed: readonly (Card | null)[];
  /** Le siège vient de poser un 7 et rejoue. */
  readonly replaying: boolean;
}

export interface HuitView {
  readonly seats: number;
  readonly hand: readonly Card[];
  readonly handCounts: readonly number[];
  readonly discardTop: Card;
  readonly activeSuit: Suit;
  readonly current: number;
  readonly direction: 1 | -1;
  readonly scores: readonly number[];
  readonly roundOver: boolean;
  readonly roundWinner: number | null;
  readonly deckCount: number;
  readonly lastAction: LastAction | null;
  /** Coups légaux du siège, avec leur clé, si c'est son tour ; sinon vide. */
  readonly legal: readonly { key: string; move: Move }[];
}

export function cardKey(c: Card): string {
  return `${c.value}${c.suit}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.value === b.value;
}

export function cardPoints(value: Value): number {
  switch (value) {
    case '8': return 32;
    case '7': return 14;
    case 'A': return 11;
    case '10': return 10;
    case '9': return 9;
    case 'R': return 4;
    case 'D': return 3;
    case 'V': return 2;
    default: return Number.parseInt(value, 10);
  }
}

export function handPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, c) => sum + cardPoints(c.value), 0);
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const value of VALUES) deck.push({ suit, value });
  return deck;
}

export function isPlayable(card: Card, activeSuit: Suit, topValue: Value): boolean {
  if (card.value === '8') return topValue !== '8';
  return card.suit === activeSuit || card.value === topValue;
}

function top(state: HuitState): Card {
  return state.discard[state.discard.length - 1] as Card;
}

function nextSeat(seat: number, direction: 1 | -1, seats: number): number {
  return (seat + direction + seats) % seats;
}

export function moveKey(move: Move): string {
  if (move.type === 'draw') return 'draw';
  return move.suit ? `play:${cardKey(move.card)}>${move.suit}` : `play:${cardKey(move.card)}`;
}

export function legalMoves(state: HuitState, seat: number): Move[] {
  if (state.roundOver || state.current !== seat) return [];
  const hand = state.hands[seat] ?? [];
  const t = top(state);
  const moves: Move[] = [];
  const seen = new Set<string>();
  for (const card of hand) {
    const k = cardKey(card);
    if (seen.has(k) || !isPlayable(card, state.activeSuit, t.value)) continue;
    seen.add(k);
    if (card.value === '8') for (const suit of SUITS) moves.push({ type: 'play', card, suit });
    else moves.push({ type: 'play', card });
  }
  moves.push({ type: 'draw' });
  return moves;
}

export function forcedMove(state: HuitState, seat: number): Move | null {
  const legal = legalMoves(state, seat);
  if (legal.length === 1 && legal[0]?.type === 'draw') return legal[0];
  return null;
}

export function createRound(seats: number, rng: Rng, previous?: HuitState): HuitState {
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = [];
  for (let i = 0; i < seats; i++) hands.push(deck.splice(0, HAND_SIZE));
  const first = deck.pop() as Card;
  const scores = previous ? [...previous.scores] : new Array<number>(seats).fill(0);
  // Le siège qui ouvre tourne d'une manche à l'autre.
  const opener = previous ? (previous.roundWinner ?? 0) : 0;
  return {
    seats,
    hands,
    deck,
    discard: [first],
    current: opener,
    direction: 1,
    activeSuit: first.suit,
    scores,
    roundOver: false,
    roundWinner: null,
    roundPoints: new Array<number>(seats).fill(0),
    lastAction: null,
    draws: new Array<number>(seats).fill(0),
    lastPlayed: new Array<Card | null>(seats).fill(null),
    replaying: false,
  };
}

export function applyMove(state: HuitState, seat: number, move: Move, rng: Rng): HuitState {
  if (state.roundOver || state.current !== seat) return state;
  const hand = state.hands[seat] ?? [];

  if (move.type === 'draw') {
    let deck = [...state.deck];
    let discard = [...state.discard];
    if (deck.length === 0 && discard.length > 1) {
      const t = discard.pop() as Card;
      deck = shuffle(discard, rng);
      discard = [t];
    }
    const hands = state.hands.map((h) => [...h]);
    let type: 'draw' | 'pass' = 'pass';
    if (deck.length > 0) {
      (hands[seat] as Card[]).push(deck.pop() as Card);
      type = 'draw';
    }
    const draws = [...state.draws];
    if (type === 'draw') draws[seat] = (draws[seat] ?? 0) + 1;
    return {
      ...state,
      hands,
      deck,
      discard,
      draws,
      current: nextSeat(seat, state.direction, state.seats),
      lastAction: { seat, type },
      replaying: false,
    };
  }

  const idx = hand.findIndex((c) => sameCard(c, move.card));
  if (idx === -1) return state;
  const card = hand[idx] as Card;
  if (!isPlayable(card, state.activeSuit, top(state).value)) return state;
  if (card.value === '8' && (move.suit === undefined || !SUITS.includes(move.suit))) return state;

  const hands = state.hands.map((h) => [...h]);
  (hands[seat] as Card[]).splice(idx, 1);
  const discard = [...state.discard, card];
  const activeSuit: Suit = card.value === '8' && move.suit ? move.suit : card.suit;
  const lastPlayed = [...state.lastPlayed];
  lastPlayed[seat] = card;
  const lastAction: LastAction = card.value === '8' && move.suit ? { seat, type: 'play', card, suit: move.suit } : { seat, type: 'play', card };

  if ((hands[seat] as Card[]).length === 0) {
    const roundPoints = hands.map((h) => handPoints(h));
    const scores = state.scores.map((s, i) => s + (roundPoints[i] ?? 0));
    return { ...state, hands, discard, activeSuit, scores, roundPoints, roundOver: true, roundWinner: seat, lastAction, lastPlayed, replaying: false };
  }

  const direction: 1 | -1 = card.value === '10' ? (state.direction === 1 ? -1 : 1) : state.direction;
  const replaying = card.value === '7';
  const current = replaying ? seat : nextSeat(seat, direction, state.seats);
  return { ...state, hands, discard, activeSuit, direction, current, lastAction, lastPlayed, replaying };
}

export function isMatchOver(state: HuitState): boolean {
  return state.roundOver && state.scores.some((s) => s >= MATCH_LIMIT);
}

export function matchWinner(state: HuitState): number | null {
  if (!isMatchOver(state)) return null;
  let best = 0;
  state.scores.forEach((s, i) => {
    if (s < (state.scores[best] ?? Infinity)) best = i;
  });
  return best;
}

export function view(state: HuitState, seat: number): HuitView {
  const legal = legalMoves(state, seat).map((move) => ({ key: moveKey(move), move }));
  return {
    seats: state.seats,
    hand: state.hands[seat] ?? [],
    handCounts: state.hands.map((h) => h.length),
    discardTop: top(state),
    activeSuit: state.activeSuit,
    current: state.current,
    direction: state.direction,
    scores: state.scores,
    roundOver: state.roundOver,
    roundWinner: state.roundWinner,
    deckCount: state.deck.length,
    lastAction: state.lastAction,
    legal,
  };
}

/** Monde possible : les cartes que ce siège ne voit pas sont redistribuées au hasard. */
export function determinize(state: HuitState, seat: number, rng: Rng): HuitState {
  const unknown: Card[] = [];
  state.hands.forEach((h, i) => {
    if (i !== seat) unknown.push(...h);
  });
  unknown.push(...state.deck);
  const pool = shuffle(unknown, rng);
  const hands = state.hands.map((h, i) => (i === seat ? [...h] : pool.splice(0, h.length)));
  return { ...state, hands, deck: pool };
}

export function evaluate(state: HuitState, seat: number): number {
  if (state.roundOver) {
    if (state.roundWinner === seat) return 1;
    const pts = state.roundPoints[seat] ?? 0;
    return Math.max(0, 0.6 - pts / 120);
  }
  // Manche interrompue : moins on a de cartes par rapport aux autres, mieux c'est.
  const mine = state.hands[seat]?.length ?? 0;
  const total = state.hands.reduce((n, h) => n + h.length, 0) || 1;
  return Math.max(0, Math.min(0.8, 0.8 * (1 - (mine * state.seats) / (2 * total))));
}

/**
 * Politique de simulation (et niveau « facile ») : se débarrasser d'abord des cartes
 * chères, garder les 8 pour quand rien d'autre ne passe, ne piocher qu'en dernier recours.
 */
export function rolloutMove(state: HuitState, seat: number, legal: readonly Move[], rng: Rng): Move {
  const plays = legal.filter((m): m is Extract<Move, { type: 'play' }> => m.type === 'play');
  if (plays.length === 0) return legal[0] as Move;
  const nonEight = plays.filter((m) => m.card.value !== '8');
  if (nonEight.length > 0) {
    let best = nonEight[0] as Extract<Move, { type: 'play' }>;
    let bestPts = -1;
    const shuffled = shuffle(nonEight, rng);
    for (const m of shuffled) {
      const p = cardPoints(m.card.value);
      if (p > bestPts) {
        bestPts = p;
        best = m;
      }
    }
    return best;
  }
  // Seulement des 8 : la couleur majoritaire du reste de la main.
  const hand = state.hands[seat] ?? [];
  const counts = new Map<Suit, number>();
  for (const c of hand) if (c.value !== '8') counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  let bestSuit: Suit = SUITS[rng.int(SUITS.length)] as Suit;
  let bestCount = -1;
  for (const [s, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      bestSuit = s;
    }
  }
  return plays.find((m) => m.suit === bestSuit) ?? (plays[0] as Move);
}

export function roundSummary(state: HuitState): RoundSummary {
  return {
    perSeat: state.hands.map((h, i) => ({ roundPoints: state.roundPoints[i] ?? 0, total: state.scores[i] ?? 0, detail: h })),
    roundWinner: state.roundWinner,
  };
}

export function achievements(state: HuitState, seat: number, ctx: AchievementContext): string[] {
  const out: string[] = [];
  if (state.roundWinner === seat) {
    if (state.lastPlayed[seat]?.value === '8') out.push('huit-magique');
    if ((state.draws[seat] ?? 0) === 0) out.push('sans-pioche');
    if (state.lastPlayed[seat]?.value === '7') out.push('coup-du-sept');
  }
  if (ctx.matchOver && ctx.wonMatch && (state.scores[seat] ?? 1) === 0) out.push('manche-parfaite');
  return out;
}

export const PHRASES: readonly string[] = [
  'bien-joue', 'joli-coup', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va',
  'change-de-couleur', 'un-huit', 'je-pioche', 'plus-qu-une', 'la-revanche', 'au-revoir',
];

export const META: GameMeta = { id: 'huit-americain', nameKey: 'games.huit-americain.name', seatCounts: [4], status: 'available' };

export const huitAmericain: GameDefinition<HuitState, Move, HuitView> = {
  id: 'huit-americain',
  seatCounts: [4, 3, 2],
  timings: { botDelay: 1400, forcedDelay: 1200, afkTimeout: 120_000 },
  createRound,
  currentSeat: (s) => (s.roundOver ? null : s.current),
  legalMoves,
  forcedMove,
  applyMove,
  moveKey,
  isRoundOver: (s) => s.roundOver,
  isMatchOver,
  scores: (s) => [...s.scores],
  matchWinner,
  view,
  determinize,
  evaluate,
  rolloutMove,
  roundSummary,
  achievements,
  phrases: PHRASES,
};
