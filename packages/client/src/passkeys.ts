/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/**
 * Passkeys (WebAuthn) côté navigateur. Le serveur ne voit jamais le secret : il garde une
 * clé publique, et reçoit une signature à chaque connexion. Une passkey est liée à un
 * écosystème (Apple, Google, Windows, gestionnaire de mots de passe) : on la perd en changeant
 * de famille d'appareils, d'où le code de récupération qui reste la vraie clé de secours.
 */

import { getToken, setToken, type ProfileData } from './profile.ts';

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function passkeysSupported(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && typeof navigator.credentials?.create === 'function';
}

function b64urlEncode(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function api(method: string, path: string, body?: unknown, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: RequestInit = { method, headers, cache: 'no-store' };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`/api${path}`, init);
}

interface RegOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  authenticatorSelection: AuthenticatorSelectionCriteria;
  attestation: AttestationConveyancePreference;
  timeout: number;
  excludeCredentials: { type: 'public-key'; id: string }[];
}

/** Enregistre une nouvelle passkey sur le profil courant. Renvoie la liste à jour, ou null. */
export async function registerPasskey(name: string): Promise<PasskeyInfo | null> {
  const token = getToken();
  if (!token || !passkeysSupported()) return null;
  const optRes = await api('POST', '/passkeys/options', {}, token);
  if (!optRes.ok) return null;
  const opt = (await optRes.json()) as RegOptions;
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64urlDecode(opt.challenge),
      rp: opt.rp,
      user: { id: b64urlDecode(opt.user.id), name: opt.user.name, displayName: opt.user.displayName },
      pubKeyCredParams: opt.pubKeyCredParams,
      authenticatorSelection: opt.authenticatorSelection,
      attestation: opt.attestation,
      timeout: opt.timeout,
      excludeCredentials: opt.excludeCredentials.map((c) => ({ type: 'public-key' as const, id: b64urlDecode(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const resp = cred.response as AuthenticatorAttestationResponse;
  const res = await api('POST', '/passkeys', {
    rawId: b64urlEncode(cred.rawId),
    clientDataJSON: b64urlEncode(resp.clientDataJSON),
    attestationObject: b64urlEncode(resp.attestationObject),
    name: name.slice(0, 40),
  }, token);
  if (!res.ok) return null;
  return ((await res.json()) as { passkey: PasskeyInfo }).passkey;
}

export async function deletePasskey(id: string): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  const res = await api('DELETE', `/passkeys/${encodeURIComponent(id)}`, undefined, token);
  return res.ok;
}

interface AuthOptions {
  challenge: string;
  rpId: string;
  userVerification: UserVerificationRequirement;
  timeout: number;
}

/** Connexion par passkey : le navigateur propose les passkeys connues pour ce site. */
export async function signInWithPasskey(): Promise<ProfileData | null> {
  if (!passkeysSupported()) return null;
  const optRes = await api('POST', '/passkeys/auth/options', {});
  if (!optRes.ok) return null;
  const opt = (await optRes.json()) as AuthOptions;
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: b64urlDecode(opt.challenge), rpId: opt.rpId, userVerification: opt.userVerification, timeout: opt.timeout, allowCredentials: [] },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const resp = cred.response as AuthenticatorAssertionResponse;
  const res = await api('POST', '/passkeys/auth', {
    rawId: b64urlEncode(cred.rawId),
    clientDataJSON: b64urlEncode(resp.clientDataJSON),
    authenticatorData: b64urlEncode(resp.authenticatorData),
    signature: b64urlEncode(resp.signature),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as ProfileData & { token: string };
  setToken(data.token);
  return data;
}

/** Déconnecte les autres appareils entrés par passkey. */
export async function revokeSessions(): Promise<number | null> {
  const token = getToken();
  if (!token) return null;
  const res = await api('POST', '/profil/sessions/revoke', {}, token);
  if (!res.ok) return null;
  return ((await res.json()) as { revoked: number }).revoked;
}
