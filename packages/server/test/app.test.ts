import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { generateProfileToken, FEMALE_NAMES, MALE_NAMES, EMOJI_CODES } from '@jdc/core';
import { PHRASES } from '@jdc/huit-americain';
import { createApp, CLIENT_DIR } from '../src/app.ts';
import { GAMES } from '../src/games.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FAST = { port: 0, host: '127.0.0.1', timings: { botDelay: 5, forcedDelay: 5, afkTimeout: 60_000 }, botThinkMs: 5, matchmakingSeconds: 60 };

async function boot(extra: Record<string, unknown> = {}) {
  const server = createApp({ ...FAST, ...extra });
  const addr = await server.start();
  const url = `http://127.0.0.1:${addr.port}`;
  return { server, url, port: addr.port };
}

function client(url: string, opts: Record<string, unknown> = {}): Socket {
  return connect(`${url}/jeu/huit-americain`, { transports: ['websocket'], reconnection: false, forceNew: true, ...opts });
}

const once = <T = unknown>(sock: Socket, ev: string, ms = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + ev)), ms);
    sock.once(ev, (d: T) => {
      clearTimeout(t);
      resolve(d);
    });
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function req(port: number, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      { host: '127.0.0.1', port, path: p, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: out }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

interface View { tableId: string; seat: number; game: { current: number; legal: { key: string; move: { type: string } }[]; hand: unknown[]; roundOver: boolean }; seats: { name: string; isBot: boolean }[] }

test('HTTP : en-têtes de sécurité, pages servies, rien de caché ni de hors-dossier', async () => {
  const { server, port } = await boot();
  try {
    const r = await req(port, 'GET', '/');
    assert.equal(r.status, 200);
    assert.ok(r.headers['content-security-policy']?.includes("default-src 'none'"));
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-powered-by'], undefined);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    const lower = r.body.toLowerCase();
    assert.ok(!lower.includes('onclick=') && !lower.includes(' style=') && !lower.includes('<script>'), 'HTML sans script ni style en ligne');
    for (const p of ['/profil/', '/donnees/', '/confidentialite/', '/mentions-legales/', '/soutenir/', '/a-propos/', '/regles/', '/installer/', '/hors-ligne/', '/jeu/huit-americain/', '/js/accueil.js', '/css/site.css', '/i18n/fr.json', '/img/avatars/a01.svg', '/img/emotes/sourire.svg', '/healthz', '/socket.io/socket.io.esm.min.js']) {
      assert.equal((await req(port, 'GET', p)).status, 200, p);
    }
    for (const p of ['/package.json', '/.env', '/.git/config', '/../package.json', '/%2e%2e/package.json', '/js/../../src/app.ts', '/src/app.ts', '/api/inconnu']) {
      assert.notEqual((await req(port, 'GET', p)).status, 200, p);
    }
    const nf = await req(port, 'GET', '/nulle-part');
    assert.equal(nf.status, 404);
    assert.ok(nf.body.includes('Mauvaise pioche'));
    const v = await req(port, 'GET', '/api/version');
    assert.equal(JSON.parse(v.body).version, '0.1.0');
    assert.equal(v.headers['cache-control'], 'no-store');
    const g = JSON.parse((await req(port, 'GET', '/api/jeux')).body);
    assert.deepEqual(g.games.map((x: { id: string }) => x.id), ['huit-americain', 'tarot', 'belote']);
    assert.deepEqual(g.games[1].seatCounts, [4, 5]);
    assert.equal(g.games[1].status, 'available');
    assert.equal(g.games[2].status, 'available');
    assert.deepEqual(g.games[2].seatCounts, [4]);
    assert.equal(g.avatars, 12);
  } finally {
    await server.close();
  }
});

test('HTTP : redirection vers HTTPS derrière le tunnel, HSTS seulement en HTTPS', async () => {
  const { server, port } = await boot({ publicOrigin: 'https://jeux.example', trustProxy: 'cloudflare' });
  try {
    const r = await req(port, 'GET', '/profil/?x=1', undefined, { 'x-forwarded-proto': 'http' });
    assert.equal(r.status, 301);
    assert.equal(r.headers['location'], 'https://jeux.example/profil/?x=1');
    const h = await req(port, 'GET', '/healthz', undefined, { 'x-forwarded-proto': 'http' });
    assert.equal(h.status, 200, 'le contrôle de santé n\'est pas redirigé');
    const s = await req(port, 'GET', '/', undefined, { 'x-forwarded-proto': 'https' });
    assert.ok(s.headers['strict-transport-security']?.includes('max-age=31536000'));
    assert.equal((await req(port, 'GET', '/')).headers['strict-transport-security'], undefined);
  } finally {
    await server.close();
  }
});

test('API profil : création, lecture, modification, export, suppression ; jetons refusés', async () => {
  const { server, port } = await boot();
  try {
    const token = generateProfileToken();
    assert.equal((await req(port, 'POST', '/api/profil', { token: 'court', pseudo: 'x' })).status, 400);
    const c = await req(port, 'POST', '/api/profil', { token, pseudo: '<b>Régis</b>', avatar: 3 });
    assert.equal(c.status, 201);
    assert.equal(JSON.parse(c.body).profile.pseudo, 'bRégisb');
    assert.equal((await req(port, 'POST', '/api/profil', { token, pseudo: 'x' })).status, 409);
    assert.equal((await req(port, 'GET', '/api/profil')).status, 401);
    assert.equal((await req(port, 'GET', '/api/profil', undefined, { Authorization: `Bearer ${generateProfileToken()}` })).status, 401);
    const auth = { Authorization: `Bearer ${token}` };
    const g = await req(port, 'GET', '/api/profil', undefined, auth);
    assert.equal(g.status, 200);
    assert.equal(JSON.parse(g.body).profile.avatar, 3);
    const u = await req(port, 'PATCH', '/api/profil', { pseudo: 'Régis', avatar: 11 }, auth);
    assert.equal(JSON.parse(u.body).profile.avatar, 11);
    const big = await req(port, 'PATCH', '/api/profil', { pseudo: 'a'.repeat(10_000) }, auth);
    assert.equal(big.status, 413, 'charge utile limitée');
    const e = await req(port, 'GET', '/api/profil/export', undefined, auth);
    assert.ok(e.headers['content-disposition']?.includes('attachment'));
    assert.equal(JSON.parse(e.body).profile.pseudo, 'Régis');
    assert.ok(!e.body.includes(token), 'le jeton ne figure pas dans l\'export');
    const d = await req(port, 'DELETE', '/api/profil', undefined, auth);
    assert.equal(JSON.parse(d.body).deleted, true);
    assert.equal((await req(port, 'GET', '/api/profil', undefined, auth)).status, 401);
    assert.equal((await req(port, 'DELETE', '/api/profil', undefined, auth)).status, 404);
    assert.equal(server.store.count, 0);
  } finally {
    await server.close();
  }
});

test('Socket : origine étrangère refusée, même origine acceptée, plafond par IP', async () => {
  const { server, url } = await boot({ maxConnPerIp: 2 });
  try {
    const evil = client(url, { extraHeaders: { Origin: 'https://evil.example' } });
    await once(evil, 'connect_error');
    evil.close();
    const { port } = new URL(url);
    const ok = client(url, { extraHeaders: { Origin: `http://127.0.0.1:${port}` } });
    await once(ok, 'connect');
    const ok2 = client(url);
    await once(ok2, 'connect');
    const third = client(url);
    await once(third, 'connect_error');
    ok.close();
    ok2.close();
    third.close();
  } finally {
    await server.close();
  }
});

test('Solo : partie démarrée, pseudo assaini, main privée, bots à parité, aucun identifiant interne', async () => {
  const { server, url } = await boot();
  try {
    const c = client(url);
    await once(c, 'connect');
    const seat = once<{ tableId: string; seat: number; rejoinKey: string }>(c, 'seat');
    const state = once<View>(c, 'state');
    c.emit('solo', { name: '<img src=x onerror=alert(1)>', avatar: 99 });
    const s = await seat;
    assert.match(s.tableId, /^solo_/);
    assert.match(s.rejoinKey, /^[0-9a-f-]{36}$/);
    const v = await state;
    assert.equal(v.seat, s.seat);
    assert.ok(!/[<>]/.test(v.seats[v.seat]!.name));
    assert.equal(v.game.hand.length, 6);
    const json = JSON.stringify(v);
    assert.ok(!json.includes('"deck"') && !json.includes('"hands"') && !json.includes('humanId') && !json.includes('rejoinKey') && !json.includes('profileId'));
    const bots = v.seats.filter((x) => x.isBot).map((x) => x.name);
    assert.equal(bots.length, 3);
    const f = bots.filter((n) => FEMALE_NAMES.includes(n)).length;
    const m = bots.filter((n) => MALE_NAMES.includes(n)).length;
    assert.equal(f + m, 3);
    assert.ok(Math.abs(f - m) <= 1);
    assert.equal(server.tables.size, 1);
    c.close();
    await wait(50);
  } finally {
    await server.close();
  }
});

test('Solo : un humain joue une manche entière contre les bots (coups par clé)', async () => {
  const { server, url } = await boot();
  try {
    const c = client(url);
    await once(c, 'connect');
    let last: View | null = null;
    let tableId = '';
    c.on('state', (v: View) => {
      last = v;
      tableId = v.tableId;
      if (!v.game.roundOver && v.game.current === v.seat) {
        const play = v.game.legal.find((l) => l.move.type === 'play') ?? v.game.legal[0];
        if (play && v.game.legal.length > 1) c.emit('move', { tableId, key: play.key });
      }
    });
    const end = once<{ summary: { roundWinner: number | null }; achievements: string[][] }>(c, 'roundEnd', 20_000);
    c.emit('solo', { name: 'Régis', level: 'facile' });
    const e = await end;
    assert.ok(e.summary.roundWinner !== null);
    assert.equal(e.achievements.length, 4);
    assert.ok(last !== null && (last as View).game.roundOver);
    c.emit('nextRound', { tableId });
    const v2 = await once<View>(c, 'state');
    assert.ok(!v2.game.roundOver);
    c.close();
  } finally {
    await server.close();
  }
});

test('En ligne : deux humains, file, départ forcé, bots complètent ; coupure → bot → reprise', async () => {
  const { server, url } = await boot({ rejoinGraceMs: 2000 });
  try {
    const a = client(url);
    const b = client(url);
    await once(a, 'connect');
    await once(b, 'connect');
    const statusA = once<{ players: unknown[]; countdown: number }>(a, 'queueStatus');
    a.emit('joinQueue', { name: 'Anna', avatar: 1 });
    assert.equal((await statusA).countdown, 60);
    b.emit('joinQueue', { name: 'Bob', avatar: 2 });
    await wait(50);
    const seatA = once<{ tableId: string; seat: number; rejoinKey: string }>(a, 'seat');
    const seatB = once<{ tableId: string; seat: number; rejoinKey: string }>(b, 'seat');
    const stateA = once<View>(a, 'state');
    a.emit('forceStart');
    const sa = await seatA;
    const sb = await seatB;
    assert.equal(sa.tableId, sb.tableId);
    assert.match(sa.tableId, /^online_/);
    const va = await stateA;
    assert.equal(va.seats.filter((s) => !s.isBot).length, 2);
    assert.equal(va.seats.filter((s) => s.isBot).length, 2);

    // B coupe : A voit le siège passer en attente, puis B revient avec sa clé.
    const seatsEv = once<{ seats: { isBot: boolean; awaiting: boolean }[] }>(a, 'seats');
    b.close();
    const se = await seatsEv;
    assert.ok(se.seats[sb.seat]!.isBot && se.seats[sb.seat]!.awaiting);
    const b2 = client(url);
    await once(b2, 'connect');
    const back = once<View>(b2, 'state');
    b2.emit('rejoin', { tableId: sb.tableId, rejoinKey: sb.rejoinKey });
    const vb = await back;
    assert.equal(vb.seat, sb.seat);
    assert.ok(!vb.seats[sb.seat]!.isBot);
    // Clé fausse : refusée proprement.
    const c = client(url);
    await once(c, 'connect');
    const err = once<{ code: string }>(c, 'error');
    c.emit('rejoin', { tableId: sb.tableId, rejoinKey: '123e4567-e89b-42d3-a456-426614174000' });
    assert.equal((await err).code, 'reprise-impossible');
    a.close();
    b2.close();
    c.close();
  } finally {
    await server.close();
  }
});

test('Table privée : code, invité, hôte lance, sièges complétés par des bots ; code faux refusé', async () => {
  const { server, url } = await boot();
  try {
    const host = client(url);
    const guest = client(url);
    await once(host, 'connect');
    await once(guest, 'connect');
    const st = once<{ code: string; isHost: boolean; players: unknown[] }>(host, 'privateStatus');
    host.emit('createPrivate', { name: 'Hôte', avatar: 0 });
    const s = await st;
    assert.match(s.code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.ok(s.isHost);
    const bad = once<{ code: string }>(guest, 'error');
    guest.emit('joinPrivate', { name: 'Invité', code: 'ABCD01' });
    assert.equal((await bad).code, 'code-invalide');
    const nf = once<{ code: string }>(guest, 'error');
    guest.emit('joinPrivate', { name: 'Invité', code: 'ZZZZZZ' });
    assert.equal((await nf).code, 'table-introuvable');
    const st2 = once<{ players: unknown[]; isHost: boolean }>(guest, 'privateStatus');
    guest.emit('joinPrivate', { name: 'Invité', code: s.code.toLowerCase() });
    const g = await st2;
    assert.equal(g.players.length, 2);
    assert.ok(!g.isHost);
    const seatG = once<{ tableId: string }>(guest, 'seat');
    guest.emit('startPrivate');
    await wait(80);
    assert.equal(server.tables.size, 0, 'seul l\'hôte lance');
    const stateG = once<View>(guest, 'state');
    host.emit('startPrivate');
    const sg = await seatG;
    assert.match(sg.tableId, /^private_/);
    const v = await stateG;
    assert.equal(v.seats.filter((x) => !x.isBot).length, 2);
    host.close();
    guest.close();
  } finally {
    await server.close();
  }
});

test('Profils : une partie complète avec jeton crédite les statistiques et les succès', async () => {
  // Une partie entière en quelques secondes dépasse la limite de débit d'un humain : on la lève ici.
  const { server, url, port } = await boot({ rateBurst: 5000, ratePerSec: 5000 });
  try {
    const token = generateProfileToken();
    await req(port, 'POST', '/api/profil', { token, pseudo: 'Régis', avatar: 2 });
    const c = client(url, { auth: { token } });
    await once(c, 'connect');
    let tableId = '';
    c.on('state', (v: View) => {
      tableId = v.tableId;
      if (!v.game.roundOver && v.game.current === v.seat && v.game.legal.length > 1) {
        const play = v.game.legal.find((l) => l.move.type === 'play') ?? v.game.legal[0]!;
        c.emit('move', { tableId, key: play.key });
      }
    });
    c.on('roundEnd', (e: { matchOver: boolean }) => {
      if (!e.matchOver) setTimeout(() => c.emit('nextRound', { tableId }), 5);
    });
    const unlocked = once<{ codes: string[] }>(c, 'achievements', 120_000);
    c.emit('solo', { name: 'ignoré', level: 'facile' });
    const u = await unlocked;
    assert.ok(u.codes.includes('premiere-partie'));
    const v = await once<View>(c, 'state').catch(() => null);
    void v;
    const ex = JSON.parse((await req(port, 'GET', '/api/profil', undefined, { Authorization: `Bearer ${token}` })).body);
    assert.equal(ex.profile.pseudo, 'Régis', 'le pseudo du profil prime sur celui déclaré');
    assert.equal(ex.stats[0].game, 'huit-americain');
    assert.equal(ex.stats[0].matches, 1);
    assert.ok(ex.achievements.some((a: { code: string }) => a.code === 'premiere-partie'));
    c.close();
  } finally {
    await server.close();
  }
});

test('Robustesse : charges utiles malveillantes, rafale, texte libre refusé', async () => {
  const { server, url } = await boot({ rateBurst: 5000, ratePerSec: 5000 });
  try {
    const c = client(url);
    await once(c, 'connect');
    const seat = once<{ tableId: string }>(c, 'seat');
    c.emit('solo', { name: 'Test' });
    const { tableId } = await seat;
    const junk = [undefined, null, 0, 'x', [], {}, { tableId }, { tableId, key: 7 }, { tableId, key: 'a'.repeat(500) }, { tableId: '../x', key: 'draw' },
      { tableId: { toString: () => tableId }, key: 'draw' }, { tableId, key: { $ne: 1 } }];
    for (const j of junk) {
      c.emit('move', j as never);
      c.emit('emote', j as never);
      c.emit('rejoin', j as never);
      c.emit('nextRound', j as never);
      c.emit('restart', j as never);
      c.emit('quit', { tableId: '../x' } as never);
    }
    c.emit('emote', { tableId, kind: 'texte', code: 'bonjour à tous' } as never);
    c.emit('emote', { tableId, kind: 'phrase', code: '<script>' });
    c.emit('solo', { a: 1 } as never);
    c.emit('joinQueue', null as never);
    c.emit('createPrivate', 'x' as never);
    c.emit('joinPrivate', { code: ['A'] } as never);
    await wait(150);
    assert.equal(server.tables.size, 1, 'une seule table par joueur');
    const ok = once(c, 'emote');
    c.emit('emote', { tableId, kind: 'phrase', code: PHRASES[0]! });
    await ok;
    c.emit('quit', { tableId });
    await wait(50);
    assert.equal(server.tables.size, 0, 'départ volontaire du dernier humain : table libérée');
    c.close();
    const c2 = client(url);
    await once(c2, 'connect');
    c2.close();
  } finally {
    await server.close();
  }
});

test('Rafale : un client qui inonde est déconnecté, le serveur reste debout', async () => {
  const { server, url } = await boot({ rateBurst: 10, ratePerSec: 1 });
  try {
    const c = client(url);
    await once(c, 'connect');
    const gone = once(c, 'disconnect', 5000);
    for (let i = 0; i < 100; i++) c.emit('leaveQueue');
    await gone;
    const c2 = client(url);
    await once(c2, 'connect');
    c2.close();
  } finally {
    await server.close();
  }
});

test('Cohérence : le dictionnaire du client couvre les émoticônes, les phrases et les succès de chaque jeu', () => {
  const fr = JSON.parse(readFileSync(path.join(CLIENT_DIR, 'i18n', 'fr.json'), 'utf8'));
  assert.deepEqual(Object.keys(fr.emotes).sort(), [...EMOJI_CODES].sort());
  for (const code of EMOJI_CODES) readFileSync(path.join(CLIENT_DIR, 'img', 'emotes', `${code}.svg`));
  // Les réactions sont dans la salle commune ; chaque jeu porte ses douze phrases.
  const salle = readFileSync(path.join(CLIENT_DIR, 'js', 'salle.js'), 'utf8');
  for (const code of EMOJI_CODES) assert.ok(salle.includes(`'${code}'`), `émoticône ${code} connue de la salle`);
  for (const g of GAMES) {
    const id = g.meta.id;
    assert.equal(g.def.phrases.length, 12, `${id} : douze phrases`);
    assert.deepEqual(Object.keys(fr.phrases[id]).sort(), [...g.def.phrases].sort(), `${id} : phrases traduites`);
    const client = readFileSync(path.join(CLIENT_DIR, 'js', `jeu-${id}.js`), 'utf8');
    for (const code of g.def.phrases) assert.ok(client.includes(`'${code}'`), `${id} : phrase ${code} connue du client`);
    assert.ok(fr.games[id]?.name && fr.games[id]?.blurb, `${id} : nom et présentation`);
    assert.ok(fr.games[id]?.rules?.['1'], `${id} : règles affichables`);
    readFileSync(path.join(CLIENT_DIR, 'jeu', id, 'index.html'));
  }
  for (const code of ['premiere-partie', 'premiere-victoire', 'dix-victoires', 'cinquante-parties', 'touche-a-tout',
    'huit-americain:huit-magique', 'huit-americain:sans-pioche', 'huit-americain:coup-du-sept', 'huit-americain:manche-parfaite',
    'tarot:garde-sans-filet', 'tarot:trois-bouts', 'tarot:petit-au-bout', 'tarot:grande-poignee', 'tarot:defense-de-fer', 'tarot:maitre-du-tarot',
    'belote:capot', 'belote:belle-prise', 'belote:dedans', 'belote:belote-rebelote', 'belote:cent', 'belote:maitre-de-la-belote']) {
    assert.ok(fr.achievements[code]?.name, code);
  }
});

test('Espace de noms par défaut refusé ; création de profil limitée par IP', async () => {
  const { server, url, port } = await boot();
  try {
    const root = connect(url, { transports: ['websocket'], reconnection: false, forceNew: true });
    await once(root, 'connect_error');
    root.close();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await req(port, 'POST', '/api/profil', { token: generateProfileToken(), pseudo: 'x' })).status;
    assert.equal(last, 429, 'la onzième création de l\'heure est refusée');
    assert.equal(server.store.count, 10);
  } finally {
    await server.close();
  }
});

test('Inactivité : le siège libéré peut être repris par la même connexion', async () => {
  // Pioches forcées rapides : l'inactivité ne se mesure qu'à un tour où l'humain a un vrai choix.
  const { server, url } = await boot({ timings: { botDelay: 5, forcedDelay: 5, afkTimeout: 60 }, rejoinGraceMs: 5000 });
  try {
    const c = client(url);
    await once(c, 'connect');
    const seat = once<{ tableId: string; seat: number; rejoinKey: string }>(c, 'seat');
    const afk = once(c, 'afk', 5000);
    c.emit('solo', { name: 'Lent' });
    const s = await seat;
    await afk;
    const back = once<View>(c, 'state');
    c.emit('rejoin', { tableId: s.tableId, rejoinKey: s.rejoinKey });
    const v = await back;
    assert.equal(v.seat, s.seat);
    assert.ok(!v.seats[s.seat]!.isBot);
    c.close();
  } finally {
    await server.close();
  }
});
