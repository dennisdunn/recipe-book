// Weekly dinner planner. Pure: works on index entries + per-recipe stats, no DOM or storage.
//
// A plan (stored in IndexedDB `plans`, keyed by `id` = start date):
//   { id, start: 'YYYY-MM-DD',
//     days: [{ date, recipeId (null = none), locked, skip, multiplier, cooked }],
//     accepted (saved at least once), counted: [recipe ids already counted as recommended],
//     checked: [shopping keys ticked: catalogId or 'extra:<text>'], extras: [items added to the shopping list],
//     menu (only for weeks built in the menu builder): { offer: recipe id on show, passed: [ids passed over] } }
// Plans saved by older versions may lack fields; read them through normalizePlan().
// Picks are weighted random:
//   - candidates are mains (tag "main", or the user's per-recipe override), not excluded, not rated 1 star
//   - recipes cooked or recommended within `noRepeatDays` are left out while enough others remain
//   - higher ratings and favorites are more likely; long-unseen recipes get a mild boost
//   - the same category on neighbouring days is discouraged
//   - optional `boost(entry)` multiplies the weight (used to favor recipes that use what's in the pantry)
// fillPlan fills a whole week at once ("Plan my week"); pickOne offers one dinner at a time (the menu builder).

// simple: the simple view's menu week, `count` days from weekday `startDay` (0 Sunday, 1 Monday …)
export const DEFAULTS = { days: 7, noRepeatDays: 21, simple: { startDay: 1, count: 5 } };

const DAY = 86400000;
export const isoDate = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const parseDate = s => new Date(`${s}T12:00:00`);
export const addDays = (s, n) => isoDate(new Date(parseDate(s).getTime() + n * DAY));

export const isMain = (entry, stat) => stat?.main ?? entry.tags.includes('main');

const NEW_DAY = { recipeId: null, locked: false, skip: false, multiplier: 1, cooked: false };

export function newPlan(start, days = DEFAULTS.days) {
  return {
    id: start, start, accepted: false, counted: [], checked: [], extras: [],
    days: Array.from({ length: days }, (_, i) => ({ ...NEW_DAY, date: addDays(start, i) })),
  };
}

/** Fill in fields missing from plans stored by older versions. */
export function normalizePlan(plan) {
  if (!plan) return plan;
  return {
    accepted: false, counted: [], checked: [], extras: [], ...plan,
    days: plan.days.map(d => ({ ...NEW_DAY, ...d })),
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

/** The recipes the planner may choose from, and which of them rest because they were cooked or suggested recently. */
function candidates(index, stats, noRepeatDays, today) {
  const pool = index.filter(e => {
    const s = stats.get(e.id);
    return isMain(e, s) && !s?.excluded && s?.rating !== 1;
  });
  const recent = new Set(pool.filter(e => {
    const s = stats.get(e.id);
    return [s?.lastCooked, s?.lastRecommended].some(d => d && today - parseDate(d) < noRepeatDays * DAY);
  }).map(e => e.id));
  return { pool, recent };
}

/** One weighted pick from `pool` minus `exclude`; resting recipes are used only if fewer than `minFresh` others remain. */
function choose({ pool, recent }, exclude, neighbours, { stats, today, rng, boost, minFresh = 1 }) {
  let choices = pool.filter(e => !exclude.has(e.id));
  const fresh = choices.filter(e => !recent.has(e.id));
  if (fresh.length >= minFresh) choices = fresh;
  const weighted = choices.map(e => [e,
    weight(e, stats.get(e.id), today) * (neighbours.includes(e.categorySlug) ? 0.3 : 1) * (boost?.(e) ?? 1)]);
  return pick(weighted, rng);
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
  const cands = candidates(index, stats, noRepeatDays, today);
  const byId = new Map(index.map(e => [e.id, e]));

  for (const i of targets) {
    const used = new Set(days.map(d => d.recipeId).filter(Boolean));
    const neighbours = [days[i - 1], days[i + 1]].map(d => byId.get(d?.recipeId)?.categorySlug).filter(Boolean);
    days[i].recipeId = choose(cands, used, neighbours, { stats, today, rng, boost, minFresh: targets.length })?.id ?? null;
    days[i].cooked = false;
  }
  return { ...plan, days };
}

/**
 * Pick a single dinner for day `dayIndex` of `plan` (the menu builder), with the same weighting as fillPlan.
 * Recipes already in the plan and those in `exclude` (e.g. ones passed over) are left out, as is anything `allow`
 * rejects (used to keep long or make-ahead recipes off tonight).
 * Returns an index entry, or null when nothing is left.
 */
export function pickOne(plan, dayIndex, index, stats, { noRepeatDays = DEFAULTS.noRepeatDays, rng = Math.random, now = new Date(), boost, exclude = [], allow } = {}) {
  const today = parseDate(isoDate(now)).getTime();
  const byId = new Map(index.map(e => [e.id, e]));
  const used = new Set([...plan.days.map(d => d.recipeId).filter(Boolean), ...exclude]);
  const neighbours = [plan.days[dayIndex - 1], plan.days[dayIndex + 1]].map(d => byId.get(d?.recipeId)?.categorySlug).filter(Boolean);
  const cands = candidates(index, stats, noRepeatDays, today);
  if (allow) cands.pool = cands.pool.filter(allow);
  return choose(cands, used, neighbours, { stats, today, rng, boost });
}

/**
 * The dates the simple view plans for, given today's date: the window of `count` days from weekday `startDay`.
 * Inside a window, its remaining days from today on; once it is over (e.g. at the weekend), the next window.
 */
export function menuDates(today, { startDay = 1, count = 5 } = {}) {
  const since = (parseDate(today).getDay() - startDay + 7) % 7; // days since the window's start day
  const start = since < count ? addDays(today, -since) : addDays(today, 7 - since);
  return Array.from({ length: count }, (_, i) => addDays(start, i)).filter(d => d >= today);
}

/** Index of the first day with no dinner chosen and not skipped, or -1 when the plan is complete. */
export const nextOpenDay = plan => plan.days.findIndex(d => !d.recipeId && !d.skip);

/** Recipe ids in the plan that have not yet been counted as "recommended". */
export const uncounted = plan => plan.days.map(d => d.recipeId).filter(id => id && !plan.counted.includes(id));
