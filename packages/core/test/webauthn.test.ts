import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cborDecode, b64urlEncode, b64urlDecode, parseAuthData, verifyRegistration, verifyAssertion, ChallengeStore, ALG_ES256, ALG_RS256,
} from '../src/webauthn.ts';
import { randomBytes } from 'node:crypto';
import { ProfileStore, generateProfileToken } from '../src/profiles.ts';
import { cborEncode, makeAuthenticator, chal, RP, ORIGIN } from './aide/authentificateur.ts';

test('CBOR : entiers, chaînes, tableaux, cartes, et refus des formes dangereuses', () => {
  const round = (v: unknown) => cborDecode(cborEncode(v));
  assert.equal(round(0), 0);
  assert.equal(round(23), 23);
  assert.equal(round(300), 300);
  assert.equal(round(-7), -7);
  assert.equal(round('été'), 'été');
  assert.deepEqual(round([1, 'a']), [1, 'a']);
  const m = round(new Map<number, unknown>([[1, 2], [-2, new Uint8Array([9])]])) as Map<number, unknown>;
  assert.equal(m.get(1), 2);
  assert.throws(() => cborDecode(Buffer.from([0x5f])), /indéfinie/);
  assert.throws(() => cborDecode(Buffer.from([0x41])), /tronqué/);
  assert.throws(() => cborDecode(Buffer.concat([cborEncode(1), cborEncode(2)])), /en trop/);
  let deep: unknown = 1;
  for (let i = 0; i < 20; i++) deep = [deep];
  assert.throws(() => cborDecode(cborEncode(deep)), /profond/);
});

test('Enregistrement puis authentification ES256 et RS256 : signatures, origine, domaine, défi, compteur', () => {
  for (const alg of [ALG_ES256, ALG_RS256]) {
    const a = makeAuthenticator(alg);
    const c1 = chal();
    const reg = verifyRegistration(a.register(c1), RP, [ORIGIN]);
    assert.equal(reg.credentialId, a.rawId);
    assert.equal(reg.alg, alg);
    assert.ok(reg.publicKeyPem.includes('BEGIN PUBLIC KEY'));
    assert.ok(reg.userVerified);
    assert.equal(reg.challenge, c1);

    const c2 = chal();
    const ok = verifyAssertion(a.assert(c2), reg.publicKeyPem, alg, 0, RP, [ORIGIN]);
    assert.equal(ok.challenge, c2);
    assert.equal(ok.signCount, 1);
    // Rejeu avec un compteur qui ne croît pas : clone détecté.
    assert.throws(() => verifyAssertion(a.assert(chal(), ORIGIN, 0x05, false), reg.publicKeyPem, alg, 1, RP, [ORIGIN]), /compteur/);
    // Mauvaise origine, mauvais domaine, signature d'une autre clé.
    assert.throws(() => verifyAssertion(a.assert(chal(), 'https://evil.example'), reg.publicKeyPem, alg, 1, RP, [ORIGIN]), /origine/);
    assert.throws(() => verifyAssertion(a.assert(chal()), reg.publicKeyPem, alg, 1, 'autre.example', [ORIGIN]), /domaine/);
    const other = makeAuthenticator(alg);
    const otherReg = verifyRegistration(other.register(chal()), RP, [ORIGIN]);
    assert.throws(() => verifyAssertion(a.assert(chal()), otherReg.publicKeyPem, alg, 1, RP, [ORIGIN]), /signature/);
    // Présence non attestée.
    assert.throws(() => verifyAssertion(a.assert(chal(), ORIGIN, 0x04), reg.publicKeyPem, alg, 1, RP, [ORIGIN]), /présence/);
  }
});

test('Enregistrement : formats refusés', () => {
  const a = makeAuthenticator();
  assert.throws(() => verifyRegistration({ rawId: 'x', clientDataJSON: 'y', attestationObject: 'z' }, RP, [ORIGIN]), /invalides/);
  assert.throws(() => verifyRegistration(a.register(chal(), 'http://jeux.example'), RP, [ORIGIN]), /origine/);
  assert.throws(() => verifyRegistration(a.register(chal()), 'autre.example', [ORIGIN]), /domaine/);
  const r = a.register(chal());
  assert.throws(() => verifyRegistration({ ...r, rawId: b64urlEncode(randomBytes(32)) }, RP, [ORIGIN]), /incohérent/);
  assert.throws(() => parseAuthData(Buffer.alloc(10)), /court/);
});

test('ChallengeStore : usage unique, expiration, plafond', () => {
  const cs = new ChallengeStore(50, 3);
  const c = cs.issue('p1');
  assert.deepEqual(cs.consume(c), { profileId: 'p1' });
  assert.equal(cs.consume(c), undefined, 'usage unique');
  const c2 = cs.issue(null);
  cs.issue(null);
  cs.issue(null);
  assert.throws(() => cs.issue(null), /trop/);
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      assert.equal(cs.consume(c2), undefined, 'expiré');
      resolve();
    }, 80);
  });
});

test('ProfileStore : passkeys et sessions, export, révocation, cascade', () => {
  const store = new ProfileStore(':memory:');
  const token = generateProfileToken();
  const p = store.create(token, 'Régis', 1)!;
  const a = makeAuthenticator();
  const reg = verifyRegistration(a.register(chal()), RP, [ORIGIN]);
  const pk = store.addPasskey(p.id, { id: reg.credentialId, publicKeyPem: reg.publicKeyPem, alg: reg.alg, signCount: reg.signCount, name: '<b>Mon téléphone</b>' });
  assert.ok(pk && pk.name === 'bMon téléphoneb');
  assert.equal(store.addPasskey(p.id, { id: reg.credentialId, publicKeyPem: 'x', alg: -7, signCount: 0, name: 'doublon' }), null);
  const found = store.findPasskey(reg.credentialId)!;
  assert.equal(found.profileId, p.id);
  store.touchPasskey(reg.credentialId, 5);
  assert.equal(store.findPasskey(reg.credentialId)!.signCount, 5);
  const session = store.createSession(p.id)!;
  assert.notEqual(session, token);
  assert.equal(store.getByToken(session)!.id, p.id, 'un jeton de session ouvre le profil');
  assert.equal(store.getByToken(token)!.id, p.id, 'le jeton d\'origine aussi');
  const ex = store.export(p.id)!;
  assert.equal(ex.passkeys.length, 1);
  assert.equal(ex.sessions, 1);
  assert.ok(!JSON.stringify(ex).includes('BEGIN PUBLIC KEY'), 'la clé publique ne figure pas dans l\'export');
  assert.equal(store.revokeSessions(p.id), 1);
  assert.equal(store.getByToken(session), null);
  assert.ok(store.deletePasskey(p.id, reg.credentialId));
  assert.ok(!store.deletePasskey(p.id, reg.credentialId));
  const s2 = store.createSession(p.id)!;
  assert.ok(store.delete(p.id));
  assert.equal(store.getByToken(s2), null, 'cascade');
  store.close();
});
