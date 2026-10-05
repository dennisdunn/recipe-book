// Pantry matching. Pure: works on index entries (their `need` list of catalog ids) and the set of ids on hand.
//
// The pantry is stored in meta as { have: [catalogId], assumeStaples: true }. With assumeStaples, catalog
// staples (salt, oil, flour...) count as on hand without being ticked.

export const EMPTY_PANTRY = { have: [], assumeStaples: true };

/** Set of catalog ids treated as on hand. */
export function onHand(pantry, catalogItems) {
  const ids = new Set(pantry.have);
  if (pantry.assumeStaples) for (const c of catalogItems) if (c.staple) ids.add(c.id);
  return ids;
}

/**
 * How well the pantry covers a recipe. Staples are left out of the count when they are assumed, so
 * "missing 1" means one real shopping item.
 *   { needed, missing: [ids], using: number of ticked pantry items it uses, ratio: 0..1 }
 */
export function coverage(entry, have, pantry, staples) {
  const needed = entry.need.filter(id => !(pantry.assumeStaples && staples.has(id)));
  const missing = needed.filter(id => !have.has(id));
  const using = needed.length - missing.length;
  return { needed: needed.length, missing, using, ratio: needed.length ? using / needed.length : 1 };
}

/** Planner weight multiplier: 1x with nothing on hand, ~4.5x when half is, 20x when everything is. */
export const pantryBoost = cov => (cov.using ? 20 ** cov.ratio : 1); // only for recipes that use something ticked
