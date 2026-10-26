import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeState, isOpenDay } from '../js/simple-state.js';

// Monday 2026-10-26 to Friday 2026-10-30; recipes 'a'…'e' are in the book, 'gone' is not
const dates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const inBook = id => ['a', 'b', 'c', 'd', 'e'].includes(id);
const week = recipes => dates.map((date, i) => ({ date, recipeId: recipes[i] ?? null, skip: recipes[i] === 'skip' }))
  .map(d => (d.skip ? { ...d, recipeId: null } : d));
const MON = '2026-10-26';

test('no dinners yet, on a dinner day: choose tonight first, and no week button (tonight is the next one)', () => {
  const s = homeState(week([]), dates, MON, inBook);
  assert.equal(s.tonight, 'choose');
  assert.equal(s.week, null);
  assert.equal(s.canPrint, false);
  assert.equal(s.thisWeek, true);
});

test('tonight chosen, rest open: cook tonight, and choose the next dinner as a second button', () => {
  const s = homeState(week(['a']), dates, MON, inBook);
  assert.deepEqual([s.tonight, s.week, s.weekIsPrimary, s.canPrint], ['cook', 'choose-next', false, true]);
});

test('tonight open but other days chosen: choose tonight; the week button waits (tonight is the next open day)', () => {
  const s = homeState(week([null, 'b', 'c']), dates, MON, inBook);
  assert.deepEqual([s.tonight, s.week, s.canPrint], ['choose', null, true]);
});

test('later day open after tonight is chosen: choose the next dinner', () => {
  const s = homeState(week(['a', 'b', null, 'd']), dates, MON, inBook);
  assert.equal(s.week, 'choose-next');
});

test('the whole week chosen: cook tonight, change dinners', () => {
  const s = homeState(week(['a', 'b', 'c', 'd', 'e']), dates, MON, inBook);
  assert.deepEqual([s.tonight, s.week], ['cook', 'change']);
});

test('tonight skipped: nothing for tonight, and the week button is the main one', () => {
  const s = homeState(week(['skip', 'b']), dates, MON, inBook);
  assert.deepEqual([s.tonightDay, s.tonight, s.week, s.weekIsPrimary], [null, null, 'choose-next', true]);
});

test('at the weekend the week is next week: no tonight, choose dinners as the main button', () => {
  const next = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const s = homeState(next.map(date => ({ date, recipeId: null, skip: false })), next, '2026-10-31', inBook);
  assert.deepEqual([s.tonight, s.week, s.weekIsPrimary, s.thisWeek, s.canPrint], [null, 'choose-first', true, false, false]);
});

test('a day whose recipe left the book is open again', () => {
  assert.equal(isOpenDay({ recipeId: 'gone', skip: false }, inBook), true);
  assert.equal(isOpenDay({ recipeId: 'a', skip: false }, inBook), false);
  assert.equal(isOpenDay({ recipeId: null, skip: true }, inBook), false);
  const s = homeState(week(['gone', 'b']), dates, MON, inBook);
  assert.equal(s.tonight, 'choose');
});
