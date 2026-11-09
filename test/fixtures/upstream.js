/**
 * Recorded-shape fixtures for every upstream TrueRate talks to, plus a fake `fetch`
 * that routes by URL. Numbers are chosen so the expected medians/spreads are easy to check by hand.
 *
 * USD/PKR by source:  erapi 280, fawaz 281, floatrates 279, moneyconvert 282  -> median 280.5
 * USD/SAR by source:  erapi 3.75, fawaz 3.76, floatrates 3.74, moneyconvert 3.75 -> median 3.75
 * USD/EUR by source:  erapi 0.92, fawaz 0.921, floatrates 0.919, moneyconvert 0.92 -> median 0.92
 * USD/JPY: erapi + fawaz only (two sources)
 */
const DAY = 86400e3;

export function marketPayloads(now = Date.now()) {
  const iso = new Date(now - 3600e3).toISOString(); // an hour ago: fresh
  const ymd = iso.slice(0, 10);
  return {
    erapi: {
      result: 'success',
      time_last_update_unix: Math.floor((now - 3600e3) / 1000),
      base_code: 'USD',
      rates: { USD: 1, PKR: 280, SAR: 3.75, EUR: 0.92, JPY: 150, XYZ: 5, SYP: 122, MMK: 2100, CAD: 1.40 },
    },
    fawaz: {
      date: ymd,
      usd: { usd: 1, pkr: 281, sar: 3.76, eur: 0.921, jpy: 151, btc: 0.00001, bad: 'x', syp: 13000, mmk: 2100, cad: 1.41 },
    },
    floatrates: {
      pkr: { code: 'PKR', rate: 279, date: new Date(now - 3600e3).toUTCString() },
      sar: { code: 'SAR', rate: '3.74', date: new Date(now - 3600e3).toUTCString() },
      eur: { code: 'EUR', rate: 0.919, date: new Date(now - 3600e3).toUTCString() },
      syp: { code: 'SYP', rate: 122, date: new Date(now - 3600e3).toUTCString() },
      cad: { code: 'CAD', rate: 1.40, date: new Date(now - 3600e3).toUTCString() },
      zzz: { code: 'zz', rate: 1, date: 'garbage' },
    },
    moneyconvert: {
      base: 'USD',
      rates: { USD: 1, PKR: 282, SAR: '3.75', EUR: 0.92, NEG: -1, SYP: 13000, CAD: 2.8 },
      lastModified: new Date(now - 600e3).toUTCString(),
    },
  };
}

export function officialPayloads(now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const monthAgo = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  return {
    providers: [
      { key: 'ECB', name: 'European Central Bank', country_code: 'EU', pivot_currency: 'EUR', rate_type: 'reference', frequency: 'daily', data_url: 'https://ecb.example', end_date: today },
      { key: 'SAMA', name: 'Saudi Central Bank', country_code: 'SA', pivot_currency: 'SAR', rate_type: 'reference', frequency: 'daily', data_url: 'https://sama.example', end_date: today },
      { key: 'SBP', name: 'State Bank of Pakistan', country_code: 'PK', pivot_currency: 'PKR', rate_type: 'weighted average', frequency: 'daily', data_url: 'https://sbp.example', end_date: monthAgo },
      { key: 'FED', name: 'Federal Reserve', country_code: 'US', pivot_currency: 'USD', rate_type: 'noon buying', frequency: 'daily', data_url: 'https://fed.example', end_date: today },
      { key: 'ODD', name: 'Odd Bank', country_code: 'XX', pivot_currency: 'XXX', rate_type: 'reference', frequency: 'daily', data_url: null, end_date: today },
    ],
    // SBP is absent from the live view on purpose: it reports a month late.
    rates: [
      { date: today, base: 'USD', quote: 'EUR', rate: 0.9205, providers: [
        { key: 'ECB', rate: 0.9204, date: today },
        { key: 'FED', rate: 0.9206, date: today },
        { key: 'ODD', rate: 1.2, date: today, excluded: true },
      ] },
      { date: today, base: 'USD', quote: 'SAR', rate: 3.7502, providers: [
        { key: 'SAMA', rate: 3.75, date: today },
        { key: 'FED', rate: 3.7504, date: today },
      ] },
      { date: today, base: 'USD', quote: 'PKR', rate: 283, providers: [
        { key: 'FED', rate: 283, date: today },
        { key: 'ODD', rate: 0, date: today },
      ] },
      { date: today, base: 'USD', quote: 'xx', rate: 1, providers: [] },
    ],
    // /v2/rates?base=usd&providers=SBP: the issuing bank's own (month-old) figures.
    sbp: [
      { date: monthAgo, base: 'USD', quote: 'PKR', rate: 278.5 },
      { date: monthAgo, base: 'USD', quote: 'SAR', rate: 0 },
      { date: monthAgo, base: 'USD', quote: 'EUR', rate: 0.91 },
    ],
    history: [
      { date: '2026-10-03', base: 'USD', quote: 'PKR', rate: 281 },
      { date: '2026-10-01', base: 'USD', quote: 'PKR', rate: 280 },
      { date: '2026-10-02', base: 'USD', quote: 'PKR', rate: 0 },
    ],
  };
}

function respond(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * A `fetch` replacement that serves the fixtures above.
 * @param {{now?: number, fail?: string[], calls?: string[]}} o  fail = substrings of URLs that should return HTTP 503
 */
export function makeFetch({ now = Date.now(), fail = [], calls = [] } = {}) {
  const m = marketPayloads(now);
  const o = officialPayloads(now);
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (fail.some((f) => u.includes(f))) return respond({ error: 'down' }, { status: 503 });
    if (u.startsWith('https://open.er-api.com/')) return respond(m.erapi);
    if (u.includes('currency-api')) return respond(m.fawaz);
    if (u.startsWith('https://www.floatrates.com/')) return respond(m.floatrates);
    if (u.startsWith('https://cdn.moneyconvert.net/')) {
      const { lastModified, ...body } = m.moneyconvert;
      return respond(body, { headers: { 'last-modified': lastModified } });
    }
    if (u === 'https://api.frankfurter.dev/v2/providers') return respond(o.providers);
    if (u.includes('frankfurter.dev/v2/rates') && u.includes('expand=providers')) return respond(o.rates);
    if (u.includes('frankfurter.dev/v2/rates') && u.includes('providers=SBP')) return respond(o.sbp);
    if (u.includes('frankfurter.dev/v2/rates') && u.includes('quotes=')) return respond(o.history);
    return respond({ error: 'no fixture for ' + u }, { status: 404 });
  };
}
