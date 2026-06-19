// ============================================================================
// Zero Point Data — Sample Report
// ----------------------------------------------------------------------------
// Email-gated lead capture + a sample report generated honestly from the live
// signal engine. Every number in the report is derived from real engine output;
// none are invented. Three sections mirror the real product report:
//   1. Daily Update          — current allocation, active signal, Risk Index
//   2. Multi-Horizon Analysis — long/mid/short-term context from factors + trend
//   3. Flash Updates         — recent regime inflection points with dates
// ============================================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

// Basic, pragmatic email validation (no external deps).
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function fmtDate(unixSecs) {
  return new Date(unixSecs * 1000).toISOString().slice(0, 10);
}

function signed(n) {
  return (n > 0 ? '+' : '') + n;
}

// --- section builders -------------------------------------------------------

function buildDailyUpdate(latest) {
  const riskOn = latest.score >= 0;
  const signal = riskOn ? 'Risk-On' : 'Risk-Off';
  return {
    title: 'Daily Update',
    regime: latest.regimeLabel,
    regimeTag: latest.regimeTag,
    signal,
    riskIndex: latest.score,
    btcAllocation: latest.btcAllocation,
    cashAllocation: latest.cashAllocation,
    daysInRegime: latest.daysInRegime,
    summary:
      `The active regime is ${latest.regimeLabel} (${latest.regimeTag}), held for ` +
      `${latest.daysInRegime} day${latest.daysInRegime === 1 ? '' : 's'}. The Risk Index reads ` +
      `${signed(latest.score)}, a ${signal} signal. The current allocation stance is ` +
      `${latest.btcAllocation}% BTC / ${latest.cashAllocation}% cash.`,
  };
}

function buildMultiHorizon(series, latest) {
  const f = latest.factors;

  // Long-term context: 200d trend structure + overall span direction.
  const first = series[0];
  const lastClose = latest.close;
  const longChangePct = first.close ? ((lastClose - first.close) / first.close) * 100 : 0;
  const longTone = f.trend >= 0 ? 'constructive' : 'deteriorating';
  const longTerm =
    `Over the full window the structural trend reads ${longTone} ` +
    `(trend factor ${signed(f.trend)}). Price has moved ` +
    `${longChangePct >= 0 ? '+' : ''}${Math.round(longChangePct)}% across the series, ` +
    `framing the broader risk backdrop.`;

  // Mid-term context: momentum + capital flow over a ~30d look-back.
  const midWindow = series.slice(-30);
  const midFirst = midWindow[0];
  const midChangePct = midFirst.close ? ((lastClose - midFirst.close) / midFirst.close) * 100 : 0;
  const midTerm =
    `Across roughly the last 30 days momentum reads ${signed(f.momentum)} and capital flow ` +
    `${signed(f.flow)}, with price ${midChangePct >= 0 ? 'up' : 'down'} ` +
    `${Math.abs(Math.round(midChangePct))}% over the span. ` +
    `${f.momentum >= 0 && f.flow >= 0
      ? 'Momentum and flow are aligned to the upside.'
      : f.momentum < 0 && f.flow < 0
        ? 'Momentum and flow are aligned to the downside.'
        : 'Momentum and flow are diverging — a sign to watch for confirmation.'}`;

  // Short-term context: volatility regime + last-week price action.
  const shortWindow = series.slice(-7);
  const shortFirst = shortWindow[0];
  const shortChangePct = shortFirst.close ? ((lastClose - shortFirst.close) / shortFirst.close) * 100 : 0;
  const volTone = f.volatility >= 0 ? 'supportive (subdued)' : 'elevated (a headwind)';
  const shortTerm =
    `In the last 7 days price is ${shortChangePct >= 0 ? 'up' : 'down'} ` +
    `${Math.abs(Math.round(shortChangePct * 10) / 10)}% and the volatility factor reads ` +
    `${signed(f.volatility)} — ${volTone}.`;

  return {
    title: 'Multi-Horizon Analysis',
    factors: f,
    longTerm,
    midTerm,
    shortTerm,
  };
}

function buildFlashUpdates(series, max = 5) {
  const flashes = [];
  for (let i = series.length - 1; i >= 1 && flashes.length < max; i--) {
    const s = series[i];
    if (!s.inflection) continue;
    flashes.push({
      date: fmtDate(s.t),
      from: s.prevRegime,
      to: s.regime,
      regimeLabel: s.regimeLabel,
      riskIndex: s.score,
      note:
        `Regime shifted to ${s.regimeLabel} (Risk Index ${signed(s.score)}). ` +
        `The inflection is the signal.`,
    });
  }
  return {
    title: 'Flash Updates',
    intro: flashes.length
      ? 'Recent regime inflection points detected by the engine.'
      : 'No regime inflections in the recent window — the read has been stable.',
    events: flashes,
  };
}

function buildReport(signal) {
  const { latest, series, source, generatedAt } = signal;
  return {
    brand: 'Zero Point Data',
    kind: 'Sample Report',
    generatedAt: generatedAt || new Date().toISOString(),
    dataSource: source === 'coingecko' ? 'live BTC/USD' : 'synthetic demo series',
    disclaimer:
      'Sample report for informational purposes only. Not financial advice. ' +
      'Signals are model outputs that may be wrong; past performance does not guarantee future results.',
    sections: {
      dailyUpdate: buildDailyUpdate(latest),
      multiHorizon: buildMultiHorizon(series, latest),
      flashUpdates: buildFlashUpdates(series),
    },
  };
}

// --- lead persistence -------------------------------------------------------

function appendLead(lead) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) { /* dir may already exist */ }

  let leads = [];
  try {
    const raw = fs.readFileSync(LEADS_FILE, 'utf8');
    leads = JSON.parse(raw);
    if (!Array.isArray(leads)) leads = [];
  } catch (e) { /* no file yet */ }

  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2) + '\n');
}

// --- request handler --------------------------------------------------------
// `getSignal` is injected by the server so we reuse its cache + fallback logic
// without duplicating the data-fetch path or breaking existing routes.

function createSampleReportHandler(getSignal) {
  return function handle(req, res) {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
        return;
      }

      const firstName = (payload.firstName || '').toString().trim();
      const lastName = (payload.lastName || '').toString().trim();
      const email = (payload.email || '').toString().trim();

      if (!firstName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'First name is required.' }));
        return;
      }
      if (!isValidEmail(email)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A valid email is required.' }));
        return;
      }

      try {
        const signal = await getSignal();
        const report = buildReport(signal);

        appendLead({
          firstName,
          lastName,
          email: email.toLowerCase(),
          capturedAt: new Date().toISOString(),
          regimeAtCapture: signal.latest.regime,
          riskIndexAtCapture: signal.latest.score,
        });

        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ report }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
  };
}

module.exports = { createSampleReportHandler, buildReport, isValidEmail, LEADS_FILE };
