/**
 * Real pages for currency pairs. The HTML is the same app; only the metadata changes, so a
 * shared link or a search result names the pair without needing to run any script.
 */
import CURRENCIES from './currencies.json' with { type: 'json' };

export const SITE = 'https://truerate.truerate-app.workers.dev';

export function pairFromUrl(url) {
  const m = url.pathname.match(/^\/([a-z]{3})-to-([a-z]{3})\/?$/i);
  const onHome = url.pathname === '/';
  const from = (m ? m[1] : onHome ? url.searchParams.get('from') ?? '' : '').toUpperCase();
  const to = (m ? m[2] : onHome ? url.searchParams.get('to') ?? '' : '').toUpperCase();
  return CURRENCIES[from] && CURRENCIES[to] && from !== to ? { from, to } : null;
}

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderPairHtml(html, { from, to }) {
  const title = `${from} to ${to}: what did your deal really cost? · TrueRate`;
  const desc = `Enter what you gave and what you received in ${CURRENCIES[from].name} and ${CURRENCIES[to].name}. TrueRate shows the cost against the market rate that day, with every source shown. Your amounts stay on your device.`;
  const canonical = `${SITE}/${from.toLowerCase()}-to-${to.toLowerCase()}`;
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${attr(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, a) => a + attr(desc))
    .replace(/(<meta property="og:title" content=")[^"]*/, (_, a) => a + attr(title))
    .replace(/(<meta property="og:description" content=")[^"]*/, (_, a) => a + attr(desc))
    .replace(/(<link rel="canonical" href=")[^"]*/, (_, a) => a + canonical);
}
