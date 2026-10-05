import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShoppingList } from '../js/shopping.js';

const catalog = [
  { id: 'onion', name: 'onion', aisle: 'Produce', staple: false },
  { id: 'salt', name: 'salt', aisle: 'Spices & Seasonings', staple: true },
  { id: 'broth', name: 'chicken broth', aisle: 'Canned & Jarred', staple: false },
];
const line = (catalogId, amount, extra = {}) => ({
  raw: `raw ${catalogId}`, item: catalogId, catalogId, amount, confidence: 'high', shop: true, optional: false, quantityMax: null, ...extra,
});
const recipe = (title, ingredients) => ({ title, ingredients });
const items = list => Object.fromEntries(list.flatMap(a => a.items).map(i => [i.catalogId, i]));

test('sums the same item and unit across recipes, after scaling', () => {
  const list = buildShoppingList([
    { recipe: recipe('A', [line('broth', { value: 236.6, unit: 'ml' })]), multiplier: 2 },
    { recipe: recipe('B', [line('broth', { value: 236.6, unit: 'ml' })]), multiplier: 1 },
  ], catalog);
  const broth = items(list).broth;
  assert.equal(broth.amounts.length, 1);
  assert.ok(Math.abs(broth.amounts[0].value - 709.8) < 0.01);
  assert.deepEqual(broth.recipes, ['A', 'B']);
});

test('keeps different units and package sizes apart', () => {
  const list = buildShoppingList([{ recipe: recipe('A', [
    line('broth', { value: 1, unit: 'pkg', package: 'can', packageOz: 14.5 }),
    line('broth', { value: 1, unit: 'pkg', package: 'can', packageOz: 32 }),
    line('broth', { value: 100, unit: 'ml' }),
  ]) }], catalog);
  assert.equal(items(list).broth.amounts.length, 3);
});

test('skips shop:false lines; to-taste lines have no amount', () => {
  const list = buildShoppingList([{ recipe: recipe('A', [
    line('onion', null),
    line('broth', { value: 1, unit: 'ml' }, { shop: false }),
  ]) }], catalog);
  const all = items(list);
  assert.equal(all.broth, undefined);
  assert.equal(all.onion.toTaste, true);
  assert.deepEqual(all.onion.amounts, []);
});

test('low-confidence lines are shown as written, not summed', () => {
  const list = buildShoppingList([{ recipe: recipe('A', [
    line('onion', { value: 2, unit: 'each' }, { confidence: 'low', raw: '2 or 3 onions?' }),
  ]) }], catalog);
  const onion = items(list).onion;
  assert.deepEqual(onion.amounts, []);
  assert.deepEqual(onion.rawNotes, [{ raw: '2 or 3 onions?', recipe: 'A' }]);
});

test('ranges and approximate amounts are flagged; optional only when every line is optional', () => {
  const list = buildShoppingList([{ recipe: recipe('A', [
    line('onion', { value: 1, unit: 'each' }, { quantityMax: 2, optional: true }),
    line('onion', { value: 1, unit: 'each' }),
  ]) }], catalog);
  const onion = items(list).onion;
  assert.equal(onion.approximate, true);
  assert.equal(onion.optional, false);
});

test('groups by aisle, sorted, with Other last; staples are flagged', () => {
  const list = buildShoppingList([{ recipe: recipe('A', [
    line('salt', null), line('onion', { value: 1, unit: 'each' }), line(null, null, { item: 'Mystery Spice' }),
  ]) }], catalog);
  assert.deepEqual(list.map(a => a.aisle), ['Produce', 'Spices & Seasonings', 'Other']);
  assert.equal(items(list).salt.staple, true);
  assert.equal(list.at(-1).items[0].name, 'Mystery Spice');
});
