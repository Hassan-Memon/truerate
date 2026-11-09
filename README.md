# TrueRate

**What did your currency deal really cost you?** Enter what you gave and what you received. TrueRate shows the cost against the market rate that day, in your own money, with every source shown. Your amounts never leave your device.

**Live:** [truerate.truerate-app.workers.dev](https://truerate.truerate-app.workers.dev) · [![CI](https://github.com/Hassan-Memon/truerate/actions/workflows/ci.yml/badge.svg)](https://github.com/Hassan-Memon/truerate/actions/workflows/ci.yml) [![Deploy](https://github.com/Hassan-Memon/truerate/actions/workflows/deploy.yml/badge.svg)](https://github.com/Hassan-Memon/truerate/actions/workflows/deploy.yml)

## The problem

> **Money is property, and every property deserves an evaluation people can see.**
> We expect to know how land, cars, gold and companies are valued. A currency is valued every day too, yet most people only ever see a number with no name, no method and no time attached. Every website shows a different dollar rate, and nobody tells you **who decided it, how, and when**.
>
> **TrueRate exists to bring that process into the light:** for every currency, show who actually sets the rate, where they publish it, how it is calculated in their own words, and how each number you are quoted relates to the price where currency really changes hands.

What we found (details and sources in [`docs/research.md`](docs/research.md)):

- **Who decides.** Nobody, for a floating currency: the rate is the price at which banks actually trade. A managed float (PKR, INR) is the same, except the central bank steps in to calm the market. A peg (SAR 3.75, AED 3.6725, HKD 7.75–7.85) is decided by the state, by policy.
- **There is a chain of rates, not one rate.** USD/PKR on 4 Nov 2026: interbank closing **276.70** → banks to customers **276.39 / 276.85** → open market (cash) **277.35 / 278.48**. All three are published daily by the State Bank of Pakistan. "Every site shows a different rate" is mostly sites showing different steps of this chain.
- **What is still hidden.** Individual trades. Currency trading is about $9.6 trillion a day on private bank platforms; only end-of-day averages are made public.
- **Our own weak point.** Today's benchmark is the median of four free aggregators that do not publish their methods, cross-checked against central-bank figures. That is accurate enough to spot a cost of 1–4%, but it is not a price anyone can trade at, and agreement between feeds proves nothing where they copy the same official rate. So every answer states its margin of error and its grade, and gives no verdict where the number would mislead.

## What the site does today

- **Check a deal.** Amount given, amount received, date, channel. The answer: "this deal cost you about 4,300 PKR (1.6%)", the benchmark used, its margin of error, and what we can verify about that channel. Works for every currency we can benchmark, in English and Urdu, with a WhatsApp share that contains only what the person chooses to send.
- **Private by design.** The browser fetches the benchmark for a pair and a date, then does the arithmetic itself. Amounts are never sent to the server (`public/check.js`, and a test enforces it). Nothing is stored.
- **Refuses to guess.** If sources split into separate groups, or a currency is documented as having more than one rate (Myanmar, Venezuela, Iran, Syria so far), there is no rate and no verdict, only the reason and a citation.
- **Rate ladder (USD/PKR).** Interbank, banks, open market, each with publisher, method in their own words and a link to the original document. See the limits below.
- **Who decides.** Floating, managed, peg or band, with a citation, plus the market's distance from any peg. Anything else says "not yet documented".
- **Reference tools.** Converter, range strip, source tables, all currencies and history, with figures over three days old marked. Their agreement label measures only whether sources agree.

**Current limits.**

- The ladder is entered by hand from the published documents (`src/core/ladders.json`) and shows its age. SBP's site refuses scripted requests, and we do not work around that.
- "Typical cost" for a channel appears only where a citable figure exists, currently the World Bank's Saudi Arabia to Pakistan baseline from November 2024 and the ladder. We do not rank providers or name cheaper ones yet.
- The past-date benchmark uses central-bank figures through Frankfurter, and its grade reflects how the pair's sources agree today.
- The list of multi-rate currencies is hand-maintained and short, so a currency missing from it is not proven to have one rate. Server-generated explanations in the reference tools stay in English in the Urdu view.

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

| Hand-entered | SBP and ECAP published documents (`src/core/ladders.json`) | USD/PKR ladder, dated, each row linked to its original |
| Hand-entered | Cited regime facts (`src/core/regimes.json`) | pegs, bands and multi-rate currencies, each with a source and a date checked |

Consensus = median of market feeds, unless they split with no majority group (neighbouring rates more than 5% apart), in which case there is no rate. Cross pairs (PKR→SAR) are built per source. Source agreement loses points for few sources, wide spread, market/official gap, and stale data. Benchmark grade: **cross-checked** (market and central-bank figures within 1.5%), **limited** (one kind of source, or a wider gap), **none** (no verdict). Verdict bands: under 1% close to market, 1–3% noticeable, 3% or more high. The bands are our judgement; 3% is the UN target for remittance costs.

## Run locally

Requires Node 22+.

```bash
node src/server.js          # http://localhost:3000
npm test                    # 103 offline tests (node --test), fixtures in test/fixtures/
npm run preview             # same app inside the real Workers runtime (wrangler dev)
```

If an upstream is down the site keeps working: a dead market feed is dropped from the median, and if the central-bank feed (Frankfurter) is down the page says so and shows market feeds only. `/api/pair` reports this as `feeds: { market, marketTotal, official }`.

## API

```
GET /api/benchmark?from=USD&to=PKR&date=2026-11-04   the yardstick for a deal: rate, margin, grade
GET /api/pair?from=USD&to=PKR                 every source and central bank, regime and ladder for one pair
GET /api/convert?from=USD&to=PKR&amount=100   result plus low/high band (result is null with no consensus)
GET /api/rates?base=PKR                       all currencies against a base
GET /api/history?from=USD&to=PKR&days=90      daily official history
GET /api/sources  ·  /api/currencies  ·  /api/health
```

Responses are cached five minutes in memory and carry `Cache-Control` so the edge caches them too. CORS is open.

## Deploy for free (Cloudflare Workers)

1. Create a free Cloudflare account (no card needed).
2. `npx wrangler@4 login` then `npm run deploy`. You get `https://truerate.<you>.workers.dev`.
3. Or deploy from CI: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as Actions secrets, set the repository variable `DEPLOY_ENABLED=true`, and merge to `master`. Deploy stays off until you do — see [`docs/security.md`](docs/security.md#cicd) for the token scope.

Any Node host (Render, Fly, Railway free tiers) also works: `PORT=8080 node src/server.js`.

## Project layout

```
src/core/sources.js    market adapters        src/core/official.js   central-bank adapter
src/core/aggregate.js  consensus + pair maths src/core/cache.js      TTL cache, stale-while-revalidate
src/core/benchmark.js  benchmark grade, ladder src/core/pages.js     pair-page metadata
src/core/regimes.json  cited "who decides"    src/core/ladders.json  hand-entered rate ladder
src/api.js             HTTP routes (web Request/Response, runtime neutral)
src/server.js          Node entry             src/worker.js          Cloudflare Worker entry
public/check.js        the deal check, browser only   public/i18n.js  English and Urdu text
public/                index.html, app.js, styles.css, 404.html, sitemap.xml (no build step)
scripts/build-currencies.mjs   regenerates src/core/currencies.json (166 fiat currencies)
```

## Status (2026-11-09)

Live at [truerate.truerate-app.workers.dev](https://truerate.truerate-app.workers.dev) on the Cloudflare Workers free plan. Every merge to `master` runs the tests and deploys ([`deploy.yml`](.github/workflows/deploy.yml)).

Tests: 103 offline tests. [`ci.yml`](.github/workflows/ci.yml) runs them on Node 22 and 24 and checks that the Worker bundles.

Next:
1. **Real receipts.** Collect about 30 from freelancers and people sending money home, to learn the size of the costs and whether people care. Nothing else here matters as much.
2. **Opt-in contributions.** If people want it: anonymous reports of what each channel really costs, which nobody publishes. This needs storage, a privacy notice and moderation, so it is deliberately not built yet.
3. **Ladder updates.** A way to enter the day's figures without a pull request each time, or permission from SBP to read them automatically.
4. **More currencies** in the regime and ladder files, one cited fact at a time.

Open:
1. CPU time on the free plan (10 ms per request): parsing the full Frankfurter `expand=providers` response is the heaviest step and only happens once per 5-minute snapshot per isolate. Watch it as traffic grows.
2. History and past-date benchmarks rely on Frankfurter alone; when it is down the page says so. A second history source would remove that single point of failure.
3. Later: embed widget, receipt photos, Urdu voice notes on WhatsApp.

## Contributing

`master` takes pull requests only, with green CI, and the rule applies to the maintainer too. Branch, open a PR, merge when the checks pass; the merge deploys.

## Security

The app ships no dependencies, no API keys, and no cookies, and every upstream URL is hardcoded. Repository controls — secret scanning with push protection, Dependabot, branch protection on `master`, least-privilege `GITHUB_TOKEN`, SHA-pinned actions, and security headers applied by both runtimes — are documented with verification commands in [`docs/security.md`](docs/security.md). Report vulnerabilities privately via [`SECURITY.md`](SECURITY.md).

MIT licence. Rates are informational, not financial advice.
