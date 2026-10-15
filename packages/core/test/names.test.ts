import test from 'node:test';
import assert from 'node:assert/strict';
import { FEMALE_NAMES, MALE_NAMES, pickBotNames } from '../src/names.ts';
import { seededRng } from '../src/rng.ts';

test('listes de prénoms : parité, sans doublon, sans prénom mixte', () => {
  assert.equal(FEMALE_NAMES.length, MALE_NAMES.length);
  const all = [...FEMALE_NAMES, ...MALE_NAMES];
  assert.equal(new Set(all.map((n) => n.toLowerCase())).size, all.length);
  for (const mixte of ['Claude', 'Dominique', 'Camille']) {
    assert.ok(!MALE_NAMES.includes(mixte) || !FEMALE_NAMES.includes(mixte));
  }
});

test('pickBotNames : distincts, parité à 1 près, exclusion insensible à la casse', () => {
  for (let seed = 0; seed < 30; seed++) {
    const names = pickBotNames(3, ['sophie', 'JEAN'], seededRng(seed));
    assert.equal(new Set(names).size, 3);
    const f = names.filter((n) => FEMALE_NAMES.includes(n)).length;
    const m = names.filter((n) => MALE_NAMES.includes(n)).length;
    assert.equal(f + m, 3);
    assert.ok(Math.abs(f - m) <= 1);
    assert.ok(!names.includes('Sophie') && !names.includes('Jean'));
  }
});
