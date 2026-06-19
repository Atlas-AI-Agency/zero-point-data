#!/usr/bin/env node
// ============================================================================
// Zero Point Data — Backtest Runner (CLI)
// ----------------------------------------------------------------------------
// Usage:  node src/backtest/run.js
//
// Loads a daily BTC candle series via the hardened production data feed
// (CoinGecko -> Coinbase, with last-good cache and synthetic last resort), runs
// the walk-forward harness across multiple out-of-sample segments, prints a
// readable report to stdout, and writes data/track-record.json.
//
// ALL NUMBERS PRODUCED HERE ARE BACKTESTED / HYPOTHETICAL. The synthetic
// fallback series is MORE volatile than real BTC and will typically produce an
// unrealistically large edge — the report says so explicitly when synthetic
// data is used. See BACKTEST.md.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { walkForward } = require('./harness');
const datafeed = require('../datafeed');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'track-record.json');

// ---- data loading ----------------------------------------------------------

// Load candles via the hardened production data feed: multi-source
// (CoinGecko -> Coinbase) with retries + last-good cache, and synthetic only as
// a true last resort. This is the SAME feed the live product uses, so the
// backtest runs on the same real data the signal is served from.
async function loadCandles() {
  if (process.env.ZPD_SYNTHETIC === '1') {
    return { candles: datafeed.syntheticCandles(), source: 'synthetic' };
  }
  // Deep history for a longer, more credible walk-forward (multiple cycles).
  const years = Number(process.env.ZPD_YEARS) || 6;
  const feed = await datafeed.getDeepCandles({ years });
  return {
    candles: feed.candles,
    source: feed.source,
    live: feed.live,
    stale: feed.stale,
    asOf: feed.asOf,
    loadError: feed.source === 'synthetic' ? (feed.note || 'no live data available') : null,
  };
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
  const { candles, source, loadError, live, stale, asOf } = await loadCandles();

  const result = walkForward(candles, {
    segments: 6,
    warmup: 220,
    costBps: 10,
    base: 100000,
  });

  printReport(result, source, loadError);

  const isReal = source !== 'synthetic';
  const artifact = {
    schema: 'zero-point-data/track-record/v1',
    hypothetical: true,
    disclaimer:
      'BACKTESTED / HYPOTHETICAL performance. Not indicative of future results. ' +
      'No real capital was deployed. See BACKTEST.md.',
    generatedAt: new Date().toISOString(),
    dataSource: source,
    real: isReal,                 // true when computed on live market data
    dataAsOf: asOf ? new Date(asOf).toISOString() : null,
    stale: stale || false,
    syntheticWarning:
      isReal
        ? null
        : 'Synthetic series is more volatile than real BTC; edge is an artifact of the generator, NOT a real track record.',
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
