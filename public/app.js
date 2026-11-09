/* TrueRate frontend. No framework, no build step. */
import { assessDeal, aboutRound, parseAmount, channelContext } from '/check.js';
import { translator } from '/i18n.js';

const $ = (s) => document.querySelector(s);
const REFRESH_MS = 5 * 60 * 1000;

const state = { from: 'USD', to: 'PKR', amount: 1, days: 30, currencies: {}, pair: null, table: null, history: null, lang: 'en', deal: null };
let T = translator('en');

const SOURCE_NAMES = { erapi: 'ExchangeRate-API', fawaz: 'Currency-API', floatrates: 'FloatRates', moneyconvert: 'MoneyConvert', frankfurter: 'Frankfurter' };

/* ---------- formatting ---------- */
const nf = (opts) => new Intl.NumberFormat('en-US', opts);
function fmtRate(x) {
  if (!Number.isFinite(x)) return '—';
  const digits = x >= 1000 ? 2 : x >= 100 ? 3 : x >= 1 ? 4 : 6;
  return nf({ minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits }).format(x);
}
function fmtAmount(x, code) {
  if (!Number.isFinite(x)) return '—';
  const d = state.currencies[code]?.decimals ?? 2;
  const max = x < 1 ? 6 : d;
  return nf({ minimumFractionDigits: Math.min(d, max), maximumFractionDigits: max }).format(x);
}
const fmtMoney = (x, code) => `${nf({ maximumFractionDigits: 2 }).format(Math.abs(x))} ${code}`;
const fmtPct = (p, digits = 2) => (Number.isFinite(p) ? `${p > 0 ? '+' : ''}${p.toFixed(digits)}%` : '—');
function fmtAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const m = Math.round(ms / 60000);
  if (m < 1) return T('ago.now');
  if (m < 60) return T('ago.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return T('ago.h', { n: h });
  return T('ago.d', { n: Math.round(h / 24) });
}
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : undefined }) : '—');
const fmtTime = (iso) => new Date(iso).toLocaleString('en-GB');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Numbers and codes stay left-to-right inside Urdu sentences. */
const ltr = (s) => `<bdi dir="ltr">${esc(s)}</bdi>`;
const localToday = () => new Date().toLocaleDateString('en-CA');

/* ---------- data ---------- */
async function api(path) {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

/* Storage can be blocked (private mode, sandboxed iframes): never let it break the page. */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

function readUrl() {
  const q = new URLSearchParams(location.search);
  const code = (v) => (v && /^[a-z]{3}$/i.test(v) ? v.toUpperCase() : null);
  const path = location.pathname.match(/^\/([a-z]{3})-to-([a-z]{3})\/?$/i);
  state.from = code(path?.[1]) ?? code(q.get('from')) ?? code(store.get('tr.from')) ?? 'USD';
  state.to = code(path?.[2]) ?? code(q.get('to')) ?? code(store.get('tr.to')) ?? 'PKR';
  const a = parseFloat(q.get('amount'));
  state.amount = Number.isFinite(a) && a >= 0 ? a : 1;
}
const pairPath = () => `/${state.from.toLowerCase()}-to-${state.to.toLowerCase()}`;
function writeUrl() {
  const q = state.amount !== 1 ? `?amount=${state.amount}` : '';
  if (state.from !== state.to) history.replaceState(null, '', pairPath() + q + location.hash);
  store.set('tr.from', state.from); store.set('tr.to', state.to);
  document.title = `${state.from} to ${state.to}${state.pair?.rate ? ` · ${fmtRate(state.pair.rate)}` : ''} · TrueRate`;
}

/* ---------- language ---------- */
function applyLanguage() {
  T = translator(state.lang);
  const root = document.documentElement;
  root.lang = state.lang;
  root.dir = state.lang === 'ur' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  $('#lang').lang = state.lang === 'ur' ? 'en' : 'ur';
  $('#search').placeholder = T('all.search');
}
function renderEverything() {
  applyLanguage();
  if (state.pair) { renderResult(); renderLadder(); renderWho(); renderSources(); renderFooter(); }
  renderAll(); renderChart(); renderDeal();
}

/* ---------- render: selects ---------- */
function fillSelects() {
  const opts = Object.values(state.currencies)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => `<option value="${c.code}">${c.flag ? c.flag + ' ' : ''}${c.code} · ${esc(c.name)}</option>`)
    .join('');
  for (const id of ['#from', '#to', '#deal-from', '#deal-to']) $(id).innerHTML = opts;
  syncSelects();
}
function syncSelects() {
  $('#from').value = state.from; $('#deal-from').value = state.from;
  $('#to').value = state.to; $('#deal-to').value = state.to;
}

/* ---------- render: deal check ---------- */
function renderDeal() {
  const host = $('#deal-result');
  const d = state.deal;
  if (!d) { host.innerHTML = ''; return; }
  if (d.error) { host.innerHTML = `<div class="alert">${esc(T(d.error))}</div>`; return; }
  if (d.loading) { host.innerHTML = `<div class="card muted">${esc(T('deal.checking'))}</div>`; return; }

  const { bench, verdict, gave, received, from, to, channel } = d;
  const url = `${location.origin}${pairPath()}`;
  const shareBar = (text) => `<div class="share">
      <a class="primary-link" href="https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}" target="_blank" rel="noopener">${esc(T('share.whatsapp'))}</a>
      <button type="button" class="link" id="copy-link">${esc(T('share.copy'))}</button>
    </div>`;

  if (verdict.status === 'no-benchmark') {
    const regime = state.pair?.regime;
    const notes = [regime?.from, regime?.to].filter((r) => r?.noBenchmark)
      .map((r) => `<p class="small">${esc(r.decider[state.lang])} <a href="${esc(r.source.url)}" rel="noopener">${esc(r.source.label)}</a></p>`).join('');
    host.innerHTML = `<div class="card verdict none">
      <div class="chip">${esc(T('result.none.title'))}</div>
      <p>${esc(T(`result.none.${bench.reason}`))}</p>${notes}
    </div>`;
    return;
  }

  const pct = Math.abs(verdict.costPct);
  const pctText = `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  const cost = ltr(fmtMoney(aboutRound(verdict.displayCost), verdict.displayCurrency));
  const costPlain = fmtMoney(aboutRound(verdict.displayCost), verdict.displayCurrency);
  const pctHtml = ltr(pctText);
  const headline = {
    implausible: () => T('result.implausible', { pct: pctHtml }),
    'about-market': () => T('result.about'),
    better: () => T('result.better', { cost, pct: pctHtml }),
  }[verdict.status]?.() ?? T('result.cost', { cost, pct: pctHtml });

  if (verdict.status === 'implausible') {
    host.innerHTML = `<div class="card verdict none"><p class="headline">${headline}</p></div>`;
    return;
  }

  const grade = T(`grade.${bench.grade}`, { margin: ltr(`${bench.marginPct.toFixed(2)}%`) });
  const srcName = T(`source.${bench.source}`, { date: ltr(fmtDate(bench.rateDate)) });
  const ctx = channelContext(channel, from, to, state.pair?.ladder);
  const ctxVars = { ...ctx, date: ltr(fmtDate(ctx.date)), rate: ltr(fmtRate(ctx.rate)), who: T(`ctx.who.${ctx.channel}`), totalPct: ltr(`${ctx.totalPct}%`), marginPct: ltr(`${ctx.marginPct}%`), collected: ltr(ctx.collected) };
  const shareText = ['high', 'noticeable', 'close'].includes(verdict.status)
    ? T('share.text', { from, to, cost: costPlain, pct: pctText })
    : T('share.textPlain', { from, to });
  host.innerHTML = `<div class="card verdict ${verdict.status}">
    <div class="chip">${esc(T(`verdict.${verdict.status}`))}</div>
    <p class="headline">${headline}</p>
    <dl class="sums">
      <div><dt>${esc(T('result.youGot'))}</dt><dd>${ltr(`${fmtAmount(received, to)} ${to}`)}</dd></div>
      <div><dt>${esc(T('result.atBenchmark'))}</dt><dd>${ltr(`${fmtAmount(verdict.expected, to)} ${to}`)}</dd></div>
      <div><dt>${esc(T('result.benchmark'))}</dt><dd>${ltr(`${fmtAmount(gave, from)} ${from} × ${fmtRate(bench.rate)}`)} <span class="muted small">${srcName}</span></dd></div>
    </dl>
    <p class="small">${grade}</p>
    <p class="small">${T(ctx.key, ctxVars)}${ctx.url ? ` <a href="${esc(ctx.url)}" rel="noopener">${esc(T('ctx.link'))}</a>` : ''}</p>
    <p class="small muted">${esc(T('result.normal'))}</p>
    ${shareBar(shareText)}
  </div>`;
  $('#copy-link')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(url); e.target.textContent = T('share.copied'); } catch { e.target.textContent = url; }
  });
}

async function checkDeal(ev) {
  ev.preventDefault();
  const gave = parseAmount($('#deal-gave').value);
  const received = parseAmount($('#deal-received').value);
  const from = $('#deal-from').value;
  const to = $('#deal-to').value;
  const date = $('#deal-date').value || localToday();
  const channel = $('#deal-channel').value;
  if (!gave || !received) { state.deal = { error: 'deal.err.amounts' }; return renderDeal(); }
  if (from === to) { state.deal = { error: 'deal.err.same' }; return renderDeal(); }
  state.deal = { loading: true }; renderDeal();
  if (from !== state.from || to !== state.to) { state.from = from; state.to = to; syncSelects(); await loadPair(); }
  try {
    // Only the pair and the date leave this device. The amounts never do.
    const bench = await api(`/api/benchmark?from=${from}&to=${to}&date=${date}`);
    state.deal = { bench, gave, received, from, to, channel, verdict: assessDeal({ gave, received, from, to, benchmark: bench }) };
  } catch {
    state.deal = { error: 'deal.err.fetch' };
  }
  renderDeal();
  $('#deal-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- render: rate ladder ---------- */
function renderLadder() {
  const d = state.pair;
  const host = $('#ladder-card');
  if (!d?.ladder) {
    host.innerHTML = `<p class="muted">${esc(T('ladder.none'))} <a href="/usd-to-pkr">${esc(T('ladder.goto'))}</a></p>`;
    return;
  }
  const l = d.ladder;
  const steps = l.rows.map((r) => `<tr>
    <td><b>${esc(T(`ladder.${r.id}`))}</b><div class="name" dir="ltr">${esc(r.publisher)}: “${esc(r.method)}” <a href="${esc(r.url)}" rel="noopener">${esc(T('ladder.read'))}</a></div></td>
    ${r.mid ? `<td class="num" colspan="2">${fmtRate(r.mid)}</td>` : `<td class="num">${fmtRate(r.buy)}</td><td class="num">${fmtRate(r.sell)}</td>`}</tr>`).join('');
  const liveMedian = d.rate ? (d.from.code === 'USD' ? d.rate : d.inverse) : null;
  const median = liveMedian ? `<tr class="median"><td><b>${esc(T('ladder.median'))}</b><div class="name">${esc(T('ladder.median.note'))}</div></td><td class="num" colspan="2">${fmtRate(liveMedian)}</td></tr>` : '';
  const note = l.stale ? T('ladder.stale', { date: ltr(fmtDate(l.date)), days: ltr(l.ageDays) }) : T('ladder.fresh', { date: ltr(fmtDate(l.date)) });
  host.innerHTML = `<p class="${l.stale ? 'alert' : 'small muted'}">${note}</p>
    <table class="tbl ladder"><thead><tr><th>${esc(T('ladder.step'))} (PKR / USD)</th><th class="num">${esc(T('ladder.buy'))}</th><th class="num">${esc(T('ladder.sell'))}</th></tr></thead><tbody>${steps}${median}</tbody></table>`;
}

/* ---------- render: who decides ---------- */
function pegLine(code, regime, d) {
  const other = code === d.to.code ? d.from.code : d.to.code;
  if (!regime.peg || regime.peg.base !== other || !d.rate) return '';
  const market = code === d.to.code ? d.rate : d.inverse;
  if (regime.peg.rate) {
    const dist = (Math.abs(market - regime.peg.rate) / regime.peg.rate) * 100;
    return `<p class="small">${T('who.pegDistance', { dist: ltr(`${dist.toFixed(2)}%`), peg: ltr(regime.peg.rate) })}</p>`;
  }
  const inside = market >= regime.peg.low && market <= regime.peg.high;
  return `<p class="small">${T(inside ? 'who.bandInside' : 'who.bandOutside', { rate: ltr(fmtRate(market)) })}</p>`;
}
function renderWho() {
  const d = state.pair;
  const legs = [[d.from.code, d.regime.from], [d.to.code, d.regime.to]].filter(([code]) => code !== 'USD');
  $('#who').innerHTML = legs.map(([code, r]) => {
    if (!r) return `<p class="muted">${T('who.undocumented', { code: ltr(code) })}</p>`;
    return `<div class="who-leg"><b dir="ltr">${esc(code)}</b>: ${esc(r.decider[state.lang])}
      ${r.quote ? `<blockquote dir="ltr" class="small">“${esc(r.quote)}”</blockquote>` : ''}
      ${pegLine(code, r, d)}
      <p class="small muted">${esc(T('who.source'))}: <a href="${esc(r.source.url)}" rel="noopener">${esc(r.source.label)}</a>, ${T('who.checked', { date: ltr(fmtDate(r.source.checked)) })}</p></div>`;
  }).join('');
}

/* ---------- render: converter result ---------- */
function renderResult() {
  const d = state.pair;
  if (!d) return;
  $('.alert.load')?.remove();
  const amt = state.amount;
  const warn = d.regime.from?.noBenchmark || d.regime.to?.noBenchmark ? `<div class="alert">${esc(T('warn.multi'))}</div>` : '';
  if (d.rate) {
    $('#result').innerHTML = `${warn}<div class="big" dir="ltr">${esc(fmtAmount(amt, d.from.code))}<span class="cur">${d.from.code}</span><span class="eq">=</span>${esc(fmtAmount(amt * d.rate, d.to.code))}<span class="cur">${d.to.code}</span></div>`;
    $('#unit').textContent = `1 ${d.from.code} = ${fmtRate(d.rate)} ${d.to.code}   ·   1 ${d.to.code} = ${fmtRate(d.inverse)} ${d.from.code}`;
  } else {
    const groups = (d.market?.groups ?? []).map((g) => fmtRate(g.min)).join(' / ');
    $('#result').innerHTML = `${warn}<div class="alert">${T('conv.noConsensus', { groups: ltr(groups) })}</div>`;
    $('#unit').textContent = '';
  }

  // Range strip: every market source as a tick, consensus as a marker, official and issuing bank as taller ticks.
  const m = d.market;
  const band = $('#band');
  if (m && m.n >= 1 && d.rate) {
    const pts = [m.min, m.max, d.rate];
    if (d.official) pts.push(d.official.rate);
    for (const h of d.official?.homes ?? []) if (h.rate) pts.push(h.rate);
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const pad = (hi - lo || d.rate * 0.002) * 0.15;
    lo -= pad; hi += pad;
    const x = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const ticks = m.quotes.map((q) => `<span class="tick" style="left:${x(q.rate)}" title="${esc(SOURCE_NAMES[q.source] ?? q.source)}: ${fmtRate(q.rate)}"></span>`).join('');
    const official = d.official ? `<span class="tick official" style="left:${x(d.official.rate)}" title="${esc(T('legend.official'))}: ${fmtRate(d.official.rate)}"></span>` : '';
    const homes = (d.official?.homes ?? []).filter((h) => h.rate).map((h) => `<span class="tick home" style="left:${x(h.rate)}" title="${esc(h.name)}: ${fmtRate(h.rate)}"></span>`).join('');
    band.innerHTML = `
      <div class="label"><span>${esc(T('conv.range', { n: m.n }))}</span><span>${esc(T('conv.spread'))} <b dir="ltr">${m.spreadPct.toFixed(2)}%</b></span></div>
      <div class="strip" dir="ltr">
        <span class="tip" style="left:${x(m.min)}">${fmtRate(m.min)}</span>
        <span class="tip" style="left:${x(m.max)}">${fmtRate(m.max)}</span>
        <div class="rail"></div>
        <div class="range" style="left:${x(m.min)};width:calc(${x(m.max)} - ${x(m.min)})"></div>
        ${ticks}${official}${homes}
        <span class="marker" style="left:${x(d.rate)}" title="${esc(T('legend.median'))}: ${fmtRate(d.rate)}"></span>
      </div>
      <div class="legend"><span><i style="background:var(--accent)"></i>${esc(T('legend.median'))}</span><span><i style="background:var(--text-2)"></i>${esc(T('legend.feed'))}</span>${d.official ? `<span><i style="background:var(--warn)"></i>${esc(T('legend.official'))}</span>` : ''}${homes ? `<span><i style="background:var(--bad)"></i>${esc(T('legend.issuer'))}</span>` : ''}</div>`;
  } else {
    band.innerHTML = m ? '' : `<div class="label"><span>${esc(T('conv.noFeed'))}</span></div>`;
  }

  const o = d.official;
  if (o) {
    const homes = (o.homes ?? []).map((h) => `${esc(h.name)}: <b dir="ltr">${fmtRate(h.rate)}</b> <span class="${h.stale ? 'stale' : 'muted small'}">(${ltr(fmtDate(h.date))}${h.stale ? `, ${esc(T('tag.stale'))}` : ''})</span>`).join(' · ');
    const main = o.nIncluded === 0 && o.n > 0
      ? T('official.allFlagged', { rate: `<b>${ltr(fmtRate(o.rate))}</b>`, n: ltr(o.n) })
      : T('official.line', { inc: ltr(o.nIncluded), n: ltr(o.n), rate: `<b>${ltr(fmtRate(o.rate))}</b>` });
    const gap = Number.isFinite(d.gapPct) ? ` <span class="muted small">(${ltr(fmtDate(o.date))}, ${T('official.vsMarket', { gap: ltr(fmtPct(d.gapPct)) })})</span>` : '';
    $('#official-line').innerHTML = `${main}${gap}${homes ? '<br>' + homes : ''}`;
  } else {
    $('#official-line').textContent = d.feeds && !d.feeds.official ? T('official.down') : T('official.none');
  }

  const a = d.agreement;
  const icon = { strong: '✓', partial: '!', weak: '✕', split: '✕' }[a.label];
  $('#agreement').innerHTML = `<span class="badge ${a.label}">${icon} ${esc(T(`agree.${a.label}`))}</span>` +
    (a.reasons.length ? `<ul class="reasons" dir="ltr">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '') +
    `<p class="small muted agree-note">${esc(T('agree.note'))}</p>`;
}

/* ---------- render: source tables ---------- */
function renderSources() {
  const d = state.pair;
  if (!d) return;
  const m = d.market;
  $('#market-n').textContent = m ? T('src.live', { n: m.n }) : '0';
  $('#market-table tbody').innerHTML = (m?.quotes ?? [])
    .slice().sort((a, b) => a.rate - b.rate)
    .map((q) => `<tr><td>${esc(SOURCE_NAMES[q.source] ?? q.source)}</td><td class="num">${fmtRate(q.rate)}</td><td class="num dev ${Math.abs(q.devPct ?? 0) > 0.5 ? 'far' : q.devPct >= 0 ? 'pos' : 'neg'}">${fmtPct(q.devPct)}</td><td class="name">${esc(fmtAgo(q.asOf))}</td></tr>`)
    .join('') || `<tr><td colspan="4" class="muted">${esc(T('src.noMarket'))}</td></tr>`;

  const o = d.official;
  const bankEmpty = d.feeds && !d.feeds.official ? T('src.bankDown') : T('src.noBank');
  $('#bank-n').textContent = o ? T('src.inst', { n: o.n }) : '0';
  const quoted = o?.quotes ?? [];
  const missingHomes = (o?.homes ?? []).filter((h) => !quoted.some((q) => q.key === h.key)).map((h) => ({ ...h, home: true }));
  const rows = [...missingHomes, ...quoted.map((q) => ({ ...q, home: (o.homes ?? []).some((h) => h.key === q.key) }))];
  const more = $('#bank-more');
  const render = (all) => {
    const list = all ? rows : rows.slice(0, 8);
    $('#bank-table tbody').innerHTML = list.map((q) => {
      const flag = q.country ? countryFlag(q.country) : '';
      return `<tr><td>${flag} ${esc(q.name)}${q.home ? ` <span class="pill">${esc(T('tag.issuer'))}</span>` : ''}${q.excluded ? `<span class="ex">${esc(T('tag.outlier'))}</span>` : ''}${q.stale ? `<span class="ex stale">${esc(T('tag.stale'))}</span>` : ''}<div class="name">${esc(q.rateType ?? '')}</div></td><td class="num">${fmtRate(q.rate)}</td><td class="num dev ${Math.abs(q.devPct ?? 0) > 1 ? 'far' : ''}">${q.devPct == null ? '—' : fmtPct(q.devPct)}</td><td class="name">${esc(fmtDate(q.date))}</td></tr>`;
    }).join('') || `<tr><td colspan="4" class="muted">${esc(bankEmpty)}</td></tr>`;
    more.hidden = rows.length <= 8;
    more.textContent = all ? T('src.showFewer') : T('src.showAll', { n: rows.length });
    more.onclick = () => render(!all);
  };
  render(false);
  $('#sources-intro').textContent = T('src.intro', { from: d.from.code, to: d.to.code, time: fmtTime(d.generatedAt) });
}
const countryFlag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');

/* ---------- render: all currencies ---------- */
function renderAll() {
  const t = state.table;
  if (!t) return;
  $('#all-title').textContent = T('all.title', { base: t.base });
  document.querySelectorAll('.all-base').forEach((el) => { el.textContent = t.base; });
  const q = ($('#search').value || '').trim().toLowerCase();
  const rows = Object.values(t.rates)
    .filter((r) => r.code !== t.base)
    .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    .sort((a, b) => a.code.localeCompare(b.code));
  $('#all-table tbody').innerHTML = rows.map((r) => {
    const rate = r.rate == null ? `<span class="name">${esc(T('all.noRate'))}</span>` : fmtRate(r.rate);
    const label = r.noBenchmark ? T('agree.multi') : T(`agree.${r.agreement}`);
    const tone = r.noBenchmark ? 'split' : r.agreement;
    return `<tr data-code="${r.code}"><td><span class="flag">${r.flag}</span><b>${r.code}</b><div class="name">${esc(r.name)}</div></td><td class="num">${rate}</td><td class="num name">${r.spreadPct == null ? '—' : r.spreadPct.toFixed(2) + '%'}</td><td class="num name">${r.official == null ? '—' : fmtRate(r.official)}</td><td><span class="agree ${tone}">${esc(label)}</span></td></tr>`;
  }).join('') || `<tr><td colspan="5" class="muted">${esc(T('all.noMatch'))}</td></tr>`;
}

/* ---------- render: history chart ---------- */
function renderChart() {
  const host = $('#chart');
  const h = state.history;
  const range = state.days >= 365
    ? T(state.days >= 730 ? 'chart.years' : 'chart.year', { n: Math.round(state.days / 365) })
    : T('chart.days', { n: state.days });
  $('#chart-title').textContent = T('chart.title', { from: state.from, to: state.to, range });
  if (state.historyError) { host.innerHTML = `<div class="empty">${esc(T('chart.down'))}</div>`; return; }
  if (!h || h.points.length < 2) { host.innerHTML = `<div class="empty">${esc(T('chart.empty'))}</div>`; return; }
  const W = host.clientWidth || 600, H = host.clientHeight || 220;
  const P = { l: 54, r: 12, t: 12, b: 24 };
  const pts = h.points;
  const xs = pts.map((p) => Date.parse(p.date));
  const ys = pts.map((p) => p.rate);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  let ylo = Math.min(...ys), yhi = Math.max(...ys);
  const padY = (yhi - ylo || ylo * 0.01) * 0.1; ylo -= padY; yhi += padY;
  const X = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - ylo) / (yhi - ylo)) * (H - P.t - P.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.rate).toFixed(1)}`).join('');
  const area = `${path}L${X(x1).toFixed(1)},${(H - P.b).toFixed(1)}L${X(x0).toFixed(1)},${(H - P.b).toFixed(1)}Z`;
  const gridY = [0, 0.5, 1].map((f) => ylo + f * (yhi - ylo));
  const months = Math.max(1, Math.round((x1 - x0) / (30 * 86400e3)));
  const labelsX = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + f * (x1 - x0));
  const dateFmt = (t) => new Date(t).toLocaleDateString('en-GB', months >= 12 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${state.from} to ${state.to} history">
    ${gridY.map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="axis" x="${P.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${fmtRate(v)}</text>`).join('')}
    ${labelsX.map((t, i) => `<text class="axis" x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${dateFmt(t)}</text>`).join('')}
    <path class="area" d="${area}"/><path class="line" d="${path}"/>
    <line class="cross" id="cross" y1="${P.t}" y2="${H - P.b}" style="display:none"/><circle class="dot" id="dot" r="4" style="display:none"/>
  </svg><div class="tooltip" id="tip" style="display:none"></div>`;
  const svg = host.querySelector('svg'), cross = $('#cross'), dot = $('#dot'), tip = $('#tip');
  const first = ys[0];
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * (W / rect.width);
    const t = x0 + ((px - P.l) / (W - P.l - P.r)) * (x1 - x0);
    let i = 0; for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - t) < Math.abs(xs[i] - t)) i = k;
    const cx = X(xs[i]), cy = Y(ys[i]);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.style.display = '';
    const chg = ((ys[i] - first) / first) * 100;
    tip.innerHTML = `<b>${fmtRate(ys[i])} ${state.to}</b>${fmtDate(pts[i].date)} · ${fmtPct(chg)} ${esc(T('chart.vsStart'))}`;
    tip.style.left = `${(cx / W) * rect.width}px`; tip.style.top = `${(cy / H) * rect.height}px`; tip.style.display = '';
  };
  const leave = () => { cross.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; };
  svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
}

function renderFooter() {
  const p = state.pair;
  const { from, to } = state;
  $('#api-example').textContent = `GET /api/benchmark?from=${from}&to=${to}&date=${localToday()}\nGET /api/pair?from=${from}&to=${to}\nGET /api/convert?from=${from}&to=${to}&amount=${state.amount || 100}\nGET /api/rates?base=${to}\nGET /api/history?from=${from}&to=${to}&days=90`;
  $('#updated').textContent = T('foot.updated', { time: fmtTime(p.generatedAt), market: p.market ? p.market.n : 0, banks: p.official ? p.official.n : 0 });
}

/* ---------- loading ---------- */
let seq = 0;
/** @param {{quiet?: boolean}} [o] quiet = background refresh: keep the current numbers on screen until new ones arrive. */
async function loadPair({ quiet = false } = {}) {
  const my = ++seq;
  const { from, to } = state;
  if (!quiet) $('#result').innerHTML = '<div class="big skeleton">&nbsp;</div>';
  try {
    const [pair, table] = await Promise.all([api(`/api/pair?from=${from}&to=${to}`), api(`/api/rates?base=${from}`)]);
    if (my !== seq) return;
    state.pair = pair; state.table = table;
    renderResult(); renderLadder(); renderWho(); renderSources(); renderAll(); writeUrl(); renderFooter();
  } catch (err) {
    if (my !== seq) return;
    if (quiet && state.pair) return; // a failed background refresh keeps the last good numbers
    state.pair = null;
    $('#result').innerHTML = `<div class="alert load">${T('err.load', { pair: ltr(`${from}/${to}`), msg: esc(err.message) })}</div>`;
    ['#unit', '#band', '#official-line', '#agreement'].forEach((s) => { $(s).textContent = ''; });
  }
  loadHistory();
}
async function loadHistory() {
  const my = seq;
  const { from, to, days } = state;
  try {
    const h = await api(`/api/history?from=${from}&to=${to}&days=${days}`);
    if (my !== seq || days !== state.days) return;
    state.history = h; state.historyError = null;
  } catch (err) {
    if (my !== seq || days !== state.days) return;
    state.history = null; state.historyError = err.message;
  }
  renderChart();
}

function changePair() { state.deal = null; renderDeal(); syncSelects(); loadPair(); }

async function init() {
  readUrl();
  const saved = store.get('tr.lang');
  state.lang = saved === 'ur' || saved === 'en' ? saved : (navigator.language || '').toLowerCase().startsWith('ur') ? 'ur' : 'en';
  applyLanguage();
  try {
    const meta = await api('/api/currencies');
    // The API keys entries by code; carry the code inside each entry so sorting/rendering can use it.
    state.currencies = Object.fromEntries(Object.entries(meta.currencies).map(([code, c]) => [code, { ...c, code }]));
  } catch (err) {
    $('#result').innerHTML = `<div class="alert load">${T('err.service', { msg: esc(err.message) })}</div>`;
    return;
  }
  if (!state.currencies[state.from]) state.from = 'USD';
  if (!state.currencies[state.to]) state.to = state.from === 'PKR' ? 'USD' : 'PKR';
  fillSelects();
  $('#amount').value = String(state.amount);
  $('#deal-date').value = localToday();
  $('#deal-date').max = localToday();

  $('#lang').addEventListener('click', () => {
    state.lang = state.lang === 'ur' ? 'en' : 'ur';
    store.set('tr.lang', state.lang);
    renderEverything();
  });
  $('#deal').addEventListener('submit', checkDeal);
  for (const [id, key] of [['#from', 'from'], ['#deal-from', 'from'], ['#to', 'to'], ['#deal-to', 'to']]) {
    $(id).addEventListener('change', (e) => { state[key] = e.target.value; changePair(); });
  }
  $('#swap').addEventListener('click', () => { [state.from, state.to] = [state.to, state.from]; changePair(); });
  $('#amount').addEventListener('input', (e) => {
    const v = parseFloat(String(e.target.value).replace(/,/g, ''));
    state.amount = Number.isFinite(v) && v >= 0 ? v : 0;
    renderResult(); writeUrl();
  });
  $('#converter').addEventListener('submit', (e) => e.preventDefault());
  $('#search').addEventListener('input', renderAll);
  $('#all-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-code]');
    if (!tr) return;
    state.to = tr.dataset.code; changePair();
    $('#rates').scrollIntoView({ behavior: 'smooth' });
  });
  document.querySelectorAll('.ranges button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.ranges button').forEach((x) => x.classList.toggle('on', x === b));
    state.days = Number(b.dataset.days); loadHistory();
  }));
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(renderChart, 150); });
  setInterval(() => loadPair({ quiet: true }), REFRESH_MS);
  loadPair();
}
init().catch((err) => {
  // Surface anything unexpected instead of failing silently as an unhandled rejection.
  console.error(err);
  $('#result').innerHTML = `<div class="alert load">TrueRate failed to start: ${esc(err?.message || err)}</div>`;
});
