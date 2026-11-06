# Product direction: from a rate site to a fair-price check

Notes from 6 November 2026. **Status: explored and written down, not being built now.** Work moved the same day to SarfBench (see [`README.md`](README.md) in this folder). Every figure below was found by web search on that date. Most come from news sites and search summaries, not from the original documents, so check a figure at its source before publishing it.

## 1. The goal, sharpened

The first problem statement was about transparency: show who sets each rate, how and when. On 6 November the founder added the real aim:

> Give the benefit of the trade back to the ordinary person who actually changes currency. Today that person loses to exchange companies and insiders, because the real rates are unclear.

The product should be distinct, useful to millions, and honest.

## 2. The core move

Move from **"what is the rate?"** to **"how much am I losing on this deal, and where do I get a better one?"** A rate site informs people. A deal checker puts money back in their pocket.

## 3. What the research showed

| Finding | Detail | Source |
|---|---|---|
| The official chain in Pakistan is tight right now | On 4 Nov 2026 the open-market selling rate was 0.64% above interbank | [`research.md`](research.md) |
| The gap explodes in a crisis | Reported at Rs 25.36 per dollar, 8.3%, in September 2023 | [Profit](https://profit.pakistantoday.com.pk/2022/12/15/tis-the-season-for-hawala-and-hundi-gap-spreads-between-interbank-and-open-market) |
| The loss sits between the published rate and the rate one person gets | A commentary said rates are negotiated on the spot and receipts are rare (the exact link was not captured) | search summary |
| SBP treats overcharging as a complaint case | Examples it lists: receipts that are not system-generated, and rates far above the displayed notice | [ProPakistani](https://propakistani.pk/2022/11/11/sbp-introduces-whistle-blowing-forum-to-identify-unauthorized-forex-activities/amp/) |
| Remittances are the biggest pool of money | Pakistan received a record $41.6bn in FY26. Every 1% lost is about $416m a year (arithmetic, not a measured loss) | [Dawn](https://www.dawn.com/news/2014137/workers-remittances-hit-record-416bn-in-fy26) |
| The problem is global | $728.6bn went to low- and middle-income countries in 2025 | [WAM, citing IFAD](https://www.wam.ae/en/article/c29ci7w-migrants-sent-7286-billion-home-families-low-and) |
| Sending money is still expensive | Global average cost of sending $200 was 6.49% in Q1 2025 | [World Bank RPW](https://remittanceprices.worldbank.org/sites/default/files/rpw_main_report_and_annex_q125_1_0.pdf) |
| Hidden markups are large, by one interested party's count | Wise-funded studies put EU losses at €30bn in 2023. Wise competes with the banks it criticises. | [Wise](https://wise.com/gb/blog/europeans-have-a-30-billion-problem) |

**Competitors.** Each covers one piece. None joins the official ladder, your actual quote and your loss in rupees.

- [Monito](https://www.monito.com/send-money/united-kingdom/pakistan/gbp/pkr) compares remittance apps against the mid-market rate.
- A Pakistani startup launched in May 2026 does the same for Pakistan ([ProPakistani](https://propakistani.pk/2026/05/18/2-overseas-pakistanis-build-smarter-way-to-send-money-home/); its name was not confirmed).
- forex.pk and the [PK Forex app](https://apps.apple.com/ma/app/pk-forex/id576063769) show a number with no source.

**On corruption.** Nothing found in public data proves corruption. The product should show measured loss and let the numbers speak, not accuse named people.

## 4. The product, Pakistan first

1. **Check my deal (the core).** The user enters the amount, the rate quoted and the channel: bank, exchange company, remittance app or card. TrueRate answers "you lose Rs X against today's official rate for this channel", with a fair / high / very high verdict and a card to share on WhatsApp.
2. **Remittance corridors.** "Send 1,000 SAR, family receives Rs ___" for each provider, ranked only by rupees received. Start with Saudi Arabia, UAE, UK and US.
3. **Crowd quotes.** People report what they were quoted or paid, by city, with a receipt photo. Show the city median against the ECAP rate.
4. **Daily gap index and alerts.** One public number: the open-market premium over interbank. A warning when it widens.
5. **Urdu first, WhatsApp first.**

| Phase | Work | Why |
|---|---|---|
| 0 | SBP adapter and rate ladder (already in the roadmap) | The benchmark everything else is measured against |
| 1 | Check my deal, share card, Urdu | Useful from day one, needs no new data |
| 2 | Four remittance corridors | Biggest money, biggest audience |
| 3 | Crowd quotes with receipts | Data nobody else has |
| 4 | Gap index, alerts, WhatsApp bot | Brings users back, gives the press a number |
| 5 | Other countries, paid API | Scale and income |

## 5. The worldwide version

The founder then asked for a product for all currencies, not only Pakistan. That changes one thing: it must work for every currency at a basic level on day one, then get deeper country by country.

**The big idea.** TrueRate becomes the fair-price label for money: for any deal, in any currency, it shows your markup against the best public benchmark, in your own money. The EU already uses this standard in law: card conversion charges must be shown as a percentage markup over the ECB reference rate ([Regulation (EU) 2019/518](https://www.legislation.gov.uk/eur/2019/518/data.html)).

**Who needs it.**

- Migrants sending money home: about 304 million people ([Migration Policy Institute](https://www.migrationpolicy.org/article/top-statistics-global-migration-migrants-2025)).
- Travellers: about 1.4 billion international trips in 2024. "Pay in your home currency" offers carry about 5–8% on average, per secondary sources ([Bankrate](https://www.bankrate.com/credit-cards/advice/say-no-to-dynamic-currency-conversion)).
- People in two-rate countries: in March 2023 the street premium was about 87% in Argentina, 84% in Ethiopia and 62% in Nigeria ([World Bank blog](https://blogs.worldbank.org/en/voices/parallel-exchange-rate-problem-world-banks-approach-helping-people-developing-countries)). These figures are old; Nigeria and Egypt have reformed since ([IMF](https://www.imf.org/en/publications/selected-issues-papers/issues/2025/07/30/potential-drivers-of-post-reform-parallel-market-premium-federal-democratic-republic-of-569118)).
- Freelancers and small importers.

**How one product covers all currencies.**

1. **Global base layer.** "Check my deal" for all 166 currencies, using the central-bank rate where one exists (the site already reads about 106 central banks) and the market median elsewhere.
2. **Benchmark grade.** Every answer says how good its benchmark is: primary source, secondary source, or "no reliable benchmark". This keeps the product honest where little is known.
3. **Country packs.** Each pack adds one country's full ladder: who sets the rate, the official documents, local channels and language. Pakistan is pack one and the template. Because the code is open, people in other countries can add theirs.
4. **Worldwide remittance data from one import.** The World Bank's price database covers 48 sending and 105 receiving countries and is listed under CC BY 4.0 ([data catalog](https://datacatalog.worldbank.org/search/dataset/0037898/remittance-prices-worldwide)). It is quarterly, so label it as a baseline.
5. **Card channel.** Visa publishes its daily network rate through a [developer API](https://developer.visa.com/capabilities/foreign_exchange). The bank's fee on top is the markup to show. Mastercard's publication was not confirmed from a primary source.

**Honesty as rules of the product.**

- The ranking method is public, and ranking is only by money received.
- No paid placement. Any referral income is disclosed on the same screen.
- Every number carries its publisher, method, time and link. Unknowns say "not documented".
- Street rates are shown as reported, with their source, and never presented as official.
- Our own errors and data gaps are published.

| Step | Work |
|---|---|
| 1 | Global deal checker with benchmark grade, all currencies |
| 2 | Country-pack framework, with Pakistan as the first full pack |
| 3 | World Bank corridor import |
| 4 | Card and travel channel |
| 5 | Crowd-reported quotes, then live provider quotes for the top corridors |
| 6 | More country packs and languages |

## 6. Risks

- **Law.** Show only licensed channels, never hawala or hundi. Aggregate crowd reports before naming a company, to limit defamation risk. Publishing street rates is sensitive where a government defends an official rate, so each country pack needs a legal check.
- **Trust.** Referral income from remittance apps is the natural revenue. Ranking must stay by money received, with the commission disclosed. Advertising from the companies being rated would break trust.
- **Data.** SBP's site has bot protection. Provider quotes must be collected corridor by corridor.
- **Depth takes time.** The base layer is global in weeks. Real depth comes one country at a time.

## 7. Not verified

- The current SBP spread limits for exchange companies. The sources found were old.
- The number of overseas Pakistanis.
- How many users the local rate sites have.
- The 2025 figure of 1.52 billion tourist arrivals, which came from a secondary site.
- Whether Wise's public comparison API still exists and what it returns.

## 8. Open decision

Which user comes first? The recommendation was the deal checker for both groups, launched with the Saudi and UAE corridors (Saudi Arabia alone sent $8.95bn in July–May of FY26). The alternative is to start with cash exchange inside Pakistan, which has less competition but a smaller loss per person today.
