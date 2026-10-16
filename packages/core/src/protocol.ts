/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import type { RoundSummary } from './contract.ts';
import type { PublicSeat, SeatView } from './table.ts';

/**
 * Le protocole entre le navigateur et le serveur, par espace de noms `/jeu/<id>`.
 * Partagé par le serveur et le client : une faute de frappe ne compile pas.
 *
 * Règle : tout ce qui vient du client est `unknown` côté serveur et revalidé ;
 * tout ce qui part du serveur est typé pour le client.
 */

export interface Identity {
  /** Ignoré si la connexion porte un jeton de profil. */
  name?: string;
  avatar?: number;
}

/** Client → serveur. Le serveur ne fait confiance à aucun de ces champs. */
export interface ClientToServer {
  solo: (data: Identity & { level?: 'facile' | 'normal'; seats?: number }) => void;
  joinQueue: (data: Identity) => void;
  leaveQueue: () => void;
  forceStart: () => void;
  createPrivate: (data: Identity & { seats?: number }) => void;
  joinPrivate: (data: Identity & { code: string }) => void;
  leavePrivate: () => void;
  startPrivate: () => void;
  move: (data: { tableId: string; key: string }) => void;
  nextRound: (data: { tableId: string }) => void;
  restart: (data: { tableId: string }) => void;
  emote: (data: { tableId: string; kind: 'phrase' | 'emoji'; code: string }) => void;
  rejoin: (data: { tableId: string; rejoinKey: string }) => void;
  quit: (data: { tableId: string }) => void;
}

export interface RoundEndPayload {
  tableId: string;
  round: number;
  summary: RoundSummary;
  seats: PublicSeat[];
  matchOver: boolean;
  winner: number | null;
  /** Tous les vainqueurs (plusieurs dans un jeu par équipes). */
  winners: number[];
  achievements: string[][];
}

/** Serveur → client. */
export interface ServerToClient<V = unknown> {
  state: (view: SeatView<V>) => void;
  tableStarted: (data: { tableId: string }) => void;
  roundEnd: (data: RoundEndPayload) => void;
  seats: (data: { tableId: string; seats: PublicSeat[] }) => void;
  emote: (data: { tableId: string; seat: number; kind: 'phrase' | 'emoji'; code: string }) => void;
  afk: (data: { tableId: string; reason: 'afk' }) => void;
  forced: (data: { tableId: string; moveKey: string }) => void;
  tableClosed: (data: { tableId: string }) => void;
  seat: (data: { tableId: string; seat: number; rejoinKey: string | null }) => void;
  queueStatus: (data: { players: { name: string; avatar: number }[]; countdown: number }) => void;
  privateStatus: (data: { code: string; seats: number; isHost: boolean; players: { name: string; avatar: number }[] }) => void;
  privateDissolved: (data: { code: string }) => void;
  serverBusy: () => void;
  achievements: (data: { codes: string[] }) => void;
  error: (data: { code: 'code-invalide' | 'table-introuvable' | 'reprise-impossible' }) => void;
}
