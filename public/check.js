/**
 * The deal check. Runs only in the browser: the amounts someone types are never sent anywhere.
 * Pure functions, no DOM, so the tests can import this file directly.
 */

/**
 * Our judgement, stated publicly. 3% is the UN's target for the cost of sending money home.
 * extremeFrom: costly enough to say so loudly, while asking the person to check their numbers.
 * implausibleFrom: this far out, a typing mistake is far likelier than a deal.
 */
export const BANDS = Object.freeze({ closeBelow: 1, highFrom: 3, extremeFrom: 25, implausibleFrom: 60 });

/** Round to two significant figures by default: a cost cannot honestly support more than "about". */
export function aboutRound(x, figures = 2) {
  if (!Number.isFinite(x) || x === 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(Math.abs(x))) - figures + 1);
  return Math.round(x / step) * step;
}

export function parseAmount(text) {
  const v = Number.parseFloat(String(text ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * @param {{gave:number, fee?:number, received:number|null, from:string, to:string, channel?:string,
 *          benchmark:{rate:number|null, marginPct:number|null, grade:string}}} deal
 * status: no-benchmark | estimate | cash | implausible | extreme | uncertain | about-market | better | close | noticeable | high
 */
export function assessDeal({ gave, fee = 0, received, from, to, channel, benchmark }) {
  if (benchmark.grade === 'none' || !benchmark.rate) return { status: 'no-benchmark' };
  const total = gave + fee;
  const expected = total * benchmark.rate;
  if (received == null) {
    return { status: 'estimate', total, expected, at1: expected * 0.99, at3: expected * 0.97, displayCurrency: to };
  }
  const cost = expected - received;
  const costPct = (cost / expected) * 100;
  // People think in the money they count at home, so a rupee deal is always shown in rupees.
  const inFrom = from === 'PKR';
  const displayCurrency = inFrom ? from : to;
  const displayCost = inFrom ? cost / benchmark.rate : cost;
  const out = { total, expected, cost, costPct, displayCurrency, displayCost };
  const size = Math.abs(costPct);
  if (size >= BANDS.implausibleFrom || (cost < 0 && size >= BANDS.extremeFrom)) return { ...out, status: 'implausible' };
  // Cash dealers publish their own prices on either side of the mid-market rate, so measuring
  // them against it can call a short-changed customer "about the market rate".
  if (channel === 'exchange') return { ...out, status: 'cash' };
  if (size >= BANDS.extremeFrom) return { ...out, status: 'extreme' };
  if (size <= benchmark.marginPct) return { ...out, status: benchmark.marginPct > BANDS.closeBelow ? 'uncertain' : 'about-market' };
  if (cost < 0) return { ...out, status: 'better' };
  if (size < BANDS.closeBelow) return { ...out, status: 'close' };
  if (size < BANDS.highFrom) return { ...out, status: 'noticeable' };
  return { ...out, status: 'high' };
}

const WORLD_BANK_SA_PK = {
  totalPct: 2.82, marginPct: 1.47, collected: 'Nov 2024',
  url: 'https://remittanceprices.worldbank.org/corridor/Saudi-Arabia/Pakistan',
};

/** What we can really say about this channel, or nothing. Never an invented "typical" number. */
export function channelContext(channel, from, to, ladder) {
  const pkrUsd = (from === 'USD' && to === 'PKR') || (from === 'PKR' && to === 'USD');
  if (pkrUsd && ladder && (channel === 'exchange' || channel === 'bank')) {
    const row = ladder.rows.find((r) => r.id === (channel === 'exchange' ? 'open' : 'bank'));
    // The customer selling dollars gets the dealer's buying rate, and the other way round.
    const rate = from === 'USD' ? row.buy : row.sell;
    return { key: from === 'USD' ? 'ctx.buy' : 'ctx.sell', channel, rate, date: ladder.date, url: row.url };
  }
  if (channel === 'remittance' && from === 'SAR' && to === 'PKR') return { key: 'ctx.wb', ...WORLD_BANK_SA_PK };
  return { key: 'ctx.none' };
}
