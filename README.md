# TrueRate

**One honest exchange rate, with every source shown.**

Every website quotes a different number for the dollar. Interbank, buying, selling, official, open market: they are all different rates, copied at different times and rounded differently. TrueRate does not pretend there is one exact number. It asks many independent sources at once, shows the **consensus**, the **spread** between them, the **official central-bank** view, and a **trust score**.

- Zero runtime dependencies (plain Node 20+ or Cloudflare Workers).
- Zero API keys. Every upstream is free and public.
- Zero hosting cost on the Cloudflare Workers free plan.

## Data sources (live at runtime)

| Tier | Source | Notes |
|---|---|---|
| Market | ExchangeRate-API open endpoint | daily, 160+ currencies |
| Market | Currency-API (fawazahmed0, jsDelivr + pages.dev fallback) | daily |
| Market | FloatRates | hourly |
| Market | MoneyConvert | every 5 min |
| Official | Frankfurter v2 `expand=providers` | ~106 central banks in one call, with outlier flags |
| Official | Issuing bank fallback (e.g. State Bank of Pakistan) | fetched per institution when missing from the live view, shown with its date and marked stale |

Consensus = median of market feeds. Cross pairs (PKR→SAR) are built per source. Trust score loses points for few sources, wide spread, market/official gap, and stale data. Street (kerb) rates have no free public feed yet; the adapter list in `src/core/sources.js` is where one would be added.

## Run locally

```bash
node src/server.js          # http://localhost:3000
npm test                    # node --test (tests still to be written)
```

## API

```
GET /api/pair?from=USD&to=PKR                 every source and central bank for one pair
GET /api/convert?from=USD&to=PKR&amount=100   result plus low/high band
GET /api/rates?base=PKR                       all currencies against a base
GET /api/history?from=USD&to=PKR&days=90      daily official history
GET /api/sources  ·  /api/currencies  ·  /api/health
```

Responses are cached five minutes in memory and carry `Cache-Control` so the edge caches them too. CORS is open.

## Deploy for free (Cloudflare Workers)

1. Create a free Cloudflare account (no card needed).
2. `npx wrangler@4 login` then `npm run deploy`. You get `https://truerate.<you>.workers.dev`.
3. Or set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets on the GitHub repo and push to `main`; `.github/workflows/deploy.yml` deploys automatically.

Any Node host (Render, Fly, Railway free tiers) also works: `PORT=8080 node src/server.js`.

## Project layout

```
src/core/sources.js    market adapters        src/core/official.js   central-bank adapter
src/core/aggregate.js  consensus + pair maths src/core/cache.js      TTL cache, stale-while-revalidate
src/api.js             HTTP routes (web Request/Response, runtime neutral)
src/server.js          Node entry             src/worker.js          Cloudflare Worker entry
public/                index.html, app.js, styles.css (no build step)
scripts/build-currencies.mjs   regenerates src/core/currencies.json (166 fiat currencies)
```

## Status (2026-11-03)

Done and verified against live upstreams:
- Backend complete: all endpoints return correct data, including USD/PKR with 4 feeds + 19 banks and the SBP stale fallback.
- Frontend written: converter, range strip, trust badge, source tables, all-currencies table, history chart with hover.

Open:
1. **Frontend did not mount in the headless QA browser** (no console errors, API reachable, `app.js` served as a module). Open `http://localhost:3000` in a normal browser and check DevTools; if it works there, the headless tool is the issue, otherwise fix `public/app.js` `init()`.
2. Write `test/` (node --test) for `aggregate.js` with fixtures; CI workflow runs `npm test`.
3. `npx wrangler@4 dev` once to confirm the Worker bundles the JSON import, then deploy.
4. Create the GitHub remote: `gh repo create truerate --public --source . --push`.
5. Later: Urdu/RTL toggle, street-rate tier when a public feed exists, embed widget.

MIT licence. Rates are informational, not financial advice.
