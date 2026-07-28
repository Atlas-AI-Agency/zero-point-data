# Backtest Framework

## Synthetic Reproducibility (First-Time Users)

To verify the harness functionality without live credentials or network access, use the embedded synthetic dataset:

```bash
ZPD_SYNTHETIC=1 node src/backtest/run.js
```

## Prerequisites

- **Node.js**: Version 18.x (use `nvm install 18` if needed)
- **No API keys required** — the synthetic series is deterministic and embedded in the harness

## Expected Output

A successful run produces:

- Console output showing a walk-forward backtest report with per-segment and aggregate metrics
- `data/track-record.json` containing the synthetic track record (gitignored)

The report header includes a **SYNTHETIC DATA WARNING** — see Notes below.

## Notes

- All numeric results are **hypothetical and non-production**. They do not indicate future performance.
- The synthetic series is **intentionally more volatile than real BTC**. A risk-managed allocation strategy mechanically looks better on an over-volatile series because there is more downside to dodge. The synthetic backtest typically shows an unrealistically large edge over buy-and-hold — this is a generator artifact, **not evidence the strategy works**.
- Use the synthetic run only to confirm the harness is wired correctly. For a meaningful (but still hypothetical) result, run with live CoinGecko data (`node src/backtest/run.js` without `ZPD_SYNTHETIC`).
- The live server path (`server.js`) is separate from this backtest harness and serves the signal API on port 4317.

## Version

Branched from `e224746` (main, 2026-07-25) — synthetic harness verifies setup correctness only. Results are **not investment advice**, and numbers are intentionally divergent from real BTC volatility patterns for testing purposes.

---

*Backtested/hypothetical performance is not indicative of future results. Not investment advice.*
