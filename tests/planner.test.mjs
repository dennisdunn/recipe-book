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

test('pickOne offers a main not already in the plan or passed over', async () => {
  const { pickOne, nextOpenDay } = await import('../js/planner.js');
  const plan = newPlan('2026-10-05');
  plan.days[0].recipeId = 'r0';
  plan.days[1].skip = true;
  assert.equal(nextOpenDay(plan), 2);
  const passed = Array.from({ length: 17 }, (_, i) => `r${i + 1}`); // everything except r0, r18, r19
  for (let s = 1; s < 30; s++) {
    const e = pickOne(plan, 2, index, new Map(), { rng: seeded(s), now: NOW, exclude: passed });
    assert.ok(['r18', 'r19'].includes(e.id), e.id);
  }
  assert.equal(pickOne(plan, 2, index, new Map(), { now: NOW, exclude: index.map(e => e.id) }), null);
  plan.days.forEach(d => { d.recipeId ??= d.skip ? null : 'r1'; });
  assert.equal(nextOpenDay(plan), -1);
});

test('pickOne rests recently cooked recipes while others remain, then offers them', async () => {
  const { pickOne } = await import('../js/planner.js');
  const stats = new Map([['r19', { lastCooked: '2026-10-03' }]]);
  const allBut19 = index.slice(0, 19).map(e => e.id);
  const plan = newPlan('2026-10-05');
  assert.equal(pickOne(plan, 0, index, stats, { now: NOW, exclude: allBut19.slice(1) }).id, 'r0');
  assert.equal(pickOne(plan, 0, index, stats, { now: NOW, exclude: allBut19 }).id, 'r19');
});

test('menuDates: the rest of this Monday–Friday window, or next week once it is over', async () => {
  const { menuDates } = await import('../js/planner.js');
  // 2026-10-26 is a Monday
  assert.deepEqual(menuDates('2026-10-26'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepEqual(menuDates('2026-10-28'), ['2026-10-28', '2026-10-29', '2026-10-30']); // Wednesday
  assert.deepEqual(menuDates('2026-10-30'), ['2026-10-30']); // Friday
  assert.deepEqual(menuDates('2026-10-31'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']); // Saturday
  assert.deepEqual(menuDates('2026-11-01'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']); // Sunday
  // a Sunday-to-Thursday week of 5
  assert.deepEqual(menuDates('2026-10-30', { startDay: 0, count: 5 }), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(menuDates('2026-10-26', { startDay: 1, count: 7 }).length, 7);
});

test('pickOne honours allow (e.g. nothing long for tonight)', async () => {
  const { pickOne } = await import('../js/planner.js');
  const timed = index.map((e, i) => ({ ...e, time: { minutes: i < 18 ? 600 : 30 } }));
  for (let s = 1; s < 30; s++) {
    const e = pickOne(newPlan('2026-10-05'), 0, timed, new Map(), { rng: seeded(s), now: NOW, allow: x => x.time.minutes <= 120 });
    assert.ok(['r18', 'r19'].includes(e.id), e.id);
  }
});
