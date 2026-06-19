// ============================================================================
// Zero Point Data — REST + WebSocket Signal API (v1)
// ----------------------------------------------------------------------------
// A documented, zero-dependency API surface for the Zero Point Data risk
// engine. Node stdlib only (http + crypto) — no `ws`, no npm packages.
//
//   REST   GET /api/v1/signal/latest       current regime / score / allocation
//          GET /api/v1/signal/history?days  recent daily scores
//          GET /api/v1/regimes              the four regime definitions
//          GET /api/v1/health               liveness + data source
//   WS         /api/v1/stream               live signal push (RFC6455)
//
// Auth: X-API-Key checked against env API_KEYS (comma-separated). When unset,
// the API runs open and advertises "auth":"open" in responses.
//
// Informational only. Not financial advice.
// ============================================================================

const crypto = require('crypto');

const MODEL_VERSION = '1.0.0';
const DISCLAIMER = 'Informational only. Not financial advice.';

// ---- auth + rate limiting --------------------------------------------------

function configuredKeys() {
  const raw = process.env.API_KEYS;
  if (!raw) return null; // null => open mode
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// in-memory sliding-window-ish counter: 60 requests / minute / key.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const buckets = new Map(); // key -> { count, resetAt }

function rateCheck(identity) {
  const now = Date.now();
  let b = buckets.get(identity);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(identity, b);
  }
  b.count += 1;
  const remaining = Math.max(0, RATE_LIMIT - b.count);
  return {
    ok: b.count <= RATE_LIMIT,
    remaining,
    limit: RATE_LIMIT,
    resetAt: b.resetAt,
    retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

// Returns { ok, authMode, identity } or { ok:false, status, body } on reject.
function authorize(req) {
  const keys = configuredKeys();
  const presented = req.headers['x-api-key'];

  if (keys === null) {
    return { ok: true, authMode: 'open', identity: 'open' };
  }
  if (!presented || !keys.includes(presented)) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Unauthorized', detail: 'Provide a valid X-API-Key header.', disclaimer: DISCLAIMER },
    };
  }
  return { ok: true, authMode: 'key', identity: presented };
}

// ---- response helpers ------------------------------------------------------

function sendJSON(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }, extraHeaders || {}));
  res.end(body);
}

// ---- signal shaping --------------------------------------------------------
// Project the engine payload into the stable public v1 contract. `getSignal`
// is the same accessor the rest of the server uses (live data + fallback).

function latestPayload(signal, authMode) {
  const l = signal.latest;
  return {
    timestamp: signal.generatedAt,
    regime: {
      key: l.regime,
      label: l.regimeLabel,
      tag: l.regimeTag,
    },
    riskScore: l.score,
    allocation: {
      btc: l.btcAllocation,
      cash: l.cashAllocation,
    },
    factors: l.factors,
    confidence: confidenceFor(l),
    daysInRegime: l.daysInRegime,
    model_version: MODEL_VERSION,
    dataSource: signal.source,
    auth: authMode,
    disclaimer: DISCLAIMER,
  };
}

// A transparent confidence proxy in [0,1]: stronger absolute score and a longer
// run inside the current regime => higher confidence. No black box.
function confidenceFor(l) {
  const strength = Math.min(1, Math.abs(l.score) / 100);
  const persistence = Math.min(1, (l.daysInRegime || 1) / 21);
  return Math.round((0.6 * strength + 0.4 * persistence) * 100) / 100;
}

function historyPayload(signal, days) {
  const series = signal.series || [];
  const slice = days > 0 ? series.slice(-days) : series;
  return slice.map(s => ({
    date: new Date(s.t * 1000).toISOString().slice(0, 10),
    score: s.score,
    regime: s.regime,
    btcAllocation: allocFor(signal, s.regime),
  }));
}

// Map a regime key to its BTC allocation using the regime definitions, so the
// slim history series doesn't need to carry allocation per point.
function allocFor(signal, regimeKey) {
  const r = (signal.regimes || []).find(x => x.key === regimeKey);
  return r ? r.btc : null;
}

// ---- REST dispatch ---------------------------------------------------------
// `getSignal` is injected from server.js so we reuse its cache + fallback.

function createHandler(getSignal) {
  return async function handle(req, res, url) {
    const auth = authorize(req);
    if (!auth.ok) {
      sendJSON(res, auth.status, auth.body);
      return true;
    }

    const rl = rateCheck(auth.identity);
    const rlHeaders = {
      'X-RateLimit-Limit': String(rl.limit),
      'X-RateLimit-Remaining': String(rl.remaining),
    };
    if (!rl.ok) {
      sendJSON(res, 429, {
        error: 'Too Many Requests',
        detail: `Rate limit of ${rl.limit} requests/minute exceeded.`,
        retryAfter: rl.retryAfter,
        disclaimer: DISCLAIMER,
      }, Object.assign({ 'Retry-After': String(rl.retryAfter) }, rlHeaders));
      return true;
    }

    const p = url.pathname;

    // GET /api/v1/health — liveness + data-feed freshness (operator-facing).
    if (p === '/api/v1/health') {
      let dataSource = 'unknown', freshness = 'unknown', live = null, stale = null;
      let dataAgeHours = null, dataAsOf = null, dataNote = null;
      try {
        const s = await getSignal();
        dataSource = s.source; freshness = s.freshness; live = s.live; stale = s.stale;
        dataAgeHours = s.dataAgeHours; dataAsOf = s.dataAsOf; dataNote = s.dataNote;
      } catch (e) {}
      // status reflects data health: degraded if serving stale/synthetic data.
      const healthy = freshness === 'fresh' && dataSource !== 'synthetic';
      sendJSON(res, 200, {
        status: healthy ? 'ok' : 'degraded',
        version: MODEL_VERSION,
        dataSource,
        dataFreshness: freshness,
        dataLive: live,
        dataStale: stale,
        dataAgeHours,
        dataAsOf,
        dataNote,
        auth: auth.authMode,
      }, rlHeaders);
      return true;
    }

    // GET /api/v1/regimes — the four regime definitions.
    if (p === '/api/v1/regimes') {
      try {
        const signal = await getSignal();
        sendJSON(res, 200, {
          regimes: (signal.regimes || []).map(r => ({
            key: r.key,
            label: r.label,
            tag: r.tag,
            scoreRange: { min: r.min, max: r.max },
            btcAllocation: r.btc,
          })),
          disclaimer: DISCLAIMER,
        }, rlHeaders);
      } catch (e) {
        sendJSON(res, 502, { error: 'Upstream signal unavailable', detail: String(e.message || e) }, rlHeaders);
      }
      return true;
    }

    // GET /api/v1/signal/latest — the headline read.
    if (p === '/api/v1/signal/latest') {
      try {
        const signal = await getSignal();
        sendJSON(res, 200, latestPayload(signal, auth.authMode), rlHeaders);
      } catch (e) {
        sendJSON(res, 502, { error: 'Upstream signal unavailable', detail: String(e.message || e) }, rlHeaders);
      }
      return true;
    }

    // GET /api/v1/signal/history?days=N
    if (p === '/api/v1/signal/history') {
      let days = parseInt(url.searchParams.get('days'), 10);
      if (!Number.isFinite(days) || days <= 0) days = 30;
      days = Math.min(days, 365);
      try {
        const signal = await getSignal();
        sendJSON(res, 200, {
          days,
          history: historyPayload(signal, days),
          model_version: MODEL_VERSION,
          disclaimer: DISCLAIMER,
        }, rlHeaders);
      } catch (e) {
        sendJSON(res, 502, { error: 'Upstream signal unavailable', detail: String(e.message || e) }, rlHeaders);
      }
      return true;
    }

    // Unknown /api/v1/* route.
    sendJSON(res, 404, {
      error: 'Not Found',
      detail: `No such endpoint: ${p}`,
      endpoints: [
        'GET /api/v1/signal/latest',
        'GET /api/v1/signal/history?days=N',
        'GET /api/v1/regimes',
        'GET /api/v1/health',
        'WS  /api/v1/stream',
      ],
      disclaimer: DISCLAIMER,
    }, rlHeaders);
    return true;
  };
}

// ---- WebSocket (RFC6455) ---------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const STREAM_INTERVAL_MS = 30 * 1000;

function acceptKey(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(secWebSocketKey + WS_GUID)
    .digest('base64');
}

// Encode a single server->client text frame (no masking, FIN=1, opcode=0x1).
function encodeTextFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    // high 32 bits stay zero; write length into the low 32 bits.
    header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}

// Encode a close frame (opcode 0x8) with an optional status code.
function encodeCloseFrame(code = 1000) {
  const body = Buffer.alloc(2);
  body.writeUInt16BE(code, 0);
  return Buffer.concat([Buffer.from([0x88, body.length]), body]);
}

// Handle an HTTP upgrade for /api/v1/stream. Validates the handshake, performs
// auth + rate limiting, then streams the current signal on connect and every
// 30s thereafter. Inbound client frames are parsed only enough to honour close.
function handleUpgrade(getSignal, req, socket) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/api/v1/stream') {
    socket.destroy();
    return false;
  }

  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (req.headers.upgrade !== 'websocket' || !key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return false;
  }

  // Auth: header X-API-Key, or ?api_key= for browser WebSocket clients that
  // cannot set custom headers.
  const keys = configuredKeys();
  if (keys !== null) {
    const presented = req.headers['x-api-key'] || url.searchParams.get('api_key');
    if (!presented || !keys.includes(presented)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return false;
    }
  }

  const identity = keys === null ? 'open' : (req.headers['x-api-key'] || url.searchParams.get('api_key'));
  const rl = rateCheck(identity);
  if (!rl.ok) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return false;
  }

  // Complete the RFC6455 opening handshake.
  const accept = acceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );

  let alive = true;
  let timer = null;

  const send = obj => {
    if (!alive) return;
    try { socket.write(encodeTextFrame(JSON.stringify(obj))); } catch (e) { cleanup(); }
  };

  const cleanup = () => {
    if (!alive) return;
    alive = false;
    if (timer) clearInterval(timer);
    try { socket.end(); } catch (e) {}
  };

  const pushSignal = async () => {
    try {
      const signal = await getSignal();
      send({ type: 'signal', data: latestPayload(signal, keys === null ? 'open' : 'key') });
    } catch (e) {
      send({ type: 'error', error: 'signal unavailable', disclaimer: DISCLAIMER });
    }
  };

  // Greet, then push on an interval.
  send({ type: 'welcome', message: 'Zero Point Data signal stream', model_version: MODEL_VERSION, disclaimer: DISCLAIMER });
  pushSignal();
  timer = setInterval(pushSignal, STREAM_INTERVAL_MS);

  // Inbound frames: we only inspect opcodes to honour a client close; all other
  // (masked) client data is safely ignored.
  socket.on('data', buf => {
    if (!alive || !buf.length) return;
    const opcode = buf[0] & 0x0f;
    if (opcode === 0x8) { // close
      try { socket.write(encodeCloseFrame(1000)); } catch (e) {}
      cleanup();
    }
    // opcode 0x9 (ping) / 0xA (pong) / 0x1 (text) from client are ignored.
  });

  socket.on('close', cleanup);
  socket.on('error', cleanup);
  socket.on('end', cleanup);

  return true;
}

module.exports = {
  createHandler,
  handleUpgrade,
  MODEL_VERSION,
  DISCLAIMER,
  // exported for tests / introspection
  acceptKey,
  encodeTextFrame,
};
