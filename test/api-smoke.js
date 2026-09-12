'use strict';

const assert = require('assert');
const { createHandler, DISCLAIMER, MODEL_VERSION } = require('../src/api');

const signal = {
  generatedAt: '2026-06-19T00:00:00.000Z',
  source: 'in-memory-fixture',
  freshness: 'fresh',
  live: false,
  stale: false,
  dataAgeHours: 0,
  dataAsOf: '2026-06-19T00:00:00.000Z',
  dataNote: 'Fixed in-memory smoke fixture.',
  latest: {
    regime: 'mild_on',
    regimeLabel: 'Mild On',
    regimeTag: 'Accumulation',
    score: 18.4,
    btcAllocation: 75,
    cashAllocation: 25,
    factors: {
      momentum: 22.1,
      trend: 14,
      flow: 9.3,
      volatility: -4.2,
    },
    daysInRegime: 6,
  },
  regimes: [
    { key: 'strong_off', label: 'Strong Off', tag: 'Capitulation', min: -100, max: -50, btc: 0 },
    { key: 'mild_off', label: 'Mild Off', tag: 'Caution', min: -50, max: 0, btc: 35 },
    { key: 'mild_on', label: 'Mild On', tag: 'Accumulation', min: 0, max: 50, btc: 75 },
    { key: 'strong_on', label: 'Strong On', tag: 'Euphoria', min: 50, max: 100, btc: 100 },
  ],
  series: [
    { t: Date.UTC(2026, 5, 17) / 1000, score: -25, regime: 'mild_off' },
    { t: Date.UTC(2026, 5, 18) / 1000, score: 12.5, regime: 'mild_on' },
    { t: Date.UTC(2026, 5, 19) / 1000, score: 18.4, regime: 'mild_on' },
  ],
};

const getSignal = async () => signal;
const handler = createHandler(getSignal);

async function request(pathname) {
  let status;
  let headers;
  let rawBody;
  const req = { headers: {} };
  const res = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(body) {
      rawBody = body;
    },
  };

  const handled = await handler(req, res, new URL(pathname, 'http://local.test'));
  assert.strictEqual(handled, true);
  assert.strictEqual(headers['Content-Type'], 'application/json; charset=utf-8');
  return { status, body: JSON.parse(rawBody) };
}

async function main() {
  const health = await request('/api/v1/health');
  assert.strictEqual(health.status, 200);
  assert.deepStrictEqual(health.body, {
    status: 'ok',
    version: MODEL_VERSION,
    dataSource: 'in-memory-fixture',
    dataFreshness: 'fresh',
    dataLive: false,
    dataStale: false,
    dataAgeHours: 0,
    dataAsOf: '2026-06-19T00:00:00.000Z',
    dataNote: 'Fixed in-memory smoke fixture.',
    auth: 'open',
  });

  const regimes = await request('/api/v1/regimes');
  assert.strictEqual(regimes.status, 200);
  assert.deepStrictEqual(regimes.body, {
    regimes: [
      { key: 'strong_off', label: 'Strong Off', tag: 'Capitulation', scoreRange: { min: -100, max: -50 }, btcAllocation: 0 },
      { key: 'mild_off', label: 'Mild Off', tag: 'Caution', scoreRange: { min: -50, max: 0 }, btcAllocation: 35 },
      { key: 'mild_on', label: 'Mild On', tag: 'Accumulation', scoreRange: { min: 0, max: 50 }, btcAllocation: 75 },
      { key: 'strong_on', label: 'Strong On', tag: 'Euphoria', scoreRange: { min: 50, max: 100 }, btcAllocation: 100 },
    ],
    disclaimer: DISCLAIMER,
  });

  const latest = await request('/api/v1/signal/latest');
  assert.strictEqual(latest.status, 200);
  assert.deepStrictEqual(latest.body, {
    timestamp: '2026-06-19T00:00:00.000Z',
    regime: { key: 'mild_on', label: 'Mild On', tag: 'Accumulation' },
    riskScore: 18.4,
    allocation: { btc: 75, cash: 25 },
    factors: { momentum: 22.1, trend: 14, flow: 9.3, volatility: -4.2 },
    confidence: 0.22,
    daysInRegime: 6,
    model_version: MODEL_VERSION,
    dataSource: 'in-memory-fixture',
    auth: 'open',
    disclaimer: DISCLAIMER,
  });

  const history = await request('/api/v1/signal/history?days=2');
  assert.strictEqual(history.status, 200);
  assert.deepStrictEqual(history.body, {
    days: 2,
    history: [
      { date: '2026-06-18', score: 12.5, regime: 'mild_on', btcAllocation: 75 },
      { date: '2026-06-19', score: 18.4, regime: 'mild_on', btcAllocation: 75 },
    ],
    model_version: MODEL_VERSION,
    disclaimer: DISCLAIMER,
  });

  process.stdout.write('API smoke passed: health, regimes, latest, history\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
