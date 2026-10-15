/*
 * Jeux de cartes — Copyright (C) 2026 regis57
 * Licensed under the GNU Affero General Public License v3.0 or later.
 */

/** Authentificateur WebAuthn simulé, pour les tests seulement. */
import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { b64urlEncode, b64urlDecode, ALG_ES256, ALG_RS256 } from '../../src/webauthn.ts';

/** Encodeur CBOR minimal, côté test seulement : ce que fabrique un authentificateur. */
export function cborEncode(v: unknown): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) {
      const b = Buffer.alloc(3);
      b[0] = (major << 5) | 25;
      b.writeUInt16BE(n, 1);
      return b;
    }
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, b.length), b]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cborEncode)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v.entries()].flatMap(([k, val]) => [cborEncode(k), cborEncode(val)])]);
  throw new Error('non encodable');
}

export const RP = 'jeux.example';
export const chal = (): string => b64urlEncode(randomBytes(32));
export const ORIGIN = 'https://jeux.example';

/** Un authentificateur simulé : clé P-256 (ou RSA), identifiant, compteur. */
export function makeAuthenticator(alg: number = ALG_ES256, rp: string = RP) {
  const pair = alg === ALG_ES256 ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' }) as Record<string, string>;
  const credId = randomBytes(32);
  let counter = 0;
  const cose = alg === ALG_ES256
    ? new Map<number, unknown>([[1, 2], [3, ALG_ES256], [-1, 1], [-2, b64urlDecode(jwk['x']!)], [-3, b64urlDecode(jwk['y']!)]])
    : new Map<number, unknown>([[1, 3], [3, ALG_RS256], [-1, b64urlDecode(jwk['n']!)], [-2, b64urlDecode(jwk['e']!)]]);
  const rpIdHash = createHash('sha256').update(rp).digest();
  const authData = (flags: number, withKey: boolean): Buffer => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    const parts: Buffer[] = [rpIdHash, Buffer.from([flags]), count];
    if (withKey) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      parts.push(Buffer.alloc(16), len, credId, cborEncode(cose));
    }
    return Buffer.concat(parts);
  };
  return {
    rawId: b64urlEncode(credId),
    register(challenge: string, origin = ORIGIN, flags = 0x45) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
      const attestationObject = cborEncode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(flags, true)]]));
      return { rawId: b64urlEncode(credId), clientDataJSON: b64urlEncode(clientDataJSON), attestationObject: b64urlEncode(attestationObject) };
    },
    assert(challenge: string, origin = ORIGIN, flags = 0x05, bumpCounter = true) {
      if (bumpCounter) counter += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const auth = authData(flags, false);
      const signer = createSign('sha256');
      signer.update(Buffer.concat([auth, createHash('sha256').update(clientDataJSON).digest()]));
      const signature = alg === ALG_ES256 ? signer.sign({ key: pair.privateKey, dsaEncoding: 'der' }) : signer.sign(pair.privateKey);
      return { rawId: b64urlEncode(credId), clientDataJSON: b64urlEncode(clientDataJSON), authenticatorData: b64urlEncode(auth), signature: b64urlEncode(signature) };
    },
  };
}

