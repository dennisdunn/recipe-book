// Weekly dinner planner. Pure: works on index entries + per-recipe stats, no DOM or storage.
//
// A plan: { id, start, days: [{ date, recipeId, locked, skip, multiplier, cooked }], accepted, counted, checked }
// Picks are weighted random:
//   - candidates are mains (tag "main", or the user's per-recipe override), not excluded, not rated 1 star
//   - recipes cooked or recommended within `noRepeatDays` are left out while enough others remain
//   - higher ratings and favorites are more likely; long-unseen recipes get a mild boost
//   - the same category on neighbouring days is discouraged
//   - optional `boost(entry)` multiplies the weight (used to favor recipes that use what's in the pantry)

export const DEFAULTS = { days: 7, noRepeatDays: 21 };

const DAY = 86400000;
export const isoDate = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const parseDate = s => new Date(`${s}T12:00:00`);
export const addDays = (s, n) => isoDate(new Date(parseDate(s).getTime() + n * DAY));

export const isMain = (entry, stat) => stat?.main ?? entry.tags.includes('main');

export function newPlan(start, days = DEFAULTS.days) {
  return {
    id: start, start, accepted: false, counted: [], checked: [],
    days: Array.from({ length: days }, (_, i) => ({
      date: addDays(start, i), recipeId: null, locked: false, skip: false, multiplier: 1, cooked: false,
    })),
  };
}

const RATING_WEIGHT = { 2: 0.4, 3: 1, 4: 1.7, 5: 2.5 };

function weight(entry, stat, today) {
  let w = RATING_WEIGHT[stat?.rating] ?? 1.2; // unrated sits a little above 3 stars so new dishes get tried
  if (stat?.favorite) w *= 1.5;
  const last = Math.max(stat?.lastCooked ? parseDate(stat.lastCooked) : 0, stat?.lastRecommended ? parseDate(stat.lastRecommended) : 0);
  w *= last ? Math.min(1 + (today - last) / DAY / 90, 2) : 1.5;
  return w;
}

function pick(weighted, rng) {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [entry, w] of weighted) if ((r -= w) <= 0) return entry;
  return weighted.at(-1)?.[0] ?? null;
}

/**
 * Fill the days at `which` (default: every unlocked, unskipped day) with new picks.
 * `stats` is a Map of recipe id -> stat record. Returns a new plan; the input is not changed.
 */
export function fillPlan(plan, index, stats, { noRepeatDays = DEFAULTS.noRepeatDays, rng = Math.random, now = new Date(), which, boost } = {}) {
  const days = plan.days.map(d => ({ ...d }));
  const targets = which ?? days.map((d, i) => i).filter(i => !days[i].locked && !days[i].skip);
  for (const i of targets) days[i].recipeId = null;

  const today = parseDate(isoDate(now)).getTime();
  const pool = index.filter(e => {
    const s = stats.get(e.id);
    return isMain(e, s) && !s?.excluded && s?.rating !== 1;
  });
  const recent = new Set(pool.filter(e => {
    const s = stats.get(e.id);
    return [s?.lastCooked, s?.lastRecommended].some(d => d && today - parseDate(d) < noRepeatDays * DAY);
  }).map(e => e.id));
  const byId = new Map(index.map(e => [e.id, e]));

  for (const i of targets) {
    const used = new Set(days.map(d => d.recipeId).filter(Boolean));
    let choices = pool.filter(e => !used.has(e.id));
    const fresh = choices.filter(e => !recent.has(e.id));
    if (fresh.length >= targets.length) choices = fresh;
    const neighbours = [days[i - 1], days[i + 1]].map(d => byId.get(d?.recipeId)?.categorySlug).filter(Boolean);
    const weighted = choices.map(e => [e, weight(e, stats.get(e.id), today) * (neighbours.includes(e.categorySlug) ? 0.3 : 1) * (boost?.(e) ?? 1)]);
    days[i].recipeId = pick(weighted, rng)?.id ?? null;
    days[i].cooked = false;
  }
  return { ...plan, days };
}

/** Recipe ids in the plan that have not yet been counted as "recommended". */
export const uncounted = plan => plan.days.map(d => d.recipeId).filter(id => id && !plan.counted.includes(id));
