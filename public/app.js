/* TrueRate frontend. No framework, no build step. */
const $ = (s) => document.querySelector(s);
const REFRESH_MS = 5 * 60 * 1000;

const state = { from: 'USD', to: 'PKR', amount: 1, days: 30, currencies: {}, pair: null, table: null, history: null };

const SOURCE_NAMES = { erapi: 'ExchangeRate-API', fawaz: 'Currency-API', floatrates: 'FloatRates', moneyconvert: 'MoneyConvert', frankfurter: 'Frankfurter' };

/* ---------- formatting ---------- */
const nf = (opts) => new Intl.NumberFormat(undefined, opts);
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
const fmtPct = (p, digits = 2) => (Number.isFinite(p) ? `${p > 0 ? '+' : ''}${p.toFixed(digits)}%` : '—');
function fmtAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : undefined }) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- data ---------- */
async function api(path) {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  const code = (v) => (v && /^[a-z]{3}$/i.test(v) ? v.toUpperCase() : null);
  state.from = code(q.get('from')) ?? localStorage.getItem('tr.from') ?? 'USD';
  state.to = code(q.get('to')) ?? localStorage.getItem('tr.to') ?? 'PKR';
  const a = parseFloat(q.get('amount'));
  state.amount = Number.isFinite(a) && a >= 0 ? a : 1;
}
function writeUrl() {
  const q = new URLSearchParams({ from: state.from, to: state.to });
  if (state.amount !== 1) q.set('amount', String(state.amount));
  history.replaceState(null, '', `?${q}`);
  try { localStorage.setItem('tr.from', state.from); localStorage.setItem('tr.to', state.to); } catch {}
  document.title = `${state.from} to ${state.to} · ${state.pair ? fmtRate(state.pair.rate) : ''} · TrueRate`;
}

/* ---------- render: selects ---------- */
function fillSelects() {
  const opts = Object.values(state.currencies)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => `<option value="${c.code}">${c.flag ? c.flag + ' ' : ''}${c.code} · ${esc(c.name)}</option>`)
    .join('');
  $('#from').innerHTML = opts;
  $('#to').innerHTML = opts;
  $('#from').value = state.from;
  $('#to').value = state.to;
}

/* ---------- render: result ---------- */
function renderResult() {
  const d = state.pair;
  const alert = $('.alert');
  if (!d) return;
  if (alert) alert.remove();
  const amt = state.amount;
  const out = amt * d.rate;
  $('#result').innerHTML = `<div class="big">${esc(fmtAmount(amt, d.from.code))}<span class="cur">${d.from.code}</span><span class="eq">=</span>${esc(fmtAmount(out, d.to.code))}<span class="cur">${d.to.code}</span></div>`;
  $('#unit').textContent = `1 ${d.from.code} = ${fmtRate(d.rate)} ${d.to.code}   ·   1 ${d.to.code} = ${fmtRate(d.inverse)} ${d.from.code}`;

  // Range strip: every market source as a tick, consensus as a marker, official and issuing bank as taller ticks.
  const m = d.market;
  const band = $('#band');
  if (m && m.n >= 1) {
    const pts = [m.min, m.max, d.rate];
    if (d.official) pts.push(d.official.rate);
    for (const h of d.official?.homes ?? []) if (h.rate) pts.push(h.rate);
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const pad = (hi - lo || d.rate * 0.002) * 0.15;
    lo -= pad; hi += pad;
    const x = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const ticks = m.quotes.map((q) => `<span class="tick" style="left:${x(q.rate)}" title="${esc(SOURCE_NAMES[q.source] ?? q.source)}: ${fmtRate(q.rate)}"></span>`).join('');
    const official = d.official ? `<span class="tick official" style="left:${x(d.official.rate)}" title="Central-bank consensus: ${fmtRate(d.official.rate)}"></span>` : '';
    const homes = (d.official?.homes ?? []).filter((h) => h.rate).map((h) => `<span class="tick home" style="left:${x(h.rate)}" title="${esc(h.name)}: ${fmtRate(h.rate)}"></span>`).join('');
    band.innerHTML = `
      <div class="label"><span>Market range across ${m.n} source${m.n > 1 ? 's' : ''}</span><span>spread <b>${m.spreadPct.toFixed(2)}%</b></span></div>
      <div class="strip">
        <span class="tip" style="left:${x(m.min)}">${fmtRate(m.min)}</span>
        <span class="tip" style="left:${x(m.max)}">${fmtRate(m.max)}</span>
        <div class="rail"></div>
        <div class="range" style="left:${x(m.min)};width:calc(${x(m.max)} - ${x(m.min)})"></div>
        ${ticks}${official}${homes}
        <span class="marker" style="left:${x(d.rate)}" title="Consensus: ${fmtRate(d.rate)}"></span>
      </div>
      <div class="legend"><span><i style="background:var(--accent)"></i>consensus (median)</span><span><i style="background:var(--text-2)"></i>market feed</span>${d.official ? '<span><i style="background:var(--warn)"></i>central-bank consensus</span>' : ''}${homes ? '<span><i style="background:var(--bad)"></i>issuing bank</span>' : ''}</div>`;
  } else {
    band.innerHTML = `<div class="label"><span>No live market feed covers this pair; showing the official rate.</span></div>`;
  }

  const o = d.official;
  if (o) {
    const homes = (o.homes ?? []).map((h) => `${esc(h.name)}: <b>${fmtRate(h.rate)}</b> <span class="${h.stale ? 'stale' : 'muted small'}">(${fmtDate(h.date)}${h.stale ? ', stale' : ''})</span>`).join(' · ');
    $('#official-line').innerHTML = `Central banks (${o.nIncluded} of ${o.n} institutions): <b>${fmtRate(o.rate)}</b> <span class="muted small">(${fmtDate(o.date)}, ${fmtPct(d.gapPct)} vs market)</span>${homes ? '<br>' + homes : ''}`;
  } else {
    $('#official-line').textContent = 'No central-bank quote available for this pair.';
  }

  const c = d.confidence;
  const icon = c.label === 'high' ? '✓' : c.label === 'medium' ? '!' : '✕';
  $('#confidence').innerHTML = `<span class="badge ${c.label}" title="Trust score ${c.score}/100">${icon} ${c.label} trust · ${c.score}/100</span>` +
    (c.reasons.length ? `<ul class="reasons">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '');
}

/* ---------- render: source tables ---------- */
function renderSources() {
  const d = state.pair;
  if (!d) return;
  const m = d.market;
  $('#market-n').textContent = m ? `${m.n} live` : '0';
  $('#market-table tbody').innerHTML = (m?.quotes ?? [])
    .slice().sort((a, b) => a.rate - b.rate)
    .map((q) => `<tr><td>${esc(SOURCE_NAMES[q.source] ?? q.source)}</td><td class="num">${fmtRate(q.rate)}</td><td class="num dev ${Math.abs(q.devPct) > 0.5 ? 'far' : q.devPct >= 0 ? 'pos' : 'neg'}">${fmtPct(q.devPct)}</td><td class="name">${fmtAgo(q.asOf)}</td></tr>`)
    .join('') || '<tr><td colspan="4" class="muted">No market feed carries this pair.</td></tr>';

  const o = d.official;
  $('#bank-n').textContent = o ? `${o.n} institutions` : '0';
  const rows = [...(o?.homes ?? []).filter((h) => h.stale).map((h) => ({ ...h, home: true })), ...(o?.quotes ?? []).map((q) => ({ ...q, home: (o.homes ?? []).some((h) => h.key === q.key) }))];
  const more = $('#bank-more');
  const render = (all) => {
    const list = all ? rows : rows.slice(0, 8);
    $('#bank-table tbody').innerHTML = list.map((q) => {
      const flag = q.country ? countryFlag(q.country) : '';
      return `<tr><td>${flag} ${esc(q.name)}${q.home ? ' <span class="pill">issuer</span>' : ''}${q.excluded ? '<span class="ex">outlier</span>' : ''}${q.stale ? '<span class="ex stale">stale</span>' : ''}<div class="name">${esc(q.rateType ?? '')}</div></td><td class="num">${fmtRate(q.rate)}</td><td class="num dev ${Math.abs(q.devPct ?? 0) > 1 ? 'far' : ''}">${q.devPct == null ? '—' : fmtPct(q.devPct)}</td><td class="name">${fmtDate(q.date)}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No central bank publishes this pair.</td></tr>';
    more.hidden = rows.length <= 8;
    more.textContent = all ? 'Show fewer' : `Show all ${rows.length} institutions`;
    more.onclick = () => render(!all);
  };
  render(false);
  $('#sources-intro').textContent = `For ${d.from.code} → ${d.to.code}, as of ${new Date(d.generatedAt).toLocaleString()}.`;
}
const countryFlag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');

/* ---------- render: all currencies ---------- */
function renderAll() {
  const t = state.table;
  if (!t) return;
  document.querySelectorAll('.all-base, #all-base').forEach((el) => { el.textContent = t.base; });
  const q = ($('#search').value || '').trim().toLowerCase();
  const rows = Object.values(t.rates)
    .filter((r) => r.code !== t.base)
    .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    .sort((a, b) => a.code.localeCompare(b.code));
  $('#all-table tbody').innerHTML = rows.map((r) => `<tr data-code="${r.code}"><td><span class="flag">${r.flag}</span><b>${r.code}</b><div class="name">${esc(r.name)}</div></td><td class="num">${fmtRate(r.rate)}</td><td class="num name">${r.spreadPct == null ? '—' : r.spreadPct.toFixed(2) + '%'}</td><td class="num name">${r.official == null ? '—' : fmtRate(r.official)}</td><td><span class="trust ${r.confidence}">${r.confidence}</span></td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No match.</td></tr>';
}

/* ---------- render: history chart ---------- */
function renderChart() {
  const host = $('#chart');
  const h = state.history;
  $('#chart-title').textContent = `${state.from} → ${state.to}, last ${state.days >= 365 ? Math.round(state.days / 365) + ' year' + (state.days >= 730 ? 's' : '') : state.days + ' days'}`;
  if (!h || h.points.length < 2) { host.innerHTML = '<div class="empty">No history for this pair.</div>'; return; }
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
  const dateFmt = (t) => new Date(t).toLocaleDateString(undefined, months >= 12 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
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
    tip.innerHTML = `<b>${fmtRate(ys[i])} ${state.to}</b>${fmtDate(pts[i].date)} · ${fmtPct(chg)} vs start`;
    tip.style.left = `${(cx / W) * rect.width}px`; tip.style.top = `${(cy / H) * rect.height}px`; tip.style.display = '';
  };
  const leave = () => { cross.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; };
  svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
}

/* ---------- loading ---------- */
let seq = 0;
async function loadPair() {
  const my = ++seq;
  const { from, to } = state;
  $('#result').innerHTML = '<div class="big skeleton">&nbsp;</div>';
  try {
    const [pair, table] = await Promise.all([api(`/api/pair?from=${from}&to=${to}`), api(`/api/rates?base=${from}`)]);
    if (my !== seq) return;
    state.pair = pair; state.table = table;
    renderResult(); renderSources(); renderAll(); writeUrl();
    $('#api-example').textContent = `GET /api/pair?from=${from}&to=${to}\nGET /api/convert?from=${from}&to=${to}&amount=${state.amount || 100}\nGET /api/rates?base=${to}\nGET /api/history?from=${from}&to=${to}&days=90`;
    $('#updated').textContent = `Rates generated ${new Date(pair.generatedAt).toLocaleString()} · refreshes every 5 minutes · ${pair.market ? pair.market.n : 0} market feeds, ${pair.official ? pair.official.n : 0} central banks for this pair.`;
  } catch (err) {
    if (my !== seq) return;
    $('#result').innerHTML = `<div class="alert">Could not load ${from}/${to}: ${esc(err.message)}</div>`;
  }
  loadHistory();
}
async function loadHistory() {
  const my = seq;
  const { from, to, days } = state;
  try {
    const h = await api(`/api/history?from=${from}&to=${to}&days=${days}`);
    if (my !== seq) return;
    state.history = h;
  } catch { state.history = null; }
  renderChart();
}

async function init() {
  readUrl();
  try {
    const meta = await api('/api/currencies');
    state.currencies = meta.currencies;
  } catch (err) {
    $('#result').innerHTML = `<div class="alert">The rate service is unreachable: ${esc(err.message)}</div>`;
    return;
  }
  if (!state.currencies[state.from]) state.from = 'USD';
  if (!state.currencies[state.to]) state.to = state.from === 'PKR' ? 'USD' : 'PKR';
  fillSelects();
  $('#amount').value = String(state.amount);
  $('#src-count').textContent = 'four';
  api('/api/sources').then((s) => { $('#bank-count').textContent = String(s.providerCount); }).catch(() => {});

  $('#from').addEventListener('change', (e) => { state.from = e.target.value; loadPair(); });
  $('#to').addEventListener('change', (e) => { state.to = e.target.value; loadPair(); });
  $('#swap').addEventListener('click', () => { [state.from, state.to] = [state.to, state.from]; $('#from').value = state.from; $('#to').value = state.to; loadPair(); });
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
    state.to = tr.dataset.code; $('#to').value = state.to; loadPair();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.querySelectorAll('.ranges button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.ranges button').forEach((x) => x.classList.toggle('on', x === b));
    state.days = Number(b.dataset.days); loadHistory();
  }));
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(renderChart, 150); });
  setInterval(loadPair, REFRESH_MS);
  loadPair();
}
init();
