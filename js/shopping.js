// Shopping list merge rules (see CLAUDE.md). Pure: no DOM, no storage, runs in Node too.
//
//   buildShoppingList([{ recipe, multiplier }], catalogItems) ->
//     [{ aisle, items: [{ catalogId, name, staple, amounts: [{ value, unit, ... }], toTaste,
//                         approximate, optional, rawNotes: [{ raw, recipe }], recipes: [title] }] }]
//
// - lines with shop: false are skipped
// - amounts are summed per catalogId + unit (packages also per kind and size), after scaling
// - amount: null ("to taste") adds the item once with no quantity
// - confidence: "low" lines are not summed; their raw text is attached so the shopper can read it

export function buildShoppingList(entries, catalogItems) {
  const catalog = new Map(catalogItems.map(c => [c.id, c]));
  const items = new Map();

  for (const { recipe, multiplier = 1 } of entries) {
    for (const line of recipe.ingredients) {
      if (line.shop === false) continue;
      const id = line.catalogId ?? `item:${line.item.toLowerCase()}`;
      const cat = catalog.get(line.catalogId);
      let it = items.get(id);
      if (!it) {
        it = {
          catalogId: id, name: cat?.name ?? line.item, aisle: cat?.aisle ?? 'Other', staple: !!cat?.staple,
          parts: new Map(), toTaste: false, approximate: false, optional: true, rawNotes: [], recipes: [],
        };
        items.set(id, it);
      }
      if (!it.recipes.includes(recipe.title)) it.recipes.push(recipe.title);
      it.optional &&= !!line.optional;

      if (line.confidence === 'low') {
        it.rawNotes.push({ raw: multiplier === 1 ? line.raw : `${line.raw} (×${multiplier})`, recipe: recipe.title });
        continue;
      }
      const a = line.amount;
      if (!a) { it.toTaste = true; continue; }
      const key = [a.unit, a.package ?? '', a.packageOz ?? '', a.countUnit ?? ''].join('|');
      const part = it.parts.get(key) ?? { ...a, value: 0 };
      part.value += a.value * multiplier;
      it.parts.set(key, part);
      if (a.approximate || line.quantityMax != null) it.approximate = true;
    }
  }

  const aisles = new Map();
  for (const it of items.values()) {
    const { parts, ...rest } = it;
    const item = { ...rest, amounts: [...parts.values()] };
    if (!aisles.has(it.aisle)) aisles.set(it.aisle, []);
    aisles.get(it.aisle).push(item);
  }
  return [...aisles]
    .map(([aisle, list]) => ({ aisle, items: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.aisle === 'Other') - (b.aisle === 'Other') || a.aisle.localeCompare(b.aisle));
}
