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

/**
 * Répartit des objets entre des places de contenances données, chaque objet n'allant que
 * sur une place qui l'admet. C'est le cœur de `determinize` : tirer un monde possible où
 * chaque main respecte ce qui a été observé (« ce joueur n'a plus de pique »).
 *
 * À chaque pas, on pose l'objet qui a le moins de places encore ouvertes (à égalité, au
 * hasard), sur une place tirée parmi celles-ci au prorata de ce qu'il leur reste ; une
 * impasse fait recommencer avec un autre tirage. Un remplissage main par main, plus simple,
 * prenait à une main les seules cartes qu'une autre pouvait recevoir, et violait les
 * renonces alors qu'un monde valide existait.
 *
 * La somme des contenances doit égaler le nombre d'objets. Renvoie null si aucune
 * répartition n'a été trouvée en `essais` tirages.
 */
export function repartir<T>(objets: readonly T[], contenances: readonly number[], admis: (place: number, objet: T) => boolean, rng: Rng, essais = 60): T[][] | null {
  if (contenances.reduce((s, c) => s + c, 0) !== objets.length) throw new RangeError('contenances et objets ne correspondent pas');
  const options = objets.map((o) => contenances.flatMap((c, i) => (c > 0 && admis(i, o) ? [i] : [])));
  for (let e = 0; e < essais; e++) {
    const reste = [...contenances];
    const places: T[][] = contenances.map(() => []);
    // L'ordre mélangé départage au hasard les objets également contraints.
    let restants = shuffle(objets.map((_, k) => k), rng);
    let impasse = false;
    while (restants.length > 0) {
      let meilleur = -1;
      let libresMeilleur: number[] = [];
      for (let j = 0; j < restants.length; j++) {
        const libres = (options[restants[j] as number] as number[]).filter((i) => (reste[i] as number) > 0);
        if (meilleur === -1 || libres.length < libresMeilleur.length) {
          meilleur = j;
          libresMeilleur = libres;
          if (libres.length <= 1) break;
        }
      }
      if (libresMeilleur.length === 0) {
        impasse = true;
        break;
      }
      const k = restants[meilleur] as number;
      restants = [...restants.slice(0, meilleur), ...restants.slice(meilleur + 1)];
      let r = rng.int(libresMeilleur.reduce((s, i) => s + (reste[i] as number), 0));
      let choisie = libresMeilleur[0] as number;
      for (const i of libresMeilleur) {
        if (r < (reste[i] as number)) {
          choisie = i;
          break;
        }
        r -= reste[i] as number;
      }
      (places[choisie] as T[]).push(objets[k] as T);
      reste[choisie] = (reste[choisie] as number) - 1;
    }
    if (!impasse) return places;
  }
  return null;
}
