/**
 * What a deal is measured against, and how far that yardstick can be believed.
 * Pure functions: the API layer does the fetching.
 */
import REGIMES from './regimes.json' with { type: 'json' };
import LADDERS from './ladders.json' with { type: 'json' };

const LADDER_STALE_DAYS = 3;
const DAY_MS = 86400e3;

export const regimeFor = (code) => REGIMES[code] ?? null;

/** Rate rows are always quoted as written in the file (USD/PKR), whichever way the pair runs. */
export function ladderFor(from, to, now = Date.now()) {
  const key = LADDERS[`${from}/${to}`] ? `${from}/${to}` : LADDERS[`${to}/${from}`] ? `${to}/${from}` : null;
  if (!key) return null;
  const ladder = LADDERS[key];
  const ageDays = Math.floor((now - Date.parse(`${ladder.date}T00:00:00Z`)) / DAY_MS);
  return { pair: key, ...ladder, ageDays, stale: ageDays > LADDER_STALE_DAYS };
}

/**
 * cross-checked: market feeds and central-bank figures agree closely. Still not a price you can trade at.
 * limited:       only one kind of source, or a wide gap between them.
 * none:          we know this number would mislead, so we give no verdict.
 */
export function gradeBenchmark(detail) {
  const legs = [detail.from?.code, detail.to?.code];
  if (legs.some((c) => REGIMES[c]?.noBenchmark)) return { grade: 'none', reason: 'multi-rate' };
  if (detail.noConsensus) return { grade: 'none', reason: 'split' };
  if (Number.isFinite(detail.gapPct) && Math.abs(detail.gapPct) > 5) return { grade: 'none', reason: 'source-conflict' };
  if (!detail.market || !detail.official) return { grade: 'limited', reason: 'single-kind' };
  if (detail.market.spreadPct > 1.5 || Math.abs(detail.gapPct ?? 0) > 1.5) return { grade: 'limited', reason: 'wide' };
  return { grade: 'cross-checked', reason: null };
}

/** The live yardstick, with a margin no verdict should claim to see inside. */
export function liveBenchmark(detail) {
  const pts = [detail.market?.min, detail.market?.max, detail.official?.rate].filter(Number.isFinite);
  const low = Math.min(...pts);
  const high = Math.max(...pts);
  return { rate: detail.rate, low, high, marginPct: Math.max(0.25, ((high - low) / detail.rate) * 50) };
}

/** Latest published point on or before the date, if it is within a week of it. */
export function historyPointFor(points, date) {
  const usable = points.filter((p) => p.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const point = usable.at(-1);
  if (!point) return null;
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${point.date}T00:00:00Z`)) / DAY_MS;
  return gap <= 7 ? point : null;
}
