import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onHand, coverage, pantryBoost, EMPTY_PANTRY } from '../js/pantry.js';

const catalog = [
  { id: 'salt', staple: true }, { id: 'oil', staple: true },
  { id: 'chicken', staple: false }, { id: 'rice', staple: false }, { id: 'lime', staple: false },
];
const staples = new Set(['salt', 'oil']);
const entry = { need: ['chicken', 'rice', 'lime', 'salt'] };

test('staples count as on hand only when assumed', () => {
  assert.deepEqual([...onHand({ have: ['rice'], assumeStaples: true }, catalog)].sort(), ['oil', 'rice', 'salt']);
  assert.deepEqual([...onHand({ have: ['rice'], assumeStaples: false }, catalog)], ['rice']);
  assert.deepEqual(EMPTY_PANTRY, { have: [], assumeStaples: true });
});

test('coverage leaves assumed staples out of the counts', () => {
  const pantry = { have: ['chicken', 'rice'], assumeStaples: true };
  const cov = coverage(entry, onHand(pantry, catalog), pantry, staples);
  assert.deepEqual(cov, { needed: 3, missing: ['lime'], using: 2, ratio: 2 / 3 });
});

test('without assumed staples they are real requirements', () => {
  const pantry = { have: ['chicken', 'rice', 'lime'], assumeStaples: false };
  const cov = coverage(entry, onHand(pantry, catalog), pantry, staples);
  assert.deepEqual(cov.missing, ['salt']);
});

test('the planner boost only applies to recipes that use ticked items', () => {
  assert.equal(pantryBoost({ using: 0, ratio: 1 }), 1); // made only of staples
  assert.equal(pantryBoost({ using: 3, ratio: 1 }), 20);
  assert.ok(Math.abs(pantryBoost({ using: 1, ratio: 0.5 }) - Math.sqrt(20)) < 1e-9);
});
