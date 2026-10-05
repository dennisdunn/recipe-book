#!/usr/bin/env node
// Validates api/recipes/*.json and regenerates everything derived from them:
//   api/index.json, api/catalog.json, api/categories/*, api/tags/*, api/version.json
// Run after adding or editing a recipe:  node tools/build-index.mjs
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api');
const slugify = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const compact = (file, data) => writeFile(file, JSON.stringify(data) + '\n');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- load + validate ----
const files = (await readdir(path.join(root, 'recipes'))).filter(f => f.endsWith('.json')).sort();
const recipes = [];
const ids = new Set();
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(root, 'recipes', f), 'utf8'));
  const err = m => { throw new Error(`${f}: ${m}`); };
  if (r.slug !== f.replace(/\.json$/, '')) err(`slug "${r.slug}" must match the file name`);
  if (!UUID.test(r.id)) err('id must be a UUID');
  if (ids.has(r.id)) err('duplicate id');
  ids.add(r.id);
  if (!r.title) err('missing title');
  if (!r.category) err('missing category');
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) err('no ingredients');
  if (!Array.isArray(r.steps)) err('steps must be an array (may be empty)');
  recipes.push(r);
}
const slugs = new Set(recipes.map(r => r.slug));
for (const r of recipes) for (const s of r.seeAlso ?? []) {
  if (!slugs.has(s)) throw new Error(`${r.slug}: seeAlso "${s}" does not exist`);
}

// ---- catalog: ingredient catalog entries referenced by recipes ----
const catalog = new Map();
for (const r of recipes) for (const i of r.ingredients) {
  if (i.catalogId && !catalog.has(i.catalogId)) catalog.set(i.catalogId, null);
}
// names/aisles live on the catalog.source file if present; otherwise taken from catalog.json as it already exists
let existing = {};
try { existing = Object.fromEntries(JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8')).items.map(c => [c.id, c])); } catch {}
for (const id of catalog.keys()) {
  if (!existing[id]) throw new Error(`catalog entry "${id}" missing from api/catalog.json; add it (id, name, aisle, staple)`);
}
const catalogItems = [...catalog.keys()].map(id => existing[id]).sort((a, b) => a.name.localeCompare(b.name));

// ---- index (list + search) ----
const index = recipes.map(r => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  category: r.category,
  categorySlug: slugify(r.category),
  subcategory: r.subcategory ?? null,
  tags: r.tags ?? [],
  servings: r.servings?.text ?? null,
  ingredients: [...new Set(r.ingredients.map(i =>
    (i.catalogId ? existing[i.catalogId].name : i.item).toLowerCase()))].sort(),
  // catalog ids the recipe cannot do without (not optional, purchasable): used for pantry matching
  need: [...new Set(r.ingredients.filter(i => i.catalogId && !i.optional && i.shop !== false).map(i => i.catalogId))].sort(),
})).sort((a, b) => a.title.localeCompare(b.title));

// ---- categories + tags ----
const group = (keyFn) => {
  const m = new Map();
  for (const s of index) for (const k of keyFn(s)) {
    if (!m.has(k.key)) m.set(k.key, { name: k.name, items: [] });
    m.get(k.key).items.push({ id: s.id, slug: s.slug, title: s.title, subcategory: s.subcategory });
  }
  return m;
};
await rm(path.join(root, 'categories'), { recursive: true, force: true });
await rm(path.join(root, 'tags'), { recursive: true, force: true });
await mkdir(path.join(root, 'categories'), { recursive: true });
await mkdir(path.join(root, 'tags'), { recursive: true });

const cats = group(s => [{ key: s.categorySlug, name: s.category }]);
for (const [slug, { name, items }] of cats) await compact(path.join(root, 'categories', `${slug}.json`), { slug, name, recipes: items });
await compact(path.join(root, 'categories', 'index.json'),
  [...cats].map(([slug, { name, items }]) => ({ slug, name, count: items.length })).sort((a, b) => a.name.localeCompare(b.name)));

const tags = group(s => s.tags.map(t => ({ key: t, name: t })));
for (const [tag, { items }] of tags) await compact(path.join(root, 'tags', `${tag}.json`), { tag, recipes: items });
await compact(path.join(root, 'tags', 'index.json'),
  [...tags].map(([tag, { items }]) => ({ tag, count: items.length })).sort((a, b) => a.tag.localeCompare(b.tag)));

await compact(path.join(root, 'index.json'), index);
await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ items: catalogItems }) + '\n');

// ---- version: content hash so the service worker can tell when to refresh ----
const hash = createHash('sha256');
for (const r of recipes) hash.update(JSON.stringify(r));
hash.update(JSON.stringify(index)).update(JSON.stringify(catalogItems));
await writeFile(path.join(root, 'version.json'), JSON.stringify({
  version: hash.digest('hex').slice(0, 12), recipeCount: recipes.length, generated: new Date().toISOString(),
}, null, 2) + '\n');

console.log(`Indexed ${recipes.length} recipes, ${cats.size} categories, ${tags.size} tags, ${catalogItems.length} catalog items.`);
