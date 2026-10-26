// App state shared by several screens: the current plan, planner settings and the pantry.
// Screens import from here rather than from each other.
import { getIndex, getCatalog, getRecipe, indexById } from './data.js';
import { buildShoppingList } from './shopping.js';
import { allStats, getMeta, setMeta, updateStat, putPlan, getPlan as dbGetPlan, allPlans as dbAllPlans } from './db.js';
import { newPlan, fillPlan, pickOne, normalizePlan, uncounted, isoDate, addDays, menuDates, DEFAULTS } from './planner.js';
import { EMPTY_PANTRY, onHand, coverage, pantryBoost } from './pantry.js';
import { formatDay } from './ui.js';

export const getPlan = async id => normalizePlan(await dbGetPlan(id));
export const allPlans = async () => (await dbAllPlans()).map(normalizePlan);

export async function currentPlan() {
  const id = await getMeta('currentPlan');
  return id ? getPlan(id) : null;
}

export async function settings() {
  const stored = await getMeta('settings');
  return { ...DEFAULTS, ...stored, simple: { ...DEFAULTS.simple, ...stored?.simple } };
}
export async function saveSettings(patch) {
  await setMeta('settings', { ...(await getMeta('settings')), ...patch });
}

/** Pantry plus what the matching code needs: the on-hand set and the staple ids. */
export async function loadPantry() {
  const [stored, catalog] = await Promise.all([getMeta('pantry'), getCatalog()]);
  const pantry = { ...EMPTY_PANTRY, ...stored };
  return { pantry, catalog, have: onHand(pantry, catalog), staples: new Set(catalog.filter(c => c.staple).map(c => c.id)) };
}
export const savePantry = pantry => setMeta('pantry', pantry);

/**
 * The shopping list for a plan's chosen dinners (or only those in `days`), scaled by each day's multiplier.
 * Items ticked in the pantry are set aside in `alreadyHave` rather than listed to buy.
 */
export async function shoppingFor(plan, days = plan.days) {
  const byId = await indexById();
  const chosen = days.filter(d => byId.has(d.recipeId) && !d.skip);
  const [entries, catalog, { pantry }] = await Promise.all([
    Promise.all(chosen.map(async d => ({ recipe: await getRecipe(byId.get(d.recipeId).slug), multiplier: d.multiplier }))),
    getCatalog(), loadPantry()]);
  const all = buildShoppingList(entries, catalog);
  const inPantry = new Set(pantry.have);
  return {
    entries, pantry,
    aisles: all.map(a => ({ ...a, items: a.items.filter(i => !inPantry.has(i.catalogId)) })),
    alreadyHave: all.flatMap(a => a.items).filter(i => inPantry.has(i.catalogId)),
  };
}

/** The planner's inputs with the user's settings; with "Use what I have" on, recipes covered by the pantry get a boost. */
async function plannerInputs() {
  const [index, stats, cfg, { pantry, have, staples }] = await Promise.all([getIndex(), allStats(), settings(), loadPantry()]);
  const boost = cfg.usePantry && pantry.have.length ? e => pantryBoost(coverage(e, have, pantry, staples)) : undefined;
  return { index, stats, opts: { ...cfg, boost } };
}

/** Fill the given days (default: all unlocked, unskipped) at random: "Plan my week" and Swap. */
export async function fillDays(plan, which) {
  const { index, stats, opts } = await plannerInputs();
  return fillPlan(plan, index, stats, { ...opts, which });
}

/** Longest recipe (start to eating, minutes) offered for tonight; slow-cooker, overnight and all-day ones are later in the week. */
export const TONIGHT_MAX_MINUTES = 120;

/** One dinner to offer for day `dayIndex` in the menu builders, skipping `exclude` (ids passed over). */
export async function offerFor(plan, dayIndex, exclude) {
  const { index, stats, opts } = await plannerInputs();
  const tonight = plan.days[dayIndex]?.date === isoDate(new Date());
  const allow = tonight ? e => (e.time?.minutes ?? 0) <= TONIGHT_MAX_MINUTES : undefined;
  return pickOne(plan, dayIndex, index, stats, { ...opts, exclude, allow })
    ?? (allow ? pickOne(plan, dayIndex, index, stats, { ...opts, exclude }) : null); // nothing short enough: anything
}

/** "Save plan": count the plan's new dinners as suggested, so they rest for the no-repeat window. */
export async function savePlanCounts(plan) {
  const today = isoDate(new Date());
  for (const id of uncounted(plan)) {
    await updateStat(id, s => ({ timesRecommended: (s.timesRecommended ?? 0) + 1, lastRecommended: today }));
  }
  plan.counted = plan.days.map(d => d.recipeId).filter(Boolean);
  plan.accepted = true;
  return plan;
}

/** Start an empty week for the menu builder and make it current. Asks before replacing a plan with the same start. */
export async function startMenuWeek(start) {
  if (await getPlan(start) && !confirm(`There is already a plan starting ${formatDay(start)}. Replace it?`)) return false;
  const plan = { ...newPlan(start), menu: { offer: null, passed: [] } };
  await putPlan(plan);
  await setMeta('currentPlan', plan.id);
  return true;
}

/**
 * The simple view's week: the dates it plans for (see menuDates) and the stored plan covering them, if any.
 * `days` are that plan's days within those dates, with their index in plan.days.
 */
export async function simpleWeek() {
  const today = isoDate(new Date());
  const cfg = await settings();
  const dates = menuDates(today, cfg.simple);
  const plan = (await allPlans()).filter(p => p.days.some(d => dates.includes(d.date)))
    .sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
  const days = plan ? plan.days.map((d, i) => ({ ...d, index: i })).filter(d => dates.includes(d.date)) : [];
  return { today, dates, plan, days };
}

/** The simple view's plan for its week, created (empty, as a menu) the first time; also made the current plan. */
export async function ensureSimplePlan() {
  const week = await simpleWeek();
  let { plan } = week;
  if (!plan) {
    plan = { ...newPlan(week.dates[0], week.dates.length), menu: { offer: null, passed: [] } };
    await putPlan(plan);
  }
  if (await getMeta('currentPlan') !== plan.id) await setMeta('currentPlan', plan.id);
  return simpleWeek();
}

/** Default start for a new week: the day after the latest stored plan ends, or today if that is later. */
export async function nextFreeStart() {
  const today = isoDate(new Date());
  const ends = (await dbAllPlans()).map(p => p.days.at(-1)?.date).filter(Boolean).sort();
  const next = ends.length ? addDays(ends.at(-1), 1) : today;
  return next > today ? next : today;
}
