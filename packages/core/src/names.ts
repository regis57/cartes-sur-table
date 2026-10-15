/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { cryptoRng, shuffle, type Rng } from './rng.ts';

/**
 * Prénoms des bots : prénoms du calendrier français, en nombre égal côté féminin et
 * côté masculin pour garantir la parité. Les prénoms mixtes sont volontairement exclus.
 */
export const FEMALE_NAMES: readonly string[] = [
  'Agathe', 'Agnès', 'Alice', 'Amélie', 'Anne', 'Béatrice', 'Bernadette', 'Brigitte',
  'Camille', 'Catherine', 'Cécile', 'Charlotte', 'Chloé', 'Christine', 'Claire', 'Clémence',
  'Colette', 'Édith', 'Éléonore', 'Élisabeth', 'Émilie', 'Florence', 'Françoise', 'Geneviève',
  'Hélène', 'Isabelle', 'Jeanne', 'Joséphine', 'Juliette', 'Laure', 'Louise', 'Lucie',
  'Madeleine', 'Marguerite', 'Marie', 'Mathilde', 'Pauline', 'Sophie', 'Sylvie', 'Thérèse',
];

export const MALE_NAMES: readonly string[] = [
  'Adrien', 'Alain', 'Alexandre', 'André', 'Antoine', 'Arnaud', 'Augustin', 'Bernard',
  'Bruno', 'Charles', 'Christophe', 'Clément', 'Damien', 'Daniel', 'Denis', 'Édouard',
  'Émile', 'Étienne', 'Fabien', 'Félix', 'François', 'Frédéric', 'Gabriel', 'Gilles',
  'Guillaume', 'Henri', 'Jacques', 'Jean', 'Joseph', 'Julien', 'Laurent', 'Louis',
  'Marc', 'Martin', 'Mathieu', 'Michel', 'Nicolas', 'Paul', 'Philippe', 'Vincent',
];

/**
 * Tire `count` prénoms distincts en alternant féminin / masculin : l'écart entre les deux
 * ne dépasse jamais 1, et le côté qui a le « surplus » est tiré au hasard.
 * `exclude` : prénoms à éviter (les pseudos des humains), comparés sans casse.
 */
export function pickBotNames(count: number, exclude: readonly string[] = [], rng: Rng = cryptoRng): string[] {
  const banned = new Set(exclude.map((n) => n.toLowerCase()));
  const pools = [
    shuffle(FEMALE_NAMES, rng).filter((n) => !banned.has(n.toLowerCase())),
    shuffle(MALE_NAMES, rng).filter((n) => !banned.has(n.toLowerCase())),
  ];
  let turn = rng.int(2);
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = pools[turn]?.pop();
    if (name !== undefined) picked.push(name);
    turn = 1 - turn;
  }
  return shuffle(picked, rng);
}
