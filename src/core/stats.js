export function median(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function mean(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}

/** Relative spread between extremes, as a percentage of the median. */
export function spreadPct(values) {
  const a = values.filter(Number.isFinite);
  if (a.length < 2) return 0;
  const m = median(a);
  return m ? ((Math.max(...a) - Math.min(...a)) / m) * 100 : 0;
}

export function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Enough significant digits that a rate like 0.0036 or 277.19 both read well. */
export function sig(x, digits = 6) {
  if (!Number.isFinite(x) || x === 0) return x;
  const mag = Math.floor(Math.log10(Math.abs(x)));
  return round(x, Math.max(0, digits - 1 - mag));
}

/**
 * Do these rates really describe one price? Sort them and cut wherever neighbours are more
 * than `gapPct` apart. One bad feed leaves a majority group, so the median still holds.
 * With no majority group (two feeds on one scale, two on another) any median is an invented
 * number that no source reported, so the caller must not publish one.
 */
export function rateGroups(values, gapPct = 5) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const groups = [];
  for (const v of a) {
    const g = groups.at(-1);
    if (g && ((v - g.max) / g.max) * 100 <= gapPct) { g.max = v; g.n += 1; } else groups.push({ min: v, max: v, n: 1 });
  }
  const largest = Math.max(0, ...groups.map((g) => g.n));
  return { groups, split: groups.length > 1 && largest * 2 <= a.length };
}
