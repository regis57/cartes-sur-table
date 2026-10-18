/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { repartir, shuffle, type BotLevel, type GameDefinition, type GameMeta, type Rng, type RoundSummary, type AchievementContext } from '@jdc/core';
import {
  SUITS, buildDeck, cardKey, cardPoints, isBout, isKing, parseCardKey, sameCard, sortHand,
  type Card, type Suit,
} from './cartes.ts';

/**
 * Règles du tarot français à 4 et 5 joueurs, pures et sans réseau. Ce sont celles du jeu
 * d'origine (regis57/tarot-francais-enligne), reprises point par point :
 *
 *  - enchères en un tour : Passe, Petite (×1), Pousse (×1, base 45 au lieu de 25), Garde (×2),
 *    Garde Sans (×4), Garde Contre (×6) ;
 *    tout le monde passe → nouvelle donne, qui ne compte pas ;
 *  - à 5 joueurs, le preneur appelle un Roi (une Dame s'il a les quatre Rois, un Cavalier
 *    s'il a aussi les quatre Dames) ; le porteur de la carte appelée est son partenaire,
 *    révélé quand la carte tombe ;
 *  - Petite, Pousse et Garde : le chien est montré à tous, puis le preneur fait son écart (ni Roi,
 *    ni bout, et de l'atout seulement s'il n'a pas d'autre carte) ;
 *  - obligation de fournir, de couper, de surcouper ; l'Excuse se joue toujours ;
 *  - à 5 joueurs, l'entame du premier pli ne se fait pas dans la couleur du Roi appelé, sauf
 *    avec ce Roi lui-même ;
 *  - l'Excuse ne remporte jamais le pli et reste à son camp contre un demi-point rendu ; au
 *    dernier pli, elle est perdue : elle passe au camp adverse ;
 *  - objectifs selon les bouts : 56 / 51 / 41 / 36 ; valeur de la donne = (25 + écart) × contrat,
 *    l'écart arrondi au point supérieur (le demi-point va au camp gagnant),
 *    plus le Petit au bout (10 × contrat) et les poignées (non multipliées) ;
 *  - à 4, le preneur marque trois fois la valeur ; à 5, deux fois (le partenaire une fois),
 *    ou quatre fois s'il est seul ;
 *  - poignées : 10 / 13 / 15 atouts à 4 joueurs, 8 / 10 / 13 à 5 (+20 / +30 / +40).
 *
 * L'écart se fait carte par carte (un coup par carte) : c'est ce qui permet au contrat de
 * rester « un coup = un choix » et au bot de raisonner dessus, sans rien changer au résultat.
 */

export const BIDS = ['passe', 'petite', 'pousse', 'garde', 'garde-sans', 'garde-contre'] as const;
export type Bid = 0 | 1 | 2 | 3 | 4 | 5;
/** Multiplicateur de chaque contrat ; la Pousse se joue comme la Petite, avec 20 points de plus à la base. */
export const BID_MULT = [0, 1, 1, 2, 4, 6] as const;
export const POUSSE_BONUS = 20;
const BID_LABELS = ['Passe', 'Petite', 'Pousse', 'Garde', 'Garde sans', 'Garde contre'] as const;
/** Le chien est pris et écarté jusqu'à la Garde comprise. */
export const LAST_BID_WITH_CHIEN: Bid = 3;
/** Nombre de donnes d'une partie, comme le défaut du jeu d'origine. */
export const MATCH_ROUNDS = 5;
const TARGETS = [56, 51, 41, 36] as const;
const POIGNEES: Record<number, readonly (readonly [number, number])[]> = {
  4: [[10, 20], [13, 30], [15, 40]],
  5: [[8, 20], [10, 30], [13, 40]],
};

export type Phase = 'bidding' | 'callKing' | 'ecart' | 'play' | 'over';

export type Move =
  | { readonly type: 'bid'; readonly bid: Bid }
  | { readonly type: 'call'; readonly suit: Suit; readonly value: CallValue }
  | { readonly type: 'discard'; readonly card: Card }
  | { readonly type: 'poignee' }
  | { readonly type: 'play'; readonly card: Card };

export interface TrickCard {
  readonly seat: number;
  readonly card: Card;
}

/** Figure appelée à cinq : un Roi ; une Dame si l'on a les quatre Rois ; un Cavalier si l'on a aussi les quatre Dames… */
export type CallValue = 'R' | 'D' | 'C' | 'V';
const CALL_VALUES: readonly CallValue[] = ['R', 'D', 'C', 'V'];
const CALL_RANK: Record<CallValue, number> = { R: 14, D: 13, C: 12, V: 11 };

/** La figure à appeler : la plus haute dont il manque au moins une à la main du preneur. */
export function callValueFor(hand: readonly Card[]): CallValue {
  return CALL_VALUES.find((v) => hand.filter((c) => c.t === 'c' && c.value === v).length < 4) ?? 'V';
}

export interface Poignee {
  readonly seat: number;
  readonly count: number;
  readonly bonus: number;
  /** Les atouts présentés à la table (règlement de la FFT), l'Excuse seulement s'il en manque. */
  readonly cards: readonly Card[];
}

/** Ce qui vient de se passer, pour l'affichage (jamais nécessaire aux règles). */
export type LastEvent =
  | { readonly type: 'redeal'; readonly reason?: 'passe' | 'petit-sec' }
  | { readonly type: 'bid'; readonly seat: number; readonly bid: Bid }
  | { readonly type: 'call'; readonly seat: number; readonly card: Card }
  | { readonly type: 'ecart-done'; readonly seat: number }
  | { readonly type: 'poignee'; readonly seat: number; readonly count: number; readonly bonus: number }
  | { readonly type: 'partner'; readonly seat: number }
  | { readonly type: 'trick'; readonly winner: number };

/** Le bilan d'une donne terminée. */
export interface DonneResult {
  readonly preneur: number;
  readonly partner: number | null;
  readonly bid: Bid;
  readonly attackPoints: number;
  readonly bouts: number;
  readonly target: number;
  readonly won: boolean;
  readonly petitAuBout: number;
  readonly poignees: number;
  readonly value: number;
  readonly deltas: readonly number[];
  readonly calledCard: Card | null;
}

export interface HistoryEntry {
  readonly round: number;
  readonly result: DonneResult;
  readonly scores: readonly number[];
}

export interface TarotState {
  readonly seats: number;
  readonly dealer: number;
  readonly roundNumber: number;
  readonly totalRounds: number;
  readonly phase: Phase;
  readonly hands: readonly (readonly Card[])[];
  readonly chien: readonly Card[];
  readonly ecart: readonly Card[];
  readonly chienSize: number;
  readonly bids: readonly number[];
  readonly bestBid: Bid;
  readonly preneur: number;
  readonly bidTurn: number;
  readonly bidsPlaced: number;
  readonly calledCard: Card | null;
  readonly partner: number;
  readonly partnerRevealed: boolean;
  readonly trick: readonly TrickCard[];
  readonly leadSeat: number;
  readonly current: number;
  readonly tricksPlayed: number;
  readonly totalTricks: number;
  readonly lastTrick: { readonly cards: readonly TrickCard[]; readonly winner: number } | null;
  readonly won: readonly (readonly Card[])[];
  readonly excuseInfo: { readonly owner: number; readonly trickWinner: number } | null;
  readonly played: readonly Card[];
  /** Par siège, ce dont il s'est montré dépourvu (« ♠ », « A » pour l'atout) : sert au bot, jamais aux règles. */
  readonly voids: readonly (readonly string[])[];
  readonly poignees: readonly Poignee[];
  readonly scores: readonly number[];
  readonly roundOver: boolean;
  readonly result: DonneResult | null;
  readonly history: readonly HistoryEntry[];
  readonly lastEvent: LastEvent | null;
}

export interface TarotView {
  readonly seats: number;
  readonly me: number;
  readonly phase: Phase;
  readonly dealer: number;
  readonly roundNumber: number;
  readonly totalRounds: number;
  readonly hand: readonly Card[];
  readonly handCounts: readonly number[];
  readonly bids: readonly number[];
  readonly bestBid: Bid;
  readonly bidTurn: number;
  readonly preneur: number;
  readonly calledCard: Card | null;
  /** Le partenaire du preneur, seulement une fois révélé (ou la donne finie). */
  readonly partner: number | null;
  /** Le chien, montré à tous pendant l'écart. */
  readonly chien: readonly Card[] | null;
  readonly chienSize: number;
  /** L'écart déjà posé, visible du preneur seul. */
  readonly ecart: readonly Card[] | null;
  /** Les atouts que le preneur a dû écarter : montrés à tous, règle officielle. */
  readonly ecartAtouts: readonly Card[];
  readonly ecartNeeded: number;
  readonly trick: readonly TrickCard[];
  readonly lastTrick: { readonly cards: readonly TrickCard[]; readonly winner: number } | null;
  readonly current: number;
  readonly tricksPlayed: number;
  readonly totalTricks: number;
  readonly poignees: readonly Poignee[];
  /** Niveau de poignée annonçable par ce siège maintenant, ou null. */
  readonly myPoignee: { readonly count: number; readonly bonus: number } | null;
  readonly scores: readonly number[];
  readonly roundOver: boolean;
  readonly result: DonneResult | null;
  readonly history: readonly HistoryEntry[];
  readonly lastEvent: LastEvent | null;
  readonly legal: readonly { key: string; move: Move }[];
}

// ---------- utilitaires ----------

function handSizeFor(seats: number): number {
  return seats === 5 ? 15 : 18;
}

function chienSizeFor(seats: number): number {
  return seats === 5 ? 3 : 6;
}

function without(hand: readonly Card[], card: Card): Card[] {
  const i = hand.findIndex((c) => sameCard(c, card));
  if (i < 0) return [...hand];
  return [...hand.slice(0, i), ...hand.slice(i + 1)];
}

function has(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => sameCard(c, card));
}

/** Le camp d'un siège : attaque (preneur et partenaire) ou défense. */
export function teamOf(state: Pick<TarotState, 'preneur' | 'partner'>, seat: number): 'A' | 'D' {
  if (seat === state.preneur) return 'A';
  if (state.partner >= 0 && state.partner !== state.preneur && seat === state.partner) return 'A';
  return 'D';
}

function ledCard(trick: readonly TrickCard[]): Card | null {
  for (const t of trick) if (t.card.t !== 'e') return t.card;
  return null;
}

function highestAtout(trick: readonly TrickCard[]): number {
  let best = 0;
  for (const t of trick) if (t.card.t === 'a' && t.card.rank > best) best = t.card.rank;
  return best;
}

/** L'écart interdit les Rois et les bouts ; l'atout n'est permis qu'en dernier recours. */
export function ecartForbidden(c: Card): boolean {
  return isKing(c) || isBout(c);
}

export function poigneeLevel(seats: number, hand: readonly Card[]): { count: number; bonus: number } | null {
  const n = hand.filter((c) => c.t === 'a' || c.t === 'e').length;
  let best: { count: number; bonus: number } | null = null;
  for (const [count, bonus] of POIGNEES[seats] ?? POIGNEES[4] ?? []) if (n >= count) best = { count, bonus };
  return best;
}

// ---------- la donne ----------

function deal(seats: number, dealer: number, rng: Rng, base: Pick<TarotState, 'roundNumber' | 'totalRounds' | 'scores' | 'history'>, lastEvent: LastEvent | null): TarotState {
  const deck = shuffle(buildDeck(), rng);
  const handSize = handSizeFor(seats);
  const chienSize = chienSizeFor(seats);
  const hands: Card[][] = [];
  for (let i = 0; i < seats; i++) hands.push(sortHand(deck.splice(0, handSize)));
  const chien = deck.splice(0, chienSize);
  return {
    seats,
    dealer,
    roundNumber: base.roundNumber,
    totalRounds: base.totalRounds,
    phase: 'bidding',
    hands,
    chien,
    ecart: [],
    chienSize,
    bids: new Array<number>(seats).fill(-1),
    bestBid: 0,
    preneur: -1,
    bidTurn: (dealer + 1) % seats,
    bidsPlaced: 0,
    calledCard: null,
    partner: -1,
    partnerRevealed: false,
    trick: [],
    leadSeat: (dealer + 1) % seats,
    current: (dealer + 1) % seats,
    tricksPlayed: 0,
    totalTricks: handSize,
    lastTrick: null,
    won: hands.map(() => []),
    excuseInfo: null,
    played: [],
    voids: hands.map(() => []),
    poignees: [],
    scores: [...base.scores],
    roundOver: false,
    result: null,
    history: [...base.history],
    lastEvent,
  };
}

/** Petit sec : le 1 d'atout pour seul atout, sans l'Excuse. La donne est annulée (règle officielle). */
export function hasPetitSec(hand: readonly Card[]): boolean {
  const atouts = hand.filter((c) => c.t === 'a');
  return atouts.length === 1 && atouts[0]!.rank === 1 && !hand.some((c) => c.t === 'e');
}

/** Donne, puis redonne (donneur suivant) tant qu'une main a le Petit sec. */
function dealValid(seats: number, dealer: number, rng: Rng, base: Pick<TarotState, 'roundNumber' | 'totalRounds' | 'scores' | 'history'>, lastEvent: LastEvent | null): TarotState {
  let s = deal(seats, dealer, rng, base, lastEvent);
  let guard = 0;
  while (s.hands.some(hasPetitSec) && guard++ < 50) s = deal(seats, (s.dealer + 1) % seats, rng, base, { type: 'redeal', reason: 'petit-sec' });
  return s;
}

export function createRound(seats: number, rng: Rng, previous?: TarotState): TarotState {
  if (previous) {
    return dealValid(seats, (previous.dealer + 1) % seats, rng, {
      roundNumber: previous.roundNumber + 1,
      totalRounds: previous.totalRounds,
      scores: previous.scores,
      history: previous.history,
    }, null);
  }
  return dealValid(seats, rng.int(seats), rng, { roundNumber: 1, totalRounds: MATCH_ROUNDS, scores: new Array<number>(seats).fill(0), history: [] }, null);
}

// ---------- légalité ----------

export function currentSeat(state: TarotState): number | null {
  switch (state.phase) {
    case 'bidding': return state.bidTurn;
    case 'callKing':
    case 'ecart': return state.preneur;
    case 'play': return state.current;
    case 'over': return null;
  }
}

/** Indices (dans la main) des cartes jouables, règle du jeu d'origine. */
export function legalCards(state: TarotState, seat: number): Card[] {
  const hand = state.hands[seat] ?? [];
  const trick = state.trick;
  if (trick.length === 0) {
    // À cinq, on n'entame pas le premier pli dans la couleur du Roi appelé, sauf avec ce Roi
    // (règlement de la FFT) : ce serait chercher le partenaire avant même d'avoir joué.
    // Une main qui n'a rien d'autre (Excuse mise à part) entame comme elle peut.
    const called = state.calledCard;
    if (state.seats === 5 && state.tricksPlayed === 0 && called && called.t === 'c') {
      const permises = hand.filter((c) => !(c.t === 'c' && c.suit === called.suit) || sameCard(c, called));
      if (permises.some((c) => c.t !== 'e')) return permises;
    }
    return [...hand];
  }
  const led = ledCard(trick);
  if (!led) return [...hand];

  const bestAtout = highestAtout(trick);
  const atouts = hand.filter((c) => c.t === 'a');
  const hasAtout = atouts.length > 0;
  const hasHigher = atouts.some((c) => c.rank > bestAtout);
  const hasLedSuit = led.t === 'c' && hand.some((c) => c.t === 'c' && c.suit === led.suit);

  const legal = hand.filter((c) => {
    if (c.t === 'e') return true;
    if (led.t === 'a') {
      if (!hasAtout) return true;
      return c.t === 'a' && (!hasHigher || c.rank > bestAtout);
    }
    if (hasLedSuit) return c.t === 'c' && c.suit === led.suit;
    if (hasAtout) return c.t === 'a' && (!hasHigher || c.rank > bestAtout);
    return true;
  });
  return legal.length ? legal : [...hand];
}

function legalDiscards(state: TarotState): Card[] {
  const hand = state.hands[state.preneur] ?? [];
  const remaining = state.chienSize - state.ecart.length;
  const normal = hand.filter((c) => !ecartForbidden(c) && c.t !== 'a');
  if (normal.length >= remaining) return normal;
  // Pas assez de cartes ordinaires : les atouts (hors bouts) deviennent permis.
  return hand.filter((c) => !ecartForbidden(c));
}

export function legalMoves(state: TarotState, seat: number): Move[] {
  if (currentSeat(state) !== seat) return [];
  switch (state.phase) {
    case 'bidding': {
      const moves: Move[] = [{ type: 'bid', bid: 0 }];
      for (let b = state.bestBid + 1; b <= 5; b++) moves.push({ type: 'bid', bid: b as Bid });
      return moves;
    }
    case 'callKing': {
      const hand = state.hands[seat] ?? [];
      const value = callValueFor(hand);
      return SUITS.map((suit) => ({ type: 'call', suit, value }));
    }
    case 'ecart':
      return legalDiscards(state).map((card) => ({ type: 'discard', card }));
    case 'play': {
      const moves: Move[] = legalCards(state, seat).map((card) => ({ type: 'play', card }));
      if (canAnnouncePoignee(state, seat)) moves.unshift({ type: 'poignee' });
      return moves;
    }
    case 'over':
      return [];
  }
}

export function canAnnouncePoignee(state: TarotState, seat: number): boolean {
  if (state.phase !== 'play') return false;
  const hand = state.hands[seat] ?? [];
  if (hand.length !== state.totalTricks) return false; // avant sa première carte seulement
  if (state.poignees.some((p) => p.seat === seat)) return false;
  return poigneeLevel(state.seats, hand) !== null;
}

export function forcedMove(state: TarotState, seat: number): Move | null {
  const legal = legalMoves(state, seat);
  // Une seule carte jouable (et pas de poignée à décider) : le socle la pose pour un humain.
  if (state.phase === 'play' && legal.length === 1 && legal[0]?.type === 'play') return legal[0];
  return null;
}

export function moveKey(m: Move): string {
  switch (m.type) {
    case 'bid': return `bid:${m.bid}`;
    case 'call': return `call:${m.value}${m.suit}`;
    case 'discard': return `discard:${cardKey(m.card)}`;
    case 'poignee': return 'poignee';
    case 'play': return `play:${cardKey(m.card)}`;
  }
}

export function parseMoveKey(key: string): Move | null {
  if (key === 'poignee') return { type: 'poignee' };
  const [kind, rest] = key.split(':');
  if (kind === 'bid') {
    const b = Number(rest);
    return Number.isInteger(b) && b >= 0 && b <= 5 ? { type: 'bid', bid: b as Bid } : null;
  }
  if (kind === 'call' && rest) {
    const value = rest.slice(0, -1);
    const suit = rest.slice(-1) as Suit;
    if ((CALL_VALUES as readonly string[]).includes(value) && SUITS.includes(suit)) return { type: 'call', suit, value: value as CallValue };
    return null;
  }
  if ((kind === 'discard' || kind === 'play') && rest) {
    const card = parseCardKey(rest);
    return card ? { type: kind, card } : null;
  }
  return null;
}

// ---------- application des coups ----------

export function applyMove(state: TarotState, seat: number, move: Move, rng: Rng): TarotState {
  switch (move.type) {
    case 'bid': return applyBid(state, seat, move.bid, rng);
    case 'call': return applyCall(state, seat, move.suit, move.value);
    case 'discard': return applyDiscard(state, seat, move.card);
    case 'poignee': return applyPoignee(state, seat);
    case 'play': return applyPlay(state, seat, move.card);
  }
}

function applyBid(state: TarotState, seat: number, bid: Bid, rng: Rng): TarotState {
  const bids = [...state.bids];
  bids[seat] = bid;
  const bestBid = bid > state.bestBid ? bid : state.bestBid;
  const preneur = bid > state.bestBid ? seat : state.preneur;
  const bidsPlaced = state.bidsPlaced + 1;

  if (bidsPlaced < state.seats) {
    return { ...state, bids, bestBid, preneur, bidsPlaced, bidTurn: (state.bidTurn + 1) % state.seats, lastEvent: { type: 'bid', seat, bid } };
  }
  if (bestBid === 0) {
    // Tout le monde passe : on redonne, la donne ne compte pas, le donneur tourne.
    return dealValid(state.seats, (state.dealer + 1) % state.seats, rng, state, { type: 'redeal', reason: 'passe' });
  }
  const next: TarotState = { ...state, bids, bestBid, preneur, bidsPlaced, lastEvent: { type: 'bid', seat, bid } };
  if (state.seats === 5) return { ...next, phase: 'callKing' };
  return proceedToChien(next);
}

function applyCall(state: TarotState, seat: number, suit: Suit, value: CallValue): TarotState {
  const called: Card = { t: 'c', suit, value, rank: CALL_RANK[value] };
  let partner = state.preneur;
  state.hands.forEach((hand, i) => {
    if (has(hand, called)) partner = i;
  });
  // La carte appelée dans le chien, ou dans sa propre main : le preneur joue seul.
  if (has(state.chien, called)) partner = state.preneur;
  const revealed = partner === state.preneur; // seul : il n'y a personne à révéler
  return proceedToChien({ ...state, calledCard: called, partner, partnerRevealed: revealed, lastEvent: { type: 'call', seat, card: called } });
}

function proceedToChien(state: TarotState): TarotState {
  const lead = (state.dealer + 1) % state.seats;
  if (state.bestBid > LAST_BID_WITH_CHIEN) {
    // Garde Sans / Garde Contre : le chien reste fermé.
    return { ...state, phase: 'play', leadSeat: lead, current: lead, trick: [] };
  }
  const hands = state.hands.map((h, i) => (i === state.preneur ? sortHand([...h, ...state.chien]) : h));
  return { ...state, phase: 'ecart', hands };
}

function applyDiscard(state: TarotState, seat: number, card: Card): TarotState {
  const hands = state.hands.map((h, i) => (i === seat ? without(h, card) : h));
  const ecart = [...state.ecart, card];
  if (ecart.length < state.chienSize) return { ...state, hands, ecart };
  const lead = (state.dealer + 1) % state.seats;
  return { ...state, hands, ecart, phase: 'play', leadSeat: lead, current: lead, trick: [], lastEvent: { type: 'ecart-done', seat } };
}

function applyPoignee(state: TarotState, seat: number): TarotState {
  const level = poigneeLevel(state.seats, state.hands[seat] ?? []);
  if (!level) return state;
  // La poignée se présente à la table : autant d'atouts que le palier en demande, les plus
  // petits (le joueur garde pour lui ce qu'il a au-delà), et l'Excuse seulement s'il manque
  // un atout — elle dit alors qu'il n'en a pas d'autre.
  const hand = state.hands[seat] ?? [];
  const atouts = hand.filter((c) => c.t === 'a').sort((a, b) => (a.t === 'a' && b.t === 'a' ? a.rank - b.rank : 0));
  const cards = atouts.length >= level.count ? atouts.slice(0, level.count) : [...atouts, ...hand.filter((c) => c.t === 'e')];
  const p: Poignee = { seat, count: level.count, bonus: level.bonus, cards };
  return { ...state, poignees: [...state.poignees, p], lastEvent: { type: 'poignee', seat, count: p.count, bonus: p.bonus } };
}

function applyPlay(state: TarotState, seat: number, card: Card): TarotState {
  const hand = state.hands[seat] ?? [];
  const hands = state.hands.map((h, i) => (i === seat ? without(h, card) : h));
  const trick = [...state.trick, { seat, card }];
  const played = [...state.played, card];

  // Renonces observées : le siège n'a pas fourni la couleur (ou l'atout) demandée.
  const voids = state.voids.map((v) => [...v]);
  const led = ledCard(state.trick);
  if (led && card.t !== 'e') {
    const seatVoids = voids[seat] as string[];
    if (led.t === 'c' && !(card.t === 'c' && card.suit === led.suit)) {
      if (!seatVoids.includes(led.suit)) seatVoids.push(led.suit);
      if (card.t !== 'a' && !seatVoids.includes('A')) seatVoids.push('A');
    } else if (led.t === 'a' && card.t !== 'a') {
      if (!seatVoids.includes('A')) seatVoids.push('A');
    }
  }

  let partnerRevealed = state.partnerRevealed;
  let lastEvent: LastEvent | null = null;
  if (state.calledCard && !partnerRevealed && sameCard(card, state.calledCard)) {
    partnerRevealed = true;
    lastEvent = { type: 'partner', seat };
  }

  const base: TarotState = { ...state, hands, trick, played, voids, partnerRevealed, lastEvent };
  void hand;
  if (trick.length < state.seats) {
    return { ...base, current: (state.current + 1) % state.seats };
  }
  return resolveTrick(base);
}

function resolveTrick(state: TarotState): TarotState {
  const trick = state.trick;
  const led = ledCard(trick);
  let winner = -1;
  let bestRank = -1;
  let bestIsAtout = false;
  for (const t of trick) {
    const c = t.card;
    if (c.t === 'e') continue;
    if (c.t === 'a') {
      if (!bestIsAtout || c.rank > bestRank) {
        bestIsAtout = true;
        bestRank = c.rank;
        winner = t.seat;
      }
    } else if (!bestIsAtout && led && led.t === 'c' && c.suit === led.suit && c.rank > bestRank) {
      bestRank = c.rank;
      winner = t.seat;
    }
  }
  if (winner < 0) winner = trick[0]?.seat ?? state.leadSeat;

  const isLast = state.tricksPlayed === state.totalTricks - 1;
  const won = state.won.map((w) => [...w]);
  let excuseInfo = state.excuseInfo;
  for (const t of trick) {
    if (t.card.t === 'e' && !isLast) {
      (won[t.seat] as Card[]).push(t.card);
      excuseInfo = { owner: t.seat, trickWinner: winner };
    } else if (t.card.t === 'e') {
      // Au dernier pli, l'Excuse est perdue : elle passe au camp adverse, même quand le pli
      // revient à un partenaire de celui qui l'a jouée.
      const camp = teamOf(state, t.seat);
      const adverse = teamOf(state, winner) !== camp ? winner : [...Array(state.seats).keys()].find((i) => teamOf(state, i) !== camp) ?? winner;
      (won[adverse] as Card[]).push(t.card);
    } else {
      (won[winner] as Card[]).push(t.card);
    }
  }

  const next: TarotState = {
    ...state,
    won,
    excuseInfo,
    lastTrick: { cards: trick, winner },
    trick: [],
    tricksPlayed: state.tricksPlayed + 1,
    leadSeat: winner,
    current: winner,
    lastEvent: state.lastEvent?.type === 'partner' ? state.lastEvent : { type: 'trick', winner },
  };
  return next.tricksPlayed >= next.totalTricks ? scoreRound(next) : next;
}

// ---------- décompte ----------

function scoreRound(state: TarotState): TarotState {
  let attackPts = 0;
  let attackBouts = 0;
  state.won.forEach((cards, i) => {
    if (teamOf(state, i) !== 'A') return;
    for (const c of cards) {
      attackPts += cardPoints(c);
      if (isBout(c)) attackBouts++;
    }
  });

  // L'Excuse : un demi-point rendu au camp qui a remporté le pli, si ce n'est pas le même.
  if (state.excuseInfo) {
    const ownerTeam = teamOf(state, state.excuseInfo.owner);
    const winnerTeam = teamOf(state, state.excuseInfo.trickWinner);
    if (ownerTeam !== winnerTeam) attackPts += ownerTeam === 'A' ? -0.5 : 0.5;
  }

  // Le chien (ou l'écart) : à l'attaque, sauf Garde Contre.
  const pile = state.bestBid <= LAST_BID_WITH_CHIEN ? state.ecart : state.chien;
  if (state.bestBid !== 5) {
    for (const c of pile) {
      attackPts += cardPoints(c);
      if (isBout(c)) attackBouts++;
    }
  }

  const target = TARGETS[Math.min(attackBouts, 3)] as number;
  const diff = attackPts - target;
  const won = diff >= 0;
  const mult = BID_MULT[state.bestBid];

  // Petit au bout : le camp qui remporte le dernier pli avec le Petit dedans.
  let petit = 0;
  if (state.lastTrick && state.lastTrick.cards.some((t) => t.card.t === 'a' && t.card.rank === 1)) {
    petit = teamOf(state, state.lastTrick.winner) === 'A' ? 10 : -10;
  }

  const poigneeSum = state.poignees.reduce((s, p) => s + p.bonus, 0);
  const sign = won ? 1 : -1;
  const base = 25 + (state.bestBid === 2 ? POUSSE_BONUS : 0);
  // Le demi-point (à cinq, l'attaque peut finir à 40,5) va toujours au camp gagnant : l'écart
  // s'arrondit au point supérieur avant d'être multiplié. 40,5 pour 41, c'est chuter d'un point ;
  // arrondir après la multiplication perdait ce point, ou le divisait par deux.
  const gap = Math.ceil(Math.abs(diff));
  const value = (base + gap) * mult * sign + petit * mult + poigneeSum * sign;

  const deltas: number[] = [];
  if (state.seats === 4) {
    for (let i = 0; i < 4; i++) deltas.push(i === state.preneur ? 3 * value : -value);
  } else {
    const alone = state.partner === state.preneur;
    for (let i = 0; i < 5; i++) {
      if (i === state.preneur) deltas.push((alone ? 4 : 2) * value);
      else if (!alone && i === state.partner) deltas.push(value);
      else deltas.push(-value);
    }
  }
  const scores = state.scores.map((s, i) => s + (deltas[i] ?? 0));

  const result: DonneResult = {
    preneur: state.preneur,
    partner: state.partner >= 0 && state.partner !== state.preneur ? state.partner : null,
    bid: state.bestBid,
    attackPoints: Math.round(attackPts * 2) / 2,
    bouts: attackBouts,
    target,
    won,
    petitAuBout: petit * mult,
    poignees: poigneeSum * sign,
    value,
    deltas,
    calledCard: state.calledCard,
  };
  return {
    ...state,
    phase: 'over',
    roundOver: true,
    partnerRevealed: true,
    scores,
    result,
    history: [...state.history, { round: state.roundNumber, result, scores }],
  };
}

export function isMatchOver(state: TarotState): boolean {
  return state.roundOver && state.roundNumber >= state.totalRounds;
}

/**
 * Tous les sièges au plus haut score. Une égalité en tête est fréquente à quatre (deux
 * défenseurs qui n'ont jamais pris reçoivent les mêmes points) : chacun compte la partie
 * comme gagnée, et pas seulement celui d'indice le plus bas.
 */
export function matchWinners(state: TarotState): number[] {
  if (!isMatchOver(state)) return [];
  const best = Math.max(...state.scores);
  return state.scores.flatMap((s, i) => (s === best ? [i] : []));
}

export function matchWinner(state: TarotState): number | null {
  return matchWinners(state)[0] ?? null;
}

// ---------- vue ----------

export function view(state: TarotState, seat: number): TarotView {
  const legal = legalMoves(state, seat).map((move) => ({ key: moveKey(move), move }));
  const isPreneur = seat === state.preneur;
  return {
    seats: state.seats,
    me: seat,
    phase: state.phase,
    dealer: state.dealer,
    roundNumber: state.roundNumber,
    totalRounds: state.totalRounds,
    hand: state.hands[seat] ?? [],
    handCounts: state.hands.map((h) => h.length),
    bids: state.bids,
    bestBid: state.bestBid,
    bidTurn: state.phase === 'bidding' ? state.bidTurn : -1,
    preneur: state.preneur,
    calledCard: state.calledCard,
    partner: state.partnerRevealed && state.partner >= 0 && state.partner !== state.preneur ? state.partner : null,
    chien: state.phase === 'ecart' ? state.chien : null,
    chienSize: state.chienSize,
    ecart: isPreneur && state.phase === 'ecart' ? state.ecart : null,
    ecartAtouts: state.phase !== 'ecart' ? state.ecart.filter((c) => c.t === 'a') : [],
    ecartNeeded: state.phase === 'ecart' ? state.chienSize - state.ecart.length : 0,
    trick: state.trick,
    lastTrick: state.lastTrick,
    current: state.phase === 'play' ? state.current : -1,
    tricksPlayed: state.tricksPlayed,
    totalTricks: state.totalTricks,
    poignees: state.poignees,
    myPoignee: canAnnouncePoignee(state, seat) ? poigneeLevel(state.seats, state.hands[seat] ?? []) : null,
    scores: state.scores,
    roundOver: state.roundOver,
    result: state.result,
    history: state.history,
    lastEvent: state.lastEvent,
    legal,
  };
}

// ---------- information cachée ----------

/**
 * Un monde possible pour `seat`, compatible avec tout ce que ce siège a vu, et avec rien
 * d'autre :
 *
 *  - sa main et les cartes tombées sont fixes ;
 *  - le chien montré reste chez le preneur (ses Rois et ses bouts ne peuvent pas être à
 *    l'écart ; ses atouts n'y sont que s'ils ont été montrés) ou dans l'écart ;
 *  - l'écart que le siège n'a pas fait ne contient ni Roi, ni bout, ni d'autre atout que
 *    ceux montrés ; le chien fermé (Garde sans, Garde contre) peut contenir n'importe quoi ;
 *  - chaque main respecte les renonces observées ;
 *  - à cinq, le partenaire n'est connu que si la carte appelée est tombée, si elle était
 *    dans le chien montré, ou si ce siège la tient — sinon il suit la carte dans ce monde.
 */
export function determinize(state: TarotState, seat: number, rng: Rng): TarotState {
  const known = new Set<string>();
  for (const c of state.played) known.add(cardKey(c));
  for (const t of state.trick) known.add(cardKey(t.card));
  for (const c of state.hands[seat] ?? []) known.add(cardKey(c));

  const preneur = state.preneur;
  const chienPris = state.bestBid >= 1 && state.bestBid <= LAST_BID_WITH_CHIEN && state.phase !== 'bidding' && state.phase !== 'callKing';
  const others = [...Array(state.seats).keys()].filter((i) => i !== seat);
  const fixed: Card[][] = state.hands.map(() => []);
  const fixedPile: Card[] = [];
  const fix = (target: Card[], c: Card): void => {
    known.add(cardKey(c));
    target.push(c);
  };

  // La pile cachée : rien à tirer si ce siège la connaît (le preneur, une fois le chien pris).
  let pileSize = 0;
  let pileAdmet: (c: Card) => boolean = () => true;
  const chienMontre = new Set<string>();
  if (chienPris && seat === preneur) {
    for (const c of state.ecart) known.add(cardKey(c)); // son écart, il l'a fait
  } else if (!chienPris) {
    pileSize = state.chien.length; // chien fermé : enchères, appel, Garde sans, Garde contre
  } else if (seat !== preneur) {
    const montres = new Set(state.phase === 'ecart' ? [] : state.ecart.filter((c) => c.t === 'a').map(cardKey));
    for (const c of state.chien) {
      if (known.has(cardKey(c))) continue;
      if (montres.has(cardKey(c))) fix(fixedPile, c);
      else if (ecartForbidden(c) || (c.t === 'a' && state.phase !== 'ecart')) fix(fixed[preneur] as Card[], c);
      else chienMontre.add(cardKey(c)); // chez le preneur, ou dans son écart
    }
    for (const c of state.ecart) if (montres.has(cardKey(c)) && !known.has(cardKey(c))) fix(fixedPile, c);
    pileSize = state.ecart.length - fixedPile.length;
    // Pendant l'écart, un atout peut encore y aller (main sans autre choix) ; après, tous ceux
    // qui y sont ont été montrés.
    pileAdmet = state.phase === 'ecart' ? (c) => !ecartForbidden(c) : (c) => c.t === 'c' && !isKing(c);
  }

  // Une poignée présentée est publique : ses cartes encore en main restent chez leur détenteur.
  for (const p of state.poignees) {
    if (p.seat === seat) continue;
    for (const c of p.cards) if (!known.has(cardKey(c))) fix(fixed[p.seat] as Card[], c);
  }

  const pool = buildDeck().filter((c) => !known.has(cardKey(c)));
  const pile = others.length;
  const contenances = [...others.map((i) => (state.hands[i]?.length ?? 0) - (fixed[i] as Card[]).length), pileSize];
  const admis = (place: number, c: Card): boolean => {
    if (chienMontre.has(cardKey(c)) && place !== pile && others[place] !== preneur) return false;
    if (place === pile) return pileAdmet(c);
    const voids = state.voids[others[place] as number] ?? [];
    return c.t === 'e' || (c.t === 'a' ? !voids.includes('A') : !voids.includes(c.suit));
  };
  const placed = repartir(pool, contenances, admis, rng) ?? (repartir(pool, contenances, () => true, rng) as Card[][]);

  const hands: Card[][] = state.hands.map((h, i) => (i === seat ? [...h] : []));
  others.forEach((i, k) => {
    hands[i] = sortHand([...(fixed[i] as Card[]), ...(placed[k] as Card[])]);
  });
  const tiree = [...fixedPile, ...(placed[pile] as Card[])];
  const chien = chienPris ? [...state.chien] : tiree;
  const ecart = chienPris && seat !== preneur ? tiree : [...state.ecart];

  // À cinq, le partenaire suit la carte appelée dans ce monde, sauf si ce siège le connaît.
  let partner = state.partner;
  const called = state.calledCard;
  if (called) {
    const connu = has(state.hands[seat] ?? [], called) || has(state.played, called) || state.trick.some((t) => sameCard(t.card, called))
      || (chienPris && has(state.chien, called));
    if (!connu) {
      partner = preneur;
      hands.forEach((h, i) => {
        if (has(h, called)) partner = i;
      });
    }
  }
  return { ...state, hands, chien, ecart, partner };
}

// ---------- évaluation ----------

export function evaluate(state: TarotState, seat: number): number {
  if (state.roundOver && state.result) {
    const delta = state.result.deltas[seat] ?? 0;
    return 0.5 + 0.5 * Math.tanh(delta / 150);
  }
  if (state.phase === 'bidding' || state.preneur < 0) return 0.5;
  // En cours de donne : points de l'attaque projetés contre l'objectif courant.
  let attack = 0;
  let defense = 0;
  let bouts = 0;
  state.won.forEach((cards, i) => {
    const pts = cards.reduce((s, c) => s + cardPoints(c), 0);
    if (teamOf(state, i) === 'A') {
      attack += pts;
      bouts += cards.filter(isBout).length;
    } else defense += pts;
  });
  if (state.bestBid <= LAST_BID_WITH_CHIEN) {
    attack += state.ecart.reduce((s, c) => s + cardPoints(c), 0);
    bouts += state.ecart.filter(isBout).length;
  }
  const remaining = 91 - attack - defense - (state.bestBid <= LAST_BID_WITH_CHIEN ? state.ecart.reduce((s, c) => s + cardPoints(c), 0) : 0);
  const share = attack + defense > 0 ? attack / (attack + defense) : 0.5;
  const projected = attack + Math.max(0, remaining) * share;
  const target = TARGETS[Math.min(bouts, 3)] as number;
  const v = 0.5 + 0.5 * Math.tanh((projected - target) / 15);
  return teamOf(state, seat) === 'A' ? v : 1 - v;
}

// ---------- le bot du jeu d'origine ----------

/** Carte maîtresse : plus aucune carte supérieure du même groupe en circulation. */
function isMaster(state: TarotState, hand: readonly Card[], card: Card): boolean {
  if (card.t === 'e') return false;
  const seen = (rank: number, suit: Suit | null, t: 'a' | 'c'): boolean => {
    const match = (c: Card): boolean => c.t === t && c.rank === rank && (t === 'a' || (c as { suit: Suit }).suit === suit);
    return state.played.some(match) || state.trick.some((x) => match(x.card)) || hand.some(match);
  };
  if (card.t === 'a') {
    for (let r = card.rank + 1; r <= 21; r++) if (!seen(r, null, 'a')) return false;
    return true;
  }
  for (let r = card.rank + 1; r <= 14; r++) if (!seen(r, card.suit, 'c')) return false;
  return true;
}

function wouldWin(state: TarotState, card: Card): boolean {
  if (card.t === 'e') return false;
  const led = ledCard(state.trick) ?? card;
  const bestAtout = highestAtout(state.trick);
  if (card.t === 'a') return card.rank > bestAtout;
  if (bestAtout > 0) return false;
  if (led.t === 'c' && card.suit === led.suit) {
    let best = -1;
    for (const t of state.trick) if (t.card.t === 'c' && t.card.suit === led.suit && t.card.rank > best) best = t.card.rank;
    return card.rank > best;
  }
  return false;
}

function botBid(state: TarotState, seat: number): Move {
  const hand = state.hands[seat] ?? [];
  const atouts = hand.filter((c) => c.t === 'a').length;
  const bouts = hand.filter(isBout).length;
  const rois = hand.filter(isKing).length;
  const gros = hand.filter((c) => c.t === 'a' && c.rank >= 16).length;
  const strength = atouts + bouts * 4 + rois * 2 + gros + (state.seats === 5 ? 2 : 0);
  let wish: Bid = 0;
  if (strength >= 26) wish = 4;
  else if (strength >= 20) wish = 3;
  else if (strength >= 17) wish = 2;
  else if (strength >= 15) wish = 1;
  return { type: 'bid', bid: wish > state.bestBid ? wish : 0 };
}

function botCall(state: TarotState, seat: number, rng: Rng): Move {
  const hand = state.hands[seat] ?? [];
  const value = callValueFor(hand);
  let bestSuit: Suit | null = null;
  let bestLen = -1;
  for (const suit of SUITS) {
    if (hand.some((c) => c.t === 'c' && c.suit === suit && c.value === value)) continue;
    const len = hand.filter((c) => c.t === 'c' && c.suit === suit).length;
    if (len > bestLen) {
      bestLen = len;
      bestSuit = suit;
    }
  }
  return { type: 'call', suit: bestSuit ?? (SUITS[rng.int(4)] as Suit), value };
}

function botDiscard(state: TarotState, legal: readonly Move[]): Move {
  const cards = legal.flatMap((m) => (m.type === 'discard' ? [m.card] : []));
  const normal = cards.filter((c) => c.t !== 'a');
  const pool = normal.length ? normal : cards;
  const sorted = [...pool].sort((a, b) => (cardPoints(a) - cardPoints(b)) || ((a.t === 'c' ? a.rank : (a as { rank: number }).rank) - (b.t === 'c' ? b.rank : (b as { rank: number }).rank)));
  return { type: 'discard', card: sorted[0] as Card };
}

function botPlay(state: TarotState, seat: number, legalMovesList: readonly Move[]): Move {
  const hand = state.hands[seat] ?? [];
  const legal = legalMovesList.flatMap((m) => (m.type === 'play' ? [m.card] : []));
  const isLastToPlay = state.trick.length === state.seats - 1;
  const tricksRemaining = state.totalTricks - state.tricksPlayed;
  const trickPts = state.trick.reduce((s, t) => s + cardPoints(t.card), 0);
  const rank = (c: Card): number => (c.t === 'e' ? 0 : c.rank);
  let choice: Card | null = null;

  // 1. L'Excuse perdue au dernier pli : on la joue au plus tard à l'avant-dernier.
  const excuse = legal.find((c) => c.t === 'e') ?? null;
  if (excuse && tricksRemaining === 2) choice = excuse;

  const safe = legal.filter((c) => c.t !== 'e' && !(c.t === 'a' && c.rank === 1));
  const noExcuse = legal.filter((c) => c.t !== 'e');
  const pool = safe.length ? safe : noExcuse.length ? noExcuse : legal;

  if (!choice && state.trick.length === 0) {
    // 2. Entame : une maîtresse à points, sinon une petite carte de sa couleur longue.
    const masters = pool.filter((c) => c.t === 'c' && isMaster(state, hand, c));
    if (masters.length) {
      masters.sort((a, b) => cardPoints(b) - cardPoints(a));
      choice = masters[0] as Card;
    } else {
      const suitCards = pool.filter((c) => c.t === 'c');
      if (suitCards.length) {
        const len: Record<string, number> = {};
        for (const c of hand) if (c.t === 'c') len[c.suit] = (len[c.suit] ?? 0) + 1;
        suitCards.sort((a, b) => ((len[(b as { suit: Suit }).suit] ?? 0) - (len[(a as { suit: Suit }).suit] ?? 0)) || (rank(a) - rank(b)));
        choice = suitCards[0] as Card;
      } else {
        choice = [...pool].sort((a, b) => rank(a) - rank(b))[0] as Card;
      }
    }
  }

  if (!choice) {
    // 3. En cours de pli.
    const winners = pool.filter((c) => wouldWin(state, c));
    const masterWinners = winners.filter((c) => isMaster(state, hand, c));
    if (isLastToPlay && winners.length && trickPts >= 2) {
      winners.sort((a, b) => (rank(a) - rank(b)) || (cardPoints(a) - cardPoints(b)));
      choice = winners[0] as Card;
    } else if (masterWinners.length && trickPts >= 3) {
      masterWinners.sort((a, b) => cardPoints(a) - cardPoints(b));
      choice = masterWinners[0] as Card;
    }
    if (!choice) {
      // 4. Se défausser au plus bas ; sacrifier l'Excuse plutôt qu'une figure sur un gros pli.
      const dumps = [...pool].sort((a, b) => (cardPoints(a) - cardPoints(b)) || (rank(a) - rank(b)));
      const cheapest = dumps[0] as Card;
      choice = excuse && cardPoints(cheapest) >= 1.5 && trickPts >= 3 && tricksRemaining > 2 ? excuse : cheapest;
    }
  }
  return { type: 'play', card: choice };
}

/** La stratégie du jeu d'origine, pour toutes les décisions : le socle l'utilise telle quelle. */
export function botMove(state: TarotState, seat: number, legal: readonly Move[], rng: Rng, level: BotLevel = 'normal'): Move | null {
  if (legal.length === 0) return null;
  switch (state.phase) {
    case 'bidding': return botBid(state, seat);
    case 'callKing': return botCall(state, seat, rng);
    case 'ecart': return botDiscard(state, legal);
    case 'play': {
      if (legal.some((m) => m.type === 'poignee')) return { type: 'poignee' }; // annonce automatique
      // Au niveau facile, le bot enchérit et écarte avec bon sens, mais joue une fois sur deux
      // une carte permise au hasard : il gâche des points et des plis, sans jamais tricher.
      const cartes = legal.filter((m) => m.type === 'play');
      if (level === 'facile' && cartes.length > 1 && rng.int(2) === 0) return cartes[rng.int(cartes.length)] as Move;
      return botPlay(state, seat, legal);
    }
    case 'over': return null;
  }
}

export function rolloutMove(state: TarotState, seat: number, legal: readonly Move[], rng: Rng): Move {
  return botMove(state, seat, legal, rng) ?? (legal[rng.int(legal.length)] as Move);
}

// ---------- bilan, succès, textes ----------

export function roundSummary(state: TarotState): RoundSummary {
  const r = state.result;
  return {
    perSeat: state.scores.map((total, i) => ({ roundPoints: r?.deltas[i] ?? 0, total, detail: r ? { role: i === r.preneur ? 'preneur' : i === r.partner ? 'partenaire' : 'defense' } : null })),
    roundWinner: r ? (r.won ? r.preneur : null) : null,
    label: r ? `${BID_LABELS[r.bid]} — {${r.preneur}}${r.partner !== null && r.partner !== r.preneur ? ` & {${r.partner}}` : ''}` : undefined,
  };
}

export function achievements(state: TarotState, seat: number, ctx: AchievementContext): string[] {
  const out: string[] = [];
  const r = state.result;
  if (r) {
    const attaque = seat === r.preneur || seat === r.partner;
    if (seat === r.preneur && r.won && r.bid >= 4) out.push('garde-sans-filet');
    if (attaque && r.won && r.bouts === 3) out.push('trois-bouts');
    if (r.petitAuBout !== 0 && (r.petitAuBout > 0) === attaque) out.push('petit-au-bout');
    if (state.poignees.some((p) => p.seat === seat && p.count >= 13)) out.push('grande-poignee');
    if (!attaque && !r.won && r.bid >= 3) out.push('defense-de-fer');
  }
  if (ctx.matchOver && ctx.wonMatch) out.push('maitre-du-tarot');
  return out;
}

export const PHRASES: readonly string[] = [
  'bien-joue', 'joli-pli', 'a-toi', 'pas-de-chance', 'je-reflechis', 'on-y-va',
  'je-prends', 'je-passe', 'coupe', 'le-petit', 'excuse', 'au-revoir',
];

export const META: GameMeta = { id: 'tarot', nameKey: 'games.tarot.name', seatCounts: [4, 5], status: 'available' };

export const tarot: GameDefinition<TarotState, Move, TarotView> = {
  id: 'tarot',
  seatCounts: [4, 5],
  timings: { botDelay: 1300, forcedDelay: 1500, afkTimeout: 150_000 },
  createRound,
  currentSeat,
  legalMoves,
  forcedMove,
  applyMove,
  moveKey,
  isRoundOver: (s) => s.roundOver,
  isMatchOver,
  scores: (s) => [...s.scores],
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
