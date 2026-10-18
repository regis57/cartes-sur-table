import test from 'node:test';
import assert from 'node:assert/strict';
import { Matchmaking, PrivateTables, newInviteCode, type LobbyEntry } from '../src/lobby.ts';
import { isValidInviteCode } from '../src/security.ts';

const entry = (id: string): LobbyEntry => ({ humanId: id, name: id, avatar: 0, profileId: null });

test('Matchmaking : part dès que les sièges sont pleins, puis relance pour les suivants', () => {
  const launched: string[][] = [];
  const mm = new Matchmaking(2, 60, { launch: (e) => launched.push(e.map((x) => x.humanId)), status: () => {} });
  mm.join(entry('a'));
  mm.join(entry('a'));
  assert.equal(mm.size, 1);
  mm.join(entry('b'));
  assert.deepEqual(launched, [['a', 'b']]);
  assert.equal(mm.size, 0);
  mm.join(entry('c'));
  mm.leave('c');
  assert.equal(mm.size, 0);
  mm.join(entry('d'));
  mm.forceStart('zzz');
  assert.equal(launched.length, 1, 'un inconnu ne peut pas forcer le départ');
  mm.forceStart('d');
  assert.deepEqual(launched[1], ['d']);
  mm.close();
});

test('Matchmaking : compte à rebours diffusé et départ au bout du temps', async () => {
  const launched: string[][] = [];
  const statuses: number[] = [];
  const mm = new Matchmaking(4, 1, { launch: (e) => launched.push(e.map((x) => x.humanId)), status: (_e, c) => statuses.push(c) });
  mm.join(entry('a'));
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(launched, [['a']]);
  assert.ok(statuses.includes(1) && statuses.includes(0));
  mm.close();
});

test('PrivateTables : création, code valide, invitation, départ de l\'hôte, lancement', () => {
  const pt = new PrivateTables(1000, 2);
  const t = pt.create('huit-americain', 4, entry('host'));
  assert.ok(t && isValidInviteCode(t.code));
  assert.equal(pt.create('huit-americain', 4, entry('host')), null, 'un humain, une table');
  assert.equal(pt.join('ZZZZZZ', entry('x')), null);
  assert.ok(pt.join(t!.code, entry('guest')));
  assert.equal(pt.join(t!.code, entry('guest'))?.entries.length, 2, 'idempotent');
  assert.equal(pt.create('huit-americain', 4, entry('guest')), null, 'déjà invité ailleurs');
  const other = pt.create('huit-americain', 2, entry('h2'));
  assert.ok(other);
  assert.equal(pt.create('huit-americain', 2, entry('h3')), null, 'plafond de tables en attente');
  assert.equal(pt.join(other!.code, entry('g2'))?.entries.length, 2);
  assert.equal(pt.join(other!.code, entry('g3')), null, 'table pleine');
  assert.equal(pt.start(t!.code, 'guest'), null, 'seul l\'hôte lance');
  const started = pt.start(t!.code, 'host');
  assert.equal(started?.entries.length, 2);
  assert.equal(pt.size, 1);
  const left = pt.leave('h2');
  assert.ok(left?.dissolved);
  assert.equal(pt.size, 0);
  for (let i = 0; i < 100; i++) assert.ok(isValidInviteCode(newInviteCode()));
});

test('PrivateTables : le balayage rend les tables expirées, pour que le serveur prévienne leurs membres', async () => {
  const pt = new PrivateTables(5, 10);
  const host: LobbyEntry = { humanId: 'h', name: 'Hôte', avatar: 0, profileId: null };
  const t = pt.create('huit-americain', 4, host);
  assert.ok(t);
  assert.deepEqual(pt.sweep(), [], 'rien d\'expiré tout de suite');
  await new Promise((r) => setTimeout(r, 15));
  const expired = pt.sweep();
  assert.deepEqual(expired.map((x) => x.code), [t.code]);
  assert.equal(pt.findByHuman('h'), null);
  assert.equal(pt.size, 0);
});
