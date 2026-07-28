# Backtest Framework

## Synthetic Reproducibility (First-Time Users)

To verify the harness functionality without live credentials, use the synthetic dataset:

```bash
ZPD_SYNTHETIC=1 node src/backtest/run.js
```

## Prerequisites
- **Node.js**: Version 18.x (use `nvm install 18` if needed)
- **Data**: The synthetic dataset is embedded in the harness and resides in `data/track-record.json` (gitignored)

## Expected Output
A successful run produces:
- `data/track-record.json` containing synthetic race telemetry
- Console output showing "Synthetic dataset loaded" and "Backtest complete"

## Notes
- All numeric results are hypothetical and non-production data
- For live operations, use the actual server path outside this repo

## Version
 Branched from `e224746...` (main, 2026-07-25)

[README Crosslink]
Refer to [BACKTEST.md] for technical documentation on the backtest framework.