/**
 * Turns raw source payloads into one snapshot: for every currency, a consensus rate,
 * the full spread across sources, the official central-bank view, and how well the sources agree.
 * Pure functions only: no network, no clocks except the `now` you pass in.
 */
import { median, mean, spreadPct, sig, round, rateGroups } from './stats.js';
import { homeProvider } from './official.js';
import { regimeFor, ladderFor } from './benchmark.js';
import CURRENCIES from './currencies.json' with { type: 'json' };

const STALE_MS = 48 * 3600 * 1000;
/** Central banks skip weekends and holidays, so Friday's figure is still current on Monday: count whole days. */
const OFFICIAL_STALE_DAYS = 3;
const isOldDate = (date, now) => !!date && Math.floor((now - Date.parse(`${date}T00:00:00Z`)) / 86400e3) > OFFICIAL_STALE_DAYS;

/**
 * How well the sources agree with each other. This is all it measures: feeds that copy the
 * same official rate agree perfectly even where nobody can trade at it, so it must never be
 * presented as trust in the number.
 */
export function agreementFor({ n, spread, gapPct, staleCount, hasOfficial, split = false, groups = [], feedAgeHours = 0 }) {
  if (split) {
    const near = groups.map((g) => sig(g.min, 4)).join(' and ');
    return { score: 0, label: 'split', reasons: [`sources split into separate groups (near ${near}), so there is no consensus`] };
  }
  let score = 100;
  const reasons = [];
  if (n === 0) { score -= 45; reasons.push('no live market source; official rate only'); }
  else if (n === 1) { score -= 30; reasons.push('only one market source'); }
  else if (n === 2) { score -= 15; reasons.push('only two market sources'); }
  else if (n === 3) { score -= 5; }
  if (spread > 0) {
    const penalty = Math.min(45, spread * 15);
    score -= penalty;
    if (spread >= 1) reasons.push(`sources disagree by ${round(spread, 2)}%`);
  }
  if (Number.isFinite(gapPct)) {
    const g = Math.abs(gapPct);
    score -= Math.min(25, g * 4);
    if (g >= 1) reasons.push(`official rate is ${round(g, 2)}% ${gapPct > 0 ? 'above' : 'below'} market`);
  } else if (!hasOfficial) { score -= 5; reasons.push('no central-bank quote to cross-check'); }
  if (staleCount) { score -= 5 * staleCount; reasons.push(`${staleCount} source${staleCount > 1 ? 's' : ''} older than 48h`); }
  if (feedAgeHours > 24 && spread > 0) reasons.push(`feeds were collected up to ${Math.round(feedAgeHours)} hours apart, so some of this spread is timing`);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: score >= 80 ? 'strong' : score >= 55 ? 'partial' : 'weak', reasons };
}

function feedAge(quotes) {
  const times = quotes.map((q) => Date.parse(q.asOf)).filter(Number.isFinite);
  return times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600e3 : 0;
}

function marketView(quotes) {
  const rates = quotes.map((q) => q.rate);
  const m = median(rates);
  const { groups, split } = rateGroups(rates);
  return {
    median: split ? null : sig(m, 8),
    noConsensus: split,
    groups: split ? groups.map((g) => ({ min: sig(g.min, 8), max: sig(g.max, 8), n: g.n })) : [],
    feedAgeHours: round(feedAge(quotes), 1),
    mean: sig(mean(rates), 8),
    min: sig(Math.min(...rates), 8),
    max: sig(Math.max(...rates), 8),
    n: quotes.length,
    spreadPct: round(spreadPct(rates), 4),
    quotes: quotes.map((q) => ({ ...q, rate: sig(q.rate, 8), devPct: split ? null : m ? round(((q.rate - m) / m) * 100, 4) : 0 })),
  };
}

function officialView(q, providers, home, now) {
  if (!q) return null;
  const included = q.providers.filter((p) => !p.excluded).map((p) => p.rate);
  const rate = q.rate;
  const homeQuote = home ? q.providers.find((p) => p.key === home.key) : null;
  return {
    rate: sig(rate, 8),
    date: q.date,
    n: q.providers.length,
    nIncluded: included.length,
    min: included.length ? sig(Math.min(...included), 8) : null,
    max: included.length ? sig(Math.max(...included), 8) : null,
    quotes: q.providers.map((p) => ({
      key: p.key,
      name: providers[p.key]?.name ?? p.key,
      country: providers[p.key]?.country ?? null,
      rateType: providers[p.key]?.rateType ?? null,
      rate: sig(p.rate, 8),
      date: p.date,
      excluded: p.excluded,
      stale: isOldDate(p.date, now),
      devPct: rate ? round(((p.rate - rate) / rate) * 100, 4) : 0,
    })),
    home: home ? {
      key: home.key, name: home.name, country: home.country, rateType: home.rateType, url: home.url,
      rate: homeQuote ? sig(homeQuote.rate, 8) : null, date: homeQuote?.date ?? home.lastDate ?? null,
      excluded: homeQuote?.excluded ?? false, stale: !homeQuote || isOldDate(homeQuote.date, now),
    } : null,
  };
}

/**
 * @param {{market: Array, official: object, now?: number}} input
 */
export function buildSnapshot({ market, official, now = Date.now() }) {
  const okMarket = market.filter((s) => s.ok);
  const providers = official.providers ?? {};
  const currencies = {};

  const codes = new Set(Object.keys(CURRENCIES));
  for (const s of okMarket) for (const c of Object.keys(s.rates)) if (CURRENCIES[c]) codes.add(c);

  for (const code of [...codes].sort()) {
    const meta = CURRENCIES[code] ?? { name: code, symbol: code, flag: '', country: null, decimals: 2 };
    const quotes = code === 'USD'
      ? okMarket.map((s) => ({ source: s.id, rate: 1, asOf: s.asOf }))
      : okMarket.filter((s) => s.rates[code] > 0).map((s) => ({ source: s.id, rate: s.rates[code], asOf: s.asOf }));
    const mv = quotes.length ? marketView(quotes) : null;

    let ov = null;
    if (code === 'USD') {
      ov = official.ok ? { rate: 1, date: official.asOf?.slice(0, 10) ?? null, n: 0, nIncluded: 0, min: 1, max: 1, quotes: [], home: null } : null;
    } else {
      const home = homeProvider(code, providers, meta.country);
      ov = officialView(official.quotes?.[code], providers, home, now);
    }

    const split = !!mv?.noConsensus;
    const rate = split ? null : mv ? mv.median : ov ? ov.rate : null;
    if (!rate && !split) continue;
    const gapPct = rate && ov && mv ? round(((ov.rate - mv.median) / mv.median) * 100, 4) : null;
    const staleCount = quotes.filter((q) => q.asOf && now - Date.parse(q.asOf) > STALE_MS).length;
    const agreement = agreementFor({ n: quotes.length, spread: mv?.spreadPct ?? 0, gapPct, staleCount, hasOfficial: !!ov, split, groups: mv?.groups, feedAgeHours: mv?.feedAgeHours });

    currencies[code] = { code, ...meta, rate: rate ? sig(rate, 8) : null, inverse: rate ? sig(1 / rate, 8) : null, noConsensus: split, market: mv, official: ov, gapPct, agreement };
  }

  const sources = [
    ...market.map(({ rates, ...s }) => s),
    (({ providers: _p, quotes: _q, ...s }) => s)(official),
  ];

  return {
    base: 'USD',
    generatedAt: new Date(now).toISOString(),
    feeds: { market: okMarket.length, marketTotal: market.length, official: !!official.ok },
    sources,
    providerCount: Object.keys(providers).length,
    providers,
    currencies,
  };
}

/** Everything the UI needs for one pair, with each source's own cross rate. */
export function pairDetail(snapshot, from, to) {
  const a = snapshot.currencies[from];
  const b = snapshot.currencies[to];
  if (!a || !b) return null;

  // Market: join quotes by source so each cross rate is internally consistent.
  const byA = new Map((a.market?.quotes ?? []).map((q) => [q.source, q]));
  const quotes = [];
  for (const qb of b.market?.quotes ?? []) {
    const qa = byA.get(qb.source);
    if (!qa) continue;
    quotes.push({ source: qb.source, rate: qb.rate / qa.rate, asOf: qa.asOf > qb.asOf ? qa.asOf : qb.asOf });
  }
  const mv = quotes.length ? marketView(quotes) : null;

  // Official: join by institution key. A USD leg means every institution has a quote of 1.
  let ov = null;
  if (a.official && b.official) {
    const list = [];
    if (from === 'USD') for (const p of b.official.quotes) list.push({ ...p });
    else if (to === 'USD') for (const p of a.official.quotes) list.push({ ...p, rate: 1 / p.rate });
    else {
      const byKey = new Map(a.official.quotes.map((p) => [p.key, p]));
      for (const pb of b.official.quotes) {
        const pa = byKey.get(pb.key);
        if (!pa) continue;
        list.push({ ...pb, rate: pb.rate / pa.rate, excluded: pa.excluded || pb.excluded, date: pa.date < pb.date ? pa.date : pb.date });
      }
    }
    const included = list.filter((p) => !p.excluded).map((p) => p.rate);
    const rate = from === 'USD' ? b.official.rate : to === 'USD' ? 1 / a.official.rate : b.official.rate / a.official.rate;
    const homes = [];
    for (const [cur, side] of [[b, 'to'], [a, 'from']]) {
      const h = cur.official.home;
      if (!h) continue;
      const q = list.find((p) => p.key === h.key);
      if (q) homes.push({ ...h, side, currency: cur.code, rate: sig(q.rate, 8), date: q.date, excluded: q.excluded, stale: isOldDate(q.date, Date.parse(snapshot.generatedAt)) });
    }
    ov = {
      rate: sig(rate, 8),
      date: a.official.date && b.official.date ? (a.official.date < b.official.date ? a.official.date : b.official.date) : (a.official.date ?? b.official.date),
      n: list.length,
      nIncluded: included.length,
      min: included.length ? sig(Math.min(...included), 8) : null,
      max: included.length ? sig(Math.max(...included), 8) : null,
      quotes: list.map((p) => ({ ...p, rate: sig(p.rate, 8), stale: isOldDate(p.date, Date.parse(snapshot.generatedAt)), devPct: rate ? round(((p.rate - rate) / rate) * 100, 4) : 0 }))
        .sort((x, y) => Number(x.excluded) - Number(y.excluded) || x.key.localeCompare(y.key)),
      homes,
    };
  }

  const split = !!mv?.noConsensus;
  const rate = split ? null : mv ? mv.median : ov ? ov.rate : null;
  if (!rate && !split) return null;
  const gapPct = rate && ov && mv ? round(((ov.rate - mv.median) / mv.median) * 100, 4) : null;
  const now = Date.parse(snapshot.generatedAt);
  const staleCount = quotes.filter((q) => q.asOf && now - Date.parse(q.asOf) > STALE_MS).length;
  const agreement = agreementFor({ n: quotes.length, spread: mv?.spreadPct ?? 0, gapPct, staleCount, hasOfficial: !!ov, split, groups: mv?.groups, feedAgeHours: mv?.feedAgeHours });

  const strip = ({ market: _m, official: _o, agreement: _a, gapPct: _g, noConsensus: _n, ...meta }) => meta;
  return {
    from: strip(a), to: strip(b),
    rate: rate ? sig(rate, 8) : null, inverse: rate ? sig(1 / rate, 8) : null,
    noConsensus: split,
    market: mv, official: ov, gapPct, agreement,
    regime: { from: regimeFor(from), to: regimeFor(to) },
    ladder: ladderFor(from, to, now),
    feeds: snapshot.feeds ?? null,
    generatedAt: snapshot.generatedAt,
  };
}

/** Tables are pure functions of (snapshot, base); remember them for the snapshot's lifetime. */
const tableMemo = new WeakMap();

/**
 * Compact per-currency table rebased to any currency. Every column is computed for the
 * actual cross pair (base → code), the same way pairDetail does it, not copied from the USD view.
 */
export function ratesTable(snapshot, base = 'USD') {
  if (!snapshot.currencies[base]) return null;
  let memo = tableMemo.get(snapshot);
  if (!memo) { memo = new Map(); tableMemo.set(snapshot, memo); }
  if (memo.has(base)) return memo.get(base);

  const rates = {};
  for (const c of Object.values(snapshot.currencies)) {
    const d = pairDetail(snapshot, base, c.code);
    if (!d) continue;
    rates[c.code] = {
      code: c.code, name: c.name, symbol: c.symbol, flag: c.flag,
      rate: d.rate,
      spreadPct: d.market?.spreadPct ?? null,
      sources: d.market?.n ?? 0,
      official: d.official?.rate ?? null,
      officialDate: d.official?.date ?? null,
      banks: d.official?.n ?? 0,
      gapPct: d.gapPct,
      noConsensus: d.noConsensus,
      noBenchmark: !!(d.regime.from?.noBenchmark || d.regime.to?.noBenchmark),
      agreement: d.agreement.label,
      score: d.agreement.score,
    };
  }
  const table = { base, generatedAt: snapshot.generatedAt, rates };
  memo.set(base, table);
  return table;
}
