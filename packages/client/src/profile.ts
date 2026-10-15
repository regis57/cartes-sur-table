/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/**
 * Le profil côté navigateur. Le jeton secret vit dans localStorage, et nulle part ailleurs ;
 * il part vers le serveur dans l'en-tête Authorization (jamais dans une URL, jamais en cookie).
 * Sans profil, on joue en invité : pseudo et avatar restent dans le navigateur.
 */

const LS_JETON = 'jdc.jeton';
const LS_INVITE = 'jdc.invite';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface ProfileData {
  profile: { id: string; pseudo: string; avatar: number; createdAt: number; lastSeenAt: number };
  stats: { game: string; matches: number; wins: number; rounds: number }[];
  achievements: { code: string; unlockedAt: number }[];
  passkeys?: { id: string; name: string; createdAt: number; lastUsedAt: number | null }[];
  sessions?: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* navigation privée ou stockage bloqué : on joue quand même, en invité */
  }
}

export function getToken(): string | null {
  const t = read(LS_JETON);
  return t && /^[A-Z2-7]{52}$/.test(t) ? t : null;
}

export function setToken(token: string | null): void {
  write(LS_JETON, token);
}

/** 256 bits d'aléa du navigateur, en base32 : 52 caractères. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
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

export function normalizeToken(raw: string): string | null {
  const t = raw.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/[^A-Z2-7]/g, '');
  return /^[A-Z2-7]{52}$/.test(t) ? t : null;
}

export function formatRecoveryCode(token: string): string {
  return token.match(/.{1,4}/g)?.join('-') ?? token;
}

export interface Guest {
  name: string;
  avatar: number;
}

export function getGuest(): Guest {
  try {
    const raw = read(LS_INVITE);
    if (raw) {
      const g: unknown = JSON.parse(raw);
      if (g && typeof g === 'object' && typeof (g as Guest).name === 'string' && Number.isInteger((g as Guest).avatar)) {
        return { name: (g as Guest).name.slice(0, 20), avatar: Math.max(0, Math.min(11, (g as Guest).avatar)) };
      }
    }
  } catch {
    /* valeur illisible : on repart de zéro */
  }
  return { name: '', avatar: Math.floor(Math.random() * 12) };
}

export function setGuest(g: Guest): void {
  write(LS_INVITE, JSON.stringify({ name: g.name.slice(0, 20), avatar: g.avatar }));
}

async function api(method: string, path: string, body?: unknown, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: RequestInit = { method, headers, cache: 'no-store' };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`/api${path}`, init);
}

export async function fetchProfile(): Promise<ProfileData | null> {
  const token = getToken();
  if (!token) return null;
  const res = await api('GET', '/profil', undefined, token);
  if (res.status === 401) {
    setToken(null);
    return null;
  }
  if (!res.ok) throw new Error('profil');
  return (await res.json()) as ProfileData;
}

export async function createProfile(pseudo: string, avatar: number): Promise<{ token: string; data: ProfileData }> {
  const token = generateToken();
  const res = await api('POST', '/profil', { token, pseudo, avatar });
  if (!res.ok) throw new Error('creation');
  setToken(token);
  return { token, data: (await res.json()) as ProfileData };
}

export async function restoreProfile(code: string): Promise<ProfileData | null> {
  const token = normalizeToken(code);
  if (!token) return null;
  const res = await api('GET', '/profil', undefined, token);
  if (!res.ok) return null;
  setToken(token);
  return (await res.json()) as ProfileData;
}

export async function updateProfile(changes: { pseudo?: string; avatar?: number }): Promise<ProfileData['profile'] | null> {
  const token = getToken();
  if (!token) return null;
  const res = await api('PATCH', '/profil', changes, token);
  if (!res.ok) return null;
  return ((await res.json()) as { profile: ProfileData['profile'] }).profile;
}

export async function exportProfile(): Promise<Blob | null> {
  const token = getToken();
  if (!token) return null;
  const res = await api('GET', '/profil/export', undefined, token);
  if (!res.ok) return null;
  return res.blob();
}

export async function deleteProfile(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  const res = await api('DELETE', '/profil', undefined, token);
  setToken(null);
  return res.ok;
}

/** L'identité à présenter au serveur de jeu : le profil s'il existe, sinon l'invité. */
export async function identity(): Promise<{ name: string; avatar: number; token: string | null }> {
  const p = await fetchProfile().catch(() => null);
  if (p) return { name: p.profile.pseudo, avatar: p.profile.avatar, token: getToken() };
  const g = getGuest();
  return { name: g.name, avatar: g.avatar, token: null };
}
