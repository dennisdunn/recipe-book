#!/usr/bin/env node
// One-time import: converts the parsed archive (recipes_all.json) into
// api/recipes/<slug>.json and writes REVIEW.md (items to verify against the originals).
// Usage: node tools/convert-parsed.mjs path/to/recipes_all.json
// Then:  node tools/build-index.mjs
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) { console.error('usage: node tools/convert-parsed.mjs recipes_all.json'); process.exit(1); }

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipesDir = path.join(repo, 'api', 'recipes');
const src = JSON.parse(await readFile(input, 'utf8'));

const slugify = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function convertAmount(a) {
  if (!a) return null;
  const out = { value: a.value, unit: a.unit };
  if (a.package != null) out.package = a.package;            // can, jar, box, pkg...
  if (a.package_oz != null) out.packageOz = a.package_oz;    // size of one package in ounces, when known
  if (a.count_unit != null) out.countUnit = a.count_unit;    // e.g. "cloves", "slices"
  if (a.approximate) out.approximate = true;
  return out;
}

function convertIngredient(i) {
  const mapped = i.norm && i.norm.id && i.norm.id !== 'unmapped';
  return {
    raw: i.raw,
    quantity: i.quantity,
    quantityMax: i.quantity_max,
    unit: i.unit,
    item: i.item,
    prep: i.prep,
    note: i.note,
    group: i.group,
    optional: !!i.optional,
    confidence: i.confidence,          // high | medium | low; show `raw` when low
    shop: !!i.shop,                    // false = not a purchasable line (e.g. "recipe follows")
    catalogId: mapped ? i.norm.id : null,
    amount: convertAmount(i.norm && i.norm.amount), // g | ml | each | pkg
  };
}

function convert(r) {
  const tags = [...(r.tags ?? [])];
  if (r.subcategory) {                 // folder name, e.g. "KETO RECIPES" -> tag "keto"
    const t = slugify(r.subcategory.replace(/\s+recipes?$/i, ''));
    if (t && !tags.includes(t)) tags.push(t);
  }
  return {
    schemaVersion: 1,
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? null,
    category: r.category,
    subcategory: r.subcategory ?? null,
    tags,
    servings: r.servings ?? null,
    times: r.times ? Object.entries(r.times).map(([label, text]) => ({ label: cap(label), text: String(text).trim() })) : [],
    ingredients: r.ingredients.map(convertIngredient),
    steps: r.steps.map(s => ({ text: s.text, group: s.section ?? null })),
    footnotes: r.footnotes ?? [],
    nutrition: r.nutrition ?? null,
    importedNotes: (r.imported_notes ?? []).map(n => ({ text: n.text })),
    seeAlso: r.see_also ?? [],
    source: {
      attribution: r.source?.attribution ?? null,
      file: r.source?.file ?? null,
      type: r.source?.type ?? null,
      duplicateFiles: r.source?.duplicate_files ?? [],
    },
  };
}

await rm(recipesDir, { recursive: true, force: true });
await mkdir(recipesDir, { recursive: true });
for (const r of src) {
  await writeFile(path.join(recipesDir, `${r.slug}.json`), JSON.stringify(convert(r), null, 2) + '\n');
}

// ---- catalog.json seed: id -> name/aisle/staple, taken from the parsed ingredient matches ----
const cat = new Map();
for (const r of src) for (const i of r.ingredients) {
  const n = i.norm;
  if (n && n.id && n.id !== 'unmapped' && !cat.has(n.id)) cat.set(n.id, { id: n.id, name: n.name, aisle: n.aisle, staple: !!n.staple });
}
await writeFile(path.join(repo, 'api', 'catalog.json'),
  JSON.stringify({ items: [...cat.values()].sort((a, b) => a.name.localeCompare(b.name)) }) + '\n');

// ---- REVIEW.md: curation notes kept out of the public API ----
const flagged = src.filter(r => (r.import_flags ?? []).length);
const noDirections = src.filter(r => r.steps.length === 0);
const lowConf = src
  .map(r => ({ r, n: r.ingredients.filter(i => i.confidence === 'low').length }))
  .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 25);
const byType = t => src.filter(r => r.source?.type === t).length;

const L = [];
L.push('# Import review', '');
L.push(`${src.length} recipes imported (${byType('doc')} from .doc, ${byType('image')} from images, ${byType('pdf')} from PDF).`);
L.push('Items below are things to check against the original files. They are not part of the public API.', '');
L.push(`## Flagged by the import (${flagged.length})`, '');
for (const r of flagged.sort((a, b) => a.title.localeCompare(b.title))) {
  L.push(`- **${r.title}** (\`${r.slug}\`, source: ${r.source.file})`);
  for (const f of r.import_flags) L.push(`  - ${f}`);
}
L.push('', `## No directions in the source (${noDirections.length})`, '');
for (const r of noDirections) L.push(`- ${r.title} (\`${r.slug}\`)`);
L.push('', '## Most low-confidence ingredient lines', '',
  'Low confidence means the quantity or unit could not be parsed cleanly; the app should show `raw` for these.', '');
for (const { r, n } of lowConf) L.push(`- ${r.title} (\`${r.slug}\`): ${n} of ${r.ingredients.length} lines`);
L.push('');
await writeFile(path.join(repo, 'REVIEW.md'), L.join('\n'));

console.log(`Wrote ${src.length} recipes, ${cat.size} catalog items and REVIEW.md`);
