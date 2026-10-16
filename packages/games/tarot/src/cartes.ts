/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/**
 * Les 78 cartes du tarot français et leur valeur en points. Les règles et les valeurs
 * sont celles du jeu d'origine (regis57/tarot-francais-enligne), reprises à l'identique.
 */

export const SUITS = ['♠', '♥', '♣', '♦'] as const;
export type Suit = (typeof SUITS)[number];
export const SUIT_VALUES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'C', 'D', 'R'] as const;
export type SuitValue = (typeof SUIT_VALUES)[number];

/** Une carte : couleur (`c`), atout (`a`) ou Excuse (`e`). `rank` ordonne les cartes d'un même groupe. */
export type Card =
  | { readonly t: 'c'; readonly suit: Suit; readonly value: SuitValue; readonly rank: number }
  | { readonly t: 'a'; readonly rank: number }
  | { readonly t: 'e' };

export function cardPoints(c: Card): number {
  if (c.t === 'e') return 4.5;
  if (c.t === 'a') return c.rank === 1 || c.rank === 21 ? 4.5 : 0.5;
  switch (c.value) {
    case 'R': return 4.5;
    case 'D': return 3.5;
    case 'C': return 2.5;
    case 'V': return 1.5;
    default: return 0.5;
  }
}

export function isBout(c: Card): boolean {
  return c.t === 'e' || (c.t === 'a' && (c.rank === 1 || c.rank === 21));
}

export function isKing(c: Card): boolean {
  return c.t === 'c' && c.value === 'R';
}

export function sameCard(a: Card, b: Card): boolean {
  if (a.t !== b.t) return false;
  if (a.t === 'e') return true;
  if (a.t === 'a') return a.rank === (b as { rank: number }).rank;
  const bb = b as Extract<Card, { t: 'c' }>;
  return a.suit === bb.suit && a.value === bb.value;
}

/** Clé stable et lisible : « R♠ », « A17 », « EXC ». */
export function cardKey(c: Card): string {
  if (c.t === 'e') return 'EXC';
  if (c.t === 'a') return `A${c.rank}`;
  return `${c.value}${c.suit}`;
}

export function parseCardKey(key: string): Card | null {
  if (key === 'EXC') return { t: 'e' };
  const atout = /^A(\d{1,2})$/.exec(key);
  if (atout) {
    const rank = Number(atout[1]);
    return rank >= 1 && rank <= 21 ? { t: 'a', rank } : null;
  }
  const suit = key.slice(-1) as Suit;
  const value = key.slice(0, -1) as SuitValue;
  const rank = SUIT_VALUES.indexOf(value) + 1;
  if (!SUITS.includes(suit) || rank === 0) return null;
  return { t: 'c', suit, value, rank };
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) SUIT_VALUES.forEach((value, i) => deck.push({ t: 'c', suit, value, rank: i + 1 }));
  for (let rank = 1; rank <= 21; rank++) deck.push({ t: 'a', rank });
  deck.push({ t: 'e' });
  return deck;
}

const SUIT_ORDER: Record<Suit, number> = { '♠': 0, '♥': 1, '♣': 2, '♦': 3 };

/** Tri d'une main : couleurs (♠ ♥ ♣ ♦, par rang), puis atouts, puis l'Excuse. */
export function sortHand(hand: readonly Card[]): Card[] {
  const group = (c: Card): number => (c.t === 'c' ? 0 : c.t === 'a' ? 1 : 2);
  return [...hand].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (a.t === 'c' && b.t === 'c') {
      if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
      return a.rank - b.rank;
    }
    if (a.t === 'a' && b.t === 'a') return a.rank - b.rank;
    return 0;
  });
}

export function suitName(s: Suit): string {
  switch (s) {
    case '♠': return 'pique';
    case '♥': return 'cœur';
    case '♣': return 'trèfle';
    case '♦': return 'carreau';
  }
}
