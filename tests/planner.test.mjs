import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlan, normalizePlan, fillPlan, uncounted, isMain, addDays } from '../js/planner.js';

// small deterministic random source so failures are reproducible
const seeded = (seed = 1) => () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entry = (id, extra = {}) => ({ id, title: id, slug: id, tags: ['main'], categorySlug: `cat-${id}`, ...extra });
const index = Array.from({ length: 20 }, (_, i) => entry(`r${i}`));
const NOW = new Date('2026-10-05T12:00:00');

test('newPlan has consecutive dates (across a month end) and every field', () => {
  const plan = newPlan('2026-10-29');
  assert.deepEqual(plan.days.map(d => d.date), ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual([plan.checked, plan.extras, plan.counted], [[], [], []]);
  assert.equal(addDays('2026-03-07', 1), '2026-03-08'); // US daylight saving starts that night
});

test('normalizePlan fills fields missing from older saved plans', () => {
  const old = { id: '2026-10-04', start: '2026-10-04', days: [{ date: '2026-10-04', recipeId: 'r1' }] };
  const plan = normalizePlan(old);
  assert.deepEqual([plan.checked, plan.extras, plan.counted, plan.accepted], [[], [], [], false]);
  assert.equal(plan.days[0].multiplier, 1);
  assert.equal(plan.days[0].recipeId, 'r1');
  assert.equal(normalizePlan(undefined), undefined);
});

test('fills every open day with distinct mains', () => {
  const plan = fillPlan(newPlan('2026-10-05'), index, new Map(), { rng: seeded(), now: NOW });
  const ids = plan.days.map(d => d.recipeId);
  assert.equal(new Set(ids).size, 7);
  assert.ok(ids.every(Boolean));
});

test('never picks non-mains, excluded or 1-star recipes; honours the main override', () => {
  const idx = [...index.slice(0, 8), entry('side', { tags: [] }), entry('promoted', { tags: [] })];
  const stats = new Map([['r0', { excluded: true }], ['r1', { rating: 1 }], ['promoted', { main: true }], ['r2', { main: false }]]);
  for (let s = 1; s < 50; s++) {
    const ids = fillPlan(newPlan('2026-10-05'), idx, stats, { rng: seeded(s), now: NOW }).days.map(d => d.recipeId);
    for (const bad of ['side', 'r0', 'r1', 'r2']) assert.ok(!ids.includes(bad), `picked ${bad}`);
  }
  assert.equal(isMain(entry('x', { tags: [] }), { main: true }), true);
});

test('keeps locked and skipped days', () => {
  const plan = newPlan('2026-10-05');
  Object.assign(plan.days[0], { recipeId: 'r5', locked: true });
  plan.days[1].skip = true;
  const filled = fillPlan(plan, index, new Map(), { rng: seeded(), now: NOW });
  assert.equal(filled.days[0].recipeId, 'r5');
  assert.equal(filled.days[1].recipeId, null);
  assert.ok(!filled.days.slice(2).some(d => d.recipeId === 'r5'));
});

test('rests recently cooked recipes while there are enough others', () => {
  const stats = new Map([['r3', { lastCooked: '2026-10-01' }], ['r4', { lastRecommended: '2026-09-30' }]]);
  for (let s = 1; s < 50; s++) {
    const ids = fillPlan(newPlan('2026-10-05'), index, stats, { rng: seeded(s), now: NOW }).days.map(d => d.recipeId);
    assert.ok(!ids.includes('r3') && !ids.includes('r4'));
  }
});

test('fills only the requested days', () => {
  const full = fillPlan(newPlan('2026-10-05'), index, new Map(), { rng: seeded(), now: NOW });
  const swapped = fillPlan(full, index, new Map(), { rng: seeded(7), now: NOW, which: [3] });
  full.days.forEach((d, i) => { if (i !== 3) assert.equal(swapped.days[i].recipeId, d.recipeId); });
});

test('boost steers the picks', () => {
  const plan = fillPlan(newPlan('2026-10-05', 1), index, new Map(), { rng: seeded(), now: NOW, boost: e => (e.id === 'r9' ? 1e6 : 1) });
  assert.equal(plan.days[0].recipeId, 'r9');
});

test('uncounted lists recipes not yet counted as recommended', () => {
  const plan = newPlan('2026-10-05', 3);
  plan.days[0].recipeId = 'a'; plan.days[1].recipeId = 'b';
  plan.counted = ['a'];
  assert.deepEqual(uncounted(plan), ['b']);
});
