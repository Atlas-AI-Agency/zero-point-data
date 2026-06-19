#!/usr/bin/env node
// ============================================================================
// Zero Point Data — Backtest Runner (CLI)
// ----------------------------------------------------------------------------
// Usage:  node src/backtest/run.js
//
// Loads a daily BTC candle series (tries live CoinGecko first, falls back to a
// deterministic synthetic generator so it runs fully offline), runs the
// walk-forward harness across multiple out-of-sample segments, prints a
// readable report to stdout, and writes data/track-record.json.
//
// ALL NUMBERS PRODUCED HERE ARE BACKTESTED / HYPOTHETICAL. The synthetic
// fallback series is MORE volatile than real BTC and will typically produce an
// unrealistically large edge — the report says so explicitly when synthetic
// data is used. See BACKTEST.md.
// ============================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const { walkForward } = require('./harness');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'track-record.json');

// ---- data loading ----------------------------------------------------------

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'zero-point-data/1.0' } }, res => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
  });
}

// Live daily BTC market chart from CoinGecko (no key, free tier) — mirrors
// server.js fetchCandles().
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

// Deterministic synthetic BTC-like series (copied from server.js so the
// backtest runs offline and reproducibly). Seeded PRNG, no Date/Math.random.
// NOTE: this series is intentionally MORE volatile than real BTC.
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

async function loadCandles() {
  if (process.env.ZPD_SYNTHETIC === '1') {
    return { candles: syntheticCandles(), source: 'synthetic' };
  }
  try {
    const candles = await fetchCandles();
    if (!candles || candles.length < 220) throw new Error('thin series');
    return { candles, source: 'coingecko' };
  } catch (e) {
    return { candles: syntheticCandles(), source: 'synthetic', loadError: String(e.message || e) };
  }
}

// ---- formatting helpers ----------------------------------------------------

const pct = x => (x * 100).toFixed(1) + '%';
const signedPct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const money = x => '$' + Math.round(x).toLocaleString('en-US');
const isoDay = t => new Date(t * 1000).toISOString().slice(0, 10);

function bar(title) {
  return '\n' + title + '\n' + '-'.repeat(Math.max(title.length, 60));
}

function printReport(result, source, loadError) {
  const synthetic = source === 'synthetic';

  console.log('============================================================');
  console.log(' ZERO POINT DATA — WALK-FORWARD BACKTEST  (HYPOTHETICAL)');
  console.log('============================================================');
  console.log(`Data source        : ${source.toUpperCase()}${synthetic ? '  (deterministic offline fallback)' : ''}`);
  if (loadError) console.log(`Live fetch failed  : ${loadError} -> using synthetic`);
  console.log(`Candles            : ${result.meta.totalCandles}`);
  console.log(`Warmup reserved    : ${result.meta.warmup} candles`);
  console.log(`OOS span           : ${isoDay(result.meta.oosStartT)} -> ${isoDay(result.meta.oosEndT)} (${result.meta.oosDays} days)`);
  console.log(`Segments           : ${result.meta.segments}`);
  console.log(`Cost / rebalance   : ${result.meta.costBps} bps (slippage+fee, charged only on allocation change)`);
  console.log(`Base notional      : ${money(result.meta.base)}`);
  console.log(`No look-ahead      : ${result.meta.noLookAhead}`);

  if (synthetic) {
    console.log(bar('!! SYNTHETIC DATA WARNING'));
    console.log('The synthetic series is MORE volatile than real BTC and is NOT a');
    console.log('real price history. Any edge below is an artifact of the generator,');
    console.log('NOT a real track record. Treat these numbers as a wiring/sanity check');
    console.log('only. Re-run with live CoinGecko data for a meaningful (still');
    console.log('hypothetical) backtest.');
  }

  console.log(bar('PER-SEGMENT OUT-OF-SAMPLE RESULTS'));
  const head = [
    'segment', 'window', 'days',
    'sig.ret', 'hold.ret', 'edge',
    'sig.MDD', 'hold.MDD', 'sharpe', 'win', 'switches', 'turnover',
  ];
  console.log(head.join('\t'));
  for (const s of result.segments) {
    console.log([
      s.label,
      `${isoDay(s.startT)}..${isoDay(s.endT)}`,
      s.days,
      signedPct(s.signalTotalReturn),
      signedPct(s.holdTotalReturn),
      signedPct(s.edgeReturn),
      pct(s.signalMaxDrawdown),
      pct(s.holdMaxDrawdown),
      s.signalSharpe.toFixed(2),
      pct(s.winRate),
      s.regimeSwitches,
      s.turnover.toFixed(2),
    ].join('\t'));
  }

  const a = result.aggregate;
  console.log(bar('AGGREGATE (continuous walk-forward, all OOS)'));
  console.log(`Signal total return : ${signedPct(a.signalTotalReturn)}   (hold: ${signedPct(a.holdTotalReturn)})`);
  console.log(`Signal CAGR         : ${signedPct(a.signalCAGR)}   (hold: ${signedPct(a.holdCAGR)})`);
  console.log(`Signal max drawdown : ${pct(a.signalMaxDrawdown)}   (hold: ${pct(a.holdMaxDrawdown)})  -> reduced ${signedPct(a.drawdownReduction)}`);
  console.log(`Annualized Sharpe   : ${a.signalSharpe.toFixed(2)}   (hold: ${a.holdSharpe.toFixed(2)})`);
  console.log(`Win rate (days up)  : ${pct(a.winRate)}`);
  console.log(`Regime switches     : ${a.regimeSwitches}`);
  console.log(`Turnover (sum |Δ|)  : ${a.turnover.toFixed(2)}  (avg/day ${a.avgDailyTurnover.toFixed(3)})`);
  console.log(`Cost drag paid      : ${money(a.costDrag)} @ ${a.costBps} bps`);
  console.log(`Final equity        : ${money(a.signalEquity)}  vs hold ${money(a.holdEquity)}`);
  console.log(`Edge vs buy & hold  : ${a.edgeMultiple.toFixed(2)}x  (${signedPct(a.edgeReturn)})`);

  console.log(bar('DISCLAIMER'));
  console.log('Backtested / hypothetical performance. Not indicative of future');
  console.log('results. No real capital was deployed. See BACKTEST.md for the full');
  console.log('methodology, cost assumptions and the no-look-ahead guarantee.');
  console.log('');
}

// ---- main ------------------------------------------------------------------

async function main() {
  const { candles, source, loadError } = await loadCandles();

  const result = walkForward(candles, {
    segments: 4,
    warmup: 210,
    costBps: 10,
    base: 100000,
  });

  printReport(result, source, loadError);

  const artifact = {
    schema: 'zero-point-data/track-record/v1',
    hypothetical: true,
    disclaimer:
      'BACKTESTED / HYPOTHETICAL performance. Not indicative of future results. ' +
      'No real capital was deployed. See BACKTEST.md.',
    generatedAt: new Date().toISOString(),
    dataSource: source,
    syntheticWarning:
      source === 'synthetic'
        ? 'Synthetic series is more volatile than real BTC; edge is an artifact of the generator, NOT a real track record.'
        : null,
    loadError: loadError || null,
    meta: result.meta,
    segments: result.segments,
    aggregate: result.aggregate,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Wrote ${path.relative(path.join(__dirname, '..', '..'), OUT_FILE)} (${source} data, hypothetical).`);
}

main().catch(err => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
