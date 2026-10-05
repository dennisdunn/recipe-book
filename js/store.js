// App state shared by several screens: the current plan, planner settings and the pantry.
// Screens import from here rather than from each other.
import { getIndex, getCatalog } from './data.js';
import { allStats, getMeta, setMeta, getPlan as dbGetPlan, allPlans as dbAllPlans } from './db.js';
import { fillPlan, normalizePlan, DEFAULTS } from './planner.js';
import { EMPTY_PANTRY, onHand, coverage, pantryBoost } from './pantry.js';

export const getPlan = async id => normalizePlan(await dbGetPlan(id));
export const allPlans = async () => (await dbAllPlans()).map(normalizePlan);

export async function currentPlan() {
  const id = await getMeta('currentPlan');
  return id ? getPlan(id) : null;
}

export async function settings() {
  return { ...DEFAULTS, ...(await getMeta('settings')) };
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
 * Fill the given days (default: all unlocked, unskipped) using the user's planner settings.
 * With "Use what I have" on, recipes covered by the pantry get a weight boost.
 */
export async function fillDays(plan, which) {
  const [index, stats, cfg, { pantry, have, staples }] = await Promise.all([getIndex(), allStats(), settings(), loadPantry()]);
  const boost = cfg.usePantry && pantry.have.length ? e => pantryBoost(coverage(e, have, pantry, staples)) : undefined;
  return fillPlan(plan, index, stats, { ...cfg, which, boost });
}
