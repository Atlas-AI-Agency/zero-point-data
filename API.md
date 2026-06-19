# Zero Point Data — REST + WebSocket Signal API (v1)

A documented, zero-dependency API for the Zero Point Data risk engine. It exposes
the current BTC risk regime, score, allocation, and per-factor drivers over plain
HTTP, plus a live WebSocket stream — all implemented with the Node standard
library only (no third-party packages).

> **Disclaimer:** Informational only. Not financial advice.

- **Base URL:** `http://localhost:4317` (set `PORT` to change)
- **Format:** JSON
- **Model version:** `1.0.0`

---

## Authentication

Send your key in the `X-API-Key` request header.

Keys are configured server-side via the `API_KEYS` environment variable
(comma-separated):

```bash
API_KEYS="key_alpha,key_beta" PORT=4317 node server.js
```

- If `API_KEYS` is **set**, every request must present a matching `X-API-Key`,
  otherwise the server responds `401 Unauthorized`.
- If `API_KEYS` is **unset**, the API runs in **open** mode (no key required) and
  every response includes `"auth":"open"` so clients can tell.

### Rate limiting

Each key (or the shared `open` identity) is limited to **60 requests per minute**.
Responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers. On
exceed, the server responds `429 Too Many Requests` with a `Retry-After` header.

---

## REST endpoints

### `GET /api/v1/signal/latest`

The headline read: current regime, risk score, allocation, factor breakdown,
confidence, and timestamp.

```bash
curl -s http://localhost:4317/api/v1/signal/latest \
  -H "X-API-Key: key_alpha"
```

```json
{
  "timestamp": "2026-06-19T00:00:00.000Z",
  "regime": { "key": "mild_on", "label": "Mild On", "tag": "Accumulation" },
  "riskScore": 18.4,
  "allocation": { "btc": 75, "cash": 25 },
  "factors": { "momentum": 22.1, "trend": 14.0, "flow": 9.3, "volatility": -4.2 },
  "confidence": 0.41,
  "daysInRegime": 6,
  "model_version": "1.0.0",
  "dataSource": "coingecko",
  "auth": "key",
  "disclaimer": "Informational only. Not financial advice."
}
```

`confidence` is a transparent proxy in `[0,1]` combining absolute score strength
with how long the current regime has persisted.

### `GET /api/v1/signal/history?days=N`

Recent daily history. `days` defaults to `30` and is capped at `365`.

```bash
curl -s "http://localhost:4317/api/v1/signal/history?days=7" \
  -H "X-API-Key: key_alpha"
```

```json
{
  "days": 7,
  "history": [
    { "date": "2026-06-13", "score": 12.5, "regime": "mild_on", "btcAllocation": 75 },
    { "date": "2026-06-14", "score": 9.8,  "regime": "mild_on", "btcAllocation": 75 }
  ],
  "model_version": "1.0.0",
  "disclaimer": "Informational only. Not financial advice."
}
```

### `GET /api/v1/regimes`

The four regime definitions used by the engine.

```bash
curl -s http://localhost:4317/api/v1/regimes \
  -H "X-API-Key: key_alpha"
```

```json
{
  "regimes": [
    { "key": "strong_off", "label": "Strong Off", "tag": "Capitulation", "scoreRange": { "min": -100, "max": -50 }, "btcAllocation": 0 },
    { "key": "mild_off",   "label": "Mild Off",   "tag": "Caution",      "scoreRange": { "min": -50,  "max": 0   }, "btcAllocation": 35 },
    { "key": "mild_on",    "label": "Mild On",    "tag": "Accumulation", "scoreRange": { "min": 0,    "max": 50  }, "btcAllocation": 75 },
    { "key": "strong_on",  "label": "Strong On",  "tag": "Euphoria",     "scoreRange": { "min": 50,   "max": 100 }, "btcAllocation": 100 }
  ],
  "disclaimer": "Informational only. Not financial advice."
}
```

### `GET /api/v1/health`

Liveness probe and active data source.

```bash
curl -s http://localhost:4317/api/v1/health -H "X-API-Key: key_alpha"
```

```json
{ "status": "ok", "version": "1.0.0", "dataSource": "coingecko", "auth": "key" }
```

---

## WebSocket stream — `/api/v1/stream`

A live push channel implementing the RFC6455 handshake with the Node standard
library only. On connect the server sends a `welcome` frame followed by the
current `signal`, then pushes an updated `signal` every **30 seconds**.

Message envelope (server → client, JSON text frames):

```json
{ "type": "welcome", "message": "Zero Point Data signal stream", "model_version": "1.0.0", "disclaimer": "Informational only. Not financial advice." }
{ "type": "signal",  "data": { /* same shape as GET /api/v1/signal/latest */ } }
```

Authentication for the stream: send `X-API-Key` as a header, or — for browser
`WebSocket` clients that cannot set custom headers — append `?api_key=...` to the
URL. Both are subject to the same rate limit.

### Browser

```js
const ws = new WebSocket("ws://localhost:4317/api/v1/stream?api_key=key_alpha");
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "signal") {
    console.log("regime:", msg.data.regime.label, "score:", msg.data.riskScore);
  }
};
```

### Node (stdlib only — no `ws` package)

```js
const http = require("http");
const crypto = require("crypto");

const key = crypto.randomBytes(16).toString("base64");
const req = http.request("http://localhost:4317/api/v1/stream", {
  headers: {
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": key,
    "X-API-Key": "key_alpha",
  },
});
req.on("upgrade", (res, socket) => {
  socket.on("data", (buf) => {
    // minimal unmasked text-frame reader for the demo
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
    console.log(buf.slice(off, off + len).toString("utf8"));
  });
});
req.end();
```

### Handshake (low level)

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:4317/api/v1/stream
```

Expected: `HTTP/1.1 101 Switching Protocols` with a `Sec-WebSocket-Accept`
header derived from your `Sec-WebSocket-Key`.

---

## Errors

| Status | Meaning |
| ------ | ------- |
| `401`  | Missing/invalid `X-API-Key` (only when `API_KEYS` is set) |
| `404`  | Unknown `/api/v1/*` endpoint (response lists valid endpoints) |
| `429`  | Rate limit exceeded — see `Retry-After` |
| `502`  | Upstream signal temporarily unavailable |

Every error body includes the `disclaimer` field.

---

**Informational only. Not financial advice.** Zero Point Data signals are a
research tool and do not constitute an offer, solicitation, or recommendation to
buy or sell any asset.
