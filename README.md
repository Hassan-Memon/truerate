# TrueRate

**One honest exchange rate, with every source shown.**

## The problem

> **Money is property, and every property deserves an evaluation people can see.**
> We expect to know how land, cars, gold and companies are valued. A currency is valued every day too, yet most people only ever see a number with no name, no method and no time attached. Every website shows a different dollar rate, and nobody tells you **who decided it, how, and when**.
>
> **TrueRate exists to bring that process into the light:** for every currency, show who actually sets the rate, where they publish it, how it is calculated in their own words, and how each number you are quoted relates to the price where currency really changes hands.

What we found (details and sources in [`docs/research.md`](docs/research.md)):

- **Who decides.** Nobody, for a floating currency: the rate is the price at which banks actually trade. A managed float (PKR, INR) is the same, except the central bank steps in to calm the market. A peg (SAR 3.75, AED 3.6725, HKD 7.75–7.85) is decided by the state, by policy.
- **There is a chain of rates, not one rate.** USD/PKR on 4 Nov 2026: interbank closing **276.70** → banks to customers **276.39 / 276.85** → open market (cash) **277.35 / 278.48**. All three are published daily by the State Bank of Pakistan. "Every site shows a different rate" is mostly sites showing different steps of this chain.
- **What is still hidden.** Individual trades. Currency trading is about $9.6 trillion a day on private bank platforms; only end-of-day averages are made public.
- **Our own weak point.** TrueRate's consensus today is the median of four free aggregators that do not publish their methods. The goal is to rank every number by **how close it is to a real trade** and **whether its method is published**, and to anchor on primary sources (central banks, official fixings) wherever they exist.

## What the site does today

TrueRate does not pretend there is one exact number. It asks many independent sources at once, shows the **consensus**, the **spread** between them, the **official central-bank** view, and a **trust score**.

- Zero runtime dependencies (plain Node 22+ or Cloudflare Workers).
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

Requires Node 22+.

```bash
node src/server.js          # http://localhost:3000
npm test                    # 66 offline tests (node --test), fixtures in test/fixtures/
npm run preview             # same app inside the real Workers runtime (wrangler dev)
```

If an upstream is down the site keeps working: a dead market feed is dropped from the median, and if the central-bank feed (Frankfurter) is down the page says so and shows market feeds only. `/api/pair` reports this as `feeds: { market, marketTotal, official }`.

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
3. Or deploy from CI: set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets on the `production` environment, set the repository variable `DEPLOY_ENABLED=true`, and push to `master`. Deploy is off until you do — see [`docs/security.md`](docs/security.md#cicd) for the minimum token scope.

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

## Status (2026-11-04)

Done and verified:
- Backend: all endpoints, verified live with 4 market feeds (USD/PKR) and earlier with 19 central banks + the SBP stale fallback.
- Frontend: converter, range strip, trust badge, source tables, all-currencies table, history chart. Checked in a headless browser at desktop and phone widths (no horizontal scroll). The earlier "did not mount" bug was real: `/api/currencies` entries carry no `code` field, so `fillSelects()` threw inside `init()` as a silent unhandled rejection. Fixed, and `init()` now reports startup errors on the page.
- `ratesTable` (`/api/rates?base=…`) now computes spread, trust and official columns for the actual cross pair; previously a non-USD base showed each currency's USD figures, and mixed market and official rates when the base had no central bank.
- Node server: a malformed URL (`/%E0%A4%A`) used to crash the process via an unhandled rejection; it now returns 400.
- Tests: 66 offline tests across stats, cache, adapters, aggregation, API routes and the static server. `.github/workflows/ci.yml` runs them on Node 22 and 24 and checks that the Worker bundles.
- Worker: `wrangler deploy --dry-run` bundles cleanly (JSON import included) and `wrangler dev` serves pages and API correctly.

Next, the core of the mission (see [`docs/research.md`](docs/research.md)):
1. **Rate ladder** per pair: interbank → bank buy/sell → open market → what you pay, each with publisher, method in their own words, time and a link to the original document.
2. **SBP adapter** (Pakistan first): interbank revaluation rates (~40 currencies), bank customer buy/sell (10), ECAP open market (6). The PDFs contain plain text that can be read without libraries; take their links from the `economic-data` page rather than guessing file names.
3. **"Who decides this currency"** card: floating / managed / peg, the decider, peg value and since when, link to the central bank's statement. Only cited facts; "not yet documented" otherwise.
4. **Peg check**: distance of the market from the official peg.
5. **Source grading**: primary vs secondary, method published or not; anchor the consensus on primary sources.
6. Add other countries' official publishers one by one.

Open:
1. Deploy: `npx wrangler@4 login && npm run deploy` (needs your Cloudflare account). Watch CPU time on the free plan (10 ms per request): parsing the full Frankfurter `expand=providers` response is the heaviest step and only happens once per 5-minute snapshot per isolate.
2. To auto-deploy from Actions: set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the `production` environment, then `gh variable set DEPLOY_ENABLED --body true`. See [`docs/security.md`](docs/security.md#cicd).
3. The canonical URL in `public/index.html` points at `truerate.pages.dev`; change it to the real deployed URL.
4. History relies on Frankfurter alone; when it is down the chart says so. A second history source would remove that single point of failure.
5. Later: Urdu/RTL toggle, street-rate tier when a public feed exists, embed widget.

## Security

The app ships no dependencies, no API keys, and no cookies, and every upstream URL is hardcoded. Repository controls — secret scanning with push protection, Dependabot, branch protection on `master`, least-privilege `GITHUB_TOKEN`, SHA-pinned actions, and security headers applied by both runtimes — are documented with verification commands in [`docs/security.md`](docs/security.md). Report vulnerabilities privately via [`SECURITY.md`](SECURITY.md).

MIT licence. Rates are informational, not financial advice.
