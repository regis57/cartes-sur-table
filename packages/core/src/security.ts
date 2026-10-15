/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Briques de sécurité sans aucune dépendance : assainissement des entrées,
 * limitation de débit, contrôle d'origine, en-têtes HTTP, adresse du client
 * derrière un proxy. Chaque fonction est testée seule.
 */

export const NAME_MAX_LENGTH = 20;
export const FALLBACK_NAME = 'Joueur';

/**
 * Nettoie un pseudo reçu du réseau. Le serveur ne fait jamais confiance au client :
 * normalisation Unicode NFC ; retrait des caractères de contrôle, de formatage et
 * bidirectionnels (usurpation d'affichage « Trojan Source ») ; seuls lettres, chiffres,
 * espace et - _ ' . sont conservés ; espaces compressés ; longueur limitée.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_NAME;
  const cleaned = raw
    .slice(0, 200)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return cleaned || FALLBACK_NAME;
}

const TABLE_ID_RE = /^(solo|online|private)_[A-Za-z0-9_-]{8,64}$/;
export function isValidTableId(value: unknown): value is string {
  return typeof value === 'string' && TABLE_ID_RE.test(value);
}

/** Code d'invitation d'une table privée : 6 caractères sans ambiguïté (pas de 0/O, 1/I). */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_RE = new RegExp(`^[${INVITE_ALPHABET}]{6}$`);
export function isValidInviteCode(value: unknown): value is string {
  return typeof value === 'string' && INVITE_RE.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSmallInt(value: unknown, min: number, maxExclusive: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) < maxExclusive;
}

/** Jeton de profil : 52 caractères base32 (256 bits). */
const PROFILE_TOKEN_RE = /^[A-Z2-7]{52}$/;
export function isValidProfileToken(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_TOKEN_RE.test(value);
}

/** Clé de reprise de siège : UUID v4. */
const REJOIN_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isValidRejoinKey(value: unknown): value is string {
  return typeof value === 'string' && REJOIN_KEY_RE.test(value);
}

/**
 * Seau à jetons : `capacity` événements en rafale, `refillPerSec` en régime établi.
 * Retourne true si l'événement est autorisé.
 */
export function createRateLimiter(opts: { capacity: number; refillPerSec: number; now?: () => number }): () => boolean {
  const now = opts.now ?? (() => Date.now());
  let tokens = opts.capacity;
  let last = now();
  return function allow(): boolean {
    const t = now();
    tokens = Math.min(opts.capacity, tokens + ((t - last) / 1000) * opts.refillPerSec);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/**
 * Autorise une requête d'établissement de connexion (HTTP upgrade / polling).
 * Les navigateurs envoient toujours `Origin` : on le compare à la liste blanche, ou,
 * à défaut, à l'hôte demandé (même origine). Cela bloque le détournement de WebSocket
 * depuis un site tiers (CSWSH). Les clients sans `Origin` (scripts, tests) ne sont pas
 * des navigateurs et ne sont donc pas visés.
 */
export function isOriginAllowed(originHeader: string | undefined, hostHeader: string | undefined, allowedOrigins: readonly string[] = []): boolean {
  if (!originHeader) return true;
  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (allowedOrigins.length > 0) return allowedOrigins.includes(parsed.origin);
  return typeof hostHeader === 'string' && parsed.host === hostHeader;
}

export function parseAllowedOrigins(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [new URL(s).origin];
      } catch {
        return [];
      }
    });
}

/**
 * Comment lire l'adresse du client.
 *  - 'none'       : l'adresse de la socket (aucun proxy devant)
 *  - 'cloudflare' : `CF-Connecting-IP`, que Cloudflare écrit lui-même et qu'un client
 *                   ne peut pas forger à travers le tunnel
 *  - 'xff'        : premier élément de `X-Forwarded-For` (proxy de confiance local, Caddy/nginx)
 */
export type TrustProxy = 'none' | 'cloudflare' | 'xff';

export function parseTrustProxy(value: string | undefined): TrustProxy {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'cloudflare') return 'cloudflare';
  if (v === '1' || v === 'true' || v === 'xff') return 'xff';
  return 'none';
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]+$/i;
function plausibleIp(s: string): boolean {
  return s.length <= 45 && (IPV4.test(s) || IPV6.test(s));
}

export function getClientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, trust: TrustProxy): string {
  if (trust === 'cloudflare') {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && plausibleIp(cf.trim())) return cf.trim();
  } else if (trust === 'xff') {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const first = (xff.split(',')[0] ?? '').trim();
      if (plausibleIp(first)) return first;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Politique de sécurité du contenu. Aucun script ni style en ligne ; les images et
 * polices viennent du site ; `data:` est admis pour les images (texture du tapis en SVG).
 * `connect-src 'self'` couvre le WebSocket de même origine (wss: implicite en HTTPS).
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

type Next = (err?: unknown) => void;

/** Middleware Express : en-têtes de sécurité (équivalent ciblé de helmet, sans dépendance). */
export function securityHeaders(opts: { hsts: boolean }) {
  return function securityHeadersMiddleware(req: IncomingMessage & { secure?: boolean }, res: ServerResponse, next: Next): void {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (opts.hsts && (req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-visitor'] !== undefined)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

/** Limiteur HTTP simple par IP (fenêtre fixe), pour les fichiers statiques et l'API de profil. */
export function httpRateLimit(opts: { windowMs: number; max: number; trust: TrustProxy }) {
  const hits = new Map<string, number>();
  const timer = setInterval(() => hits.clear(), opts.windowMs);
  timer.unref();
  return function httpRateLimitMiddleware(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const ip = getClientIp(req, opts.trust);
    const count = (hits.get(ip) ?? 0) + 1;
    hits.set(ip, count);
    if (count > opts.max) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      res.end('Trop de requêtes');
      return;
    }
    next();
  };
}
