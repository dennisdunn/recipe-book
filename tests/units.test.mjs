import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fraction, formatAmount, formatQuantity } from '../js/units.js';

test('fraction rounds to kitchen fractions and never to nothing', () => {
  assert.equal(fraction(0.25), '¼');
  assert.equal(fraction(1.333), '1⅓');
  assert.equal(fraction(2), '2');
  assert.equal(fraction(2.5), '2½');
  assert.equal(fraction(0.97), '1');
  assert.equal(fraction(0.02), '⅛');
});

test('volumes pick tsp, tbsp, cups or quarts', () => {
  assert.equal(formatAmount({ value: 4.929, unit: 'ml' }), '1 tsp');
  assert.equal(formatAmount({ value: 14.787, unit: 'ml' }), '1 tbsp');
  assert.equal(formatAmount({ value: 236.588, unit: 'ml' }), '1 cup');
  assert.equal(formatAmount({ value: 473.2, unit: 'ml' }), '2 cups');
  assert.equal(formatAmount({ value: 2839, unit: 'ml' }), '3 quarts');
});

test('weights pick ounces or pounds', () => {
  assert.equal(formatAmount({ value: 113.4, unit: 'g' }), '4 oz');
  assert.equal(formatAmount({ value: 566.99, unit: 'g' }), '1¼ lb');
});

test('packages and counts', () => {
  assert.equal(formatAmount({ value: 2, unit: 'pkg', package: 'can', packageOz: 15 }), '2 cans (15 oz)');
  assert.equal(formatAmount({ value: 1, unit: 'pkg' }), '1 pkg');
  assert.equal(formatAmount({ value: 3, unit: 'each', countUnit: 'clove' }), '3 cloves');
  assert.equal(formatAmount({ value: 0.5, unit: 'each' }), '½');
});

test('quantity ranges', () => {
  assert.equal(formatQuantity(2, 3), '2–3');
  assert.equal(formatQuantity(1.5, null), '1½');
  assert.equal(formatQuantity(null, null), '');
});
