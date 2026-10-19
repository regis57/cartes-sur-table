/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { availableParallelism } from 'node:os';
import { parseAllowedOrigins, parseTrustProxy, type TrustProxy } from '@jdc/core';

export interface Config {
  port: number;
  host: string;
  trustProxy: TrustProxy;
  allowedOrigins: string[];
  publicOrigin: string | null;
  /** Chemin de la base SQLite ; ':memory:' tant que rien n'est configuré (aucun fichier créé par surprise). */
  databasePath: string;
  maxConnPerIp: number;
  maxTables: number;
  matchmakingSeconds: number;
  rateBurst: number;
  ratePerSec: number;
  httpMaxPerMinute: number;
  botThinkMs: number;
  /** Fils de calcul des bots ; 0 = les bots réfléchissent dans le fil principal (tests, essais). */
  botWorkers: number;
  rejoinGraceMs: number;
  purgeDays: number;
  /** En production (NODE_ENV=production), les passkeys exigent PUBLIC_ORIGIN. */
  production: boolean;
  /** Surcharges de durées de jeu (tests). */
  timings?: { botDelay?: number; forcedDelay?: number; afkTimeout?: number };
}

function intFromEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let publicOrigin: string | null = null;
  if (env['PUBLIC_ORIGIN']) {
    try {
      publicOrigin = new URL(env['PUBLIC_ORIGIN']).origin;
    } catch {
      publicOrigin = null;
    }
  }
  const allowedOrigins = parseAllowedOrigins(env['ALLOWED_ORIGINS']);
  if (allowedOrigins.length === 0 && publicOrigin) allowedOrigins.push(publicOrigin);
  return {
    port: intFromEnv(env['PORT'], 3000, 1, 65535),
    host: env['HOST'] || '127.0.0.1',
    trustProxy: parseTrustProxy(env['TRUST_PROXY']),
    allowedOrigins,
    publicOrigin,
    databasePath: env['DATABASE_PATH'] || ':memory:',
    maxConnPerIp: intFromEnv(env['MAX_CONN_PER_IP'], 10, 1, 1000),
    maxTables: intFromEnv(env['MAX_TABLES'], 300, 1, 100_000),
    matchmakingSeconds: intFromEnv(env['MATCHMAKING_SECONDS'], 60, 1, 600),
    rateBurst: intFromEnv(env['RATE_BURST'], 20, 1, 10_000),
    ratePerSec: intFromEnv(env['RATE_PER_SEC'], 5, 1, 10_000),
    httpMaxPerMinute: intFromEnv(env['HTTP_MAX_PER_MINUTE'], 300, 1, 1_000_000),
    botThinkMs: intFromEnv(env['BOT_THINK_MS'], 150, 1, 5000),
    // Un cœur reste au fil principal (connexions, pages) ; au plus quatre fils de calcul.
    botWorkers: intFromEnv(env['BOT_WORKERS'], Math.max(1, Math.min(4, availableParallelism() - 1)), 0, 16),
    rejoinGraceMs: intFromEnv(env['REJOIN_GRACE_MS'], 90_000, 1000, 3_600_000),
    purgeDays: intFromEnv(env['PURGE_DAYS'], 365, 1, 3650),
    production: env['NODE_ENV'] === 'production',
  };
}
