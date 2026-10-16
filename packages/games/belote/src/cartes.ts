/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/** Le jeu de 32 cartes de la belote : 7, 8, 9, 10, Valet, Dame, Roi, As dans quatre couleurs. */

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export type Suit = (typeof SUITS)[number];
export const VALUES = ['7', '8', '9', '10', 'V', 'D', 'R', 'A'] as const;
export type Value = (typeof VALUES)[number];

export interface Card {
  readonly suit: Suit;
  readonly value: Value;
}

/** Ordre et points hors atout : A 11, 10 10, R 4, D 3, V 2, 9 8 7 rien. */
const PLAIN_ORDER: readonly Value[] = ['7', '8', '9', 'V', 'D', 'R', '10', 'A'];
const PLAIN_POINTS: Record<Value, number> = { '7': 0, '8': 0, '9': 0, '10': 10, V: 2, D: 3, R: 4, A: 11 };
/** Ordre et points à l'atout : V 20, 9 14, A 11, 10 10, R 4, D 3, 8 7 rien. */
const TRUMP_ORDER: readonly Value[] = ['7', '8', 'D', 'R', '10', 'A', '9', 'V'];
const TRUMP_POINTS: Record<Value, number> = { '7': 0, '8': 0, '9': 14, '10': 10, V: 20, D: 3, R: 4, A: 11 };

export function cardPoints(c: Card, trump: Suit): number {
  return c.suit === trump ? TRUMP_POINTS[c.value] : PLAIN_POINTS[c.value];
}

/** Force d'une carte dans sa couleur (plus grand = plus fort), selon qu'elle est atout ou non. */
export function cardStrength(c: Card, trump: Suit): number {
  return (c.suit === trump ? TRUMP_ORDER : PLAIN_ORDER).indexOf(c.value);
}

/** Rang naturel (7 < 8 < … < A), pour les suites des annonces et le tri d'une main sans atout. */
export function naturalRank(v: Value): number {
  return VALUES.indexOf(v);
}

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.value === b.value;
}

export function cardKey(c: Card): string {
  return `${c.value}${c.suit}`;
}

export function parseCardKey(key: string): Card | null {
  const suit = key.slice(-1) as Suit;
  const value = key.slice(0, -1) as Value;
  if (!SUITS.includes(suit) || !VALUES.includes(value)) return null;
  return { suit, value };
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const value of VALUES) deck.push({ suit, value });
  return deck;
}

/** Tri d'une main : couleurs alternées, l'atout d'abord s'il est connu, cartes fortes à droite. */
export function sortHand(hand: readonly Card[], trump: Suit | null): Card[] {
  const suitOrder = trump ? [trump, ...SUITS.filter((s) => s !== trump)] : [...SUITS];
  return [...hand].sort((a, b) => {
    const sa = suitOrder.indexOf(a.suit);
    const sb = suitOrder.indexOf(b.suit);
    if (sa !== sb) return sa - sb;
    const ra = trump ? cardStrength(a, trump) : naturalRank(a.value);
    const rb = trump ? cardStrength(b, trump) : naturalRank(b.value);
    return ra - rb;
  });
}
