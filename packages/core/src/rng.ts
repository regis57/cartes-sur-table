/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { randomInt } from 'node:crypto';

/**
 * Source d'aléa injectable. Les règles de jeu n'appellent jamais `Math.random` :
 * elles reçoivent un `Rng`, ce qui rend chaque partie rejouable dans les tests
 * et permet aux bots de simuler des milliers de fois sans consommer l'aléa
 * cryptographique.
 */
export interface Rng {
  /** Entier uniforme dans [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Aléa cryptographique : le seul utilisé pour les vraies parties (mélange, donneur). */
export const cryptoRng: Rng = {
  int(maxExclusive) {
    return randomInt(maxExclusive);
  },
};

/**
 * Générateur déterministe (xoshiro128**) pour les tests et les simulations des bots.
 * Rapide, reproductible, et sans aucune prétention cryptographique — il ne sert jamais
 * à distribuer les cartes d'une vraie partie.
 */
export function seededRng(seed: number): Rng {
  let s0 = seed >>> 0 || 0x9e3779b9;
  let s1 = (seed * 0x85ebca6b) >>> 0 || 0x243f6a88;
  let s2 = (seed * 0xc2b2ae35) >>> 0 || 0xb7e15162;
  let s3 = (seed * 0x27d4eb2f) >>> 0 || 0x6a09e667;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const next = (): number => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0);
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };
  return {
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError('maxExclusive invalide');
      // Rejet pour une distribution uniforme sans biais modulo.
      const limit = 0x100000000 - (0x100000000 % maxExclusive);
      let v = next();
      while (v >= limit) v = next();
      return v % maxExclusive;
    },
  };
}

/** Mélange de Fisher-Yates ; renvoie une copie, n'altère pas l'entrée. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const ai = a[i] as T;
    a[i] = a[j] as T;
    a[j] = ai;
  }
  return a;
}
