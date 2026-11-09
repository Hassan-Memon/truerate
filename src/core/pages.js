/**
 * Server-rendered pages. The HTML is the same app, but the language, metadata, headings and
 * structured data are already in it, so a search engine or a shared link sees the real page
 * in English (/usd-to-pkr) or Urdu (/ur/usd-to-pkr) without running any script.
 */
import CURRENCIES from './currencies.json' with { type: 'json' };
import { translator, FAQ_IDS } from '../../public/i18n.js';

export const SITE = 'https://truerate.truerate-app.workers.dev';

/** Which page does this URL ask for? null means it is not a page: an asset, or a 404. */
export function routeFromUrl(url) {
  const m = url.pathname.match(/^(\/ur)?(?:\/([a-z]{3})-to-([a-z]{3}))?\/?$/i);
  if (!m) return null;
  const lang = m[1] ? 'ur' : 'en';
  if (m[2]) {
    const from = m[2].toUpperCase();
    const to = m[3].toUpperCase();
    return CURRENCIES[from] && CURRENCIES[to] && from !== to ? { lang, pair: { from, to } } : null;
  }
  const from = (url.searchParams.get('from') ?? '').toUpperCase();
  const to = (url.searchParams.get('to') ?? '').toUpperCase();
  return { lang, pair: CURRENCIES[from] && CURRENCIES[to] && from !== to ? { from, to } : null };
}

export function pathFor(lang, pair) {
  const page = pair ? `/${pair.from.toLowerCase()}-to-${pair.to.toLowerCase()}` : '';
  return lang === 'ur' ? `/ur${page}` : page || '/';
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

export function formatRate(rate) {
  return Number(rate.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/**
 * @param {string} html  public/index.html
 * @param {{lang:string, pair:{from:string,to:string}|null}} route
 * @param {{rate?:number|null}} [live]  today's median, if it is safe to publish for this pair
 */
export function renderPage(html, { lang, pair }, { rate = null } = {}) {
  const T = translator(lang);
  const shown = rate ? formatRate(rate) : null;
  const vars = pair ? { from: pair.from, to: pair.to, rate: shown, fromName: CURRENCIES[pair.from].name, toName: CURRENCIES[pair.to].name } : {};
  const title = T(pair ? (shown ? 'seo.title.pair' : 'seo.title.pairNoRate') : 'seo.title.home', vars);
  const desc = T(pair ? 'seo.desc.pair' : 'seo.desc.home', vars);
  const canonical = SITE + pathFor(lang, pair);

  const graph = [
    { '@type': 'WebApplication', name: 'TrueRate', url: canonical, applicationCategory: 'FinanceApplication', operatingSystem: 'Any', inLanguage: lang, description: desc, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@type': 'Person', name: 'Hassan Memon', url: 'https://github.com/Hassan-Memon' } },
    { '@type': 'FAQPage', inLanguage: lang, mainEntity: FAQ_IDS.map((id) => ({ '@type': 'Question', name: T(`faq.${id}.q`), acceptedAnswer: { '@type': 'Answer', text: T(`faq.${id}.a`) } })) },
  ];
  if (pair) {
    graph.push({ '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'TrueRate', item: SITE + pathFor(lang, null) },
      { '@type': 'ListItem', position: 2, name: `${pair.from} to ${pair.to}`, item: canonical },
    ] });
  }
  const head = [
    `<link rel="alternate" hreflang="en" href="${SITE}${pathFor('en', pair)}">`,
    `<link rel="alternate" hreflang="ur" href="${SITE}${pathFor('ur', pair)}">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}${pathFor('en', pair)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:locale" content="${lang === 'ur' ? 'ur_PK' : 'en_US'}">`,
    ld({ '@context': 'https://schema.org', '@graph': graph }),
  ].join('\n  ');

  const heading = T(pair ? 'hero.title.pair' : 'hero.title', vars);
  const summary = pair ? T(shown ? 'summary.rate' : 'summary.none', vars) : '';
  return html
    .replace(/<html lang="en" dir="ltr">/, () => `<html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${attr(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, a) => a + attr(desc))
    .replace(/(<meta property="og:title" content=")[^"]*/, (_, a) => a + attr(title))
    .replace(/(<meta property="og:description" content=")[^"]*/, (_, a) => a + attr(desc))
    .replace(/(<link rel="canonical" href=")[^"]*/, (_, a) => a + canonical)
    .replace('<!--seo-->', () => head)
    // Translate the visible text, so a crawler reads the page in the language it asked for.
    .replace(/(<[a-z0-9]+\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)[^<]*/g, (_, open, key) => open + (key === 'hero.title' ? attr(heading) : attr(T(key))))
    .replace(/(<p id="pair-summary"[^>]*>)<\/p>/, (_, open) => `${open}${attr(summary)}</p>`)
    // Keep Urdu readers and crawlers on the Urdu pages.
    .replace(/data-pair href="\//g, () => (lang === 'ur' ? 'data-pair href="/ur/' : 'data-pair href="/'));
}
