import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, mean, spreadPct, round, sig } from '../src/core/stats.js';

test('median handles odd, even, unsorted and non-finite input', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5, NaN, 1, Infinity, 3]), 3);
  assert.ok(Number.isNaN(median([])));
});

test('median does not mutate its input', () => {
  const a = [3, 1, 2];
  median(a);
  assert.deepEqual(a, [3, 1, 2]);
});

test('mean ignores non-finite values', () => {
  assert.equal(mean([1, 2, 3, NaN]), 2);
  assert.ok(Number.isNaN(mean([])));
});

test('spreadPct is (max - min) / median, in percent', () => {
  assert.equal(spreadPct([100]), 0);
  assert.equal(spreadPct([]), 0);
  assert.equal(round(spreadPct([99, 100, 101]), 6), 2);
  assert.equal(spreadPct([0, 0, 0]), 0);
});

test('round and sig', () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(sig(277.191234, 6), 277.191);
  assert.equal(sig(0.00361234567, 4), 0.003612);
  assert.equal(sig(-12.3456, 3), -12.3);
  assert.equal(sig(0), 0);
  assert.ok(Number.isNaN(sig(NaN)));
});
