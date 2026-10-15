/*
 * Cartes sur table — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

import { createHash, createPublicKey, createVerify, randomBytes, type KeyObject } from 'node:crypto';

/**
 * Passkeys (WebAuthn), côté serveur, sans dépendance : décodage CBOR minimal,
 * vérification de l'enregistrement (attestation « none ») et de l'authentification
 * (ES256 et RS256). Le navigateur crée la clé ; le serveur ne garde que la clé
 * publique. Une passkey remplace la saisie du code de récupération sur un appareil
 * de confiance, elle ne remplace pas le code : les passkeys sont liées à un
 * écosystème (Apple, Google, Microsoft…), et un joueur qui en change les perd.
 */

// ---------- base64url ----------

export function b64urlEncode(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64url');
}

export function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

const B64URL_RE = /^[A-Za-z0-9_-]{16,1024}$/;
export function isB64url(value: unknown): value is string {
  return typeof value === 'string' && B64URL_RE.test(value);
}

// ---------- CBOR (sous-ensemble suffisant pour WebAuthn) ----------

export type Cbor = number | bigint | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | boolean | null | undefined;

export function cborDecode(buf: Buffer): Cbor {
  const [value, used] = decodeItem(buf, 0, 0);
  if (used !== buf.length) throw new Error('cbor : octets en trop');
  return value;
}

/** Décode un élément et renvoie [valeur, position suivante]. `depth` borne la récursion. */
function decodeItem(buf: Buffer, pos: number, depth: number): [Cbor, number] {
  if (depth > 16) throw new Error('cbor : trop profond');
  if (pos >= buf.length) throw new Error('cbor : tronqué');
  const initial = buf[pos] as number;
  const major = initial >> 5;
  const info = initial & 0x1f;
  let p = pos + 1;
  let arg: number;
  if (info < 24) arg = info;
  else if (info === 24) {
    arg = buf[p] as number;
    p += 1;
  } else if (info === 25) {
    arg = buf.readUInt16BE(p);
    p += 2;
  } else if (info === 26) {
    arg = buf.readUInt32BE(p);
    p += 4;
  } else if (info === 27) {
    const big = buf.readBigUInt64BE(p);
    p += 8;
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor : entier trop grand');
    arg = Number(big);
  } else throw new Error('cbor : longueur indéfinie non admise');
  if (p > buf.length) throw new Error('cbor : tronqué');

  switch (major) {
    case 0:
      return [arg, p];
    case 1:
      return [-1 - arg, p];
    case 2: {
      if (p + arg > buf.length) throw new Error('cbor : chaîne d\'octets tronquée');
      return [new Uint8Array(buf.subarray(p, p + arg)), p + arg];
    }
    case 3: {
      if (p + arg > buf.length) throw new Error('cbor : texte tronqué');
      return [buf.subarray(p, p + arg).toString('utf8'), p + arg];
    }
    case 4: {
      const items: Cbor[] = [];
      let q = p;
      for (let i = 0; i < arg; i++) {
        const [v, next] = decodeItem(buf, q, depth + 1);
        items.push(v);
        q = next;
      }
      return [items, q];
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      let q = p;
      for (let i = 0; i < arg; i++) {
        const [k, afterKey] = decodeItem(buf, q, depth + 1);
        const [v, afterValue] = decodeItem(buf, afterKey, depth + 1);
        map.set(k, v);
        q = afterValue;
      }
      return [map, q];
    }
    case 7: {
      if (info === 20) return [false, p];
      if (info === 21) return [true, p];
      if (info === 22) return [null, p];
      if (info === 23) return [undefined, p];
      throw new Error('cbor : type simple non admis');
    }
    default:
      throw new Error('cbor : étiquette non admise');
  }
}

// ---------- clés COSE → clé publique Node ----------

const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
const COSE_N = -1;
const COSE_E = -2;

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;

export interface ParsedPublicKey {
  alg: number;
  /** Clé publique au format SPKI, PEM : ce qui est stocké. */
  pem: string;
}

export function cosePublicKeyToPem(cose: Cbor): ParsedPublicKey {
  if (!(cose instanceof Map)) throw new Error('cose : clé attendue');
  const kty = cose.get(COSE_KTY);
  const alg = cose.get(COSE_ALG);
  if (kty === 2 && alg === ALG_ES256) {
    const crv = cose.get(COSE_CRV);
    const x = cose.get(COSE_X);
    const y = cose.get(COSE_Y);
    if (crv !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error('cose : courbe P-256 attendue');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(x), y: b64urlEncode(y) }, format: 'jwk' });
    return { alg: ALG_ES256, pem: key.export({ type: 'spki', format: 'pem' }).toString() };
  }
  if (kty === 3 && alg === ALG_RS256) {
    const n = cose.get(COSE_N);
    const e = cose.get(COSE_E);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256) throw new Error('cose : RSA 2048 au moins');
    const key = createPublicKey({ key: { kty: 'RSA', n: b64urlEncode(n), e: b64urlEncode(e) }, format: 'jwk' });
    return { alg: ALG_RS256, pem: key.export({ type: 'spki', format: 'pem' }).toString() };
  }
  throw new Error('cose : algorithme non admis (ES256 ou RS256 seulement)');
}

// ---------- authenticatorData ----------

export interface AuthData {
  rpIdHash: Buffer;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  credentialId?: Buffer;
  publicKey?: ParsedPublicKey;
}

export function parseAuthData(buf: Buffer): AuthData {
  if (buf.length < 37) throw new Error('authData : trop court');
  const rpIdHash = Buffer.from(buf.subarray(0, 32));
  const flags = buf[32] as number;
  const signCount = buf.readUInt32BE(33);
  const out: AuthData = { rpIdHash, userPresent: (flags & 0x01) !== 0, userVerified: (flags & 0x04) !== 0, signCount };
  if (flags & 0x40) {
    if (buf.length < 55) throw new Error('authData : données d\'attestation tronquées');
    const idLen = buf.readUInt16BE(53);
    if (idLen === 0 || idLen > 1023 || 55 + idLen > buf.length) throw new Error('authData : identifiant invalide');
    out.credentialId = Buffer.from(buf.subarray(55, 55 + idLen));
    const [cose] = decodeItem(buf, 55 + idLen, 0);
    out.publicKey = cosePublicKeyToPem(cose);
  }
  return out;
}

// ---------- clientDataJSON ----------

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

export function parseClientData(buf: Buffer, expectedType: 'webauthn.create' | 'webauthn.get', expectedOrigins: readonly string[]): ClientData {
  if (buf.length > 4096) throw new Error('clientData : trop long');
  let data: unknown;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('clientData : JSON invalide');
  }
  if (!data || typeof data !== 'object') throw new Error('clientData : objet attendu');
  const d = data as Record<string, unknown>;
  const type = d['type'];
  const challenge = d['challenge'];
  const origin = d['origin'];
  if (type !== expectedType) throw new Error('clientData : type inattendu');
  if (!isB64url(challenge)) throw new Error('clientData : défi invalide');
  if (typeof origin !== 'string' || !expectedOrigins.includes(origin)) throw new Error('clientData : origine inattendue');
  return { type: expectedType, challenge, origin };
}

// ---------- défis ----------

export class ChallengeStore {
  private readonly items = new Map<string, { profileId: string | null; expires: number }>();
  private readonly ttlMs: number;
  private readonly max: number;

  constructor(ttlMs = 5 * 60 * 1000, max = 10_000) {
    this.ttlMs = ttlMs;
    this.max = max;
  }

  issue(profileId: string | null): string {
    this.sweep();
    if (this.items.size >= this.max) throw new Error('trop de défis en attente');
    const c = b64urlEncode(randomBytes(32));
    this.items.set(c, { profileId, expires: Date.now() + this.ttlMs });
    return c;
  }

  /** Consomme le défi : valable une seule fois. Renvoie le profil associé (ou null), ou undefined si inconnu/expiré. */
  consume(challenge: string): { profileId: string | null } | undefined {
    const it = this.items.get(challenge);
    if (!it) return undefined;
    this.items.delete(challenge);
    if (it.expires < Date.now()) return undefined;
    return { profileId: it.profileId };
  }

  get size(): number {
    return this.items.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.items) if (v.expires < now) this.items.delete(k);
  }
}

// ---------- enregistrement ----------

export interface RegistrationInput {
  rawId: unknown;
  clientDataJSON: unknown;
  attestationObject: unknown;
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKeyPem: string;
  alg: number;
  signCount: number;
  challenge: string;
  userVerified: boolean;
}

export function verifyRegistration(input: RegistrationInput, rpId: string, expectedOrigins: readonly string[]): VerifiedRegistration {
  if (!isB64url(input.rawId) || !isB64url(input.clientDataJSON) || !isB64url(input.attestationObject)) throw new Error('enregistrement : champs invalides');
  const clientData = parseClientData(b64urlDecode(input.clientDataJSON), 'webauthn.create', expectedOrigins);
  const att = cborDecode(b64urlDecode(input.attestationObject));
  if (!(att instanceof Map)) throw new Error('attestation : objet attendu');
  if (att.get('fmt') !== 'none') throw new Error('attestation : seul le format « none » est accepté');
  const authDataRaw = att.get('authData');
  if (!(authDataRaw instanceof Uint8Array)) throw new Error('attestation : authData manquant');
  const auth = parseAuthData(Buffer.from(authDataRaw));
  if (!auth.rpIdHash.equals(createHash('sha256').update(rpId).digest())) throw new Error('authData : mauvais domaine');
  if (!auth.userPresent) throw new Error('authData : présence non attestée');
  if (!auth.credentialId || !auth.publicKey) throw new Error('authData : pas de clé');
  const credentialId = b64urlEncode(auth.credentialId);
  if (credentialId !== input.rawId) throw new Error('enregistrement : identifiant incohérent');
  return { credentialId, publicKeyPem: auth.publicKey.pem, alg: auth.publicKey.alg, signCount: auth.signCount, challenge: clientData.challenge, userVerified: auth.userVerified };
}

// ---------- authentification ----------

export interface AssertionInput {
  rawId: unknown;
  clientDataJSON: unknown;
  authenticatorData: unknown;
  signature: unknown;
}

export interface VerifiedAssertion {
  credentialId: string;
  challenge: string;
  signCount: number;
  userVerified: boolean;
}

export function verifyAssertion(input: AssertionInput, publicKeyPem: string, alg: number, storedSignCount: number, rpId: string, expectedOrigins: readonly string[]): VerifiedAssertion {
  if (!isB64url(input.rawId) || !isB64url(input.clientDataJSON) || !isB64url(input.authenticatorData) || !isB64url(input.signature)) throw new Error('authentification : champs invalides');
  const clientDataBuf = b64urlDecode(input.clientDataJSON);
  const clientData = parseClientData(clientDataBuf, 'webauthn.get', expectedOrigins);
  const authBuf = b64urlDecode(input.authenticatorData);
  const auth = parseAuthData(authBuf);
  if (!auth.rpIdHash.equals(createHash('sha256').update(rpId).digest())) throw new Error('authData : mauvais domaine');
  if (!auth.userPresent) throw new Error('authData : présence non attestée');
  const signed = Buffer.concat([authBuf, createHash('sha256').update(clientDataBuf).digest()]);
  let key: KeyObject;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('clé publique illisible');
  }
  const verifier = createVerify('sha256');
  verifier.update(signed);
  const ok = alg === ALG_ES256 ? verifier.verify({ key, dsaEncoding: 'der' }, b64urlDecode(input.signature)) : verifier.verify(key, b64urlDecode(input.signature));
  if (!ok) throw new Error('signature invalide');
  // Compteur : s'il est utilisé par l'authentificateur, il doit croître (clone détecté sinon).
  if (auth.signCount !== 0 && storedSignCount !== 0 && auth.signCount <= storedSignCount) throw new Error('compteur de signature non croissant');
  return { credentialId: input.rawId, challenge: clientData.challenge, signCount: auth.signCount, userVerified: auth.userVerified };
}
