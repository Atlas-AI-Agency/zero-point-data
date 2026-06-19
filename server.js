// Zero Point Data — minimal zero-dependency Node server.
// Serves the static site and a /api/signal endpoint backed by the live engine.

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { computeSignals, backtest } = require('./src/engine');
const { stripeConfigured, createCheckoutSession } = require('./src/stripe');
const { createSampleReportHandler } = require('./src/sample-report');
const api = require('./src/api');

const PORT = process.env.PORT || 4317;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

// ---- live data with cache + deterministic synthetic fallback --------------

let cache = { at: 0, payload: null };
const CACHE_MS = 5 * 60 * 1000;

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'bitcoin-vector/1.0' } }, res => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
  });
}

// CoinGecko daily market chart (no key, free tier).
async function fetchCandles() {
  const url = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=730&interval=daily';
  const j = await fetchJSON(url);
  const prices = j.prices || [];
  const volumes = j.total_volumes || [];
  return prices.map((p, i) => ({
    t: Math.floor(p[0] / 1000),
    close: p[1],
    volume: volumes[i] ? volumes[i][1] : 0,
  }));
}

// Deterministic synthetic BTC-like series so the product always renders,
// even fully offline. Uses a seeded PRNG (no Date/random nondeterminism).
function syntheticCandles(n = 730) {
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out = [];
  let price = 28000;
  const start = 1685577600; // fixed epoch (2023-06-01) for reproducibility
  for (let i = 0; i < n; i++) {
    const trend = Math.sin(i / 70) * 0.012 + Math.sin(i / 23) * 0.006;
    const shock = (rand() - 0.5) * 0.05;
    price = Math.max(15000, price * (1 + trend + shock));
    out.push({ t: start + i * 86400, close: Math.round(price), volume: 2e10 * (0.6 + rand()) });
  }
  return out;
}

async function getSignal() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;
  let candles, source;
  try {
    candles = await fetchCandles();
    if (!candles || candles.length < 220) throw new Error('thin series');
    source = 'coingecko';
  } catch (e) {
    candles = syntheticCandles();
    source = 'synthetic';
  }
  const { series, latest, regimes } = computeSignals(candles);
  const edge = backtest(series.slice(-730));
  const payload = {
    source,
    generatedAt: new Date().toISOString(),
    latest,
    regimes,
    edge,
    series: series.slice(-365).map(s => ({ t: s.t, close: Math.round(s.close), score: s.score, regime: s.regime })),
    // full untrimmed series kept server-side only (not sent to /api/signal
    // clients) so the sample report can read factors/inflections/labels.
    fullSeries: series,
  };
  cache = { at: Date.now(), payload };
  return payload;
}

// Full in-process signal (untrimmed series) for the sample report. Reuses the
// same cache + synthetic fallback as getSignal without altering /api/signal.
async function getFullSignal() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) {
    const p = cache.payload;
    if (p.fullSeries) return { source: p.source, generatedAt: p.generatedAt, latest: p.latest, series: p.fullSeries };
  }
  await getSignal();
  const p = cache.payload;
  return { source: p.source, generatedAt: p.generatedAt, latest: p.latest, series: p.fullSeries };
}

const sampleReportHandler = createSampleReportHandler(getFullSignal);

// ---- http ------------------------------------------------------------------

// documented public REST + WS API (see API.md). Reuses getSignal()'s cache.
const apiV1 = api.createHandler(getSignal);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  // /api/v1/* — dispatch to the versioned API module.
  if (u.pathname.startsWith('/api/v1/')) {
    if (await apiV1(req, res, u)) return;
  }

  if (u.pathname === '/api/signal') {
    try {
      const payload = await getSignal();
      const { fullSeries, ...publicPayload } = payload; // keep heavy series server-side
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(publicPayload));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // tells the frontend whether to show a real checkout button or a setup notice
  if (u.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stripeReady: stripeConfigured() }));
    return;
  }

  // create a Stripe Checkout Session and hand back its hosted URL
  if (u.pathname === '/api/checkout' && req.method === 'POST') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      let email;
      try { email = JSON.parse(body || '{}').email; } catch (e) {}
      try {
        const session = await createCheckoutSession({ email });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: session.url }));
      } catch (e) {
        const unconfigured = e.code === 'STRIPE_UNCONFIGURED';
        res.writeHead(unconfigured ? 503 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: unconfigured
            ? 'Checkout is not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID (see SETUP-STRIPE.md).'
            : String(e.message || e),
        }));
      }
    });
    return;
  }

  // email-gated sample report: capture lead + return a report from the engine
  if (u.pathname === '/api/sample-report' && req.method === 'POST') {
    sampleReportHandler(req, res);
    return;
  }

  // dashboard (the surface Pro subscribers log into) — clean URL -> the page.
  // Its assets (/dashboard.css, /dashboard.js, /dash/*.js) resolve via static serving.
  if (u.pathname === '/dashboard') {
    const file = path.join(PUBLIC, 'dashboard.html');
    return fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  }

  // static files
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// WebSocket upgrades for /api/v1/stream (RFC6455, stdlib only).
server.on('upgrade', (req, socket) => {
  try {
    api.handleUpgrade(getSignal, req, socket);
  } catch (e) {
    try { socket.destroy(); } catch (_) {}
  }
});

server.listen(PORT, () => {
  console.log(`Zero Point Data running on http://localhost:${PORT}`);
});
