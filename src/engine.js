// ============================================================================
// Zero Point Data — Signal Engine
// ----------------------------------------------------------------------------
// A transparent, data-driven risk architecture that evaluates momentum
// thresholds and capital flows to isolate distinct risk regimes — and exposes
// the per-factor drivers behind every read (no black box).
//
// The engine ingests a daily BTC price series (+ optional flow proxy) and emits:
//   - a composite Risk Score in [-100, +100]
//   - one of four regimes: Strong Off / Mild Off / Mild On / Strong On
//   - a BTC / Cash allocation recommendation
//   - the underlying factor breakdown (momentum, trend, volatility, flow)
//
// "The inflection is the signal" — we explicitly surface regime *transitions*.
// ============================================================================

// ---- math helpers ----------------------------------------------------------

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev;
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      prev = values[0];
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

// Relative Strength Index — classic momentum oscillator (0..100).
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss));
  }
  return out;
}

// Annualized realized volatility from daily log returns over a window.
function realizedVol(returns, period = 30) {
  const out = new Array(returns.length).fill(null);
  for (let i = period - 1; i < returns.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += returns[j];
    mean /= period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = returns[j] - mean;
      varSum += d * d;
    }
    out[i] = Math.sqrt(varSum / period) * Math.sqrt(365);
  }
  return out;
}

// Squash any value to [-1, 1] with a tunable slope.
const tanhScale = (x, slope = 1) => Math.tanh(x * slope);

// Min-max normalize the trailing window of a series to a z-like [-1,1].
function rollingZ(values, i, period) {
  const start = Math.max(0, i - period + 1);
  let min = Infinity, max = -Infinity;
  for (let j = start; j <= i; j++) {
    const v = values[j];
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) return 0;
  const v = values[i];
  return ((v - min) / (max - min)) * 2 - 1;
}

// ---- the engine ------------------------------------------------------------

const REGIMES = [
  { key: 'strong_off', label: 'Strong Off', tag: 'Capitulation', min: -100, max: -50, btc: 0,   tone: 'danger'  },
  { key: 'mild_off',   label: 'Mild Off',   tag: 'Caution',      min: -50,  max: 0,   btc: 35,  tone: 'warn'    },
  { key: 'mild_on',    label: 'Mild On',    tag: 'Accumulation', min: 0,    max: 50,  btc: 75,  tone: 'mild'    },
  { key: 'strong_on',  label: 'Strong On',  tag: 'Euphoria',     min: 50,   max: 100, btc: 100, tone: 'strong' },
];

function regimeForScore(score) {
  for (const r of REGIMES) {
    if (score >= r.min && score < r.max) return r;
  }
  return score >= 50 ? REGIMES[3] : REGIMES[0];
}

/**
 * @param {Array<{t:number, close:number, volume?:number}>} candles  daily, ascending by time
 * @returns {{ series: Array, latest: Object, regimes: typeof REGIMES }}
 */
function computeSignals(candles) {
  const closes = candles.map(c => c.close);
  const vols = candles.map(c => c.volume ?? 0);

  // log returns
  const returns = closes.map((c, i) => (i === 0 ? 0 : Math.log(c / closes[i - 1])));

  // factor inputs
  const ema21 = ema(closes, 21);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const rv30 = realizedVol(returns, 30);

  // flow proxy: volume-weighted price drift (capital rotating in vs out).
  // Positive = net buying pressure on up days dominates.
  const flowRaw = closes.map((c, i) => {
    if (i === 0) return 0;
    const ret = returns[i];
    const v = vols[i] || 1;
    return ret * Math.log1p(v);
  });
  const flowEma = ema(flowRaw, 14);

  const series = candles.map((c, i) => {
    const close = c.close;

    // --- Factor 1: Momentum (RSI centered & scaled) ---------------------
    const momentum = rsi14[i] == null ? 0 : tanhScale((rsi14[i] - 50) / 50, 1.4);

    // --- Factor 2: Trend (price vs EMA21 and 200d structure) ------------
    let trend = 0;
    if (ema21[i] != null) trend += tanhScale((close - ema21[i]) / ema21[i], 8) * 0.6;
    if (sma200[i] != null) trend += tanhScale((close - sma200[i]) / sma200[i], 3) * 0.4;

    // --- Factor 3: Volatility regime (high vol = risk-off pressure) -----
    // lower realized vol relative to its own history = supportive.
    const volZ = rv30[i] == null ? 0 : rollingZ(rv30, i, 180);
    const volatility = -tanhScale(volZ, 1.2); // invert: high vol -> negative

    // --- Factor 4: Capital flow -----------------------------------------
    const flow = flowEma[i] == null ? 0 : tanhScale(flowEma[i] * 12, 1);

    // --- Composite risk score (weighted) --------------------------------
    // momentum + trend lead; flow & volatility modulate. Matches the stated
    // "momentum thresholds and capital flows" emphasis.
    const composite =
      momentum * 0.34 +
      trend    * 0.30 +
      flow     * 0.22 +
      volatility * 0.14;

    const score = Math.max(-100, Math.min(100, composite * 100));
    const regime = regimeForScore(score);

    return {
      t: c.t,
      close,
      score: round(score),
      regime: regime.key,
      regimeLabel: regime.label,
      regimeTag: regime.tag,
      btcAllocation: regime.btc,
      cashAllocation: 100 - regime.btc,
      factors: {
        momentum: round(momentum * 100),
        trend: round(trend * 100),
        flow: round(flow * 100),
        volatility: round(volatility * 100),
      },
    };
  });

  // mark inflections (regime changed vs previous day)
  for (let i = 1; i < series.length; i++) {
    series[i].inflection = series[i].regime !== series[i - 1].regime;
    series[i].prevRegime = series[i - 1].regime;
  }

  const latest = series[series.length - 1];

  // days held in current regime
  let held = 1;
  for (let i = series.length - 2; i >= 0; i--) {
    if (series[i].regime === latest.regime) held++;
    else break;
  }
  latest.daysInRegime = held;

  return { series, latest, regimes: REGIMES };
}

function round(x) {
  return Math.round(x * 10) / 10;
}

// ---- backtest: "the edge" --------------------------------------------------
// Simulates following the allocation signal vs unhedged hold, on a base notional.
function backtest(series, base = 100000) {
  let signalEquity = base;
  let holdEquity = base;
  let prevClose = series[0].close;
  let upsideSecured = 0;   // gains captured while risk-on
  let drawdownAvoided = 0; // losses avoided while de-risked

  for (let i = 1; i < series.length; i++) {
    const ret = series[i].close / prevClose - 1;
    const alloc = series[i - 1].btcAllocation / 100; // act on yesterday's signal
    const signalRet = ret * alloc;

    signalEquity *= 1 + signalRet;
    holdEquity *= 1 + ret;

    if (alloc > 0.5 && ret > 0) upsideSecured += holdEquity * ret * alloc;
    if (alloc < 0.5 && ret < 0) drawdownAvoided += holdEquity * -ret * (1 - alloc);

    prevClose = series[i].close;
  }

  return {
    base,
    signalEquity: Math.round(signalEquity),
    holdEquity: Math.round(holdEquity),
    upsideSecured: Math.round(upsideSecured),
    drawdownAvoided: Math.round(drawdownAvoided),
    multiple: holdEquity > 0 ? round(signalEquity / holdEquity) : 1,
    totalEdge: Math.round(signalEquity - holdEquity),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeSignals, backtest, REGIMES };
}
