import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProfileStore, generateProfileToken, normalizeProfileToken, formatRecoveryCode, profileIdFromToken, AVATAR_COUNT,
} from '../src/profiles.ts';
import { isValidProfileToken } from '../src/security.ts';

test('jeton : 52 caractères base32, code lisible, normalisation tolérante', () => {
  const t = generateProfileToken();
  assert.ok(isValidProfileToken(t));
  const code = formatRecoveryCode(t);
  assert.equal(code.replace(/-/g, ''), t);
  assert.equal(normalizeProfileToken(code.toLowerCase().replace(/-/g, ' ')), t);
  assert.equal(normalizeProfileToken(t.replace(/O/g, '0').replace(/I/g, '1')), t);
  assert.equal(normalizeProfileToken('trop court'), null);
  assert.equal(normalizeProfileToken(42), null);
  assert.notEqual(generateProfileToken(), t);
  assert.equal(profileIdFromToken(t).length, 64);
});

test('ProfileStore : cycle de vie complet, export, suppression réelle, purge', () => {
  const store = new ProfileStore(':memory:');
  const t = generateProfileToken();
  const p = store.create(t, '<b>Régis</b>', 99);
  assert.ok(p);
  assert.equal(p!.pseudo, 'bRégisb');
  assert.equal(p!.avatar, 0, 'avatar hors plage → 0');
  assert.equal(store.create(t, 'x', 1), null, 'jeton déjà pris');
  assert.equal(store.count, 1);
  assert.equal(store.getByToken(generateProfileToken()), null);
  assert.equal(store.getByToken(t)?.id, p!.id);

  const u = store.update(p!.id, { pseudo: 'Régis', avatar: AVATAR_COUNT - 1 });
  assert.equal(u?.pseudo, 'Régis');
  assert.equal(u?.avatar, AVATAR_COUNT - 1);

  let fresh = store.recordMatch(p!.id, 'huit-americain', { won: true, rounds: 3, gameAchievements: ['huit-magique'] });
  assert.deepEqual(fresh.sort(), ['huit-americain:huit-magique', 'premiere-partie', 'premiere-victoire']);
  fresh = store.recordMatch(p!.id, 'huit-americain', { won: false, rounds: 2 });
  assert.deepEqual(fresh, []);
  fresh = store.recordMatch(p!.id, 'belote', { won: false, rounds: 1 });
  assert.deepEqual(fresh, ['touche-a-tout']);
  assert.deepEqual(store.unlock(p!.id, ['INVALIDE!', 'ok-code']), ['ok-code']);
  assert.deepEqual(store.unlock('inconnu', ['ok-code']), []);

  const ex = store.export(p!.id);
  assert.ok(ex);
  assert.equal(ex!.stats.find((s) => s.game === 'huit-americain')?.matches, 2);
  assert.equal(ex!.stats.find((s) => s.game === 'huit-americain')?.rounds, 5);
  assert.equal(ex!.achievements.length, 5);
  assert.equal(JSON.stringify(ex).includes(t), false, 'le jeton n\'est jamais stocké');

  assert.equal(store.purgeInactive(365), 0);
  assert.ok(store.delete(p!.id));
  assert.ok(!store.delete(p!.id));
  assert.equal(store.export(p!.id), null);
  assert.deepEqual(store.stats(p!.id), [], 'cascade');
  store.close();
});
