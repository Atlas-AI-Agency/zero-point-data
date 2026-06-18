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
  // Only surface live-computed edge when backed by real market data; the
  // synthetic demo series is too volatile to produce realistic figures, so we
  // leave the reference track-record numbers in place.
  if (data.source === 'coingecko') renderEdge(data.edge);
  drawChart(data.series, data.regimes);
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
  document.getElementById('live-source').textContent = data.source === 'coingecko' ? 'Live' : 'Demo data';
  const d = new Date(data.generatedAt);
  document.getElementById('r-stamp').textContent = 'Updated ' + d.toUTCString().slice(5, 22) + ' UTC';
  document.getElementById('chart-source').textContent = data.source === 'coingecko' ? 'source: live BTC/USD' : 'source: synthetic demo series';
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

function renderEdge(edge) {
  if (!edge) return;
  const k = n => '$' + Math.round(n / 1000) + 'K';
  document.getElementById('edge-headline').textContent = k(edge.totalEdge);
  document.getElementById('s-upside').textContent = k(edge.upsideSecured);
  document.getElementById('s-draw').textContent = k(edge.drawdownAvoided);
  document.getElementById('s-mult').textContent = edge.multiple + 'x';
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
  if (window.__signal) drawChart(window.__signal.series, window.__signal.regimes);
});

load().then(() => {});
