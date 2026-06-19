# Zero Point Data — Walk-Forward Backtest

> **DISCLAIMER — READ FIRST.** Every number produced by this harness is
> **BACKTESTED / HYPOTHETICAL**. It is **not indicative of future results**, not
> investment advice, and **no real capital was ever deployed**. Backtests are
> reconstructed from historical (or, in the offline fallback, *synthetic*) data
> and benefit from hindsight. A hypothetical edge here does **not** mean the
> strategy would have been tradeable, nor that it will work going forward.

This document describes the methodology behind `src/backtest/harness.js` and the
runner `src/backtest/run.js`, which together produce `data/track-record.json`.

## What it does

The harness evaluates the Zero Point Data signal engine (`src/engine.js`,
imported read-only) as an allocation strategy, **walk-forward**, over
out-of-sample (OOS) segments. The engine maps each day to a BTC allocation of
`0 / 35 / 75 / 100%`; the rest sits in cash. We simulate following that
allocation and compare it to naive buy-and-hold.

## Methodology

1. **Load candles.** The runner uses the hardened data feed's **deep history**
   path (`getDeepCandles`) — Coinbase BTC-USD daily back to ~2015 — to get a
   long, multi-cycle series (default **6 years**, set with `ZPD_YEARS`). If the
   live fetch fails it falls back to the standard feed, then to a
   **deterministic synthetic** generator so the backtest is reproducible
   offline. Force synthetic with `ZPD_SYNTHETIC=1`.

2. **Warm-up reservation.** The first `warmup` candles (default **210**) are
   reserved and never traded inside the test window. The engine's slowest factor
   (200-day SMA) needs this history before its reads are meaningful, so OOS
   trading only begins once the signal is fully "warm".

3. **Walk forward.** The remaining tail is carved into `segments` (default
   **4**) equal, contiguous, **non-overlapping** OOS windows. Each window is
   simulated independently, and an aggregate pass stitches the full OOS span into
   one continuous walk-forward equity curve.

4. **Simulate with frictions** (see below) and compute honest metrics.

## The no-look-ahead guarantee

Two independent properties ensure no information from the future leaks into a
trade:

- **The engine is causal.** Every per-day value the engine emits (score,
  regime, allocation) is a function only of candles dated **at or before** that
  day. EMA/SMA/RSI/realized-vol are all trailing windows.
- **We act on yesterday's signal.** The strategy return for day *t* is the day-*t*
  market return multiplied by the allocation that was **signalled on day *t − 1***:

  ```
  stratReturn[t] = (close[t] / close[t-1] - 1) * (allocation[t-1] / 100)
  ```

  The day-*t* candle is never used to decide the position that earns the day-*t*
  return. This is the standard one-bar-delay convention that removes look-ahead.

## Cost assumptions

- **Slippage + fee:** `10 bps` (0.10%) per rebalance by default.
- **Charged only on turnover.** The cost applies to the *changed* notional
  `|targetAlloc − heldAlloc|` and is paid **only on days where the target
  allocation actually changes** day-over-day. Holding a position costs nothing.
- **No initial-entry cost** is charged for the position carried into the start of
  the OOS window (it is a continuation of the live signal, not a new trade).
- Costs are deducted from strategy equity at rebalance, before the day's return
  is applied. The total cost paid is reported as `costDrag`.

These are deliberately simple, transparent assumptions. Real-world execution
also faces spreads, partial fills, funding, taxes, and latency — none of which
are modelled here. **Treat the cost model as optimistic.**

## Metrics (all computed on OOS data only)

| Metric | Meaning |
|---|---|
| `signalTotalReturn` / `holdTotalReturn` | Total OOS return, strategy vs buy-and-hold |
| `signalCAGR` / `holdCAGR` | Annualized growth (365 trading days/yr — crypto trades daily) |
| `signalMaxDrawdown` / `holdMaxDrawdown` | Worst peak-to-trough decline (positive fraction) |
| `signalSharpe` / `holdSharpe` | Annualized Sharpe from daily returns (rf = 0) |
| `winRate` | Fraction of OOS days with positive strategy return |
| `regimeSwitches` | Number of day-over-day regime changes in the window |
| `turnover` | Sum of `|Δallocation|` (allocation units) over the window |
| `costDrag` | Total slippage+fee paid (currency) |
| `edgeMultiple` / `edgeReturn` | Strategy vs buy-and-hold, multiplicative / additive |
| `drawdownReduction` | How much drawdown the strategy avoided vs hold |

## ⚠️ Synthetic data is NOT a track record

When the runner falls back to the synthetic generator (offline, or
`ZPD_SYNTHETIC=1`), the report prints a loud warning, and
`data/track-record.json` carries a `syntheticWarning` field.

**The synthetic series is intentionally more volatile than real BTC.** A
risk-managed allocation strategy mechanically looks *fantastic* on an
over-volatile series because there is more downside to dodge — so the synthetic
backtest typically shows an **unrealistically large edge over buy-and-hold**.
That number is an artifact of the generator, **not evidence the strategy works**.
Use the synthetic run only to confirm the harness is wired correctly. For a
meaningful (but still hypothetical) result, run online so live Coinbase data is
used.

## Finding (real data, 6.5-year out-of-sample) — why we don't publish numbers yet

Run on real Coinbase BTC/USD over ~6.5 years (2019→2026, 6 walk-forward
segments), the strategy **underperforms buy-and-hold on total return**
(~0.86×) — the whipsaw cost during strong bull legs outweighs the downside it
dodges. Its genuine value is **risk reduction**: max drawdown ~54% vs ~77% for
hold, and a higher Sharpe (~1.07 vs ~0.86).

In short: **this is a risk-management overlay, not an alpha engine.** A short
recent window (e.g. ~22 months) flatters it; the full multi-cycle record does
not. Per that finding, we **do not publish performance figures on the public
site** — the Track Record section describes methodology only, and
`/api/v1/track-record` is gated (`ZPD_PUBLISH_TRACK_RECORD=1` to expose
internally). We publish numbers when the model earns them.

## Running

```bash
node src/backtest/run.js                    # deep real data (6y), else synthetic
ZPD_YEARS=8 node src/backtest/run.js        # deeper history
ZPD_SYNTHETIC=1 node src/backtest/run.js    # force the offline synthetic run
```

The runner prints a readable report to stdout and writes
`data/track-record.json`. The committed artifact is labelled
`hypothetical: true` and records which data source produced it.

---

*Zero Point Data. Backtested/hypothetical performance is not indicative of
future results. Not investment advice.*
