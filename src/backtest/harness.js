// ============================================================================
// Zero Point Data — Walk-Forward Backtest Harness
// ----------------------------------------------------------------------------
// A rigorous, honest out-of-sample evaluator for the Zero Point Data signal
// engine. It rolls forward over disjoint out-of-sample (OOS) segments, runs the
// engine on the data available up to each point, and simulates the allocation
// strategy with realistic frictions and NO look-ahead.
//
// Guarantees:
//   * No look-ahead: today's return is earned at *yesterday's* signalled
//     allocation. The engine never sees a candle dated on or after the day
//     whose return it is acting on.
//   * Realistic costs: a slippage+fee charge (default 10 bps) is applied to the
//     traded notional ONLY on days where the target allocation actually changes
//     day-over-day (turnover). Holding incurs no cost.
//   * Honest metrics: total return, CAGR, max drawdown, annualized Sharpe (from
//     daily strategy returns), win rate, regime switches, turnover, and edge vs
//     buy-and-hold — all computed on OOS data only.
//
// EVERYTHING produced here is BACKTESTED / HYPOTHETICAL. See BACKTEST.md.
// ============================================================================

const { computeSignals } = require('../engine');

const TRADING_DAYS_PER_YEAR = 365; // crypto trades every day

// ---- low-level metric helpers ----------------------------------------------

function mean(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (xs.length - 1)); // sample std
}

// Max drawdown of an equity curve (array of equity values), as a positive
// fraction in [0,1]. 0.42 means a 42% peak-to-trough decline.
function maxDrawdown(equity) {
  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = (peak - e) / peak;
      if (dd > mdd) mdd = dd;
    }
  }
  return mdd;
}

// CAGR from a total growth multiple over a number of days.
function cagr(multiple, days) {
  if (days <= 0 || multiple <= 0) return 0;
  const years = days / TRADING_DAYS_PER_YEAR;
  if (years <= 0) return 0;
  return Math.pow(multiple, 1 / years) - 1;
}

// Annualized Sharpe from a series of daily returns (excess over a daily rf).
function annualizedSharpe(dailyReturns, dailyRf = 0) {
  if (dailyReturns.length < 2) return 0;
  const excess = dailyReturns.map(r => r - dailyRf);
  const sd = stddev(excess);
  if (sd === 0) return 0;
  return (mean(excess) / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

function round(x, dp = 4) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

// ----------------------------------------------------------------------------
// Simulate one out-of-sample window.
//
// `candles` is the FULL ascending candle history. We compute signals on the
// entire history once (the engine itself is causal — every per-day value is a
// function only of candles at or before that day), then simulate trading over
// the [startIdx, endIdx] slice. The day-t return is multiplied by the
// allocation from day t-1, so there is no look-ahead.
//
// Returns a rich metrics object for the window.
// ----------------------------------------------------------------------------
function simulateWindow(series, startIdx, endIdx, opts) {
  const costBps = opts.costBps != null ? opts.costBps : 10; // 10 bps default
  const costRate = costBps / 10000;
  const base = opts.base != null ? opts.base : 100000;

  let signalEquity = base;
  let holdEquity = base;

  const signalCurve = [signalEquity];
  const holdCurve = [holdEquity];
  const dailyStratReturns = [];
  const dailyHoldReturns = [];

  let regimeSwitches = 0;
  let turnover = 0;            // sum of |Δalloc| across the window (in alloc units, 0..1)
  let costDrag = 0;           // total cost paid (currency)
  let winDays = 0;            // days strategy return > 0
  let activeDays = 0;

  // allocation we are *currently holding* going into day startIdx. We assume we
  // enter the OOS window flat-to-signal: the position is whatever yesterday's
  // signal said, with no entry cost charged for the initial setup (it's a
  // continuation of the live signal, not a new trade inside the test window).
  let heldAlloc = series[startIdx - 1].btcAllocation / 100;

  for (let i = startIdx; i <= endIdx; i++) {
    const ret = series[i].close / series[i - 1].close - 1;

    // act on yesterday's signal: target allocation for today is set by day i-1.
    const targetAlloc = series[i - 1].btcAllocation / 100;

    // friction: pay cost on the changed notional when the target differs from
    // what we held. Cost is charged at the start of the day (rebalance), then
    // we earn the day's return at the new allocation.
    const delta = Math.abs(targetAlloc - heldAlloc);
    if (delta > 1e-9) {
      const tradedNotional = signalEquity * delta;
      const cost = tradedNotional * costRate;
      signalEquity -= cost;
      costDrag += cost;
      turnover += delta;
    }
    heldAlloc = targetAlloc;

    if (series[i].regime !== series[i - 1].regime) regimeSwitches++;

    const stratRet = ret * targetAlloc;
    signalEquity *= 1 + stratRet;
    holdEquity *= 1 + ret;

    signalCurve.push(signalEquity);
    holdCurve.push(holdEquity);
    dailyStratReturns.push(stratRet);
    dailyHoldReturns.push(ret);

    if (targetAlloc > 0) activeDays++;
    if (stratRet > 0) winDays++;
  }

  const days = endIdx - startIdx + 1;
  const signalMultiple = signalEquity / base;
  const holdMultiple = holdEquity / base;

  return {
    label: opts.label || null,
    startT: series[startIdx].t,
    endT: series[endIdx].t,
    days,
    base,
    costBps,

    signalEquity: Math.round(signalEquity),
    holdEquity: Math.round(holdEquity),

    signalTotalReturn: round(signalMultiple - 1),
    holdTotalReturn: round(holdMultiple - 1),

    signalCAGR: round(cagr(signalMultiple, days)),
    holdCAGR: round(cagr(holdMultiple, days)),

    signalMaxDrawdown: round(maxDrawdown(signalCurve)),
    holdMaxDrawdown: round(maxDrawdown(holdCurve)),

    signalSharpe: round(annualizedSharpe(dailyStratReturns), 3),
    holdSharpe: round(annualizedSharpe(dailyHoldReturns), 3),

    winRate: round(days ? winDays / days : 0),
    activeDays,
    regimeSwitches,
    turnover: round(turnover),
    avgDailyTurnover: round(days ? turnover / days : 0),
    costDrag: Math.round(costDrag),

    // edge vs buy-and-hold (hypothetical)
    edgeMultiple: round(holdMultiple > 0 ? signalMultiple / holdMultiple : 1),
    edgeReturn: round(signalMultiple - holdMultiple),
    drawdownReduction: round(maxDrawdown(holdCurve) - maxDrawdown(signalCurve)),
  };
}

// ----------------------------------------------------------------------------
// Walk forward across the series.
//
// We reserve a `warmup` prefix (the engine needs ~200 candles for SMA200 to be
// meaningful) and then carve the remaining tail into `segments` equal,
// contiguous, NON-overlapping out-of-sample windows. Each window is evaluated
// independently; we also report an aggregate "all OOS" pass that stitches the
// windows together into one continuous walk-forward equity curve.
//
// @param {Array} candles ascending [{t,close,volume}]
// @param {Object} [opts]
// @param {number} [opts.segments=4]   number of forward OOS windows
// @param {number} [opts.warmup=210]   candles reserved before the first window
// @param {number} [opts.costBps=10]   per-rebalance slippage+fee, in bps
// @param {number} [opts.base=100000]  notional
// @returns {Object} { segments:[...], aggregate:{...}, meta:{...} }
// ----------------------------------------------------------------------------
function walkForward(candles, opts = {}) {
  const segments = opts.segments != null ? opts.segments : 4;
  const warmup = opts.warmup != null ? opts.warmup : 210;
  const costBps = opts.costBps != null ? opts.costBps : 10;
  const base = opts.base != null ? opts.base : 100000;

  if (!Array.isArray(candles) || candles.length < warmup + segments + 2) {
    throw new Error(
      `Not enough candles: have ${candles ? candles.length : 0}, need >= ${warmup + segments + 2}`
    );
  }

  // Compute signals ONCE over the full history. The engine is causal, so this
  // is equivalent to (but far cheaper than) recomputing on each expanding
  // window — and it still contains zero look-ahead in the trade simulation
  // because we only ever multiply day-t return by the day-(t-1) allocation.
  const { series } = computeSignals(candles);

  // first tradeable OOS index (need i-1 to exist and warmup satisfied)
  const firstIdx = Math.max(warmup, 1);
  const lastIdx = series.length - 1;
  const oosLen = lastIdx - firstIdx + 1;
  const winLen = Math.floor(oosLen / segments);

  if (winLen < 5) {
    throw new Error(`OOS window too small (${winLen} days); reduce segments or warmup.`);
  }

  const segResults = [];
  for (let s = 0; s < segments; s++) {
    const startIdx = firstIdx + s * winLen;
    // last segment absorbs any remainder
    const endIdx = s === segments - 1 ? lastIdx : startIdx + winLen - 1;
    segResults.push(
      simulateWindow(series, startIdx, endIdx, {
        label: `OOS-${s + 1}`,
        costBps,
        base,
      })
    );
  }

  // aggregate: one continuous walk-forward pass over the entire OOS span.
  const aggregate = simulateWindow(series, firstIdx, lastIdx, {
    label: 'OOS-ALL',
    costBps,
    base,
  });

  return {
    meta: {
      hypothetical: true,
      note: 'BACKTESTED / HYPOTHETICAL — not indicative of future results.',
      totalCandles: candles.length,
      warmup,
      segments,
      costBps,
      base,
      oosStartT: series[firstIdx].t,
      oosEndT: series[lastIdx].t,
      oosDays: oosLen,
      tradingDaysPerYear: TRADING_DAYS_PER_YEAR,
      noLookAhead: 'day-t return earned at day-(t-1) allocation',
    },
    segments: segResults,
    aggregate,
  };
}

module.exports = {
  walkForward,
  simulateWindow,
  // exported for testing / reuse
  maxDrawdown,
  annualizedSharpe,
  cagr,
  mean,
  stddev,
};
