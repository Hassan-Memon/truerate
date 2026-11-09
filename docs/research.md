# Who decides exchange rates, and where it is published

Research notes, 4 November 2026. Every figure below was read from the original document on that date.

## 1. The question

Money is property. People expect to see how land, cars, gold and companies are valued; they deserve the same for currency. For any rate we show, TrueRate should be able to answer:

1. **Who** decided this number?
2. **How** was it calculated, in the publisher's own words?
3. **When** was it observed?
4. **How far** is it from the price at which currency actually changed hands?

## 2. Who decides: three kinds of currency

| Kind | Who decides | Examples |
|---|---|---|
| Floating | The market: the price at which banks actually trade | USD, EUR, GBP, JPY |
| Managed float | The market, with the central bank buying/selling to prevent disorder | PKR, INR |
| Peg / currency board | The government or central bank, by policy | SAR 3.75/USD, AED 3.6725/USD, HKD 7.75–7.85/USD band |

The authoritative global classification of each country's real ("de facto") arrangement is the IMF's *Annual Report on Exchange Arrangements and Exchange Restrictions* (AREAER). Use it, plus each central bank's own statement, as the source for the "who decides" card. Do not guess.

## 3. Pakistan (PKR): the full chain is public

### What SBP says about how the rupee is set

> "Pakistan has a market based flexible exchange rate system, where the exchange rate is determined by market demand and supply conditions … role of SBP's interventions in the FX market is limited only to avoid disorderly market conditions and build FX buffers without suppressing any underlying trend. … Authorized dealers [forming] the interbank market are free to quote their own buying and selling rates."
>
> SBP, [Exchange Rate Regime and FX Reserve Management](https://www.sbp.org.pk/our-operations/financial-market/exchange-rate-regime-and-fx-reserve-management)

How the price is made: exporters bring dollars in, importers need dollars out. Banks (authorized dealers) trade those dollars with each other through brokerage houses: the **interbank market**. Every other PKR rate starts from there.

### USD/PKR on 4 November 2026

| Level | Publisher | Method (their words) | Buy | Sell |
|---|---|---|---|---|
| 1. Interbank (where the price is made) | SBP, Mark-to-Market revaluation rate ("ready") | "weighted average of closing interbank exchange rate collected through Brokerage Houses" | 276.7040 | |
| 2. Banks to customers | SBP, Weighted Average Customer Exchange Rates | "an estimate of the Exchange Rates quoted by various Commercial Banks to their clients … compiled from the Exchange Rate sheets issued daily by various Commercial Banks" | 276.3921 | 276.8490 |
| 3. Open market (cash, money changers) | ECAP, published on SBP's site | "provided by Exchange Companies Association of Pakistan (ECAP) … published for information only" | 277.35 | 278.48 |
| For comparison | TrueRate market median (the 4 aggregators used on that date) | median of feeds; their own methods are largely undisclosed | 276.54 | |

The open-market selling rate was 0.64% above interbank; the bank selling rate was 0.05% above it.

### What each SBP document covers

- **Mark-to-Market revaluation rates.** About 40 currencies against PKR: spot ("ready") plus forward tenors from 1 week to 1 year. Non-USD rates are "compiled on the basis of USD/PKR rate … and exchange rate of other currencies against USD quoted on LSEG Workspace". `0.0000` means no rate for that tenor. The forward prices mostly reflect the interest-rate difference between the two currencies; they are not forecasts.
- **Weighted average customer rates.** Buy and sell for 10 currencies: AED, AUD, CAD, CHF, CNY, EUR, GBP, JPY, SAR, USD.
- **ECAP open market closing rates.** Buy and sell for 6 currencies: USD, EUR, GBP, JPY, AED, SAR.
- **SBP homepage.** A small HTML widget with the USD M2M rate and the weighted-average bid/offer for the day.

### Where to fetch them (checked 4 Nov 2026)

SBP redesigned its website: the old `/ecodata/rates/...` and `.asp` URLs now return the homepage. Current locations:

- Index page with today's links: <https://www.sbp.org.pk/economic-data>
- Per-series pages: `/economic-data/open-market-closing-exchange-rates`, `/economic-data/weighted-average-customer-exchange-rates`, `/economic-data/mark-to-market-revaluation-exchange-rate`
- Today's PDFs, for example:
  - <https://www.sbp.org.pk/assets/document/open-market-closing-exchange-rates-4-November-2026.pdf>
  - <https://www.sbp.org.pk/assets/document/weighted-average-customer-exchange-rates-04-November-2026.pdf>
  - <https://www.sbp.org.pk/assets/document/mark-to-market-revaluation-exchange-rate-04-november-2026.pdf>

The file names are **not consistent**: the day may or may not have a leading zero, and the month may be capitalised or lower-case. Read the links from the `economic-data` page rather than building them.

### Can the numbers be read without libraries?

- **ECAP and weighted-average PDFs: yes.** TrueType fonts with WinAnsi encoding. The page streams are Flate-compressed (Node `zlib`, or `DecompressionStream('deflate')` on Workers) and the text is plain literal strings in reading order.
- **M2M PDF: partly.** It mixes in Identity-H (CID) fonts with hex strings, which need the font's ToUnicode map. The SBP homepage widget gives the USD figure as HTML.
- **Access:** SBP's site has bot protection. A plain request worked from a home connection on 4 Nov, but `/economic-data` returned 403 to a scripted request on 9 Nov. We treat that as SBP's decision and do not work around it, so the site's ladder is entered by hand from the published documents. Automatic reading needs SBP's permission or a data route SBP offers.

## 4. What stays hidden

- **Individual trades.** Global FX turnover was about **$9.6 trillion per day** in April 2025 ([BIS Triennial Survey](https://www.bis.org/press/p250930.htm)). It trades over the counter on dealer platforms whose tick data is paid. Central banks publish only end-of-day aggregates, never each trade.
- **Aggregators' methods.** Free feeds such as Currency-API and FloatRates republish mid-rates but do not fully disclose where they get them or how they combine them.

## 5. Design principles that follow

1. Show a **ladder**, not a single number: interbank → bank buy/sell → open market → what you pay.
2. Every number carries its **publisher, method (quoted), timestamp and link** to the original document.
3. Rank sources by **closeness to a real trade** and **method transparency**: primary (the institution that observes trades) above secondary (aggregators).
4. For pegs, show the official peg and how far the market is from it.
5. When something is not documented, say "not documented", never guess.

## Sources

- SBP, [Exchange Rate Regime and FX Reserve Management](https://www.sbp.org.pk/our-operations/financial-market/exchange-rate-regime-and-fx-reserve-management)
- SBP, [Economic data index](https://www.sbp.org.pk/economic-data)
- ECAP via SBP, [Open Market Closing Exchange Rates, 4 Nov 2026](https://www.sbp.org.pk/assets/document/open-market-closing-exchange-rates-4-November-2026.pdf)
- SBP, [Weighted Average Customer Exchange Rates, 4 Nov 2026](https://www.sbp.org.pk/assets/document/weighted-average-customer-exchange-rates-04-November-2026.pdf)
- SBP, [Mark-to-Market Revaluation Rates, 4 Nov 2026](https://www.sbp.org.pk/assets/document/mark-to-market-revaluation-exchange-rate-04-november-2026.pdf)
- BIS, [Triennial Central Bank Survey 2025, press release](https://www.bis.org/press/p250930.htm)
