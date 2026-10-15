import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import {
  sanitizeName, isValidTableId, isValidInviteCode, isValidProfileToken, isValidRejoinKey,
  createRateLimiter, isOriginAllowed, parseAllowedOrigins, getClientIp, parseTrustProxy, CSP,
} from '../src/security.ts';

test('sanitizeName : HTML, contrôle, bidi, longueur, vide, non-chaîne', () => {
  assert.equal(sanitizeName('<img src=x onerror=alert(1)>'), 'img srcx onerroraler', 'balises retirées, 20 caractères');
  assert.equal(sanitizeName('Jean‮\u0000Pierre'), 'JeanPierre');
  assert.equal(sanitizeName('   Marie   Claire  '), 'Marie Claire');
  assert.equal(sanitizeName('a'.repeat(100)).length, 20);
  assert.equal(sanitizeName(''), 'Joueur');
  assert.equal(sanitizeName({ toString: () => 'x' }), 'Joueur');
  assert.equal(sanitizeName("O'Néal-Dupont_1.2"), "O'Néal-Dupont_1.2");
  assert.equal(sanitizeName('élodie'), 'élodie');
});

test('identifiants : table, code d\'invitation, jeton de profil, clé de reprise', () => {
  assert.ok(isValidTableId('solo_0123456789abcdef'));
  assert.ok(isValidTableId('private_' + 'a'.repeat(64)));
  assert.ok(!isValidTableId('admin_0123456789abcdef'));
  assert.ok(!isValidTableId('solo_../x'));
  assert.ok(!isValidTableId({ toString: () => 'solo_0123456789' }));
  assert.ok(isValidInviteCode('ABCD23'));
  assert.ok(!isValidInviteCode('ABCD01'));
  assert.ok(!isValidInviteCode('abcd23'));
  assert.ok(isValidProfileToken('A'.repeat(52)));
  assert.ok(!isValidProfileToken('A'.repeat(51)));
  assert.ok(!isValidProfileToken('a'.repeat(52)));
  assert.ok(isValidRejoinKey('123e4567-e89b-42d3-a456-426614174000'));
  assert.ok(!isValidRejoinKey('123e4567-e89b-12d3-a456-426614174000'));
});

test('createRateLimiter : rafale puis régime établi', () => {
  let t = 0;
  const allow = createRateLimiter({ capacity: 3, refillPerSec: 1, now: () => t });
  assert.ok(allow() && allow() && allow());
  assert.ok(!allow());
  t = 1000;
  assert.ok(allow());
  assert.ok(!allow());
});

test('isOriginAllowed : même origine, liste blanche, schémas interdits, absence', () => {
  assert.ok(isOriginAllowed(undefined, 'x', []));
  assert.ok(isOriginAllowed('http://localhost:3000', 'localhost:3000', []));
  assert.ok(!isOriginAllowed('http://evil.example', 'localhost:3000', []));
  assert.ok(isOriginAllowed('https://jeux.example', 'ignored', ['https://jeux.example']));
  assert.ok(!isOriginAllowed('https://jeux.example.evil', 'ignored', ['https://jeux.example']));
  assert.ok(!isOriginAllowed('javascript:alert(1)', 'x', []));
  assert.ok(!isOriginAllowed('not a url', 'x', []));
  assert.deepEqual(parseAllowedOrigins(' https://a.example/path , bad , http://b.example:8080 '), ['https://a.example', 'http://b.example:8080']);
});

test('getClientIp : cloudflare, xff, aucun proxy, valeurs forgées', () => {
  const socket = { remoteAddress: '10.0.0.9' } as Socket;
  const req = (headers: Record<string, string>) => ({ headers, socket });
  assert.equal(getClientIp(req({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '1.1.1.1' }), 'cloudflare'), '203.0.113.5');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '1.1.1.1' }), 'cloudflare'), '10.0.0.9', 'sans CF-Connecting-IP on retombe sur la socket');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }), 'xff'), '198.51.100.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '<script>' }), 'xff'), '10.0.0.9');
  assert.equal(getClientIp(req({ 'cf-connecting-ip': '203.0.113.5' }), 'none'), '10.0.0.9');
  assert.equal(parseTrustProxy('cloudflare'), 'cloudflare');
  assert.equal(parseTrustProxy('1'), 'xff');
  assert.equal(parseTrustProxy(undefined), 'none');
});

test('CSP : aucun inline, aucun tiers', () => {
  assert.ok(CSP.includes("default-src 'none'"));
  assert.ok(!CSP.includes('unsafe'));
  assert.ok(!CSP.includes('http'));
});
