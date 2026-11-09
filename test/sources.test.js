import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketSources, fetchJson, MARKET_SOURCES } from '../src/core/sources.js';
import { loadOfficial, homeProvider } from '../src/core/official.js';
import { makeFetch } from './fixtures/upstream.js';

const NOW = Date.parse('2026-11-04T12:00:00Z');

test('every market adapter parses its upstream shape', async () => {
  const out = await loadMarketSources({ fetchImpl: makeFetch({ now: NOW }) });
  const by = Object.fromEntries(out.map((s) => [s.id, s]));
  assert.deepEqual(out.map((s) => s.id), MARKET_SOURCES.map((s) => s.id));
  for (const s of out) {
    assert.equal(s.ok, true, `${s.id}: ${s.error}`);
    assert.equal(s.kind, 'market');
    assert.ok(Number.isFinite(s.latencyMs));
    assert.ok(!Number.isNaN(Date.parse(s.asOf)), `${s.id} asOf`);
    assert.equal(s.count, Object.keys(s.rates).length);
  }
  assert.equal(by.fawaz.rates.PKR, 281, 'lower-case codes are upper-cased');
  assert.equal(by.fawaz.rates.BAD, undefined, 'non-numeric values are dropped');
  assert.equal(by.floatrates.rates.SAR, 3.74, 'string rates are parsed');
  assert.equal(by.floatrates.rates.ZZ, undefined, 'malformed codes are dropped');
});

test('a failing adapter is recorded, never thrown', async () => {
  const out = await loadMarketSources({ fetchImpl: makeFetch({ now: NOW, fail: ['floatrates'] }) });
  const fr = out.find((s) => s.id === 'floatrates');
  assert.equal(fr.ok, false);
  assert.match(fr.error, /HTTP 503/);
  assert.deepEqual(fr.rates, {});
  assert.equal(out.filter((s) => s.ok).length, 1);
});

test('Currency-API falls back to its pages.dev mirror when jsDelivr fails', async () => {
  const calls = [];
  const out = await loadMarketSources({ fetchImpl: makeFetch({ now: NOW, fail: ['jsdelivr'], calls }) });
  assert.equal(out.find((s) => s.id === 'fawaz').ok, true);
  assert.ok(calls.some((u) => u.includes('currency-api.pages.dev')));
});

test('feeds whose terms forbid redistribution stay out', () => {
  const ids = MARKET_SOURCES.map((s) => s.id);
  assert.ok(!ids.includes('erapi'), 'ExchangeRate-API forbids services offering programmatic access');
  assert.ok(!ids.includes('moneyconvert'), 'MoneyConvert forbids redistribution without consent');
});

test('fetchJson times out', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(fetchJson('https://slow.example', { fetchImpl, timeoutMs: 20 }), /aborted/);
});

test('official loader parses providers and per-institution quotes', async () => {
  const o = await loadOfficial({ fetchImpl: makeFetch({ now: NOW }) });
  assert.equal(o.ok, true);
  assert.equal(o.kind, 'official');
  assert.equal(Object.keys(o.providers).length, 5);
  assert.equal(o.providers.SBP.pivot, 'PKR');
  assert.equal(o.quotes.XX, undefined, 'invalid quote codes are skipped');
  assert.equal(o.quotes.PKR.providers.length, 1, 'zero-rate institutions are dropped');
  const odd = o.quotes.EUR.providers.find((p) => p.key === 'ODD');
  assert.equal(odd.excluded, true);
  assert.equal(o.quotes.EUR.providers.find((p) => p.key === 'ECB').excluded, false);
  assert.equal(o.asOf, '2026-11-04T00:00:00.000Z');
});

test('official loader failure is reported, not thrown', async () => {
  const o = await loadOfficial({ fetchImpl: makeFetch({ now: NOW, fail: ['frankfurter'] }) });
  assert.equal(o.ok, false);
  assert.deepEqual(o.quotes, {});
  assert.match(o.error, /HTTP 503/);
});

test('homeProvider prefers the institution in the currency\'s own country', () => {
  const providers = {
    A: { key: 'A', pivot: 'EUR', country: 'DE' },
    B: { key: 'B', pivot: 'EUR', country: 'EU' },
    C: { key: 'C', pivot: 'GBP', country: null },
  };
  assert.equal(homeProvider('EUR', providers, 'EU').key, 'B');
  assert.equal(homeProvider('EUR', providers, 'FR').key, 'A');
  assert.equal(homeProvider('GBP', providers, 'GB'), null, 'needs a country');
  assert.equal(homeProvider('JPY', providers, 'JP'), null);
});
