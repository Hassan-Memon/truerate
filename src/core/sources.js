/**
 * Market-reference sources. Each publishes USD-based mid rates, free of charge, no API key.
 *
 * Check a feed's terms before adding it: this site offers an open API, so a feed that forbids
 * redistribution or programmatic access cannot be used. ExchangeRate-API's open endpoint and
 * MoneyConvert both forbid it, and were removed for that reason.
 * Every adapter returns { rates: {CODE: number}, asOf: ISO string } or throws.
 */
const TIMEOUT_MS = 8000;
const UA = 'TrueRate/0.1 (+https://github.com/Hassan-Memon/truerate)';

export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { body: await res.json(), headers: res.headers };
  } finally { clearTimeout(t); }
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const code = k.toUpperCase();
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(n) && n > 0) out[code] = n;
  }
  return out;
}

export const MARKET_SOURCES = [
  {
    id: 'fawaz',
    name: 'Currency-API (fawazahmed0)',
    homepage: 'https://github.com/fawazahmed0/exchange-api',
    kind: 'market',
    cadence: 'daily',
    async load(o) {
      let body;
      try {
        ({ body } = await fetchJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', o));
      } catch {
        ({ body } = await fetchJson('https://latest.currency-api.pages.dev/v1/currencies/usd.min.json', o));
      }
      return { rates: clean(body.usd), asOf: new Date(body.date + 'T00:00:00Z').toISOString() };
    },
  },
  {
    id: 'floatrates',
    name: 'FloatRates',
    homepage: 'https://www.floatrates.com/json-feeds.html',
    kind: 'market',
    cadence: 'twice a day',
    async load(o) {
      const { body } = await fetchJson('https://www.floatrates.com/daily/usd.json', o);
      const rates = {};
      let latest = 0;
      for (const v of Object.values(body)) {
        const n = parseFloat(v.rate);
        if (/^[A-Z]{3}$/.test(v.code) && Number.isFinite(n) && n > 0) rates[v.code] = n;
        const d = Date.parse(v.date);
        if (d > latest) latest = d;
      }
      return { rates, asOf: new Date(latest || Date.now()).toISOString() };
    },
  },
];

/** Runs every adapter concurrently; failures are recorded, never fatal. */
export async function loadMarketSources(opts = {}, sources = MARKET_SOURCES) {
  return Promise.all(sources.map(async (s) => {
    const meta = { id: s.id, name: s.name, kind: s.kind, homepage: s.homepage, cadence: s.cadence };
    const t0 = Date.now();
    try {
      const { rates, asOf } = await s.load(opts);
      return { ...meta, ok: true, rates, asOf, latencyMs: Date.now() - t0, count: Object.keys(rates).length };
    } catch (err) {
      return { ...meta, ok: false, rates: {}, asOf: null, latencyMs: Date.now() - t0, count: 0, error: String(err?.message || err) };
    }
  }));
}
