# Zero Point Data — Development Blueprint

> A data-first signals company. We sell **clear decisions backed by transparent data**, not raw charts and not a black box. Where the incumbent ($749+/mo, Telegram-only, no API, opaque index) hides its method, we expose *why* — every signal ships with its drivers.

This document is the build plan. The current repo is a working **product/marketing shell + a real (v1) signal engine + a scaffolded Stripe checkout**. Everything below is the path from that to a production company.

Positioning note: we are **not** "a Glassnode Vector clone." Vector is a useful reference for *what good looks like* (regime signal + risk index + allocation + alerts) and *what to beat* (opacity, no API, Telegram-only, single-asset, $749 floor). We differentiate on **transparency, API access, explainability, accessibility, and breadth.**

---

## 1. Product Specification v1 (MVP)

**Core deliverable:** a daily BTC **regime read** with an allocation stance and a transparent driver breakdown.

| Output | Detail | Frequency |
|---|---|---|
| **Risk Index** | 0–100 composite (we publish the formula and the inputs — the opposite of Vector's opaque index) | Daily close + intraday refresh |
| **Regime** | 4 states: Strong Off (Capitulation) / Mild Off (Caution) / Mild On (Accumulation) / Strong On (Euphoria) | Daily, with explicit **inflection** flag on transition |
| **Allocation stance** | BTC % / Cash % (Moderate strategy v1; Aggressive/Conservative later) | Daily |
| **Confidence** | Model's own confidence in the regime call (e.g. distance-from-threshold + factor agreement) | Per read |
| **Top drivers** | Ranked factor contributions — "why this read today: momentum −59, flow −78, …" | Per read — **this is the headline differentiator** |
| **Alerts** | Regime shift, risk-index threshold cross, volatility spike, flow reversal | Real-time (push) |
| **Analysis layer** | Biweekly multi-horizon written read (long/mid/short) | Biweekly |

**How we beat Vector's opacity (the whole thesis):**
- Publish the index construction and factor weights.
- Every signal carries its driver attribution and confidence — no "trust us."
- Full historical signal log is downloadable (CSV/Parquet), so users can audit the track record themselves rather than take a marketing number on faith.
- A public, versioned changelog of the model (`model_version` on every signal).

**v1 engine (already in repo, `src/engine.js`):** composite of Momentum (RSI), Trend (EMA/SMA structure), Capital Flow (volume-weighted drift), Volatility (realized-vol regime). This is the *honest MVP* — a transparent factor blend. Section 3 is how it grows into a validated model.

---

## 2. Data Layer Architecture

**Strategy: hybrid.** Buy where it's cheap and high-quality, index where it's proprietary, scrape public where it's free and reliable.

**Tiered sourcing:**
1. **Market data (cheap, commodity):** OHLCV, perp funding, open interest, CVD — from exchange APIs (Binance/Coinbase/Bybit) + an aggregator. CoinGecko/CCXT for v1.
2. **On-chain (buy first, build later):** Glassnode / CryptoQuant / Coin Metrics APIs for flows, reserves, realized price, SOPR, MVRV, network growth. Buying beats running your own node + indexer until volume justifies the eng cost.
3. **Proprietary derivations (the moat):** custom composites computed *on top* of 1+2 — e.g. a flow-momentum cross, a liquidity-adjusted risk score, whale-cohort net-position deltas. This is where "we pride ourselves on data" earns its keep.

**Point-in-time correctness (non-negotiable for backtesting):** store every metric with `as_of` (when we learned it) separate from `event_time` (when it happened). On-chain metrics get revised; using revised values in a backtest is the #1 way to fake an edge. Every query the model sees must be reconstructable as "what did we know at time T."

**Storage:**
- **TimescaleDB** (Postgres + hypertables) for v1 — relational, point-in-time joins, one system to run. Recommended start.
- **ClickHouse** when query volume / cardinality outgrows Timescale (tick data, many assets). Migrate the hot path, not everything.

**Pipelines:** orchestrate with Dagster or Prefect (asset-aware, better than raw cron for data lineage). Per-source **freshness monitors** that page when a feed goes stale — a silently stale flow feed produces a confidently wrong signal, the worst failure mode.

**Cost/latency trade-offs:** daily signals don't need tick latency — batch hourly, refresh the index intraday. Reserve real-time streaming for the *alert* path (volatility/flow spikes), not the core daily read. Keeps provider costs sane.

**Priority metrics for v1 → v2:** momentum variants (RSI, ROC, EMA spreads), exchange net-flows, realized price / MVRV / SOPR, funding + OI, CVD, realized vol, a liquidity proxy, network growth. Compose these into 3–4 risk composites rather than shipping 40 raw lines.

---

## 3. Modeling & Signal Generation

**Regime detection — layered, simplest-first:**
1. **v1 (shipped):** transparent weighted factor score → thresholded into 4 regimes. Explainable by construction.
2. **v2:** **Hidden Markov Model / Markov regime-switching** on the factor vector to get probabilistic regime membership + transition probabilities (better inflection timing than hard thresholds). Cross-check against the v1 score — disagreement is itself a signal to surface.
3. **v3:** ensemble (gradient-boosted classifier + HMM + rule overlay), with the rule overlay retaining a veto so the model can never do something economically absurd.

**Risk Index (0–100):** normalize each factor to a bounded contribution, weight, sum, rescale. Publish weights. Recalibrate weights only on a schedule (quarterly), versioned — never silently.

**Inflection logic:** flag when regime membership flips *and* a confirmation factor agrees (e.g. momentum threshold crossed **and** CVD/flow confirms direction) to cut whipsaw. This mirrors the public-folklore "+0.5 + CVD confirmation" idea but derived and tuned on our own data.

**Backtesting — crypto-specific rigor (this is where credibility is won or lost):**
- **Walk-forward** optimization, never a single in-sample fit.
- **Multi-cycle / stress:** must survive the 2022 bear, the 2023 chop, the 2024–25 ETF-era bull. A model tuned only on a bull is worthless.
- **Costs:** slippage + fees + funding on every simulated rebalance. An edge that dies under 10bps slippage isn't an edge.
- **Regime-shift robustness:** explicitly test that the ETF era (structurally different flows) doesn't break a model trained pre-ETF.
- **Honesty guard:** no look-ahead (point-in-time data from §2), no survivorship, report drawdown and turnover, not just CAGR.

**Explainability (product feature, not just diligence):** per-signal factor attribution ("why this read today"), feature-importance for the ML layers (SHAP), and a plain-English generated summary. Vector gives you a number; we give you the number *and the reasons*.

**Drift monitoring in prod:** track live factor distributions vs. training distribution (population stability index), track realized signal hit-rate on a rolling window, alert when either degrades. A model that was right last year and is quietly wrong now is the existential risk.

---

## 4. Delivery & UX Architecture

**Multi-channel — the API is the differentiator, since Vector has none:**
- **Web dashboard:** historical signals, performance attribution, the driver breakdown, customizable views. (React + a charting lib; or Plotly/Dash for a faster internal v1.)
- **Telegram bot:** signals + alerts (meet incumbent users where they are) — but it's *a* channel, not *the* channel.
- **REST + WebSocket API:** the headline. Quants automate against `/api/signal`, stream alerts over WS. This is the thing institutional users will pay for that they literally cannot get from Vector.
- **Exports:** CSV/Parquet of the full signal history (auditability = trust).
- **Sandbox:** let Pro users re-run the backtest with their own cost assumptions — radical transparency, and it sells itself.
- **Integrations:** TradingView alerts, portfolio tools, and (leveraging your Hermes-style local agents) a personal-monitoring agent that watches the API and acts on your rules.

---

## 5. Tech Stack & Roadmap

**Stack:** Python + **FastAPI** backend (async, native for the API differentiator); Dagster/Prefect pipelines; TimescaleDB → ClickHouse; **MLflow** for model versioning/registry; Stripe for billing; Sentry + Prometheus/Grafana for app + data/model monitoring. Deploy on your Azure expertise; self-host the agent/automation layer.

**Phased plan:**
- **Phase 0 (done / this repo):** product shell, transparent v1 engine, scaffolded Stripe checkout.
- **Phase 1 (≈4–6 wks):** real data layer (market + bought on-chain), Timescale, point-in-time store, daily pipeline, harden the v1 index, ship REST API + web dashboard, live Stripe.
- **Phase 2 (≈6–10 wks):** HMM/regime-switching v2, walk-forward backtest harness + published track record, Telegram bot, WS alerts, exports.
- **Phase 3:** ensemble model, drift monitoring, sandbox, multi-asset (ETH next), TradingView/agent integrations.

**Security/reliability:** secrets in a vault (never in code — note the Stripe scaffold already reads from env only); least-privilege provider keys; idempotent pipelines; staging that mirrors prod data shape; human sign-off on the daily signal during Phase 1–2 before full automation.

---

## 6. Monetization, GTM & Differentiation

**Tiered pricing (undercut the $749 floor on the low end, win on access up high):**
- **Lite / free:** delayed daily regime + risk index (teaser, content engine). Vector has no free tier — we acquire where they can't.
- **Pro (~$99–199/mo):** real-time signals, alerts, full history export, API (rate-limited). This is the wedge: a real API at a fraction of Vector's price.
- **Enterprise (custom):** high-rate API/WS, bespoke metrics, multi-asset, SLA. Where Vector does bespoke, so do we — with an actual API as the baseline.

**GTM:** content-led — publish the backtest methodology and periodic research (the transparency *is* the marketing). Let people verify the edge instead of asserting it.

**Differentiation, one line each:**
- vs **Vector:** transparency (published method), API access (they have none), explainability per signal, lower entry price, planned multi-asset.
- vs **CryptoQuant/Dune:** we ship *decisions*, not raw metrics/dashboards.
- vs **free LLM/TA tools:** point-in-time-correct, backtested, governed model — not a chatbot guessing.

---

## 7. Risks, Legal & Ops

**Pitfalls:** data cost/accuracy (mitigate: hybrid sourcing + freshness monitors); non-stationarity / black swans (mitigate: multi-cycle stress tests, rule-overlay veto, drawdown-first reporting); trust in the edge (mitigate: downloadable history + sandbox — let them verify); commoditization by free tools (mitigate: the moat is point-in-time data + governance, not the indicators).

**Legal/compliance:** structure as an **information service, not investment advice.** Strong, unavoidable disclaimers on every surface and every API response. Sample:

> *Zero Point Data provides data-driven market analytics for informational purposes only. Nothing herein is financial, investment, or trading advice, or a recommendation to buy or sell any asset. Signals are model outputs that may be wrong. Past and backtested performance does not guarantee future results. You are solely responsible for your decisions. Consult a licensed advisor.*

Add model-governance docs (versioned model cards, change log), retain signal history for audit, and consult counsel on jurisdiction before charging EU/US customers.

**Ops:** human-in-the-loop on the daily signal through Phase 1–2; automated data-freshness + model-drift alerting; incident runbook for a stale-feed / bad-signal event (how to retract a published signal). A wrong signal shipped confidently is the reputational kill-shot — design the retraction path *before* you need it.

---

## Immediate next steps
1. ✅ Rebrand shell to Zero Point Data, remove all Glassnode/Vector references *(pending — see note below)*.
2. ✅ Scaffold Stripe Checkout from env vars *(this turn)*.
3. Stand up Timescale + the daily market-data pipeline (Phase 1).
4. Add the API (`/api/signal` is already the seed) + dashboard.
5. Build the walk-forward backtest harness and publish the first honest track record.
