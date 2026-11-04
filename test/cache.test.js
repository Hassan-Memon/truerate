import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/core/cache.js';

function clock(t) {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  return { advance: (ms) => { now += ms; } };
}

test('serves the cached value inside the TTL', async (t) => {
  const c = clock(t);
  const cache = new TtlCache();
  let loads = 0;
  const loader = async () => ++loads;
  assert.equal(await cache.get('k', loader, { ttlMs: 1000 }), 1);
  c.advance(999);
  assert.equal(await cache.get('k', loader, { ttlMs: 1000 }), 1);
  assert.equal(loads, 1);
});

test('concurrent misses share one in-flight load', async () => {
  const cache = new TtlCache();
  let loads = 0;
  const loader = () => new Promise((r) => setTimeout(() => r(++loads), 10));
  const values = await Promise.all([1, 2, 3, 4].map(() => cache.get('k', loader, { ttlMs: 1000 })));
  assert.deepEqual(values, [1, 1, 1, 1]);
  assert.equal(loads, 1);
});

test('stale-while-revalidate: returns old value immediately and refreshes in the background', async (t) => {
  const c = clock(t);
  const cache = new TtlCache();
  let loads = 0;
  const loader = async () => ++loads;
  await cache.get('k', loader, { ttlMs: 1000, staleMs: 5000 });
  c.advance(2000); // expired but still usable
  assert.equal(await cache.get('k', loader, { ttlMs: 1000, staleMs: 5000 }), 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(cache.peek('k'), 2);
});

test('a failed refresh keeps serving the stale value', async (t) => {
  const c = clock(t);
  const cache = new TtlCache();
  await cache.get('k', async () => 'good', { ttlMs: 1000, staleMs: 5000 });
  c.advance(2000);
  const v = await cache.get('k', async () => { throw new Error('upstream down'); }, { ttlMs: 1000, staleMs: 5000 });
  assert.equal(v, 'good');
  await new Promise((r) => setImmediate(r));
  assert.equal(cache.peek('k'), 'good');
});

test('past the stale window, a miss waits for the loader and errors propagate', async (t) => {
  const c = clock(t);
  const cache = new TtlCache();
  await cache.get('k', async () => 'old', { ttlMs: 1000, staleMs: 1000 });
  c.advance(5000);
  await assert.rejects(cache.get('k', async () => { throw new Error('boom'); }, { ttlMs: 1000, staleMs: 1000 }), /boom/);
  assert.equal(await cache.get('k', async () => 'new', { ttlMs: 1000, staleMs: 1000 }), 'new');
});

test('clear forgets everything', async () => {
  const cache = new TtlCache();
  await cache.get('k', async () => 1, { ttlMs: 1000 });
  cache.clear();
  assert.equal(cache.peek('k'), undefined);
});
