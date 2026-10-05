// Checks on the real recipe data in api/: the generated files agree with the recipes, and every recipe
// works with the shopping list. Run `node tools/build-index.mjs` first if a recipe was edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildShoppingList } from '../js/shopping.js';
import { formatAmount } from '../js/units.js';

const api = new URL('../api/', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, api), 'utf8'));
const index = read('index.json');
const catalog = read('catalog.json').items;
const catalogIds = new Set(catalog.map(c => c.id));
const files = readdirSync(new URL('recipes/', api)).filter(f => f.endsWith('.json'));
const recipes = files.map(f => read(`recipes/${f}`));

test('the index lists every recipe file once', () => {
  assert.equal(index.length, files.length);
  assert.deepEqual(new Set(index.map(e => `${e.slug}.json`)), new Set(files));
});

test('index `need` matches the recipes and the catalog (rebuild the index if this fails)', () => {
  const byId = new Map(recipes.map(r => [r.id, r]));
  for (const e of index) {
    const r = byId.get(e.id);
    const need = [...new Set(r.ingredients.filter(i => i.catalogId && !i.optional && i.shop !== false).map(i => i.catalogId))].sort();
    assert.deepEqual(e.need, need, e.slug);
    for (const id of e.need) assert.ok(catalogIds.has(id), `${e.slug}: ${id} not in catalog`);
  }
});

test('there are enough dinner mains for a week', () => {
  assert.ok(index.filter(e => e.tags.includes('main')).length >= 14);
});

test('every recipe builds a shopping list with displayable amounts', () => {
  for (const recipe of recipes) {
    for (const aisle of buildShoppingList([{ recipe, multiplier: 2 }], catalog)) {
      for (const item of aisle.items) for (const a of item.amounts) {
        const text = formatAmount(a);
        assert.ok(text && !/NaN|undefined/.test(text), `${recipe.slug}: ${item.name} -> ${text}`);
      }
    }
  }
});
