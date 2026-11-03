/**
 * Official tier: central-bank and monetary-authority rates, collected by Frankfurter (frankfurter.dev).
 * One request returns, for every currency, the quote from ~100 institutions plus Frankfurter's outlier flags.
 */
import { fetchJson } from './sources.js';

export const OFFICIAL_SOURCE = {
  id: 'frankfurter',
  name: 'Frankfurter (central banks)',
  homepage: 'https://frankfurter.dev/',
  kind: 'official',
  cadence: 'daily',
};

export async function loadProviders(opts) {
  const { body } = await fetchJson('https://api.frankfurter.dev/v2/providers', opts);
  const out = {};
  for (const p of body) {
    out[p.key] = {
      key: p.key, name: p.name, country: p.country_code, pivot: p.pivot_currency,
      rateType: p.rate_type, frequency: p.frequency, url: p.data_url, lastDate: p.end_date,
    };
  }
  return out;
}

export async function loadOfficialQuotes(opts) {
  const { body } = await fetchJson('https://api.frankfurter.dev/v2/rates?base=usd&expand=providers', opts);
  const quotes = {};
  let latest = '';
  for (const row of body) {
    if (!/^[A-Z]{3}$/.test(row.quote) || !(row.rate > 0)) continue;
    quotes[row.quote] = {
      rate: row.rate,
      date: row.date,
      providers: (row.providers ?? [])
        .filter((p) => p.rate > 0)
        .map((p) => ({ key: p.key, rate: p.rate, date: p.date, excluded: !!p.excluded })),
    };
    if (row.date > latest) latest = row.date;
  }
  return { quotes, asOf: latest ? new Date(latest + 'T00:00:00Z').toISOString() : null };
}

export async function loadOfficial(opts = {}) {
  const t0 = Date.now();
  try {
    const [providers, { quotes, asOf }] = await Promise.all([loadProviders(opts), loadOfficialQuotes(opts)]);
    return { ...OFFICIAL_SOURCE, ok: true, providers, quotes, asOf, latencyMs: Date.now() - t0, count: Object.keys(quotes).length };
  } catch (err) {
    return { ...OFFICIAL_SOURCE, ok: false, providers: {}, quotes: {}, asOf: null, latencyMs: Date.now() - t0, count: 0, error: String(err?.message || err) };
  }
}

/** The institution that issues this currency, if Frankfurter carries it. */
export function homeProvider(code, providers, currencyCountry) {
  const all = Object.values(providers);
  return all.find((p) => p.pivot === code && p.country && p.country === currencyCountry)
    || all.find((p) => p.pivot === code && p.country)
    || null;
}
