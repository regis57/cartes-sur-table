import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateProfileToken } from '@jdc/core';
import { createApp } from '../src/app.ts';
import { makeAuthenticator, RP, ORIGIN } from '../../core/test/aide/authentificateur.ts';

const FAST = { port: 0, host: '127.0.0.1', timings: { botDelay: 5, forcedDelay: 5, afkTimeout: 60_000 }, botThinkMs: 5, matchmakingSeconds: 60 };

async function boot(extra: Record<string, unknown> = {}) {
  const server = createApp({ ...FAST, ...extra });
  const addr = await server.start();
  return { server, port: addr.port };
}

function req(port: number, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      { host: '127.0.0.1', port, path: p, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: out ? (JSON.parse(out) as Record<string, unknown>) : {} }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test('Passkeys : enregistrement, connexion, session, révocation, suppression', async () => {
  const { server, port } = await boot({ publicOrigin: ORIGIN, allowedOrigins: [ORIGIN] });
  try {
    const token = generateProfileToken();
    assert.equal((await req(port, 'POST', '/api/profil', { token, pseudo: 'Régis', avatar: 2 })).status, 201);

    // sans profil : refus
    assert.equal((await req(port, 'POST', '/api/passkeys/options', {})).status, 401);

    const opt = await req(port, 'POST', '/api/passkeys/options', {}, auth(token));
    assert.equal(opt.status, 200);
    assert.equal((opt.json['rp'] as { id: string }).id, RP);
    const a = makeAuthenticator();
    const reg = a.register(opt.json['challenge'] as string);

    // un défi ne sert qu'une fois, et pour le bon profil
    const other = generateProfileToken();
    assert.equal((await req(port, 'POST', '/api/profil', { token: other, pseudo: 'Autre', avatar: 1 })).status, 201);
    assert.equal((await req(port, 'POST', '/api/passkeys', { ...reg, name: 'Pirate' }, auth(other))).status, 400);
    // le défi est brûlé par la tentative, même pour le bon profil
    assert.equal((await req(port, 'POST', '/api/passkeys', { ...reg, name: 'Tablette' }, auth(token))).status, 400);
    const opt2 = await req(port, 'POST', '/api/passkeys/options', {}, auth(token));
    const reg2 = a.register(opt2.json['challenge'] as string);
    const added = await req(port, 'POST', '/api/passkeys', { ...reg2, name: ' Tablette ' }, auth(token));
    assert.equal(added.status, 201);
    assert.equal((added.json['passkey'] as { name: string }).name, 'Tablette');
    assert.equal((await req(port, 'POST', '/api/passkeys', { ...reg2, name: 'Encore' }, auth(token))).status, 400);

    // l'export mentionne la passkey, pas la clé
    const exp = await req(port, 'GET', '/api/profil/export', undefined, auth(token));
    const keys = exp.json['passkeys'] as { id: string; name: string }[];
    assert.equal(keys.length, 1);
    assert.ok(!JSON.stringify(exp.json).includes('BEGIN PUBLIC KEY'));

    // connexion par passkey → jeton de session, différent du jeton d'origine
    const aopt = await req(port, 'POST', '/api/passkeys/auth/options', {});
    assert.equal(aopt.json['rpId'], RP);
    const asr = a.assert(aopt.json['challenge'] as string);
    const login = await req(port, 'POST', '/api/passkeys/auth', asr);
    assert.equal(login.status, 200);
    const session = login.json['token'] as string;
    assert.ok(session && session !== token);
    assert.equal((login.json['profile'] as { pseudo: string }).pseudo, 'Régis');
    assert.equal((await req(port, 'POST', '/api/passkeys/auth', asr)).status, 401); // rejeu : compteur figé, défi consommé

    // la session vaut un jeton de profil
    const me = await req(port, 'GET', '/api/profil', undefined, auth(session));
    assert.equal(me.status, 200);
    assert.equal((me.json['profile'] as { pseudo: string }).pseudo, 'Régis');

    // compteur qui n'avance pas (clone) → refus ; mauvaise origine → refus
    const aopt3 = await req(port, 'POST', '/api/passkeys/auth/options', {});
    assert.equal((await req(port, 'POST', '/api/passkeys/auth', a.assert(aopt3.json['challenge'] as string, ORIGIN, 0x05, false))).status, 401);
    const aopt2 = await req(port, 'POST', '/api/passkeys/auth/options', {});
    assert.equal((await req(port, 'POST', '/api/passkeys/auth', a.assert(aopt2.json['challenge'] as string, 'https://pirate.example'))).status, 401);

    // passkey inconnue
    const b = makeAuthenticator();
    const aopt4 = await req(port, 'POST', '/api/passkeys/auth/options', {});
    assert.equal((await req(port, 'POST', '/api/passkeys/auth', b.assert(aopt4.json['challenge'] as string))).status, 401);

    // révocation des sessions : la session tombe, le jeton d'origine reste
    const rev = await req(port, 'POST', '/api/profil/sessions/revoke', {}, auth(token));
    assert.equal(rev.json['revoked'], 1);
    assert.equal((await req(port, 'GET', '/api/profil', undefined, auth(session))).status, 401);
    assert.equal((await req(port, 'GET', '/api/profil', undefined, auth(token))).status, 200);

    // suppression de la passkey : l'autre profil ne peut pas, le propriétaire oui
    assert.equal((await req(port, 'DELETE', `/api/passkeys/${keys[0]!.id}`, undefined, auth(other))).status, 404);
    assert.equal((await req(port, 'DELETE', `/api/passkeys/${keys[0]!.id}`, undefined, auth(token))).status, 200);
    const aopt5 = await req(port, 'POST', '/api/passkeys/auth/options', {});
    assert.equal((await req(port, 'POST', '/api/passkeys/auth', a.assert(aopt5.json['challenge'] as string))).status, 401);
  } finally {
    await server.close();
  }
});

test('Passkeys : la suppression du profil par une session emporte tout', async () => {
  const { server, port } = await boot({ publicOrigin: ORIGIN, allowedOrigins: [ORIGIN] });
  try {
    const token = generateProfileToken();
    await req(port, 'POST', '/api/profil', { token, pseudo: 'Léa', avatar: 5 });
    const opt = await req(port, 'POST', '/api/passkeys/options', {}, auth(token));
    const a = makeAuthenticator();
    assert.equal((await req(port, 'POST', '/api/passkeys', { ...a.register(opt.json['challenge'] as string), name: 'PC' }, auth(token))).status, 201);
    const aopt = await req(port, 'POST', '/api/passkeys/auth/options', {});
    const login = await req(port, 'POST', '/api/passkeys/auth', a.assert(aopt.json['challenge'] as string));
    const session = login.json['token'] as string;
    assert.equal((await req(port, 'DELETE', '/api/profil', undefined, auth(session))).status, 200);
    assert.equal((await req(port, 'GET', '/api/profil', undefined, auth(token))).status, 401);
    const aopt2 = await req(port, 'POST', '/api/passkeys/auth/options', {});
    assert.equal((await req(port, 'POST', '/api/passkeys/auth', a.assert(aopt2.json['challenge'] as string))).status, 401);
  } finally {
    await server.close();
  }
});
