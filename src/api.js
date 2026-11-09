/**
 * HTTP API. Runtime-neutral: takes a web Request, returns a web Response.
 * Used unchanged by the Node server and the Cloudflare Worker.
 */
import { TtlCache } from './core/cache.js';
import { loadMarketSources, fetchJson } from './core/sources.js';
import { loadOfficial } from './core/official.js';
import { buildSnapshot, pairDetail, ratesTable } from './core/aggregate.js';
import { gradeBenchmark, liveBenchmark, historyPointFor } from './core/benchmark.js';
import CURRENCIES from './core/currencies.json' with { type: 'json' };

export const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const HISTORY_TTL_MS = 60 * 60 * 1000;
const cache = new TtlCache();

/** Tests only: forget every cached upstream response. */
export function resetCache() { cache.clear(); }

export async function getSnapshot(opts = {}) {
  return cache.get('snapshot', async () => {
    const [market, official] = await Promise.all([loadMarketSources(opts), loadOfficial(opts)]);
    if (!market.some((s) => s.ok) && !official.ok) throw new Error('every upstream source failed');
    return buildSnapshot({ market, official });
  }, { ttlMs: SNAPSHOT_TTL_MS });
}

async function getHistory(from, to, days, opts) {
  return cache.get(`history:${from}:${to}:${days}`, async () => {
    const start = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
    const url = `https://api.frankfurter.dev/v2/rates?base=${from.toLowerCase()}&quotes=${to.toLowerCase()}&from=${start}`;
    const { body } = await fetchJson(url, opts);
    const points = body.filter((r) => r.rate > 0).map((r) => ({ date: r.date, rate: r.rate })).sort((x, y) => x.date.localeCompare(y.date));
    return { from, to, days, source: 'frankfurter', points };
  }, { ttlMs: HISTORY_TTL_MS });
}

const utcToday = () => new Date().toISOString().slice(0, 10);
const shiftDate = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400e3).toISOString().slice(0, 10);
function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * The yardstick for one deal. The browser does the arithmetic, so amounts never reach this
 * server: it only ever learns the pair and the date.
 */
async function getBenchmark(from, to, date, opts) {
  const today = utcToday();
  const live = !date || date >= today;
  let detail = null;
  try { detail = pairDetail(await getSnapshot(opts), from, to); } catch (err) { if (live) throw err; }
  if (live && !detail) return null;

  const { grade, reason } = detail ? gradeBenchmark(detail) : { grade: 'limited', reason: 'single-kind' };
  const base = { from, to, requestedDate: date ?? today, grade, reason, generatedAt: new Date().toISOString() };
  const blocked = { ...base, rate: null, low: null, high: null, marginPct: null, rateDate: null, source: null };
  if (grade === 'none') return blocked;

  const liveView = detail?.rate ? liveBenchmark(detail) : null;
  if (live) return { ...base, ...liveView, rateDate: today, source: detail.market ? 'market-median' : 'central-bank-consensus' };

  const points = await cache.get(`benchmark:${from}:${to}:${date}`, async () => {
    const url = `https://api.frankfurter.dev/v2/rates?base=${from.toLowerCase()}&quotes=${to.toLowerCase()}&from=${shiftDate(date, -7)}&to=${date}`;
    const { body } = await fetchJson(url, opts);
    return body.filter((r) => r.rate > 0).map((r) => ({ date: r.date, rate: r.rate }));
  }, { ttlMs: HISTORY_TTL_MS });
  const point = historyPointFor(points, date);
  if (!point) return { ...blocked, grade: 'none', reason: 'no-history' };
  return { ...base, rate: point.rate, low: point.rate, high: point.rate, marginPct: Math.max(0.5, liveView?.marginPct ?? 0), rateDate: point.date, source: 'central-bank-history' };
}

/** All of one institution's USD quotes; used when the issuing bank is missing from the live view. */
async function getProviderQuotes(key, opts) {
  return cache.get(`provider:${key}`, async () => {
    const { body } = await fetchJson(`https://api.frankfurter.dev/v2/rates?base=usd&providers=${encodeURIComponent(key)}`, opts);
    const rates = { USD: { rate: 1, date: null } };
    for (const r of body) if (r.rate > 0) rates[r.quote] = { rate: r.rate, date: r.date };
    return rates;
  }, { ttlMs: 6 * HISTORY_TTL_MS });
}

/** The issuing bank's quote is worth showing even when it is a month old; attach it, flagged as stale. */
async function attachStaleHomes(detail, snapshot, opts) {
  if (!detail.official) return detail;
  const want = [[detail.to.code, 'to'], [detail.from.code, 'from']];
  for (const [code, side] of want) {
    const home = snapshot.currencies[code]?.official?.home;
    if (!home || home.rate !== null || detail.official.homes.some((h) => h.key === home.key)) continue;
    try {
      const q = await getProviderQuotes(home.key, opts);
      const a = q[detail.from.code]; const b = q[detail.to.code];
      if (!a || !b) continue;
      const rate = b.rate / a.rate;
      detail.official.homes.push({ ...home, side, currency: code, rate: Number(rate.toPrecision(8)), date: b.date ?? a.date, stale: true });
    } catch { /* optional enrichment; never fail the request */ }
  }
  return detail;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };

function json(data, { status = 200, maxAge = 120, sMaxAge = 300 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=600` : 'no-store',
      ...CORS,
    },
  });
}

const code = (v, fallback) => {
  const c = (v ?? fallback ?? '').toString().trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
};

const ROUTES = {
  '/api': 'index of endpoints',
  '/api/rates?base=USD': 'every currency against a base: consensus rate, spread, official rate, source agreement',
  '/api/benchmark?from=USD&to=PKR&date=2026-11-04': 'the rate a deal is measured against on a date, its margin of error and its grade',
  '/api/pair?from=USD&to=PKR': 'one pair in full detail: every market source and every central bank',
  '/api/convert?from=USD&to=PKR&amount=100': 'convert an amount, with the low/high band across sources',
  '/api/history?from=USD&to=PKR&days=30': 'daily official history for charting',
  '/api/currencies': 'currency metadata',
  '/api/sources': 'upstream source health',
  '/api/health': 'liveness',
};

export async function handleApi(request, opts = {}) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '') || '/api';
  const q = url.searchParams;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method not allowed' }, { status: 405 });

  try {
    if (p === '/api') return json({ name: 'TrueRate API', docs: 'https://github.com/Hassan-Memon/truerate#api', endpoints: ROUTES });
    if (p === '/api/health') return json({ ok: true, time: new Date().toISOString() }, { maxAge: 0, sMaxAge: 0 });
    if (p === '/api/currencies') return json({ count: Object.keys(CURRENCIES).length, currencies: CURRENCIES }, { maxAge: 86400, sMaxAge: 86400 });

    if (p === '/api/sources') {
      const s = await getSnapshot(opts);
      return json({ generatedAt: s.generatedAt, ttlSeconds: SNAPSHOT_TTL_MS / 1000, sources: s.sources, providerCount: s.providerCount, providers: s.providers });
    }

    if (p === '/api/rates') {
      const base = code(q.get('base'), 'USD');
      if (!base) return json({ error: 'base must be a 3-letter currency code' }, { status: 400 });
      const s = await getSnapshot(opts);
      const t = ratesTable(s, base);
      return t ? json(t) : json({ error: `unknown currency ${base}` }, { status: 404 });
    }

    if (p === '/api/pair' || p === '/api/convert') {
      const from = code(q.get('from'), 'USD');
      const to = code(q.get('to'), 'PKR');
      if (!from || !to) return json({ error: 'from and to must be 3-letter currency codes' }, { status: 400 });
      const s = await getSnapshot(opts);
      const d = pairDetail(s, from, to);
      if (!d) return json({ error: `no data for ${from}/${to}` }, { status: 404 });
      await attachStaleHomes(d, s, opts);
      if (p === '/api/pair') return json(d);
      const amount = parseFloat(q.get('amount') ?? '1');
      if (!Number.isFinite(amount) || amount < 0) return json({ error: 'amount must be a non-negative number' }, { status: 400 });
      return json({
        from, to, amount,
        rate: d.rate,
        noConsensus: d.noConsensus,
        result: d.rate ? amount * d.rate : null,
        low: d.market ? amount * d.market.min : null,
        high: d.market ? amount * d.market.max : null,
        official: d.official ? amount * d.official.rate : null,
        agreement: d.agreement,
        generatedAt: d.generatedAt,
      });
    }

    if (p === '/api/benchmark') {
      const from = code(q.get('from'), 'USD');
      const to = code(q.get('to'), 'PKR');
      const date = q.get('date') || null;
      if (!from || !to) return json({ error: 'from and to must be 3-letter currency codes' }, { status: 400 });
      if (date && !validDate(date)) return json({ error: 'date must be a real date written YYYY-MM-DD' }, { status: 400 });
      // A day of grace: it is already tomorrow in Karachi for hours before it is in UTC.
      if (date && date > shiftDate(utcToday(), 1)) return json({ error: 'date cannot be in the future' }, { status: 400 });
      if (date && date < '2015-01-01') return json({ error: 'date is too far in the past' }, { status: 400 });
      const b = await getBenchmark(from, to, date, opts);
      return b ? json(b) : json({ error: `no data for ${from}/${to}` }, { status: 404 });
    }

    if (p === '/api/history') {
      const from = code(q.get('from'), 'USD');
      const to = code(q.get('to'), 'PKR');
      const days = Math.min(3660, Math.max(7, parseInt(q.get('days') ?? '30', 10) || 30));
      if (!from || !to) return json({ error: 'from and to must be 3-letter currency codes' }, { status: 400 });
      return json(await getHistory(from, to, days, opts), { maxAge: 1800, sMaxAge: 3600 });
    }

    return json({ error: 'not found', endpoints: ROUTES }, { status: 404 });
  } catch (err) {
    return json({ error: 'upstream failure', detail: String(err?.message || err) }, { status: 503 });
  }
}
