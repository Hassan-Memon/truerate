import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, resetCache } from '../src/api.js';
import { makeFetch } from './fixtures/upstream.js';

let calls;
let fetchImpl;
beforeEach(() => {
  resetCache();
  calls = [];
  fetchImpl = makeFetch({ calls });
});

async function get(path, { method = 'GET', opts } = {}) {
  const res = await handleApi(new Request('http://x' + path, { method }), opts ?? { fetchImpl });
  const text = await res.text();
  return { res, status: res.status, body: text ? JSON.parse(text) : null };
}

test('GET /api lists endpoints; trailing slash is tolerated', async () => {
  for (const p of ['/api', '/api/']) {
    const { status, body } = await get(p);
    assert.equal(status, 200);
    assert.ok(body.endpoints['/api/pair?from=USD&to=PKR']);
  }
});

test('GET /api/health needs no upstream and is not cached', async () => {
  const { status, body, res } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(calls.length, 0);
  assert.match(res.headers.get('cache-control'), /max-age=0/);
});

test('GET /api/currencies returns metadata for every tracked currency', async () => {
  const { body } = await get('/api/currencies');
  assert.equal(body.count, Object.keys(body.currencies).length);
  assert.ok(body.count > 150);
  assert.equal(body.currencies.PKR.name, 'Pakistani Rupee');
});

test('GET /api/pair returns full detail, including the stale issuing bank', async () => {
  const { status, body, res } = await get('/api/pair?from=usd&to=pkr');
  assert.equal(status, 200);
  assert.equal(body.rate, 280.5);
  assert.equal(body.market.n, 4);
  assert.equal(body.official.rate, 283);
  const sbp = body.official.homes.find((h) => h.key === 'SBP');
  assert.ok(sbp, 'SBP attached from its own provider feed');
  assert.equal(sbp.rate, 278.5);
  assert.equal(sbp.stale, true);
  assert.equal(sbp.side, 'to');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control'), /s-maxage=300/);
});

test('GET /api/pair defaults to USD→PKR', async () => {
  const { body } = await get('/api/pair');
  assert.equal(body.from.code, 'USD');
  assert.equal(body.to.code, 'PKR');
});

test('snapshot is fetched once and shared across requests', async () => {
  await get('/api/pair?from=USD&to=EUR');
  const n = calls.length;
  await get('/api/rates?base=EUR');
  await get('/api/pair?from=GBP&to=EUR').catch(() => {});
  assert.equal(calls.length, n);
});

test('GET /api/convert multiplies through and gives the low/high band', async () => {
  const { body } = await get('/api/convert?from=USD&to=PKR&amount=100');
  assert.equal(body.amount, 100);
  assert.equal(body.rate, 280.5);
  assert.equal(body.result, 28050);
  assert.equal(body.low, 27900);
  assert.equal(body.high, 28200);
  assert.equal(body.official, 28300);
  assert.equal(body.confidence.label, 'high');
});

test('GET /api/convert rejects a bad amount', async () => {
  for (const a of ['-5', 'abc']) {
    const { status, body } = await get(`/api/convert?from=USD&to=PKR&amount=${a}`);
    assert.equal(status, 400);
    assert.match(body.error, /amount/);
  }
});

test('GET /api/rates rebases the table', async () => {
  const { status, body } = await get('/api/rates?base=PKR');
  assert.equal(status, 200);
  assert.equal(body.base, 'PKR');
  assert.equal(body.rates.PKR.rate, 1);
  // Built per source (1/280, 1/281, 1/279, 1/282), then the median: not simply 1/280.5.
  const expected = (1 / 280 + 1 / 281) / 2;
  assert.ok(Math.abs(body.rates.USD.rate - expected) < 1e-9, `${body.rates.USD.rate} vs ${expected}`);
});

test('GET /api/history returns sorted, cleaned points', async () => {
  const { status, body, res } = await get('/api/history?from=USD&to=PKR&days=30');
  assert.equal(status, 200);
  assert.deepEqual(body.points, [{ date: '2026-10-01', rate: 280 }, { date: '2026-10-03', rate: 281 }]);
  assert.equal(body.days, 30);
  assert.match(res.headers.get('cache-control'), /max-age=1800/);
  assert.ok(calls.some((u) => u.includes('base=usd&quotes=pkr&from=')));
});

test('GET /api/history clamps days', async () => {
  assert.equal((await get('/api/history?days=1')).body.days, 7);
  assert.equal((await get('/api/history?days=999999')).body.days, 3660);
  assert.equal((await get('/api/history?days=nope')).body.days, 30);
});

test('GET /api/sources reports upstream health', async () => {
  const { body } = await get('/api/sources');
  assert.equal(body.sources.length, 5);
  assert.ok(body.sources.every((s) => s.ok));
  assert.equal(body.providerCount, 5);
  assert.equal(body.ttlSeconds, 300);
});

test('input validation: 400 for malformed codes, 404 for unknown ones', async () => {
  assert.equal((await get('/api/rates?base=US1')).status, 400);
  assert.equal((await get('/api/pair?from=USDX&to=PKR')).status, 400);
  assert.equal((await get('/api/history?from=1&to=PKR')).status, 400);
  const r = await get('/api/rates?base=ABC');
  assert.equal(r.status, 404);
  assert.match(r.body.error, /unknown currency ABC/);
  assert.equal((await get('/api/pair?from=USD&to=ABC')).status, 404);
});

test('errors are not cacheable', async () => {
  const { res } = await get('/api/rates?base=US1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('unknown routes 404 with the endpoint list', async () => {
  const { status, body } = await get('/api/nope');
  assert.equal(status, 404);
  assert.ok(body.endpoints);
});

test('methods: OPTIONS is a CORS preflight, POST is refused, HEAD works', async () => {
  const pre = await handleApi(new Request('http://x/api/pair', { method: 'OPTIONS' }), { fetchImpl });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal((await get('/api/pair', { method: 'POST' })).status, 405);
  const head = await handleApi(new Request('http://x/api/health', { method: 'HEAD' }), { fetchImpl });
  assert.equal(head.status, 200);
});

test('every upstream down gives 503, not a crash', async () => {
  const opts = { fetchImpl: makeFetch({ fail: ['er-api', 'currency-api', 'floatrates', 'moneyconvert', 'frankfurter'] }) };
  const { status, body, res } = await get('/api/pair', { opts });
  assert.equal(status, 503);
  assert.match(body.detail, /every upstream source failed/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('central-bank feed down: pair still answers from the market, and says so', async () => {
  const opts = { fetchImpl: makeFetch({ fail: ['frankfurter'] }) };
  const { status, body } = await get('/api/pair?from=USD&to=PKR', { opts });
  assert.equal(status, 200);
  assert.equal(body.rate, 280.5);
  assert.equal(body.official, null);
  assert.equal(body.feeds.official, false);
  assert.ok(body.confidence.reasons.includes('no central-bank quote to cross-check'));
});
