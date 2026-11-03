// Builds src/core/currencies.json: the fiat universe TrueRate tracks.
// Codes = union of what the live sources publish; names/symbols from ICU; flag from ISO country prefix.
import { writeFileSync } from 'node:fs';

const names = new Intl.DisplayNames(['en'], { type: 'currency', fallback: 'none' });
const FLAG_OVERRIDES = {
  EUR: 'EU', XAF: 'CM', XOF: 'SN', XPF: 'PF', XCD: 'AG', ANG: 'CW', XDR: null,
  XAU: null, XAG: null, XPT: null, XPD: null, USD: 'US', GBP: 'GB', CHF: 'CH',
  AED: 'AE', SAR: 'SA', PKR: 'PK', INR: 'IN', ZAR: 'ZA', ZMW: 'ZM', ZWL: 'ZW', ZWG: 'ZW',
  STN: 'ST', SSP: 'SS', RSD: 'RS', MRU: 'MR', KID: 'KI', TVD: 'TV', FOK: 'FO', GGP: 'GG',
  IMP: 'IM', JEP: 'JE', CNH: 'CN', BYN: 'BY', SLE: 'SL', VES: 'VE', MKD: 'MK',
};
const ZERO_DECIMALS = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'PYG', 'XAF', 'XOF', 'XPF', 'RWF', 'GNF', 'DJF', 'KMF', 'VUV', 'BIF']);
const flag = (cc) => cc ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';

async function j(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }

const [er, fr] = await Promise.all([
  j('https://open.er-api.com/v6/latest/USD'),
  j('https://api.frankfurter.dev/v2/rates?base=usd'),
]);
const codes = new Set(['USD', ...Object.keys(er.rates), ...fr.map(r => r.quote)]);
const out = {};
for (const code of [...codes].filter(c => /^[A-Z]{3}$/.test(c)).sort()) {
  const name = names.of(code);
  if (!name) continue; // not an ISO fiat currency ICU knows about
  let symbol = code;
  try {
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
    symbol = parts.find(p => p.type === 'currency')?.value ?? code;
  } catch {}
  const cc = code in FLAG_OVERRIDES ? FLAG_OVERRIDES[code] : code.slice(0, 2);
  out[code] = { name, symbol, flag: flag(cc), country: cc ?? null, decimals: ZERO_DECIMALS.has(code) ? 0 : 2 };
}
writeFileSync(new URL('../src/core/currencies.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote', Object.keys(out).length, 'currencies');
