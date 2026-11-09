import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, pairDetail, ratesTable, agreementFor } from '../src/core/aggregate.js';
import { loadMarketSources } from '../src/core/sources.js';
import { loadOfficial } from '../src/core/official.js';
import { median, spreadPct, round, sig } from '../src/core/stats.js';
import { makeFetch } from './fixtures/upstream.js';

const NOW = Date.parse('2026-11-04T12:00:00Z');

async function snapshot({ fail = [], now = NOW } = {}) {
  const fetchImpl = makeFetch({ now, fail });
  const [market, official] = await Promise.all([loadMarketSources({ fetchImpl }), loadOfficial({ fetchImpl })]);
  return buildSnapshot({ market, official, now });
}

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

/* ---------- agreement ---------- */

test('agreementFor: four agreeing sources with an official match is strong agreement', () => {
  const c = agreementFor({ n: 4, spread: 0.1, gapPct: 0.05, staleCount: 0, hasOfficial: true });
  assert.equal(c.label, 'strong');
  assert.equal(c.score, 98);
  assert.deepEqual(c.reasons, []);
});

test('agreementFor: penalties and reasons accumulate', () => {
  const c = agreementFor({ n: 1, spread: 0, gapPct: -3, staleCount: 1, hasOfficial: true });
  assert.equal(c.score, 100 - 30 - 12 - 5); // 53: just under the 55 'partial' cutoff
  assert.equal(c.label, 'weak');
  assert.equal(agreementFor({ n: 1, spread: 0, gapPct: -3, staleCount: 0, hasOfficial: true }).label, 'partial');
  assert.deepEqual(c.reasons, ['only one market source', 'official rate is 3% below market', '1 source older than 48h']);
});

test('agreementFor: official-only data, wide spread, clamps at zero', () => {
  const c = agreementFor({ n: 0, spread: 10, gapPct: null, staleCount: 3, hasOfficial: true });
  assert.equal(c.score, 0);
  assert.equal(c.label, 'weak');
  assert.ok(c.reasons.includes('no live market source; official rate only'));
  assert.ok(c.reasons.includes('sources disagree by 10%'));
  assert.ok(c.reasons.includes('3 sources older than 48h'));
});

test('agreementFor: missing central bank costs 5 points', () => {
  const c = agreementFor({ n: 4, spread: 0, gapPct: null, staleCount: 0, hasOfficial: false });
  assert.equal(c.score, 95);
  assert.deepEqual(c.reasons, ['no central-bank quote to cross-check']);
});

/* ---------- snapshot ---------- */

test('snapshot: consensus is the median of market feeds, with spread and official view', async () => {
  const s = await snapshot();
  const pkr = s.currencies.PKR;
  assert.equal(pkr.rate, 280);
  assert.equal(pkr.market.n, 2);
  assert.equal(pkr.market.min, 279);
  assert.equal(pkr.market.max, 281);
  assert.equal(pkr.market.spreadPct, round((2 / 280) * 100, 4));
  assert.equal(pkr.official.rate, 283);
  assert.equal(pkr.gapPct, round(((283 - 280) / 280) * 100, 4));
  near(pkr.inverse, 1 / 280);
  // per-source deviation from consensus
  const fz = pkr.market.quotes.find((q) => q.source === 'fawaz');
  assert.equal(fz.devPct, round(((281 - 280) / 280) * 100, 4));
  // agreement: 2 sources (-15), spread 0.7143% (-10.71), gap 1.0714% (-4.29) -> 70
  assert.equal(pkr.agreement.score, 70);
  assert.equal(pkr.agreement.label, 'partial');
  assert.deepEqual(pkr.agreement.reasons, ['only two market sources', 'official rate is 1.07% above market']);
});

test('snapshot: metadata, feed status and sources', async () => {
  const s = await snapshot();
  assert.equal(s.base, 'USD');
  assert.equal(s.generatedAt, new Date(NOW).toISOString());
  assert.deepEqual(s.feeds, { market: 2, marketTotal: 2, official: true });
  assert.equal(s.sources.length, 3);
  for (const src of s.sources) assert.equal(src.rates, undefined, 'raw rates are not leaked into sources');
  assert.equal(s.sources.at(-1).quotes, undefined);
  assert.equal(s.providerCount, 5);
  assert.equal(s.currencies.PKR.name, 'Pakistani Rupee');
  assert.equal(s.currencies.PKR.flag, '🇵🇰');
});

test('snapshot: only known fiat currencies are tracked', async () => {
  const s = await snapshot();
  assert.equal(s.currencies.XYZ, undefined);
  assert.equal(s.currencies.BTC, undefined);
  assert.equal(s.currencies.NEG, undefined);
  // currencies no feed carries are omitted rather than shown with a null rate
  for (const c of Object.values(s.currencies)) assert.ok(c.rate > 0 || c.noConsensus, c.code);
});

test('snapshot: USD is 1 everywhere', async () => {
  const s = await snapshot();
  assert.equal(s.currencies.USD.rate, 1);
  assert.equal(s.currencies.USD.market.n, 2);
  assert.equal(s.currencies.USD.market.spreadPct, 0);
  assert.equal(s.currencies.USD.official.rate, 1);
});

test('snapshot: excluded central-bank outliers stay listed but out of the range', async () => {
  const eur = (await snapshot()).currencies.EUR;
  assert.equal(eur.official.n, 3);
  assert.equal(eur.official.nIncluded, 2);
  assert.equal(eur.official.min, 0.9204);
  assert.equal(eur.official.max, 0.9206);
  assert.equal(eur.official.quotes.find((q) => q.key === 'ODD').excluded, true);
  assert.equal(eur.official.quotes.find((q) => q.key === 'ECB').name, 'European Central Bank');
});

test('snapshot: issuing bank is found, and flagged stale when missing from the live view', async () => {
  const s = await snapshot();
  const sar = s.currencies.SAR.official.home;
  assert.equal(sar.key, 'SAMA');
  assert.equal(sar.rate, 3.75);
  assert.equal(sar.stale, false);
  const pkr = s.currencies.PKR.official.home;
  assert.equal(pkr.key, 'SBP');
  assert.equal(pkr.rate, null);
  assert.equal(pkr.stale, true);
  assert.equal(pkr.date, new Date(NOW - 30 * 86400e3).toISOString().slice(0, 10));
});

test('snapshot: two sources and no central bank lowers agreement', async () => {
  const jpy = (await snapshot()).currencies.JPY;
  assert.equal(jpy.market.n, 2);
  assert.equal(jpy.rate, 150.5);
  assert.equal(jpy.official, null);
  assert.equal(jpy.gapPct, null);
  assert.ok(jpy.agreement.reasons.includes('only two market sources'));
  assert.ok(jpy.agreement.reasons.includes('no central-bank quote to cross-check'));
});

test('snapshot: stale market sources are counted', async () => {
  // Build the payloads three days before the snapshot time.
  const fetchImpl = makeFetch({ now: NOW - 3 * 86400e3 });
  const [market, official] = await Promise.all([loadMarketSources({ fetchImpl }), loadOfficial({ fetchImpl })]);
  const s = buildSnapshot({ market, official, now: NOW });
  assert.ok(s.currencies.PKR.agreement.reasons.includes('2 sources older than 48h'));
});

test('snapshot: falls back to official rate when no market feed is up', async () => {
  const s = await snapshot({ fail: ['currency-api', 'floatrates'] });
  assert.equal(s.feeds.market, 0);
  assert.equal(s.currencies.PKR.rate, 283);
  assert.equal(s.currencies.PKR.market, null);
  assert.ok(s.currencies.PKR.agreement.reasons.includes('no live market source; official rate only'));
  assert.equal(s.currencies.JPY, undefined, 'no market and no official means no rate');
});

test('snapshot: market-only when the central-bank feed is down', async () => {
  const s = await snapshot({ fail: ['frankfurter'] });
  assert.equal(s.feeds.official, false);
  assert.equal(s.currencies.PKR.rate, 280);
  assert.equal(s.currencies.PKR.official, null);
  assert.equal(s.currencies.USD.official, null);
});

/* ---------- pair detail ---------- */

test('pairDetail: cross rates are built per source, then the median is taken', async () => {
  const s = await snapshot();
  const d = pairDetail(s, 'PKR', 'SAR');
  const perSource = { fawaz: 3.76 / 281, floatrates: 3.74 / 279 };
  const vals = Object.values(perSource);
  assert.equal(d.market.n, 2);
  near(d.rate, median(vals));
  near(d.market.spreadPct, spreadPct(vals), 1e-3);
  for (const q of d.market.quotes) near(q.rate, perSource[q.source]);
  near(d.inverse, 1 / d.rate, 1e-6);
  assert.equal(d.from.code, 'PKR');
  assert.equal(d.to.code, 'SAR');
  assert.equal(d.from.market, undefined, 'currency stubs are stripped of their USD views');
  assert.deepEqual(d.feeds, s.feeds);
});

test('pairDetail: official cross joins institutions that quote both legs', async () => {
  const d = pairDetail(await snapshot(), 'PKR', 'SAR');
  assert.deepEqual(d.official.quotes.map((q) => q.key), ['FED']);
  assert.equal(d.official.quotes[0].rate, sig(3.7504 / 283, 8));
  assert.equal(d.official.rate, sig(3.7502 / 283, 8));
  assert.deepEqual(d.official.homes, []);
});

test('pairDetail: USD on either side uses each institution\'s quote directly', async () => {
  const s = await snapshot();
  const a = pairDetail(s, 'USD', 'EUR');
  assert.equal(a.official.rate, 0.9205);
  assert.deepEqual(a.official.quotes.map((q) => q.key), ['ECB', 'FED', 'ODD'], 'outliers sort last');
  assert.equal(a.official.homes[0].key, 'ECB');
  assert.equal(a.official.homes[0].side, 'to');

  const b = pairDetail(s, 'EUR', 'USD');
  assert.equal(b.official.rate, sig(1 / 0.9205, 8));
  assert.equal(b.official.quotes.find((q) => q.key === 'ECB').rate, sig(1 / 0.9204, 8));
  assert.equal(b.official.homes[0].side, 'from');
  near(b.rate, median([1 / 0.921, 1 / 0.919]));
});

test('pairDetail: identical legs give exactly 1', async () => {
  const d = pairDetail(await snapshot(), 'PKR', 'PKR');
  assert.equal(d.rate, 1);
  assert.equal(d.market.spreadPct, 0);
});

test('pairDetail: unknown currency returns null', async () => {
  const s = await snapshot();
  assert.equal(pairDetail(s, 'USD', 'ABC'), null);
  assert.equal(pairDetail(s, 'ABC', 'USD'), null);
});

/* ---------- rates table ---------- */

test('ratesTable: USD base matches the snapshot', async () => {
  const s = await snapshot();
  const t = ratesTable(s, 'USD');
  assert.equal(t.base, 'USD');
  assert.equal(t.rates.PKR.rate, 280);
  assert.equal(t.rates.PKR.spreadPct, s.currencies.PKR.market.spreadPct);
  assert.equal(t.rates.PKR.official, 283);
  assert.equal(t.rates.PKR.sources, 2);
  assert.equal(t.rates.PKR.score, s.currencies.PKR.agreement.score);
  assert.equal(t.rates.USD.rate, 1);
});

test('ratesTable: a non-USD base uses true cross figures, not the USD view', async () => {
  const s = await snapshot();
  const t = ratesTable(s, 'PKR');
  const d = pairDetail(s, 'PKR', 'SAR');
  assert.equal(t.rates.SAR.rate, d.rate);
  assert.equal(t.rates.SAR.spreadPct, d.market.spreadPct);
  assert.notEqual(t.rates.SAR.spreadPct, s.currencies.SAR.market.spreadPct);
  assert.equal(t.rates.SAR.official, d.official.rate);
  assert.equal(t.rates.SAR.score, d.agreement.score);
  assert.equal(t.rates.PKR.rate, 1);
});

test('ratesTable: no official column when the base has no central-bank quote', async () => {
  const t = ratesTable(await snapshot(), 'JPY');
  assert.equal(t.rates.EUR.official, null);
  assert.equal(t.rates.PKR.official, null);
  near(t.rates.PKR.rate, median([279 / 150, 281 / 151]));
});

test('ratesTable: memoised per snapshot and base; unknown base is null', async () => {
  const s = await snapshot();
  assert.equal(ratesTable(s, 'PKR'), ratesTable(s, 'PKR'));
  assert.notEqual(ratesTable(s, 'PKR'), ratesTable(s, 'USD'));
  assert.equal(ratesTable(s, 'ABC'), null);
});
