// ============================================================================
// Zero Point Data — hardened BTC data feed
// ----------------------------------------------------------------------------
// Goals (production reliability for a paid product):
//   1. Multiple live sources, tried in order, each with retries + backoff.
//   2. Persist the last-good REAL series to disk so restarts/cold-starts keep
//      serving real data.
//   3. If every live source fails: serve last-good real data, flagged STALE
//      with its age — fall to synthetic ONLY when there is no real data at all.
//   4. Report data freshness for /health and operator logging.
//
// Zero dependencies: Node stdlib (https/fs) only.
// ============================================================================

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'last-good-candles.json');
const DAYS = 730;            // ~2y daily candles
const MIN_CANDLES = 220;     // need enough history for the 200d structure factor
const FRESH_MAX_MS = 36 * 60 * 60 * 1000; // data older than 36h counts as "stale"

// ---- low-level fetch with timeout -----------------------------------------

function fetchJSON(url, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'zero-point-data/1.0' } }, res => {
      if (res.statusCode === 429) { res.resume(); return reject(new Error('rate-limited (429)')); }
      if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad JSON')); } });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retry a thunk with exponential backoff + small jitter.
async function withRetry(fn, { tries = 3, baseMs = 600, label = '' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < tries) {
        const backoff = baseMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        log(`source ${label} attempt ${attempt}/${tries} failed (${e.message}); retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

// ---- sources (each returns ascending [{t, close, volume}]) ----------------

// 1) CoinGecko — daily market chart, includes volume. No key.
async function fromCoinGecko() {
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${DAYS}&interval=daily`;
  const j = await fetchJSON(url);
  const prices = j.prices || [];
  const volumes = j.total_volumes || [];
  const out = prices.map((p, i) => ({
    t: Math.floor(p[0] / 1000),
    close: p[1],
    volume: volumes[i] ? volumes[i][1] : 0,
  }));
  if (out.length < MIN_CANDLES) throw new Error('thin series (' + out.length + ')');
  return out;
}

// 2) Coinbase — daily candles (granularity 86400). No key. Returns
//    [time, low, high, open, close, volume] newest-first; we normalize.
//    Coinbase caps ~300 candles/req, so we page backwards. `pages` controls
//    depth: 3 pages ≈ 870 days (live feed), 8 pages ≈ ~6.4y (deep backtest).
async function fromCoinbase(pages = 3) {
  const granularity = 86400;
  const nowSec = Math.floor(Date.now() / 1000);
  const span = 290 * granularity; // stay under the ~300 cap per request
  const buckets = [];
  let end = nowSec;
  for (let i = 0; i < pages; i++) {
    const start = end - span;
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const rows = await fetchJSON(url);
    if (!Array.isArray(rows)) throw new Error('unexpected shape');
    if (rows.length === 0) break; // ran past the start of history
    for (const r of rows) buckets.push({ t: r[0], close: r[4], volume: r[5] });
    end = start - granularity;
  }
  // dedupe by day + sort ascending
  const byT = new Map();
  for (const b of buckets) if (b && Number.isFinite(b.close)) byT.set(b.t, b);
  const out = [...byT.values()].sort((a, b) => a.t - b.t);
  if (out.length < MIN_CANDLES) throw new Error('thin series (' + out.length + ')');
  return out;
}

const SOURCES = [
  { name: 'coingecko', fn: fromCoinGecko },
  { name: 'coinbase', fn: fromCoinbase },
];

// ---- deterministic synthetic fallback (last resort, never overwrites cache)-

function syntheticCandles(n = DAYS) {
  let seed = 1337;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const out = [];
  let price = 28000;
  const start = 1685577600;
  for (let i = 0; i < n; i++) {
    const trend = Math.sin(i / 70) * 0.012 + Math.sin(i / 23) * 0.006;
    const shock = (rand() - 0.5) * 0.05;
    price = Math.max(15000, price * (1 + trend + shock));
    out.push({ t: start + i * 86400, close: Math.round(price), volume: 2e10 * (0.6 + rand()) });
  }
  return out;
}

// ---- disk persistence of last-good REAL data ------------------------------

function readDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.candles) && j.candles.length >= MIN_CANDLES) return j;
  } catch (e) { /* no/invalid cache */ }
  return null;
}

function writeDisk(candles, source) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const lastT = candles[candles.length - 1].t;
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ source, savedAt: Date.now(), lastCandleT: lastT, candles }));
  } catch (e) { log('warning: could not persist last-good candles: ' + e.message); }
}

// ---- logging (operator-facing; degradation must never be silent) ----------

function log(msg) { console.log('[datafeed] ' + msg); }

// ---- public API ------------------------------------------------------------

/**
 * Returns { candles, source, live, stale, ageMs, asOf, note }.
 *  - live=true  → freshly fetched from a live source this call.
 *  - stale=true → served from last-good disk cache because all sources failed.
 *  - source 'synthetic' only when there is no real data anywhere.
 */
async function getCandles() {
  // 1) try each live source in order, with retries
  for (const src of SOURCES) {
    try {
      const candles = await withRetry(() => src.fn(), { label: src.name });
      writeDisk(candles, src.name);
      const lastT = candles[candles.length - 1].t * 1000;
      log(`live data from ${src.name} (${candles.length} candles, last ${new Date(lastT).toISOString().slice(0, 10)})`);
      return { candles, source: src.name, live: true, stale: false, ageMs: Date.now() - lastT, asOf: lastT };
    } catch (e) {
      log(`source ${src.name} exhausted: ${e.message}`);
    }
  }

  // 2) all live sources failed → serve last-good real data, flagged stale
  const disk = readDisk();
  if (disk) {
    const lastT = disk.lastCandleT * 1000;
    const ageMs = Date.now() - lastT;
    log(`ALL LIVE SOURCES FAILED — serving last-good ${disk.source} data, age ${(ageMs / 3600000).toFixed(1)}h (STALE)`);
    return { candles: disk.candles, source: disk.source, live: false, stale: true, ageMs, asOf: lastT, note: 'served from last-good cache; live sources unavailable' };
  }

  // 3) no real data anywhere (e.g. first-ever cold start offline) → synthetic
  log('NO LIVE SOURCES AND NO CACHED REAL DATA — falling back to synthetic demo series');
  const candles = syntheticCandles();
  return { candles, source: 'synthetic', live: false, stale: true, ageMs: null, asOf: null, note: 'synthetic demo data — no real data available' };
}

// Classify freshness for /health.
function freshness(ageMs) {
  if (ageMs == null) return 'unknown';
  if (ageMs <= FRESH_MAX_MS) return 'fresh';
  return 'stale';
}

// Deep history for the BACKTEST only — separate from the live feed so page
// loads stay fast. Coinbase BTC-USD goes back to ~2015; `years` deepens paging.
// Falls back to the standard live feed (then synthetic) if the deep fetch fails.
async function getDeepCandles({ years = 6 } = {}) {
  const pages = Math.max(3, Math.ceil((years * 365) / 290) + 1);
  try {
    const candles = await withRetry(() => fromCoinbase(pages), { label: 'coinbase-deep', tries: 3 });
    const lastT = candles[candles.length - 1].t * 1000;
    log(`deep history from coinbase (${candles.length} candles, ${new Date(candles[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(lastT).toISOString().slice(0, 10)})`);
    return { candles, source: 'coinbase', live: true, stale: false, ageMs: Date.now() - lastT, asOf: lastT };
  } catch (e) {
    log(`deep fetch failed (${e.message}); falling back to standard feed`);
    return getCandles();
  }
}

module.exports = { getCandles, getDeepCandles, freshness, FRESH_MAX_MS, syntheticCandles };
