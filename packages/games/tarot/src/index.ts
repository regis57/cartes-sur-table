/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
export * from './cartes.ts';
export * from './rules.ts';
import type { RegisteredGame } from '@jdc/core';
import { tarot, META } from './rules.ts';
export const game: RegisteredGame = { meta: META, def: tarot as unknown as RegisteredGame['def'] };
