/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { randomUUID } from 'node:crypto';
import type { BotLevel, GameDefinition, RoundSummary } from './contract.ts';
import { chooseBotMove, simpleMove, type BotEngine } from './bot.ts';
import { cryptoRng, seededRng, type Rng } from './rng.ts';
import { createRateLimiter } from './security.ts';

/**
 * Une table : des sièges, un jeu, une partie en cours. Indépendante du réseau : elle
 * parle au monde par une `Outbox`, que le serveur relie aux sockets. Tout ce qui
 * concerne le temps (bots qui « réfléchissent », joueurs inactifs, reprise après
 * déconnexion) vit ici, une fois pour tous les jeux.
 */

export interface Seat {
  name: string;
  avatar: number;
  isBot: boolean;
  /** Identifiant de connexion de l'humain (socket), null pour un bot. */
  humanId: string | null;
  /** Clé secrète permettant de reprendre ce siège après une coupure. */
  rejoinKey: string | null;
  /** Jusqu'à quand le siège attend son humain (ms epoch), null si occupé ou définitivement bot. */
  rejoinDeadline: number | null;
  /** Identifiant de profil (pour les succès), null pour un invité ou un bot. */
  profileId: string | null;
}

/** Ce que tout le monde à la table peut savoir d'un siège. */
export interface PublicSeat {
  name: string;
  avatar: number;
  isBot: boolean;
  /** Le siège attend le retour de son humain (affiché « en reconnexion… »). */
  awaiting: boolean;
}

export interface Outbox {
  toSeat(seat: number, event: string, payload: unknown): void;
  toAll(event: string, payload: unknown): void;
}

export interface TableOptions {
  botLevel?: BotLevel;
  /** Durées surchargées (tests). */
  timings?: Partial<GameDefinition<unknown, unknown, unknown>['timings']>;
  /** Délai de grâce pour reprendre son siège après une coupure (ms). */
  rejoinGraceMs?: number;
  /** Budget de réflexion du bot MCTS (ms). */
  botThinkMs?: number;
  /**
   * Moteur de calcul des bots (un fil à part, côté serveur). Sans lui, le bot réfléchit dans
   * le processus même, en bloquant tout le reste le temps de son budget : c'est le cas des tests.
   */
  botEngine?: BotEngine;
  /** Durée au bilan (fin de manche ou de partie) sans que personne ne relance, avant fermeture (ms). */
  idleEndMs?: number;
  rng?: Rng;
  onDestroy?: (table: Table<unknown, unknown, unknown>) => void;
  /** Fin de manche (et de partie si `matchOver`) : pour les profils et les succès. */
  onRoundEnd?: (info: RoundEndInfo) => void;
  /** Un humain a quitté son siège (coupure, inactivité, départ) : le transport peut délier sa connexion. */
  onHumanReleased?: (humanId: string, tableId: string) => void;
}

export interface RoundEndInfo {
  tableId: string;
  round: number;
  matchOver: boolean;
  winner: number | null;
  winners: number[];
  /** Succès propres au jeu, par siège (vide pour un bot). */
  achievements: string[][];
  seats: readonly Seat[];
}

export type TablePhase = 'playing' | 'roundEnd' | 'matchEnd' | 'destroyed';

/** Vue envoyée à un siège : la vue du jeu, enrichie de ce que le socle sait. */
/** Une manche jouée, pour la feuille de marque commune à tous les jeux. */
export interface RoundRecord {
  round: number;
  label: string | null;
  points: number[];
  totals: number[];
  winner: number | null;
}

export interface SeatView<V> {
  tableId: string;
  seat: number;
  seats: PublicSeat[];
  phase: TablePhase;
  round: number;
  /** Les manches terminées de la partie en cours, tenues par le socle. */
  rounds: RoundRecord[];
  game: V;
}

export class Table<S, M, V> {
  readonly id: string;
  readonly def: GameDefinition<S, M, V>;
  readonly seats: Seat[];
  state: S;
  phase: TablePhase = 'playing';
  round = 0;
  rounds: RoundRecord[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly out: Outbox;
  private readonly rng: Rng;
  private readonly botRng: Rng;
  private readonly timings: GameDefinition<S, M, V>['timings'];
  private readonly botLevel: BotLevel;
  private readonly rejoinGraceMs: number;
  private readonly botThinkMs: number;
  private readonly botEngine: BotEngine | null;
  /** L'état pour lequel un bot est en train de calculer, pour ne pas lancer deux fois le même calcul. */
  private botInFlight: S | null = null;
  private readonly idleEndMs: number;
  private readonly emoteLimiters: (() => boolean)[];
  private readonly onDestroy: TableOptions['onDestroy'];
  private readonly onRoundEnd: TableOptions['onRoundEnd'];
  private readonly onHumanReleased: TableOptions['onHumanReleased'];
  /** Minuterie de grâce : indépendante des minuteries de jeu, qu'un coup efface. */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, def: GameDefinition<S, M, V>, seats: Seat[], out: Outbox, opts: TableOptions = {}) {
    if (!def.seatCounts.includes(seats.length)) throw new RangeError(`${def.id} : ${seats.length} sièges non admis`);
    this.id = id;
    this.def = def;
    this.seats = seats;
    this.out = out;
    this.rng = opts.rng ?? cryptoRng;
    this.botRng = seededRng(this.rng.int(0x7fffffff));
    this.timings = { ...def.timings, ...opts.timings };
    this.botLevel = opts.botLevel ?? 'normal';
    this.rejoinGraceMs = opts.rejoinGraceMs ?? 90_000;
    this.botThinkMs = opts.botThinkMs ?? 150;
    this.botEngine = opts.botEngine ?? null;
    this.idleEndMs = opts.idleEndMs ?? 15 * 60_000;
    this.onDestroy = opts.onDestroy;
    this.onRoundEnd = opts.onRoundEnd;
    this.onHumanReleased = opts.onHumanReleased;
    this.emoteLimiters = seats.map(() => createRateLimiter({ capacity: 3, refillPerSec: 0.4 }));
    this.state = def.createRound(seats.length, this.rng);
  }

  // ---------- cycle de vie ----------

  start(): void {
    this.round = 1;
    this.phase = 'playing';
    this.out.toAll('tableStarted', { tableId: this.id });
    this.broadcastViews();
    this.scheduleTurn();
  }

  destroy(): void {
    if (this.phase === 'destroyed') return;
    this.clearTimers();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.phase = 'destroyed';
    this.onDestroy?.(this as unknown as Table<unknown, unknown, unknown>);
  }

  get humansPresent(): number {
    return this.seats.filter((s) => !s.isBot).length;
  }

  private get anyoneExpected(): boolean {
    const now = Date.now();
    return this.seats.some((s) => !s.isBot || (s.rejoinDeadline !== null && s.rejoinDeadline > now));
  }

  // ---------- vues ----------

  publicSeats(): PublicSeat[] {
    const now = Date.now();
    return this.seats.map((s) => ({
      name: s.name,
      avatar: s.avatar,
      isBot: s.isBot,
      awaiting: s.isBot && s.rejoinDeadline !== null && s.rejoinDeadline > now,
    }));
  }

  viewFor(seat: number): SeatView<V> {
    return { tableId: this.id, seat, seats: this.publicSeats(), phase: this.phase, round: this.round, rounds: this.rounds, game: this.def.view(this.state, seat) };
  }

  broadcastViews(): void {
    this.seats.forEach((s, i) => {
      if (!s.isBot) this.out.toSeat(i, 'state', this.viewFor(i));
    });
  }

  // ---------- coups ----------

  /** Coup d'un humain : identifié par sa clé, retrouvé parmi les coups légaux calculés ici. */
  onMove(seat: number, moveKey: unknown): boolean {
    if (this.phase !== 'playing') return false;
    const s = this.seats[seat];
    if (!s || s.isBot) return false;
    if (typeof moveKey !== 'string' || moveKey.length > 64) return false;
    if (this.def.currentSeat(this.state) !== seat) return false;
    const move = this.def.legalMoves(this.state, seat).find((m) => this.def.moveKey(m) === moveKey);
    if (move === undefined) return false;
    this.apply(seat, move);
    return true;
  }

  private apply(seat: number, move: M): void {
    this.clearTimers();
    this.state = this.def.applyMove(this.state, seat, move, this.rng);
    if (this.def.isRoundOver(this.state)) {
      this.endRound();
      return;
    }
    this.broadcastViews();
    this.scheduleTurn();
  }

  private endRound(): void {
    const summary: RoundSummary = this.def.roundSummary(this.state);
    this.rounds = [...this.rounds, {
      round: this.round,
      label: summary.label ?? null,
      points: summary.perSeat.map((p) => p.roundPoints),
      totals: summary.perSeat.map((p) => p.total),
      winner: summary.roundWinner,
    }];
    const matchOver = this.def.isMatchOver(this.state);
    const winner = matchOver ? this.def.matchWinner(this.state) : null;
    const winners = matchOver ? (this.def.matchWinners?.(this.state) ?? (winner === null ? [] : [winner])) : [];
    this.phase = matchOver ? 'matchEnd' : 'roundEnd';
    const achievements = this.seats.map((s, i) =>
      s.isBot ? [] : this.def.achievements(this.state, i, { matchOver, wonMatch: winners.includes(i), rounds: this.round }),
    );
    this.broadcastViews();
    this.out.toAll('roundEnd', { tableId: this.id, round: this.round, summary, seats: this.publicSeats(), matchOver, winner, winners, achievements });
    this.onRoundEnd?.({ tableId: this.id, round: this.round, matchOver, winner, winners, achievements, seats: this.seats });
    // Une table sans humain ne doit pas tourner à vide.
    if (!this.anyoneExpected) {
      this.destroy();
      return;
    }
    // Au bilan, plus aucune minuterie ne court : un onglet oublié garderait la table (et sa
    // place parmi celles que le serveur accepte) indéfiniment. Personne ne relance : on ferme.
    this.schedule(this.idleEndMs, () => {
      if (this.phase === 'roundEnd' || this.phase === 'matchEnd') this.destroy();
    });
  }

  /** Manche suivante, à la demande d'un humain de la table. */
  nextRound(seat: number): boolean {
    if (this.phase !== 'roundEnd') return false;
    const s = this.seats[seat];
    if (!s || s.isBot) return false;
    this.clearTimers();
    this.round += 1;
    this.phase = 'playing';
    this.state = this.def.createRound(this.seats.length, this.rng, this.state);
    this.broadcastViews();
    this.scheduleTurn();
    return true;
  }

  /** Nouvelle partie complète, à la demande d'un humain, une fois la partie finie. */
  restartMatch(seat: number): boolean {
    if (this.phase !== 'matchEnd') return false;
    const s = this.seats[seat];
    if (!s || s.isBot) return false;
    this.clearTimers();
    this.round = 1;
    this.rounds = [];
    this.phase = 'playing';
    this.state = this.def.createRound(this.seats.length, this.rng);
    this.out.toAll('tableStarted', { tableId: this.id });
    this.broadcastViews();
    this.scheduleTurn();
    return true;
  }

  // ---------- temps ----------

  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.phase === 'destroyed') return;
      try {
        fn();
      } catch (err) {
        console.error(`[table ${this.id}] minuterie :`, err instanceof Error ? err.message : err);
      }
    }, ms);
    this.timers.add(t);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private scheduleTurn(): void {
    if (this.phase !== 'playing') return;
    const seat = this.def.currentSeat(this.state);
    if (seat === null) return;
    const s = this.seats[seat];
    if (!s) return;

    if (s.isBot) {
      // Sans aucun humain à la table, les bots ne jouent pas : une table vide ne
      // consomme ni processeur ni minuterie ; elle reprend au retour d'un humain.
      if (this.humansPresent === 0) return;
      this.schedule(this.timings.botDelay, () => this.playBot(seat));
      return;
    }

    const forced = this.def.forcedMove(this.state, seat);
    if (forced !== null) {
      this.out.toSeat(seat, 'forced', { tableId: this.id, moveKey: this.def.moveKey(forced) });
      this.schedule(this.timings.forcedDelay, () => {
        if (this.def.currentSeat(this.state) === seat) this.apply(seat, forced);
      });
      return;
    }

    this.schedule(this.timings.afkTimeout, () => {
      if (this.def.currentSeat(this.state) === seat && !s.isBot) this.replaceWithBot(seat, 'afk');
    });
  }

  private playBot(seat: number): void {
    if (this.def.currentSeat(this.state) !== seat) return;
    const legal = this.def.legalMoves(this.state, seat);
    if (legal.length === 0) return;
    // Un seul coup possible : rien à calculer, on ne dérange pas le moteur.
    if (!this.botEngine || legal.length === 1) {
      const move = chooseBotMove(this.def, this.state, seat, this.botLevel, this.botThinkMs, this.botRng) ?? (legal[0] as M);
      this.apply(seat, move);
      return;
    }
    if (this.botInFlight === this.state) return;
    const snapshot = this.state;
    this.botInFlight = snapshot;
    const job = { gameId: this.def.id, state: snapshot, seat, level: this.botLevel, thinkMs: this.botThinkMs, seed: this.botRng.int(0x7fffffff) };
    this.botEngine.choose(job).then(
      (answer) => this.botAnswered(snapshot, seat, legal, answer),
      () => this.botAnswered(snapshot, seat, legal, null),
    );
  }

  /**
   * Le calcul du bot est revenu. La table a pu bouger pendant ce temps (un coup joué, un
   * humain revenu à son siège, la table fermée) : on ne joue que si rien n'a changé.
   * Une réponse absente ou illégale n'arrête jamais la partie : un coup de secours est joué.
   */
  private botAnswered(snapshot: S, seat: number, legal: readonly M[], answer: unknown): void {
    if (this.botInFlight === snapshot) this.botInFlight = null;
    if (this.phase !== 'playing' || this.state !== snapshot) return;
    if (!this.seats[seat]?.isBot || this.def.currentSeat(snapshot) !== seat) return;
    const key = answer === null || answer === undefined ? null : this.safeMoveKey(answer as M);
    const move = key === null ? undefined : legal.find((m) => this.def.moveKey(m) === key);
    try {
      this.apply(seat, move ?? simpleMove(this.def, snapshot, seat, legal, this.botRng));
    } catch (err) {
      console.error(`[table ${this.id}] bot :`, err instanceof Error ? err.message : err);
    }
  }

  private safeMoveKey(move: M): string | null {
    try {
      return this.def.moveKey(move);
    } catch {
      return null;
    }
  }

  // ---------- présence ----------

  /** Un humain part (coupure ou départ volontaire) : un bot prend le siège, qui reste reprenable. */
  leave(seat: number, reason: 'disconnect' | 'quit'): void {
    const s = this.seats[seat];
    if (!s || s.isBot) return;
    const humanId = s.humanId;
    s.isBot = true;
    s.humanId = null;
    s.rejoinDeadline = reason === 'disconnect' ? Date.now() + this.rejoinGraceMs : null;
    if (reason === 'quit') s.rejoinKey = null;
    if (humanId) this.onHumanReleased?.(humanId, this.id);
    this.afterSeatChange(seat);
  }

  private replaceWithBot(seat: number, reason: 'afk'): void {
    const s = this.seats[seat];
    if (!s || s.isBot) return;
    this.out.toSeat(seat, 'afk', { tableId: this.id, reason });
    const humanId = s.humanId;
    s.isBot = true;
    s.humanId = null;
    s.rejoinDeadline = Date.now() + this.rejoinGraceMs;
    if (humanId) this.onHumanReleased?.(humanId, this.id);
    this.afterSeatChange(seat);
  }

  private afterSeatChange(seat: number): void {
    if (!this.anyoneExpected) {
      this.destroy();
      return;
    }
    this.out.toAll('seats', { tableId: this.id, seats: this.publicSeats() });
    if (this.phase === 'playing' && this.def.currentSeat(this.state) === seat) {
      this.clearTimers();
      this.scheduleTurn();
    }
    // Si le dernier humain attendu ne revient pas, la table se libère : minuterie
    // à part, qu'aucun coup ne peut effacer.
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.phase !== 'destroyed' && !this.anyoneExpected) this.destroy();
    }, this.rejoinGraceMs + 50);
  }

  /**
   * Reprise d'un siège par son humain, avec la clé remise au départ.
   *
   * Le siège peut encore être tenu par l'ancienne connexion : après un changement de réseau
   * ou une mise en veille, le navigateur se reconnecte en une seconde, alors que le serveur
   * ne constate la mort de l'ancienne connexion qu'au bout de son délai de battement (près
   * d'une minute). La clé fait foi : la nouvelle connexion prend la place, l'ancienne est
   * prévenue (s'il s'agissait d'un second onglet bien vivant) puis déliée.
   */
  rejoin(rejoinKey: string, humanId: string): number | null {
    const idx = this.seats.findIndex((s) => s.rejoinKey !== null && s.rejoinKey === rejoinKey);
    if (idx === -1) return null;
    const s = this.seats[idx] as Seat;
    if (s.isBot) {
      if (s.rejoinDeadline === null || s.rejoinDeadline < Date.now()) return null;
    } else if (s.humanId !== humanId) {
      const ancien = s.humanId;
      this.out.toSeat(idx, 'seatTaken', { tableId: this.id });
      if (ancien) this.onHumanReleased?.(ancien, this.id);
    }
    s.isBot = false;
    s.humanId = humanId;
    s.rejoinDeadline = null;
    this.out.toAll('seats', { tableId: this.id, seats: this.publicSeats() });
    this.out.toSeat(idx, 'state', this.viewFor(idx));
    if (this.phase === 'playing') {
      // Son tour, ou une table que les bots avaient mise en pause : on relance.
      this.clearTimers();
      this.scheduleTurn();
    }
    return idx;
  }

  // ---------- émoticônes et phrases ----------

  /** Interaction toute faite : un code du catalogue, jamais de texte libre. */
  onEmote(seat: number, kind: unknown, code: unknown): boolean {
    const s = this.seats[seat];
    if (!s || s.isBot) return false;
    if (kind !== 'phrase' && kind !== 'emoji') return false;
    if (typeof code !== 'string') return false;
    const ok = kind === 'phrase' ? this.def.phrases.includes(code) : EMOJI_CODES.includes(code);
    if (!ok) return false;
    const allow = this.emoteLimiters[seat];
    if (!allow || !allow()) return false;
    this.out.toAll('emote', { tableId: this.id, seat, kind, code });
    return true;
  }

  static newId(prefix: 'solo' | 'online' | 'private'): string {
    return `${prefix}_${randomUUID()}`;
  }

  static newRejoinKey(): string {
    return randomUUID();
  }
}

/** Émoticônes communes à tous les jeux : des codes, dessinés côté client en SVG. */
export const EMOJI_CODES: readonly string[] = [
  'sourire', 'rire', 'clin-oeil', 'etonne', 'triste', 'reflechit',
  'applaudit', 'pouce', 'coeur', 'bravo', 'dodo', 'grimace',
];
