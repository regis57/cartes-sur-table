/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import type { Rng } from './rng.ts';

/**
 * LE CONTRAT DE JEU.
 *
 * Tout jeu de la plateforme est un objet qui respecte `GameDefinition`. Le socle
 * (salles, matchmaking, bots, réseau, profils) ne connaît que ce contrat ; il ne sait
 * rien des cartes, des atouts ni des enchères. Ajouter un jeu, c'est écrire ce seul
 * objet, ses tests, et ses textes.
 *
 * Trois propriétés sont imposées par le socle et vérifiées par le compilateur :
 *
 *  1. Les règles sont PURES. `applyMove` renvoie un nouvel état, sans modifier l'ancien,
 *     sans réseau, sans horloge, et sans autre aléa que le `Rng` reçu. C'est ce qui rend
 *     les parties rejouables et les bots capables de simuler.
 *
 *  2. La VUE PAR JOUEUR est obligatoire. Le socle n'envoie JAMAIS un état complet à un
 *     client : il envoie `view(state, seat)`. Un jeu qui voudrait divulguer la main d'un
 *     adversaire devrait le faire exprès, dans cette fonction, où un relecteur le verra.
 *
 *  3. L'INFORMATION CACHÉE est déclarée. `determinize` fabrique un état complet
 *     compatible avec ce que le siège sait. C'est ce qui permet au bot MCTS générique
 *     de jouer à n'importe quel jeu sans tricher : il ne raisonne que sur des mondes
 *     possibles, jamais sur le vrai.
 *
 * Paramètres de type :
 *  - S : l'état complet d'une manche (connu du serveur seul)
 *  - M : un coup (ce que le client envoie, toujours revalidé par `legalMoves`)
 *  - V : la vue d'un siège (ce que le client reçoit)
 */
export interface GameDefinition<S, M, V> {
  /** Identifiant stable, en minuscules et tirets : « huit-americain ». Sert d'espace de noms réseau et de clé de profil. */
  readonly id: string;

  /** Nombres de sièges acceptés (le premier est celui du matchmaking public). */
  readonly seatCounts: readonly number[];

  /**
   * Durées propres au jeu, en millisecondes. Le socle les applique ; il ne les devine pas.
   *  - botDelay : « temps de réflexion » affiché d'un bot
   *  - forcedDelay : délai avant qu'un coup forcé (pioche obligatoire…) soit joué pour un humain
   *  - afkTimeout : inactivité d'un humain à son tour avant remplacement par un bot
   */
  readonly timings: { readonly botDelay: number; readonly forcedDelay: number; readonly afkTimeout: number };

  /** Nouvelle manche. `previous` porte ce qui survit d'une manche à l'autre (scores, donneur). */
  createRound(seats: number, rng: Rng, previous?: S): S;

  /** Siège qui doit jouer, ou null si la manche est terminée. */
  currentSeat(state: S): number | null;

  /** Coups légaux pour ce siège, dans cet état. Vide si ce n'est pas son tour. */
  legalMoves(state: S, seat: number): M[];

  /**
   * Coup que le socle joue d'office pour un humain qui n'a pas de vrai choix
   * (par exemple : aucune carte jouable, donc pioche). `null` s'il doit décider.
   */
  forcedMove(state: S, seat: number): M | null;

  /** Applique un coup LÉGAL et renvoie le nouvel état. Ne mute jamais `state`. */
  applyMove(state: S, seat: number, move: M, rng: Rng): S;

  /** Clé stable d'un coup, pour les statistiques des bots et les journaux. */
  moveKey(move: M): string;

  /** Vrai dès qu'une manche est finie. */
  isRoundOver(state: S): boolean;

  /** Vrai si la partie (succession de manches) est finie : la limite de points est atteinte, etc. */
  isMatchOver(state: S): boolean;

  /** Scores cumulés par siège, lisibles à tout moment. */
  scores(state: S): number[];

  /** Siège vainqueur de la partie, une fois `isMatchOver` ; sinon null. */
  matchWinner(state: S): number | null;

  /**
   * Tous les sièges vainqueurs, pour un jeu par équipes (facultatif). Par défaut, le seul
   * siège renvoyé par `matchWinner`. Chacun d'eux compte la partie comme gagnée.
   */
  matchWinners?(state: S): number[];

  /**
   * Ce que le siège a le droit de voir. C'est la SEULE chose envoyée aux clients.
   * Doit être sérialisable en JSON et ne contenir aucun identifiant interne.
   */
  view(state: S, seat: number): V;

  /**
   * Tire un état complet compatible avec `view(state, seat)` : les cartes inconnues
   * de ce siège sont redistribuées au hasard entre les endroits où elles peuvent être.
   * Pour un jeu à information complète, renvoyer `state` tel quel.
   */
  determinize(state: S, seat: number, rng: Rng): S;

  /**
   * Valeur d'un état pour un siège, dans [0, 1] (1 = meilleur). Appelée sur les états
   * de fin de manche par le bot, et sur un état quelconque si une simulation est
   * coupée (elle doit alors rester sensée : une estimation, pas une erreur).
   */
  evaluate(state: S, seat: number): number;

  /**
   * Politique de simulation du bot (facultative) : choisir un coup parmi les légaux
   * pendant les parties simulées. Par défaut, uniforme. Une politique un peu sensée
   * (préférer jouer plutôt que piocher) rend le bot bien meilleur à coût nul.
   */
  rolloutMove?(state: S, seat: number, legal: readonly M[], rng: Rng): M;

  /**
   * Politique de bot propre au jeu (facultative). Quand elle renvoie un coup, le socle le
   * joue tel quel ; quand elle renvoie `null`, le socle s'en remet au MCTS générique.
   * Utile aux jeux dont une manche est trop longue pour que le MCTS converge dans le
   * temps de réflexion imparti (le tarot : enchères, écart, dix-huit plis), ou dont les
   * décisions de début de manche demandent une stratégie plutôt qu'une recherche.
   */
  botMove?(state: S, seat: number, legal: readonly M[], rng: Rng): M | null;

  /** Bilan d'une manche terminée, pour l'écran de fin et les succès. */
  roundSummary(state: S): RoundSummary;

  /**
   * Succès débloqués par un siège à la fin d'une manche ou d'une partie.
   * Codes stables, en minuscules et tirets, propres au jeu (« huit-magique »).
   * Les succès communs à tous les jeux (première partie, 10 victoires) sont gérés par le socle.
   */
  achievements(state: S, seat: number, context: AchievementContext): string[];

  /** Phrases toutes faites (12 au départ) : codes stables, traduits côté client. */
  readonly phrases: readonly string[];
}

/** Bilan d'une manche : un enregistrement par siège, de quoi afficher un tableau. */
export interface RoundSummary {
  readonly perSeat: readonly {
    readonly roundPoints: number;
    readonly total: number;
    /** Cartes restantes (ou autre détail visible de fin de manche), déjà sous forme de vue. */
    readonly detail: unknown;
  }[];
  /** Siège qui a remporté la manche, s'il y en a un. */
  readonly roundWinner: number | null;
  /** Une ligne pour la feuille de marque, propre au jeu (« Garde — Anne », « Atout ♠ — Paul »). */
  readonly label?: string | undefined;
}

export interface AchievementContext {
  /** La partie entière vient de se terminer (et pas seulement une manche). */
  readonly matchOver: boolean;
  /** Le siège a remporté la partie. */
  readonly wonMatch: boolean;
  /** Nombre de manches jouées dans cette partie. */
  readonly rounds: number;
}

/**
 * Métadonnées d'un jeu, destinées à l'accueil et aux pages d'aide. Séparées des règles
 * pour que le client puisse les lire sans charger le moteur.
 */
export interface GameMeta {
  readonly id: string;
  /** Clé i18n du nom. */
  readonly nameKey: string;
  readonly seatCounts: readonly number[];
  /** Disponible au public, ou en préparation. */
  readonly status: 'available' | 'soon';
}

/** Un jeu enregistré sur la plateforme : sa définition et ses métadonnées. */
export interface RegisteredGame<S = unknown, M = unknown, V = unknown> {
  readonly meta: GameMeta;
  readonly def: GameDefinition<S, M, V>;
}
