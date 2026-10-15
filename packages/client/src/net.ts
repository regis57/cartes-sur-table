/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */
import type { Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@jdc/core/protocol.ts';

export type GameSocket<V> = Socket<ServerToClient<V>, ClientToServer>;

/**
 * Le client Socket.io est servi par le serveur lui-même, à la même origine (CSP stricte,
 * aucun CDN). Le chemin est une variable pour que TypeScript le laisse au navigateur ;
 * les types viennent du paquet de développement `socket.io-client`, identique.
 */
const SOCKET_IO_CLIENT = '/socket.io/socket.io.esm.min.js';

/** Connexion à l'espace de noms d'un jeu, avec le jeton de profil s'il y en a un (jamais dans l'URL). */
export async function connectGame<V>(gameId: string, token: string | null): Promise<GameSocket<V>> {
  const mod = (await import(SOCKET_IO_CLIENT)) as typeof import('socket.io-client');
  return mod.io(`/jeu/${gameId}`, {
    transports: ['websocket', 'polling'],
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionAttempts: 5,
  }) as unknown as GameSocket<V>;
}

const KEY = 'jdc.siege';

export interface SavedSeat {
  gameId: string;
  tableId: string;
  rejoinKey: string;
}

export function saveSeat(s: SavedSeat | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : la reprise après rechargement ne sera pas proposée */
  }
}

export function loadSeat(gameId: string): SavedSeat | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s: unknown = JSON.parse(raw);
    if (s && typeof s === 'object' && (s as SavedSeat).gameId === gameId && typeof (s as SavedSeat).tableId === 'string' && typeof (s as SavedSeat).rejoinKey === 'string') {
      return s as SavedSeat;
    }
  } catch {
    /* valeur illisible */
  }
  return null;
}
