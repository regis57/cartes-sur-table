import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoRng, repartir, seededRng, shuffle } from '../src/rng.ts';

test('seededRng : reproductible, uniforme dans la borne, refuse les bornes invalides', () => {
  const a = seededRng(42);
  const b = seededRng(42);
  const seqA = Array.from({ length: 50 }, () => a.int(10));
  const seqB = Array.from({ length: 50 }, () => b.int(10));
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 10));
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, () => seededRng(43).int(10)));
  assert.throws(() => a.int(0));
  assert.throws(() => a.int(1.5));
});

test('shuffle : même multi-ensemble, entrée intacte, aléa crypto utilisable', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = shuffle(input, seededRng(7));
  assert.deepEqual([...out].sort((x, y) => x - y), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const c = shuffle(input, cryptoRng);
  assert.equal(c.length, 10);
});

test('repartir : respecte contenances et admissions, trouve le monde valide que le remplissage glouton manquait', () => {
  // Trois places de deux ; les objets 'a' et 'b' ne vont qu'en place 2 ; le reste partout.
  const objets = ['a', 'b', 'c', 'd', 'e', 'f'];
  const admis = (p: number, o: string): boolean => (o === 'a' || o === 'b' ? p === 2 : true);
  for (let graine = 1; graine <= 200; graine++) {
    const r = repartir(objets, [2, 2, 2], admis, seededRng(graine));
    assert.ok(r, `graine ${graine}`);
    assert.deepEqual(r.map((p) => p.length), [2, 2, 2]);
    assert.deepEqual([...r[2]!].sort(), ['a', 'b']);
    assert.deepEqual(r.flat().sort(), objets);
  }
  // Impossible : null, sans boucle infinie.
  assert.equal(repartir(['a', 'b', 'c'], [1, 2], (p, o) => o !== 'a' || p === 5, seededRng(1)), null);
  assert.throws(() => repartir(['a'], [2], () => true, seededRng(1)));
});
