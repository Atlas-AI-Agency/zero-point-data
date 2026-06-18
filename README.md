# Zero Point Data

A data-first BTC signals product — a polished single-page site with a **real working signal engine** behind it (not a mockup) and a **scaffolded Stripe checkout**. Our pitch: the signal *and the transparent data behind it*.

> See [`ROADMAP.md`](ROADMAP.md) for the full 7-part development blueprint (data layer, regime modeling, backtesting, API, GTM, legal) and [`SETUP-STRIPE.md`](SETUP-STRIPE.md) to activate billing.

## What it is

A single-page product site with a live "Today's Read" panel. The engine implements a transparent methodology:

> *a data-driven risk architecture that evaluates momentum and capital flows to isolate distinct risk regimes — and exposes the per-factor drivers behind every read.*

It classifies the BTC market into four regimes — **Strong Off** (Capitulation), **Mild Off** (Caution), **Mild On** (Accumulation), **Strong On** (Euphoria) — and outputs a BTC/Cash allocation, a risk score in `[-100, +100]`, and a factor breakdown. *"The inflection is the signal"*: regime transitions are flagged explicitly.

## The engine (`src/engine.js`)

Composite risk score = weighted blend of four factors computed from a daily BTC price/volume series:

| Factor | Weight | Input |
|---|---|---|
| Momentum | 0.34 | RSI(14), centered & tanh-scaled |
| Trend | 0.30 | price vs EMA(21) + 200-day structure |
| Capital Flow | 0.22 | volume-weighted return drift, EMA(14) |
| Volatility | 0.14 | 30d realized vol vs its own 180d range (inverted) |

A `backtest()` simulates following the allocation signal vs an unhedged hold to produce the track-record numbers ("the edge").

## Data

`/api/signal` pulls **live BTC/USD daily** data from CoinGecko (no key), runs the engine, and caches for 5 min. If the network is unavailable it falls back to a **deterministic synthetic series** so the product always renders. The frontend shows live-computed track-record numbers only when backed by real data; otherwise it displays reference figures.

## Billing

Stripe Checkout is wired but **inert until you add keys** ([`src/stripe.js`](src/stripe.js) + `/api/checkout`). The Subscribe button shows a setup notice until `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` are set — see [`SETUP-STRIPE.md`](SETUP-STRIPE.md). Test mode first; no real money moves.

## Run

```bash
node server.js      # http://localhost:4317
```

Zero dependencies — pure Node stdlib + vanilla HTML/CSS/JS.

## Structure

```
server.js          # zero-dep HTTP server + /api/signal + data fetch/fallback
src/engine.js      # the signal engine (regimes, factors, backtest)
public/index.html  # the page (verbatim Vector copy)
public/styles.css  # dark theme, teal/blue accents
public/app.js      # fetches signal, renders read card / regimes / chart
```

---
*Independent demonstration build. Not affiliated with Glassnode. Not financial advice.*
