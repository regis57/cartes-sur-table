/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isValidProfileToken, sanitizeName } from './security.ts';

/**
 * Profils de joueurs, sans mot de passe ni adresse email.
 *
 * Le navigateur tire un jeton secret de 256 bits ; le serveur n'en garde que
 * l'empreinte SHA-256, qui sert d'identifiant. Le jeton, présenté groupé par quatre,
 * est aussi le « code de récupération » que le joueur note pour retrouver son profil
 * sur un autre appareil. Il n'y a donc rien à réinitialiser, donc rien à envoyer, donc
 * aucune adresse à collecter.
 *
 * Ce qui est stocké, et rien d'autre : pseudo, avatar (un numéro), dates de création
 * et de dernière visite (au jour près), compteurs par jeu, succès. Jamais d'adresse IP,
 * jamais d'empreinte de navigateur, jamais d'historique de parties.
 */

export const AVATAR_COUNT = 12;
export const PROFILE_TOKEN_BYTES = 32;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648) sans remplissage ; 32 octets → 52 caractères. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function generateProfileToken(): string {
  return base32Encode(randomBytes(PROFILE_TOKEN_BYTES));
}

/** Accepte le code tel qu'un humain le tape : minuscules, espaces, tirets, 0/1 confondus. */
export function normalizeProfileToken(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const t = raw.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/[^A-Z2-7]/g, '');
  return isValidProfileToken(t) ? t : null;
}

/** Présentation lisible du code de récupération : groupes de quatre. */
export function formatRecoveryCode(token: string): string {
  return token.match(/.{1,4}/g)?.join('-') ?? token;
}

export function profileIdFromToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface Profile {
  id: string;
  pseudo: string;
  avatar: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface GameStats {
  game: string;
  matches: number;
  wins: number;
  rounds: number;
}

export interface Achievement {
  code: string;
  unlockedAt: number;
}

export interface ProfileExport {
  profile: Profile;
  stats: GameStats[];
  achievements: Achievement[];
}

/** Succès communs à tous les jeux, attribués par le socle. */
export const COMMON_ACHIEVEMENTS: readonly string[] = [
  'premiere-partie', 'premiere-victoire', 'dix-victoires', 'cinquante-parties', 'touche-a-tout',
];

const DAY = 86_400;
const nowSec = (): number => Math.floor(Date.now() / 1000);

export class ProfileStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profils (
        id TEXT PRIMARY KEY,
        pseudo TEXT NOT NULL,
        avatar INTEGER NOT NULL,
        cree_le INTEGER NOT NULL,
        vu_le INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        profil_id TEXT NOT NULL REFERENCES profils(id) ON DELETE CASCADE,
        jeu TEXT NOT NULL,
        parties INTEGER NOT NULL DEFAULT 0,
        victoires INTEGER NOT NULL DEFAULT 0,
        manches INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (profil_id, jeu)
      );
      CREATE TABLE IF NOT EXISTS succes (
        profil_id TEXT NOT NULL REFERENCES profils(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        obtenu_le INTEGER NOT NULL,
        PRIMARY KEY (profil_id, code)
      );
      CREATE INDEX IF NOT EXISTS profils_vu_le ON profils(vu_le);
    `);
  }

  close(): void {
    this.db.close();
  }

  get count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM profils').get() as { n: number };
    return row.n;
  }

  /** Crée un profil pour ce jeton (généré côté navigateur). Null si le jeton existe déjà. */
  create(token: string, pseudo: unknown, avatar: unknown): Profile | null {
    const id = profileIdFromToken(token);
    const a = typeof avatar === 'number' && Number.isInteger(avatar) && avatar >= 0 && avatar < AVATAR_COUNT ? avatar : 0;
    const t = nowSec();
    // Date au jour près : assez pour la purge, pas assez pour tracer des habitudes.
    const day = t - (t % DAY);
    try {
      this.db.prepare('INSERT INTO profils (id, pseudo, avatar, cree_le, vu_le) VALUES (?, ?, ?, ?, ?)').run(id, sanitizeName(pseudo), a, day, day);
    } catch {
      return null;
    }
    return this.getById(id);
  }

  getById(id: string): Profile | null {
    const row = this.db.prepare('SELECT id, pseudo, avatar, cree_le, vu_le FROM profils WHERE id = ?').get(id) as
      | { id: string; pseudo: string; avatar: number; cree_le: number; vu_le: number }
      | undefined;
    if (!row) return null;
    return { id: row.id, pseudo: row.pseudo, avatar: row.avatar, createdAt: row.cree_le, lastSeenAt: row.vu_le };
  }

  /** Retrouve un profil par son jeton et note la visite (au jour près). */
  getByToken(token: string): Profile | null {
    const p = this.getById(profileIdFromToken(token));
    if (!p) return null;
    const t = nowSec();
    const day = t - (t % DAY);
    if (day > p.lastSeenAt) {
      this.db.prepare('UPDATE profils SET vu_le = ? WHERE id = ?').run(day, p.id);
      p.lastSeenAt = day;
    }
    return p;
  }

  update(id: string, changes: { pseudo?: unknown; avatar?: unknown }): Profile | null {
    const p = this.getById(id);
    if (!p) return null;
    const pseudo = changes.pseudo === undefined ? p.pseudo : sanitizeName(changes.pseudo);
    const avatar =
      typeof changes.avatar === 'number' && Number.isInteger(changes.avatar) && changes.avatar >= 0 && changes.avatar < AVATAR_COUNT
        ? changes.avatar
        : p.avatar;
    this.db.prepare('UPDATE profils SET pseudo = ?, avatar = ? WHERE id = ?').run(pseudo, avatar, id);
    return this.getById(id);
  }

  stats(id: string): GameStats[] {
    const rows = this.db.prepare('SELECT jeu, parties, victoires, manches FROM stats WHERE profil_id = ? ORDER BY jeu').all(id) as {
      jeu: string;
      parties: number;
      victoires: number;
      manches: number;
    }[];
    return rows.map((r) => ({ game: r.jeu, matches: r.parties, wins: r.victoires, rounds: r.manches }));
  }

  achievements(id: string): Achievement[] {
    const rows = this.db.prepare('SELECT code, obtenu_le FROM succes WHERE profil_id = ? ORDER BY obtenu_le, code').all(id) as {
      code: string;
      obtenu_le: number;
    }[];
    return rows.map((r) => ({ code: r.code, unlockedAt: r.obtenu_le }));
  }

  /** Débloque des succès ; renvoie ceux qui sont nouveaux. */
  unlock(id: string, codes: readonly string[]): string[] {
    if (!this.getById(id)) return [];
    const t = nowSec();
    const day = t - (t % DAY);
    const stmt = this.db.prepare('INSERT OR IGNORE INTO succes (profil_id, code, obtenu_le) VALUES (?, ?, ?)');
    const fresh: string[] = [];
    for (const code of codes) {
      if (!/^[a-z0-9-]{3,40}(?::[a-z0-9-]{3,40})?$/.test(code)) continue;
      const r = stmt.run(id, code, day);
      if (r.changes > 0) fresh.push(code);
    }
    return fresh;
  }

  /**
   * Enregistre une partie terminée et attribue les succès communs.
   * Renvoie les succès nouvellement obtenus (communs + propres au jeu).
   */
  recordMatch(id: string, game: string, result: { won: boolean; rounds: number; gameAchievements?: readonly string[] }): string[] {
    if (!this.getById(id)) return [];
    this.db
      .prepare(
        `INSERT INTO stats (profil_id, jeu, parties, victoires, manches) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(profil_id, jeu) DO UPDATE SET parties = parties + 1, victoires = victoires + excluded.victoires, manches = manches + excluded.manches`,
      )
      .run(id, game, result.won ? 1 : 0, result.rounds);
    const all = this.stats(id);
    const matches = all.reduce((n, s) => n + s.matches, 0);
    const wins = all.reduce((n, s) => n + s.wins, 0);
    const games = all.filter((s) => s.matches > 0).length;
    const codes: string[] = [];
    if (matches >= 1) codes.push('premiere-partie');
    if (wins >= 1) codes.push('premiere-victoire');
    if (wins >= 10) codes.push('dix-victoires');
    if (matches >= 50) codes.push('cinquante-parties');
    if (games >= 2) codes.push('touche-a-tout');
    for (const c of result.gameAchievements ?? []) codes.push(`${game}:${c}`);
    return this.unlock(id, codes);
  }

  /** Tout ce que la plateforme sait d'un profil, pour le droit d'accès et la portabilité. */
  export(id: string): ProfileExport | null {
    const profile = this.getById(id);
    if (!profile) return null;
    return { profile, stats: this.stats(id), achievements: this.achievements(id) };
  }

  /** Effacement réel et immédiat (les tables liées suivent par cascade). */
  delete(id: string): boolean {
    const r = this.db.prepare('DELETE FROM profils WHERE id = ?').run(id);
    return r.changes > 0;
  }

  /** Purge des profils sans visite depuis `days` jours. Renvoie le nombre effacé. */
  purgeInactive(days: number): number {
    const limit = nowSec() - days * DAY;
    const r = this.db.prepare('DELETE FROM profils WHERE vu_le < ?').run(limit);
    return Number(r.changes);
  }
}
