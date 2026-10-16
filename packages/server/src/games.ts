/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import type { GameMeta, RegisteredGame } from '@jdc/core';
import { game as huitAmericain } from '@jdc/huit-americain';
import { game as tarot } from '@jdc/tarot';

/** Les jeux servis par cette instance. Ajouter un jeu = l'importer ici. */
export const GAMES: readonly RegisteredGame[] = [huitAmericain, tarot];

/** Jeux annoncés mais pas encore jouables : affichés « bientôt » sur l'accueil. */
export const SOON: readonly GameMeta[] = [
  { id: 'belote', nameKey: 'games.belote.name', seatCounts: [4], status: 'soon' },
];

export function findGame(id: string): RegisteredGame | undefined {
  return GAMES.find((g) => g.meta.id === id);
}
