// Zero Point Data — frontend: fetch live signal, render the read, chart, regimes.

const TONE = {
  strong_on:  getCss('--strong'),
  mild_on:    getCss('--mild'),
  mild_off:   getCss('--warn'),
  strong_off: getCss('--danger'),
};

function getCss(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

const FACTOR_LABELS = { momentum: 'Momentum', trend: 'Trend', flow: 'Capital Flow', volatility: 'Volatility' };

// Real = any live market source (coingecko/coinbase/...), not the synthetic demo.
function isRealData(data) { return data && data.source && data.source !== 'synthetic'; }
function sourceLabel(data) {
  if (!isRealData(data)) return 'source: synthetic demo series';
  const src = data.source.charAt(0).toUpperCase() + data.source.slice(1);
  if (data.stale) return 'source: ' + src + ' (last good · ' + (data.dataAgeHours ?? '?') + 'h old)';
  return 'source: live BTC/USD · ' + src;
}

async function load() {
  let data;
  try {
    const res = await fetch('/api/signal');
    data = await res.json();
  } catch (e) {
    document.getElementById('r-tag').textContent = 'Signal unavailable';
    return;
  }
  window.__signal = data;
  renderRead(data);
  renderRegimes(data);
  // NOTE: the public Track Record section intentionally shows illustrative
  // copy, NOT live backtest numbers. The 6.5y out-of-sample record shows the
  // strategy underperforms buy-and-hold on return (its value is risk reduction,
  // not alpha), so we do not publish edge figures until the model earns them.
  // The real artifact lives at data/track-record.json for internal review.
  drawChart(data.series, data.regimes);
  drawTimeline(data);
}

function renderRead(data) {
  const l = data.latest;
  const tone = TONE[l.regime];

  document.getElementById('r-label').textContent = l.regimeLabel;
  document.getElementById('r-tag').textContent = l.regimeTag + ' · risk score ' + (l.score > 0 ? '+' : '') + l.score;
  document.getElementById('r-swatch').style.background = tone;
  document.getElementById('r-label').style.color = tone;

  // needle position maps [-100,100] -> [0,100]%
  const pos = ((l.score + 100) / 200) * 100;
  document.getElementById('needle').style.left = pos + '%';

  document.getElementById('btc-alloc').innerHTML = l.btcAllocation + '<small>%</small>';
  document.getElementById('cash-alloc').innerHTML = l.cashAllocation + '<small>%</small>';

  // factors
  const wrap = document.getElementById('factors');
  wrap.innerHTML = '';
  for (const key of ['momentum', 'trend', 'flow', 'volatility']) {
    const v = l.factors[key]; // -100..100
    const row = document.createElement('div');
    row.className = 'factor';
    const w = Math.min(50, Math.abs(v) / 2); // half-width %
    const col = v >= 0 ? getCss('--accent') : getCss('--danger');
    const side = v >= 0 ? `left:50%;width:${w}%;` : `right:50%;left:auto;width:${w}%;`;
    row.innerHTML = `
      <span class="fk">${FACTOR_LABELS[key]}</span>
      <span class="fbar"><i style="${side}background:${col}"></i></span>
      <span class="fv">${v > 0 ? '+' : ''}${v}</span>`;
    wrap.appendChild(row);
  }

  document.getElementById('r-held').textContent = l.daysInRegime + ' day' + (l.daysInRegime === 1 ? '' : 's') + ' in regime';
  document.getElementById('live-source').textContent = !isRealData(data) ? 'Demo data' : (data.stale ? 'Last good' : 'Live');
  const d = new Date(data.generatedAt);
  document.getElementById('r-stamp').textContent = 'Updated ' + d.toUTCString().slice(5, 22) + ' UTC';
  document.getElementById('chart-source').textContent = sourceLabel(data);
}

function renderRegimes(data) {
  const grid = document.getElementById('regime-grid');
  grid.innerHTML = '';
  const DESC = {
    strong_off: 'Structural weakness dominates. Capital is fleeing risk. The engine calls for full de-risking.',
    mild_off:   'Momentum is fading and flows are softening. Reduce exposure and wait for confirmation.',
    mild_on:    'Risk appetite is returning. Conditions favor steady accumulation of exposure.',
    strong_on:  'Momentum and capital flows are aligned and strong. The read favors maximum participation.',
  };
  for (const r of data.regimes) {
    const active = r.key === data.latest.regime;
    const card = document.createElement('div');
    card.className = 'regime-card';
    if (active) { card.style.borderColor = TONE[r.key]; card.style.boxShadow = `0 0 0 1px ${TONE[r.key]}33`; }
    card.innerHTML = `
      <div class="bar" style="background:${TONE[r.key]}"></div>
      <h4>${r.label} ${active ? '· <span style="color:'+TONE[r.key]+';font-size:13px">active</span>' : ''}</h4>
      <div class="rtag">${r.tag}</div>
      <div class="rdesc">${DESC[r.key]}</div>
      <div class="ralloc">BTC ${r.btc}% · Cash ${100 - r.btc}%</div>`;
    grid.appendChild(card);
  }
}


function drawChart(series, regimes) {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = 280;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const prices = series.map(s => s.close);
  const min = Math.min(...prices), max = Math.max(...prices);
  const pad = 8;
  const x = i => (i / (series.length - 1)) * (W - pad * 2) + pad;
  const y = p => H - pad - ((p - min) / (max - min)) * (H - pad * 2);

  const TONE_MAP = {
    strong_on: getCss('--strong'), mild_on: getCss('--mild'),
    mild_off: getCss('--warn'), strong_off: getCss('--danger'),
  };

  // regime background shading
  for (let i = 1; i < series.length; i++) {
    ctx.fillStyle = hexA(TONE_MAP[series[i].regime], 0.07);
    ctx.fillRect(x(i - 1), 0, x(i) - x(i - 1) + 1, H);
  }

  // price line, colored by regime segment
  ctx.lineWidth = 2;
  for (let i = 1; i < series.length; i++) {
    ctx.strokeStyle = TONE_MAP[series[i].regime];
    ctx.beginPath();
    ctx.moveTo(x(i - 1), y(prices[i - 1]));
    ctx.lineTo(x(i), y(prices[i]));
    ctx.stroke();
  }
}

function hexA(hex, a) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ---- Stripe checkout ------------------------------------------------------
async function initCheckout() {
  const btns = document.querySelectorAll('[data-checkout]');
  const note = document.getElementById('checkout-note');
  if (!btns.length) return;

  let ready = false;
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    ready = cfg.stripeReady;
  } catch (e) {}

  if (!ready && note) {
    note.textContent = 'Checkout activates once Stripe keys are configured (see SETUP-STRIPE.md).';
  }

  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (note) { note.classList.remove('err'); note.textContent = 'Redirecting to secure checkout…'; }
      btn.disabled = true;
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (res.ok && data.url) {
          window.location.href = data.url; // Stripe-hosted Checkout
          return;
        }
        if (note) { note.classList.add('err'); note.textContent = data.error || 'Checkout unavailable right now.'; }
      } catch (e) {
        if (note) { note.classList.add('err'); note.textContent = 'Network error — try again.'; }
      }
      btn.disabled = false;
    });
  });
}
initCheckout();

// scroll reveal
const io = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

window.addEventListener('resize', () => {
  // redraw chart on resize if data present
  if (window.__signal) { drawChart(window.__signal.series, window.__signal.regimes); drawTimeline(window.__signal); }
});

load().then(() => {});

// ---- Inflection Points timeline ------------------------------------------
const REGIME_META = {
  strong_off: { label: 'Strong Risk-Off', short: 'Risk-Off', alloc: 0,   css: '--danger' },
  mild_off:   { label: 'Mild Risk-Off',   short: 'Risk-Off', alloc: 35,  css: '--warn'   },
  mild_on:    { label: 'Mild Risk-On',    short: 'Risk-On',  alloc: 75,  css: '--mild'   },
  strong_on:  { label: 'Strong Risk-On',  short: 'Risk-On',  alloc: 100, css: '--strong' },
};
const RISK_ON = new Set(['mild_on', 'strong_on']);
const LEGEND_ORDER = ['strong_off', 'mild_off', 'mild_on', 'strong_on'];

function fmtDate(t) {
  const d = new Date(t * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function drawTimeline(data) {
  const series = data.series || [];
  const canvas = document.getElementById('timeline');
  if (!canvas || !series.length) return;

  const tone = k => getCss(REGIME_META[k].css);

  // source label
  const src = document.getElementById('infl-source');
  if (src) src.textContent = sourceLabel(data);

  // --- main canvas ---------------------------------------------------------
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = 380;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const padL = 56, padR = 14, padT = 16, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const prices = series.map(s => s.close);
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = max - min || 1;
  const x = i => padL + (i / (series.length - 1)) * plotW;
  const y = p => padT + plotH - ((p - min) / span) * plotH;

  // regime background shading
  for (let i = 1; i < series.length; i++) {
    ctx.fillStyle = hexA(tone(series[i].regime), 0.09);
    ctx.fillRect(x(i - 1), padT, x(i) - x(i - 1) + 1, plotH);
  }

  // price axis labels + horizontal gridlines
  ctx.fillStyle = getCss('--muted-2');
  ctx.font = '11px ' + getCss('--mono');
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const kfmt = v => v >= 1000 ? '$' + (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'k' : '$' + Math.round(v);
  for (let g = 0; g <= 4; g++) {
    const p = min + (span * g) / 4;
    const yy = y(p);
    ctx.strokeStyle = hexA(getCss('--border'), 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillText(kfmt(p), padL - 8, yy);
  }

  // month gridlines + labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let lastMonth = -1;
  for (let i = 0; i < series.length; i++) {
    const d = new Date(series[i].t * 1000);
    const m = d.getUTCMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      const xx = x(i);
      ctx.strokeStyle = hexA(getCss('--border-2'), 0.5);
      ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
      ctx.fillStyle = getCss('--muted-2');
      ctx.fillText(d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), xx, padT + plotH + 6);
    }
  }

  // price line, colored by regime segment
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (let i = 1; i < series.length; i++) {
    ctx.strokeStyle = tone(series[i].regime);
    ctx.beginPath();
    ctx.moveTo(x(i - 1), y(prices[i - 1]));
    ctx.lineTo(x(i), y(prices[i]));
    ctx.stroke();
  }

  // numbered inflection callouts (regime transitions)
  const inflections = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i].regime !== series[i - 1].regime) inflections.push(i);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  inflections.forEach((idx, n) => {
    const xx = x(idx), yy = y(prices[idx]);
    const col = tone(series[idx].regime);
    ctx.fillStyle = getCss('--bg');
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(xx, yy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = '600 11px ' + getCss('--font');
    ctx.fillText(String(n + 1), xx, yy + 0.5);
  });

  // --- per-day heatmap strip ----------------------------------------------
  const strip = document.getElementById('heat-strip');
  if (strip) {
    strip.innerHTML = '';
    for (const s of series) {
      const cell = document.createElement('span');
      cell.className = 'heat-cell';
      cell.style.background = tone(s.regime);
      cell.title = REGIME_META[s.regime].label + ' · ' + fmtDate(s.t);
      strip.appendChild(cell);
    }
  }

  // --- 4-state legend ------------------------------------------------------
  const legend = document.getElementById('infl-legend');
  if (legend) {
    legend.innerHTML = '';
    for (const k of LEGEND_ORDER) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-swatch" style="background:${tone(k)}"></span><span>${REGIME_META[k].label}</span>`;
      legend.appendChild(item);
    }
  }

  // --- two "Inflection Detected" cards ------------------------------------
  renderInflectionCards(series);
}

function renderInflectionCards(series) {
  const wrap = document.getElementById('infl-cards');
  if (!wrap) return;

  // scan for most recent transition INTO risk-on and INTO risk-off
  let lastOn = null, lastOff = null;
  for (let i = 1; i < series.length; i++) {
    const cur = RISK_ON.has(series[i].regime);
    const prev = RISK_ON.has(series[i - 1].regime);
    if (cur && !prev) lastOn = series[i];
    if (!cur && prev) lastOff = series[i];
  }

  const card = (s, kind) => {
    if (!s) {
      return `<div class="infl-card empty"><div class="ic-tag">No ${kind} inflection in window</div></div>`;
    }
    const m = REGIME_META[s.regime];
    const cls = RISK_ON.has(s.regime) ? 'on' : 'off';
    const cashOrBtc = RISK_ON.has(s.regime)
      ? `${m.alloc}% BTC`
      : `${100 - m.alloc}% Cash`;
    return `
      <div class="infl-card ${cls}" style="--ic:${getCss(m.css)}">
        <div class="ic-head"><span class="ic-dot"></span><span class="ic-kind">Inflection Detected</span></div>
        <div class="ic-title">${m.short}, ${cashOrBtc}</div>
        <div class="ic-meta"><span class="ic-regime">${m.label}</span><span class="ic-date">${fmtDate(s.t)}</span></div>
      </div>`;
  };

  wrap.innerHTML = card(lastOn, 'Risk-On') + card(lastOff, 'Risk-Off');
}

// ---- sample report modal --------------------------------------------------
(function initSampleReport() {
  const overlay = document.getElementById('sample-modal');
  if (!overlay) return;
  const formView = document.getElementById('sample-form-view');
  const reportView = document.getElementById('sample-report-view');
  const reportBody = document.getElementById('sample-report-body');
  const form = document.getElementById('sample-form');
  const submitBtn = document.getElementById('sample-submit');
  const errEl = document.getElementById('sample-error');
  let lastReport = null;
  let lastTxt = '';

  function open() {
    formView.hidden = false;
    reportView.hidden = true;
    errEl.hidden = true;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = form.querySelector('input[name="firstName"]');
    if (first) first.focus();
  }
  function close() {
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', open));
  document.querySelectorAll('[data-sample-close]').forEach(b => b.addEventListener('click', close));
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) close(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.hidden = true;
    const fd = new FormData(form);
    const payload = {
      firstName: (fd.get('firstName') || '').trim(),
      lastName: (fd.get('lastName') || '').trim(),
      email: (fd.get('email') || '').trim(),
    };
    if (!payload.firstName) return showErr('Please enter your first name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return showErr('Please enter a valid email address.');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Building your report…';
    try {
      const res = await fetch('/api/sample-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.report) { showErr(data.error || 'Could not generate the report.'); return; }
      lastReport = data.report;
      lastTxt = reportToText(data.report);
      renderReport(data.report);
      formView.hidden = true;
      reportView.hidden = false;
    } catch (err) {
      showErr('Network error — please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get my sample report';
    }
  });

  function showErr(msg) { errEl.textContent = msg; errEl.hidden = false; }

  const TONE_BY_REGIME = {
    strong_on: getCss('--strong'), mild_on: getCss('--mild'),
    mild_off: getCss('--warn'), strong_off: getCss('--danger'),
  };

  function renderReport(r) {
    const d = r.sections.dailyUpdate;
    const m = r.sections.multiHorizon;
    const f = r.sections.flashUpdates;
    const sign = n => (n > 0 ? '+' : '') + n;
    const signalClass = d.signal === 'Risk-On' ? 'on' : 'off';

    const flashRows = f.events.length
      ? f.events.map(ev => `
          <li>
            <span class="flash-date">${ev.date}</span>
            <span class="flash-swatch" style="background:${TONE_BY_REGIME[ev.to] || 'var(--muted)'}"></span>
            <span class="flash-note">${ev.note}</span>
          </li>`).join('')
      : `<li class="flash-empty">${f.intro}</li>`;

    reportBody.innerHTML = `
      <div class="report-meta">${r.brand} · ${r.dataSource} · ${new Date(r.generatedAt).toUTCString().slice(5, 22)} UTC</div>

      <div class="report-section">
        <h4>${d.title}</h4>
        <div class="report-grid">
          <div class="rs-cell"><div class="rs-k">Active signal</div><div class="rs-v sig-${signalClass}">${d.signal}</div></div>
          <div class="rs-cell"><div class="rs-k">Risk Index</div><div class="rs-v">${sign(d.riskIndex)}</div></div>
          <div class="rs-cell"><div class="rs-k">BTC allocation</div><div class="rs-v">${d.btcAllocation}%</div></div>
          <div class="rs-cell"><div class="rs-k">Cash allocation</div><div class="rs-v">${d.cashAllocation}%</div></div>
        </div>
        <p>${d.summary}</p>
      </div>

      <div class="report-section">
        <h4>${m.title}</h4>
        <p><strong>Long-term.</strong> ${m.longTerm}</p>
        <p><strong>Mid-term.</strong> ${m.midTerm}</p>
        <p><strong>Short-term.</strong> ${m.shortTerm}</p>
      </div>

      <div class="report-section">
        <h4>${f.title}</h4>
        <p class="flash-intro">${f.intro}</p>
        <ul class="flash-list">${flashRows}</ul>
      </div>

      <p class="report-disclaimer">${r.disclaimer}</p>`;
  }

  function reportToText(r) {
    const d = r.sections.dailyUpdate;
    const m = r.sections.multiHorizon;
    const f = r.sections.flashUpdates;
    const sign = n => (n > 0 ? '+' : '') + n;
    const lines = [];
    lines.push(`${r.brand} — ${r.kind}`);
    lines.push(`Generated: ${r.generatedAt} · source: ${r.dataSource}`);
    lines.push('='.repeat(60), '');
    lines.push(`[ ${d.title} ]`);
    lines.push(`Active signal:    ${d.signal}`);
    lines.push(`Risk Index:       ${sign(d.riskIndex)}`);
    lines.push(`Regime:           ${d.regime} (${d.regimeTag}) — ${d.daysInRegime} day(s)`);
    lines.push(`Allocation:       ${d.btcAllocation}% BTC / ${d.cashAllocation}% cash`);
    lines.push('', d.summary, '');
    lines.push(`[ ${m.title} ]`);
    lines.push(`Long-term:  ${m.longTerm}`);
    lines.push(`Mid-term:   ${m.midTerm}`);
    lines.push(`Short-term: ${m.shortTerm}`, '');
    lines.push(`[ ${f.title} ]`);
    lines.push(f.intro);
    f.events.forEach(ev => lines.push(`  ${ev.date}  ${ev.note}`));
    lines.push('', '-'.repeat(60), r.disclaimer);
    return lines.join('\n');
  }

  document.getElementById('sample-download').addEventListener('click', () => {
    if (!lastReport) return;
    const blob = new Blob([lastTxt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zero-point-data-sample-report.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();

// ---- theme toggle ---------------------------------------------------------
(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('zpd-theme', next); } catch (e) {}
    // TONE was read once at load from CSS vars; refresh it for the new theme.
    TONE.strong_on = getCss('--strong');
    TONE.mild_on   = getCss('--mild');
    TONE.mild_off  = getCss('--warn');
    TONE.strong_off = getCss('--danger');
    // re-render everything that bakes in colors (canvases read vars at draw time)
    if (window.__signal) {
      try { renderRead(window.__signal); } catch (e) {}
      try { renderRegimes(window.__signal); } catch (e) {}
      try { drawChart(window.__signal.series, window.__signal.regimes); } catch (e) {}
      try { drawTimeline(window.__signal); } catch (e) {}
    }
  });
})();
