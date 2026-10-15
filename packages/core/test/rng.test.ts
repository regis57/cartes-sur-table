import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoRng, seededRng, shuffle } from '../src/rng.ts';

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
