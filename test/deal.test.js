import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessDeal, aboutRound, parseAmount, channelContext } from '../public/check.js';
import { STRINGS, translator } from '../public/i18n.js';
import { handleApi, resetCache, publishableRate } from '../src/api.js';
import { buildSnapshot, pairDetail, ratesTable } from '../src/core/aggregate.js';
import { gradeBenchmark, historyPointFor, ladderFor, weekRangePct } from '../src/core/benchmark.js';
import { loadMarketSources } from '../src/core/sources.js';
import { loadOfficial } from '../src/core/official.js';
import { rateGroups } from '../src/core/stats.js';
import REGIMES from '../src/core/regimes.json' with { type: 'json' };
import LADDERS from '../src/core/ladders.json' with { type: 'json' };
import { makeFetch } from './fixtures/upstream.js';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const bench = (rate = 276.8, marginPct = 0.25, grade = 'sources-agree') => ({ rate, marginPct, grade });
const assess = (gave, received, from = 'USD', to = 'PKR', b = bench()) => assessDeal({ gave, received, from, to, benchmark: b });

async function snapshot(now = NOW) {
  const fetchImpl = makeFetch({ now });
  const [market, official] = await Promise.all([loadMarketSources({ fetchImpl }), loadOfficial({ fetchImpl })]);
  return buildSnapshot({ market, official, now });
}

let fetchImpl;
let calls;
beforeEach(() => { resetCache(); calls = []; fetchImpl = makeFetch({ calls }); });
const get = async (path) => {
  const res = await handleApi(new Request('http://x' + path), { fetchImpl });
  return { status: res.status, body: await res.json() };
};

/* ---------- splits: never publish a number no source reported ---------- */

test('rateGroups: one bad feed leaves a majority, so the median holds', () => {
  const { split, groups } = rateGroups([280, 281, 282, 900]);
  assert.equal(split, false);
  assert.equal(groups.length, 2);
});

test('rateGroups: no majority group means no consensus', () => {
  assert.equal(rateGroups([122, 122, 13000, 13000]).split, true);
  assert.equal(rateGroups([1374600, 1684462, 1879663, 1891556]).split, true);
  assert.equal(rateGroups([100, 200]).split, true);
  assert.equal(rateGroups([100, 101]).split, false);
  assert.equal(rateGroups([100]).split, false);
  assert.equal(rateGroups([]).split, false);
});

test('a split currency has no rate, and says so, instead of averaging the two groups', async () => {
  const s = await snapshot();
  const syp = s.currencies.SYP;
  assert.equal(syp.rate, null);
  assert.equal(syp.noConsensus, true);
  assert.equal(syp.market.median, null);
  assert.equal(syp.agreement.label, 'split');
  assert.deepEqual(syp.market.groups.map((g) => g.n), [1, 1]);

  const d = pairDetail(s, 'USD', 'SYP');
  assert.equal(d.rate, null);
  assert.equal(d.inverse, null);
  assert.equal(d.noConsensus, true);
  assert.equal(d.gapPct, null);
  assert.ok(d.market.quotes.every((q) => q.devPct === null));
});

test('ratesTable keeps a split currency and marks it', async () => {
  const t = ratesTable(await snapshot(), 'USD');
  assert.equal(t.rates.SYP.rate, null);
  assert.equal(t.rates.SYP.noConsensus, true);
  assert.equal(t.rates.MMK.noBenchmark, true);
  assert.equal(t.rates.PKR.noBenchmark, false);
});

test('/api/convert returns no result for a split pair rather than a made-up one', async () => {
  const { status, body } = await get('/api/convert?from=USD&to=SYP&amount=100');
  assert.equal(status, 200);
  assert.equal(body.noConsensus, true);
  assert.equal(body.result, null);
});

test('feeds that agree with each other but not with central banks are no consensus either', async () => {
  const s = await snapshot();
  assert.equal(s.currencies.KPW.rate, null);
  assert.equal(s.currencies.KPW.noConsensus, true);
  const d = pairDetail(s, 'USD', 'KPW');
  assert.equal(d.rate, null);
  assert.deepEqual(d.market.groups.map((g) => g.min), [150, 900]);
  assert.equal(gradeBenchmark(d).grade, 'none');
});

/* ---------- agreement is not trust ---------- */

test('a documented multi-rate currency gets no benchmark, however well its feeds agree', async () => {
  const d = pairDetail(await snapshot(), 'USD', 'MMK');
  assert.equal(d.market.spreadPct, 0);
  assert.equal(d.agreement.label, 'strong', 'agreement alone would have called this fine');
  assert.deepEqual(gradeBenchmark(d), { grade: 'none', reason: 'multi-rate' });
  assert.equal(d.regime.to.kind, 'multi');
});

test('gradeBenchmark: agreement across kinds, one kind, a wide gap, a conflict', () => {
  const base = { from: { code: 'USD' }, to: { code: 'PKR' }, market: { spreadPct: 0.1 }, official: { rate: 1 }, gapPct: 0.1 };
  assert.equal(gradeBenchmark(base).grade, 'sources-agree');
  assert.deepEqual(gradeBenchmark({ ...base, official: null, gapPct: null }), { grade: 'limited', reason: 'single-kind' });
  assert.deepEqual(gradeBenchmark({ ...base, gapPct: 2 }), { grade: 'limited', reason: 'wide' });
  assert.deepEqual(gradeBenchmark({ ...base, market: { spreadPct: 3 } }), { grade: 'limited', reason: 'wide' });
  assert.deepEqual(gradeBenchmark({ ...base, gapPct: -98 }), { grade: 'none', reason: 'source-conflict' });
  assert.deepEqual(gradeBenchmark({ ...base, noConsensus: true, gapPct: null }), { grade: 'none', reason: 'split' });
});

test('feeds collected far apart are called out as timing', async () => {
  const s = await snapshot();
  const fresh = pairDetail(s, 'USD', 'PKR').agreement.reasons;
  assert.ok(!fresh.some((r) => r.includes('hours apart')));
  const old = JSON.parse(JSON.stringify(s));
  for (const code of ['USD', 'PKR']) {
    for (const q of old.currencies[code].market.quotes) if (q.source === 'fawaz') q.asOf = new Date(NOW - 40 * 3600e3).toISOString();
  }
  assert.ok(pairDetail(old, 'USD', 'PKR').agreement.reasons.some((r) => r.includes('hours apart')));
});

/* ---------- old data is marked ---------- */

test('a quote more than three days old is marked stale', async () => {
  const later = NOW + 5 * 86400e3;
  const fetchNow = makeFetch({ now: NOW });
  const [market, official] = await Promise.all([loadMarketSources({ fetchImpl: fetchNow }), loadOfficial({ fetchImpl: fetchNow })]);
  const s = buildSnapshot({ market, official, now: later });
  const eur = pairDetail(s, 'USD', 'EUR');
  assert.ok(eur.official.quotes.every((q) => q.stale));
  assert.equal(eur.official.homes[0].stale, true);
  const fresh = pairDetail(await snapshot(), 'USD', 'EUR');
  assert.ok(fresh.official.quotes.every((q) => !q.stale));
});

/* ---------- /api/benchmark ---------- */

test('benchmark today uses the live market median, with a margin', async () => {
  const { status, body } = await get('/api/benchmark?from=USD&to=PKR');
  assert.equal(status, 200);
  assert.equal(body.rate, 280);
  assert.equal(body.source, 'market-median');
  assert.equal(body.low, 279);
  assert.equal(body.high, 283);
  assert.ok(Math.abs(body.marginPct - (4 / 280) * 50) < 1e-9);
  assert.equal(body.grade, 'sources-agree');
});

test('benchmark for a past date uses the last published rate on or before it', async () => {
  const onDay = await get('/api/benchmark?from=USD&to=PKR&date=2026-10-03');
  assert.equal(onDay.body.rate, 281);
  assert.equal(onDay.body.rateDate, '2026-10-03');
  assert.equal(onDay.body.source, 'central-bank-history');
  assert.ok(onDay.body.marginPct >= 0.5);
  assert.ok(calls.some((u) => u.includes('from=2026-09-26&to=2026-10-03')));

  // The fixture's 2 Oct rate is 0, so it is skipped and 1 Oct is used.
  assert.equal((await get('/api/benchmark?from=USD&to=PKR&date=2026-10-02')).body.rateDate, '2026-10-01');
});

test('benchmark gives no rate when nothing was published within a week', async () => {
  const { body } = await get('/api/benchmark?from=USD&to=PKR&date=2026-10-20');
  assert.equal(body.rate, null);
  assert.equal(body.grade, 'none');
  assert.equal(body.reason, 'no-history');
});

test('benchmark gives no rate at all for multi-rate or split pairs', async () => {
  for (const to of ['MMK', 'SYP']) {
    const { body } = await get(`/api/benchmark?from=USD&to=${to}`);
    assert.equal(body.rate, null, to);
    assert.equal(body.grade, 'none', to);
  }
});

test('benchmark validates its input', async () => {
  for (const q of ['date=2026-13-40', 'date=yesterday', 'date=2026-02-31', 'date=2999-01-01', 'date=1999-01-01', 'from=US1']) {
    assert.equal((await get(`/api/benchmark?${q}`)).status, 400, q);
  }
  assert.equal((await get('/api/benchmark?from=USD&to=ABC')).status, 404);
});

test('benchmark accepts tomorrow in UTC, because it is already tomorrow in Karachi', async () => {
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const { status, body } = await get(`/api/benchmark?from=USD&to=PKR&date=${tomorrow}`);
  assert.equal(status, 200);
  assert.equal(body.source, 'market-median');
});

test('a past-date margin grows with how much the pair moved that week', () => {
  assert.equal(weekRangePct([{ date: 'a', rate: 100 }]), 0);
  assert.ok(Math.abs(weekRangePct([{ date: 'a', rate: 90 }, { date: 'b', rate: 110 }]) - 10) < 1e-9);
});

test('a page never publishes a rate it would not stand behind', async () => {
  assert.equal(await publishableRate('USD', 'PKR', { fetchImpl }), 280);
  assert.equal(await publishableRate('USD', 'MMK', { fetchImpl }), null, 'documented multi-rate');
  assert.equal(await publishableRate('USD', 'SYP', { fetchImpl }), null, 'split feeds');
  resetCache();
  const down = makeFetch({ fail: ['currency-api', 'floatrates', 'frankfurter'] });
  assert.equal(await publishableRate('USD', 'PKR', { fetchImpl: down }), null, 'upstream down still renders a page');
  resetCache();
  const hang = () => new Promise(() => {});
  assert.equal(await publishableRate('USD', 'PKR', { fetchImpl: hang }, 10), null, 'a slow upstream cannot hold the page');
});

test('historyPointFor ignores later dates and points over a week old', () => {
  const pts = [{ date: '2026-10-01', rate: 1 }, { date: '2026-10-05', rate: 2 }];
  assert.equal(historyPointFor(pts, '2026-10-04').rate, 1);
  assert.equal(historyPointFor(pts, '2026-10-12').rate, 2);
  assert.equal(historyPointFor(pts, '2026-10-13'), null);
  assert.equal(historyPointFor(pts, '2026-09-01'), null);
});

/* ---------- the deal check ---------- */

test('assessDeal: the worked example', () => {
  const v = assess(1000, 272500);
  assert.equal(v.expected, 276800);
  assert.equal(v.cost, 4300);
  assert.ok(Math.abs(v.costPct - 1.5535) < 0.001);
  assert.equal(v.status, 'noticeable');
  assert.equal(v.displayCurrency, 'PKR');
  assert.equal(v.displayCost, 4300);
});

test('assessDeal: the verdict bands', () => {
  assert.equal(assess(1000, 276800).status, 'about-market');
  assert.equal(assess(1000, 276200).status, 'about-market', '0.22% is inside the margin');
  assert.equal(assess(1000, 275000).status, 'close');
  assert.equal(assess(1000, 270000).status, 'noticeable');
  assert.equal(assess(1000, 268000).status, 'high');
  assert.equal(assess(1000, 277800).status, 'better');
});

test('assessDeal: a wide margin says it cannot tell, never "about the market rate"', () => {
  assert.equal(assess(1000, 272500, 'USD', 'PKR', bench(276.8, 2)).status, 'uncertain');
  assert.equal(assess(1000, 249120, 'USD', 'SDG', bench(276.8, 11.8)).status, 'uncertain', 'a 10% loss inside an 11.8% margin');
  assert.equal(assess(1000, 276500, 'USD', 'PKR', bench(276.8, 1)).status, 'about-market', 'a margin of 1% can still say so');
});

test('assessDeal: fees count, because leaving them out flatters the deal', () => {
  const without = assessDeal({ gave: 1000, received: 276000, from: 'USD', to: 'PKR', benchmark: bench() });
  const withFee = assessDeal({ gave: 1000, fee: 15, received: 276000, from: 'USD', to: 'PKR', benchmark: bench() });
  assert.equal(without.status, 'close');
  assert.equal(withFee.status, 'noticeable');
  assert.equal(withFee.total, 1015);
  assert.ok(Math.abs(withFee.cost - (1015 * 276.8 - 276000)) < 1e-6);
});

test('assessDeal: cash deals get no verdict, however close they look', () => {
  for (const received of [277350, 276500, 275850, 268000]) {
    const v = assessDeal({ gave: 1000, received, from: 'USD', to: 'PKR', channel: 'exchange', benchmark: bench() });
    assert.equal(v.status, 'cash', String(received));
    assert.ok(Number.isFinite(v.cost), 'the difference is still shown');
  }
});

test('assessDeal: a quote with no amount received gives marks to judge it by', () => {
  const v = assessDeal({ gave: 1000, received: null, from: 'USD', to: 'PKR', channel: 'bank', benchmark: bench() });
  assert.equal(v.status, 'estimate');
  assert.equal(v.expected, 276800);
  assert.ok(Math.abs(v.at1 - 274032) < 1e-6);
  assert.ok(Math.abs(v.at3 - 268496) < 1e-6);
});

test('assessDeal: a likely typing mistake gets no verdict, but a real rip-off still shows its cost', () => {
  assert.equal(assess(1000, 272).status, 'implausible');
  assert.equal(assess(1000, 2725000).status, 'implausible');
  assert.equal(assess(1000, 400000).status, 'implausible', 'far more than the market is a mistake');
  const ripoff = assess(1000, 193800);
  assert.equal(ripoff.status, 'extreme');
  assert.ok(ripoff.displayCost > 80000);
});

test('assessDeal: no benchmark means no verdict and no numbers', () => {
  assert.deepEqual(assess(1000, 2000, 'USD', 'MMK', bench(null, null, 'none')), { status: 'no-benchmark' });
  assert.deepEqual(assess(1000, 2000, 'USD', 'MMK', bench(2100, 1, 'none')), { status: 'no-benchmark' });
});

test('assessDeal: a rupee deal is shown in rupees whichever way it ran', () => {
  const v = assess(278480, 1000, 'PKR', 'USD', bench(1 / 276.8));
  assert.equal(v.status, 'close');
  assert.equal(v.displayCurrency, 'PKR');
  assert.ok(Math.abs(v.displayCost - 1680) < 1e-6, String(v.displayCost));
});

test('aboutRound and parseAmount', () => {
  assert.equal(aboutRound(4293), 4300);
  assert.equal(aboutRound(12345), 12000);
  assert.equal(aboutRound(-987), -990);
  assert.equal(aboutRound(0), 0);
  assert.equal(aboutRound(276858, 3), 277000, 'an estimate keeps enough figures to be useful');
  assert.equal(parseAmount('272,500'), 272500);
  assert.equal(parseAmount(' 1 000.5 '), 1000.5);
  for (const bad of ['', 'abc', '0', '-5', null]) assert.equal(parseAmount(bad), null, String(bad));
});

test('channelContext: uses the dealer side the customer actually faced, never an invented figure', () => {
  const ladder = ladderFor('USD', 'PKR', NOW);
  const sellUsd = channelContext('exchange', 'USD', 'PKR', ladder);
  assert.equal(sellUsd.key, 'ctx.buy');
  assert.equal(sellUsd.rate, 277.35);
  const buyUsd = channelContext('exchange', 'PKR', 'USD', ladder);
  assert.equal(buyUsd.key, 'ctx.sell');
  assert.equal(buyUsd.rate, 278.48);
  assert.equal(channelContext('bank', 'USD', 'PKR', ladder).rate, 276.3921);
  assert.equal(channelContext('remittance', 'SAR', 'PKR', null).key, 'ctx.wb');
  for (const [c, f, t] of [['freelance', 'USD', 'PKR'], ['card', 'USD', 'PKR'], ['remittance', 'USD', 'PKR'], ['exchange', 'USD', 'EUR'], ['bank', 'SAR', 'PKR']]) {
    assert.equal(channelContext(c, f, t, ladder).key, 'ctx.none', `${c} ${f}/${t}`);
  }
});

test('the deal arithmetic is browser-only: the app sends the pair and date, never the amounts', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const calls = [...app.matchAll(/api\(`([^`]+)`\)/g)].map((m) => m[1]);
  const call = calls.find((c) => c.startsWith('/api/benchmark'));
  assert.equal(call, '/api/benchmark?from=${from}&to=${to}&date=${date}');
  for (const c of calls) assert.ok(!/gave|received/.test(c), c);
});

/* ---------- ladder ---------- */

test('ladderFor: finds the pair either way round and reports its age', () => {
  const a = ladderFor('USD', 'PKR', Date.parse('2026-11-05T00:00:00Z'));
  assert.equal(a.pair, 'USD/PKR');
  assert.equal(a.ageDays, 1);
  assert.equal(a.stale, false);
  assert.equal(ladderFor('PKR', 'USD', Date.parse('2026-11-09T12:00:00Z')).stale, true);
  assert.equal(ladderFor('USD', 'EUR', NOW), null);
});

test('every ladder row carries a publisher, a method and a link to the original', () => {
  for (const l of Object.values(LADDERS)) {
    assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const r of l.rows) {
      assert.ok(r.publisher && r.method, r.id);
      assert.match(r.url, /^https:\/\//, r.id);
      assert.ok(r.mid > 0 || (r.buy > 0 && r.sell >= r.buy), r.id);
      assert.ok(STRINGS.en[`ladder.${r.id}`], r.id);
    }
  }
});

/* ---------- facts need citations ---------- */

test('every regime entry is cited, in both languages', () => {
  for (const [code, r] of Object.entries(REGIMES)) {
    assert.ok(r.decider.en && r.decider.ur, code);
    assert.ok(r.source.label, code);
    assert.match(r.source.url, /^https:\/\//, code);
    assert.match(r.source.checked, /^\d{4}-\d{2}-\d{2}$/, code);
    if (r.kind === 'peg') assert.ok(r.peg.rate > 0, code);
    if (r.kind === 'band') assert.ok(r.peg.low < r.peg.high, code);
  }
});

test('the pair response carries the regime and the ladder', async () => {
  const { body } = await get('/api/pair?from=SAR&to=PKR');
  assert.equal(body.regime.from.peg.rate, 3.75);
  assert.equal(body.regime.to.kind, 'managed');
  assert.equal(body.ladder, null);
  assert.equal((await get('/api/pair?from=USD&to=PKR')).body.ladder.pair, 'USD/PKR');
});

/* ---------- language ---------- */

test('Urdu covers every English string, with the same placeholders', () => {
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(STRINGS.ur).sort(), Object.keys(STRINGS.en).sort());
  for (const [k, en] of Object.entries(STRINGS.en)) assert.deepEqual(placeholders(STRINGS.ur[k]), placeholders(en), k);
});

test('every data-i18n key in the page exists', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 30);
  for (const k of keys) assert.ok(STRINGS.en[k], k);
});

test('translator fills placeholders and falls back to English', () => {
  assert.equal(translator('en')('src.live', { n: 4 }), '4 live');
  assert.match(translator('ur')('src.live', { n: 4 }), /4/);
  assert.equal(translator('xx')('nav.rates'), 'Rates');
  assert.equal(translator('en')('no.such.key'), 'no.such.key');
});

test('the old overclaims are gone from the page', () => {
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8') + JSON.stringify(STRINGS.en);
  for (const claim of [/independent/i, /authoritative/i, /one honest rate/i, /trust score/i, /high trust/i, /cross-checked/i, /licensed channels/i, /ExchangeRate-API/i, /MoneyConvert/i]) {
    assert.ok(!claim.test(page), String(claim));
  }
});
