/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { randomInt } from 'node:crypto';
import { INVITE_ALPHABET } from './security.ts';

/** Un humain qui attend une table. */
export interface LobbyEntry {
  humanId: string;
  name: string;
  avatar: number;
  profileId: string | null;
}

export interface MatchmakingCallbacks {
  /** Assez de joueurs, ou compte à rebours écoulé : lancer une table avec ces humains. */
  launch(entries: LobbyEntry[]): void;
  /** État de l'attente à diffuser aux joueurs en file. */
  status(entries: LobbyEntry[], countdown: number): void;
}

/**
 * File d'attente publique d'un jeu : les joueurs s'y rangent, un compte à rebours
 * démarre au premier arrivé, et la table part dès que les sièges sont pleins ou que le
 * temps est écoulé (les sièges vides sont alors pris par des bots).
 */
export class Matchmaking {
  private queue: LobbyEntry[] = [];
  private countdown: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly seats: number;
  private readonly countdownSeconds: number;
  private readonly cb: MatchmakingCallbacks;

  constructor(seats: number, countdownSeconds: number, cb: MatchmakingCallbacks) {
    this.seats = seats;
    this.countdownSeconds = countdownSeconds;
    this.cb = cb;
    this.countdown = countdownSeconds;
  }

  get size(): number {
    return this.queue.length;
  }

  has(humanId: string): boolean {
    return this.queue.some((e) => e.humanId === humanId);
  }

  join(entry: LobbyEntry): void {
    if (this.has(entry.humanId)) return;
    this.queue.push(entry);
    if (this.queue.length === 1) this.startCountdown();
    else this.broadcast();
    if (this.queue.length >= this.seats) this.launch();
  }

  leave(humanId: string): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((e) => e.humanId !== humanId);
    if (this.queue.length === before) return;
    if (this.queue.length === 0) this.stopCountdown();
    else this.broadcast();
  }

  /** Un joueur en file demande à partir tout de suite, avec des bots. */
  forceStart(humanId: string): void {
    if (this.has(humanId)) this.launch();
  }

  close(): void {
    this.stopCountdown();
    this.queue = [];
  }

  private broadcast(): void {
    this.cb.status([...this.queue], this.countdown);
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdown = this.countdownSeconds;
    this.timer = setInterval(() => {
      this.countdown -= 1;
      this.broadcast();
      if (this.countdown <= 0) this.launch();
    }, 1000);
    this.timer.unref();
    this.broadcast();
  }

  private stopCountdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private launch(): void {
    this.stopCountdown();
    const batch = this.queue.splice(0, this.seats);
    if (batch.length === 0) return;
    this.cb.launch(batch);
    if (this.queue.length > 0) this.startCountdown();
  }
}

/** Une table privée en attente : un code d'invitation, un hôte, des invités. */
export interface PendingPrivateTable {
  code: string;
  gameId: string;
  seats: number;
  hostId: string;
  entries: LobbyEntry[];
  createdAt: number;
}

export function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

/**
 * Tables privées : l'hôte crée, reçoit un code à partager ; les invités le saisissent ;
 * l'hôte lance quand il veut, les sièges vides vont aux bots. Une table qui n'est pas
 * lancée au bout de `ttlMs` est oubliée.
 */
export class PrivateTables {
  private readonly byCode = new Map<string, PendingPrivateTable>();

  private readonly ttlMs: number;
  private readonly maxPending: number;

  constructor(ttlMs = 30 * 60 * 1000, maxPending = 200) {
    this.ttlMs = ttlMs;
    this.maxPending = maxPending;
  }

  get size(): number {
    return this.byCode.size;
  }

  create(gameId: string, seats: number, host: LobbyEntry): PendingPrivateTable | null {
    this.sweep();
    if (this.byCode.size >= this.maxPending) return null;
    if (this.findByHuman(host.humanId)) return null;
    let code = newInviteCode();
    while (this.byCode.has(code)) code = newInviteCode();
    const t: PendingPrivateTable = { code, gameId, seats, hostId: host.humanId, entries: [host], createdAt: Date.now() };
    this.byCode.set(code, t);
    return t;
  }

  join(code: string, entry: LobbyEntry): PendingPrivateTable | null {
    this.sweep();
    const t = this.byCode.get(code);
    if (!t) return null;
    if (t.entries.some((e) => e.humanId === entry.humanId)) return t;
    if (t.entries.length >= t.seats) return null;
    if (this.findByHuman(entry.humanId)) return null;
    t.entries.push(entry);
    return t;
  }

  findByHuman(humanId: string): PendingPrivateTable | null {
    for (const t of this.byCode.values()) if (t.entries.some((e) => e.humanId === humanId)) return t;
    return null;
  }

  /** Départ d'un humain ; si c'est l'hôte, la table est dissoute et ses invités rendus. */
  leave(humanId: string): { table: PendingPrivateTable; dissolved: boolean } | null {
    const t = this.findByHuman(humanId);
    if (!t) return null;
    if (t.hostId === humanId) {
      this.byCode.delete(t.code);
      return { table: t, dissolved: true };
    }
    t.entries = t.entries.filter((e) => e.humanId !== humanId);
    return { table: t, dissolved: false };
  }

  /** L'hôte lance : la table est retirée de l'attente et ses entrées rendues. */
  start(code: string, hostId: string): PendingPrivateTable | null {
    const t = this.byCode.get(code);
    if (!t || t.hostId !== hostId) return null;
    this.byCode.delete(code);
    return t;
  }

  private sweep(): void {
    const limit = Date.now() - this.ttlMs;
    for (const [code, t] of this.byCode) if (t.createdAt < limit) this.byCode.delete(code);
  }
}
