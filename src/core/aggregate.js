/**
 * Turns raw source payloads into one snapshot: for every currency, a consensus rate,
 * the full spread across sources, the official central-bank view, and a confidence score.
 * Pure functions only: no network, no clocks except the `now` you pass in.
 */
import { median, mean, spreadPct, sig, round } from './stats.js';
import { homeProvider } from './official.js';
import CURRENCIES from './currencies.json' with { type: 'json' };

const STALE_MS = 48 * 3600 * 1000;

export function confidenceFor({ n, spread, gapPct, staleCount, hasOfficial }) {
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
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low', reasons };
}

function marketView(quotes) {
  const rates = quotes.map((q) => q.rate);
  const m = median(rates);
  return {
    median: sig(m, 8),
    mean: sig(mean(rates), 8),
    min: sig(Math.min(...rates), 8),
    max: sig(Math.max(...rates), 8),
    n: quotes.length,
    spreadPct: round(spreadPct(rates), 4),
    quotes: quotes.map((q) => ({ ...q, rate: sig(q.rate, 8), devPct: m ? round(((q.rate - m) / m) * 100, 4) : 0 })),
  };
}

function officialView(q, providers, home) {
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
      devPct: rate ? round(((p.rate - rate) / rate) * 100, 4) : 0,
    })),
    home: home ? {
      key: home.key, name: home.name, country: home.country, rateType: home.rateType, url: home.url,
      rate: homeQuote ? sig(homeQuote.rate, 8) : null, date: homeQuote?.date ?? home.lastDate ?? null,
      excluded: homeQuote?.excluded ?? false, stale: !homeQuote,
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
      ov = officialView(official.quotes?.[code], providers, home);
    }

    const rate = mv ? mv.median : ov ? ov.rate : null;
    if (!rate) continue;
    const gapPct = ov && mv ? round(((ov.rate - mv.median) / mv.median) * 100, 4) : null;
    const staleCount = quotes.filter((q) => q.asOf && now - Date.parse(q.asOf) > STALE_MS).length;
    const confidence = confidenceFor({ n: quotes.length, spread: mv?.spreadPct ?? 0, gapPct, staleCount, hasOfficial: !!ov });

    currencies[code] = { code, ...meta, rate: sig(rate, 8), inverse: sig(1 / rate, 8), market: mv, official: ov, gapPct, confidence };
  }

  const sources = [
    ...market.map(({ rates, ...s }) => s),
    (({ providers: _p, quotes: _q, ...s }) => s)(official),
  ];

  return {
    base: 'USD',
    generatedAt: new Date(now).toISOString(),
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
      if (q) homes.push({ ...h, side, currency: cur.code, rate: sig(q.rate, 8), date: q.date, excluded: q.excluded });
    }
    ov = {
      rate: sig(rate, 8),
      date: a.official.date && b.official.date ? (a.official.date < b.official.date ? a.official.date : b.official.date) : (a.official.date ?? b.official.date),
      n: list.length,
      nIncluded: included.length,
      min: included.length ? sig(Math.min(...included), 8) : null,
      max: included.length ? sig(Math.max(...included), 8) : null,
      quotes: list.map((p) => ({ ...p, rate: sig(p.rate, 8), devPct: rate ? round(((p.rate - rate) / rate) * 100, 4) : 0 }))
        .sort((x, y) => Number(x.excluded) - Number(y.excluded) || x.key.localeCompare(y.key)),
      homes,
    };
  }

  const rate = mv ? mv.median : ov ? ov.rate : null;
  if (!rate) return null;
  const gapPct = ov && mv ? round(((ov.rate - mv.median) / mv.median) * 100, 4) : null;
  const now = Date.parse(snapshot.generatedAt);
  const staleCount = quotes.filter((q) => q.asOf && now - Date.parse(q.asOf) > STALE_MS).length;
  const confidence = confidenceFor({ n: quotes.length, spread: mv?.spreadPct ?? 0, gapPct, staleCount, hasOfficial: !!ov });

  const strip = ({ market: _m, official: _o, confidence: _c, gapPct: _g, ...meta }) => meta;
  return {
    from: strip(a), to: strip(b),
    rate: sig(rate, 8), inverse: sig(1 / rate, 8),
    market: mv, official: ov, gapPct, confidence,
    generatedAt: snapshot.generatedAt,
  };
}

/** Compact per-currency table rebased to any currency. */
export function ratesTable(snapshot, base = 'USD') {
  const b = snapshot.currencies[base];
  if (!b) return null;
  const rates = {};
  for (const c of Object.values(snapshot.currencies)) {
    rates[c.code] = {
      code: c.code, name: c.name, symbol: c.symbol, flag: c.flag,
      rate: sig(c.rate / b.rate, 8),
      spreadPct: c.market?.spreadPct ?? null,
      sources: c.market?.n ?? 0,
      official: c.official ? sig(c.official.rate / (b.official?.rate ?? b.rate), 8) : null,
      officialDate: c.official?.date ?? null,
      banks: c.official?.n ?? 0,
      gapPct: c.gapPct,
      confidence: c.confidence.label,
      score: c.confidence.score,
    };
  }
  return { base, generatedAt: snapshot.generatedAt, rates };
}
