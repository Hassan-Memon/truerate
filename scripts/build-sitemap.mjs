/**
 * Regenerates public/sitemap.xml: the home page and the most-searched corridors, each in
 * English and Urdu, with each version naming the other. `npm run sitemap`
 */
import { writeFileSync } from 'node:fs';

const SITE = 'https://truerate.truerate-app.workers.dev';
const TO_PKR = ['usd', 'sar', 'aed', 'gbp', 'eur', 'cad', 'aud', 'qar', 'omr', 'kwd', 'bhd', 'myr'];
const PAIRS = [
  ...TO_PKR.map((c) => `${c}-to-pkr`),
  'pkr-to-usd', 'pkr-to-sar', 'pkr-to-aed', 'pkr-to-gbp', 'pkr-to-eur',
  'usd-to-inr', 'sar-to-inr', 'aed-to-inr', 'gbp-to-inr',
  'usd-to-bdt', 'sar-to-bdt', 'aed-to-bdt',
  'usd-to-sar', 'usd-to-aed', 'usd-to-eur', 'eur-to-usd', 'gbp-to-usd', 'usd-to-gbp',
];

function entry(page) {
  const en = page ? `${SITE}/${page}` : `${SITE}/`;
  const ur = page ? `${SITE}/ur/${page}` : `${SITE}/ur`;
  const alts = `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="ur" href="${ur}"/><xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
  return [en, ur].map((loc) => `  <url><loc>${loc}</loc>${alts}</url>`).join('\n');
}

const body = ['', ...PAIRS].map(entry).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
writeFileSync(new URL('../public/sitemap.xml', import.meta.url), xml);
console.log(`sitemap: ${(PAIRS.length + 1) * 2} URLs`);
