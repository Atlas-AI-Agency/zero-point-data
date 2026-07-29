1|# Zero Point Data — REST + WebSocket Signal API (v1)
2|
3|A documented, zero-dependency API for the Zero Point Data risk engine. It exposes
4|the current BTC risk regime, score, allocation, and per-factor drivers over plain
5|HTTP, plus a live WebSocket stream — all implemented with the Node standard
6|library only (no third-party packages).
7|
8|> **Disclaimer:** Informational only. Not financial advice.
9|
10|- **Base URL:** `http://localhost:4317` (set `PORT` to change)
11|- **Format:** JSON
12|- **Model version:** `1.0.0`
13|
14|---
15|
16|## Authentication
17|
18|Send your key in the `X-API-Key` request header.
19|
20|Keys are configured server-side via the `API_KEYS` environment variable
21|(comma-separated):
22|
23|```bash
24|API_KEYS="key_alpha,key_beta" PORT=4317 node server.js
25|```
26|
27|- If `API_KEYS` is **set**, every request must present a matching `X-API-Key`,
28| otherwise the server responds `401 Unauthorized`.
29|- If `API_KEYS` is **unset**, the API runs in **open** mode (no key required) and
30| every response includes `"auth":"open"` so clients can tell.
31|
32|### Rate limiting
33|
34|Each key (or the shared `open` identity) is limited to **60 requests per minute**.
35|Responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers. On
36|exceed, the server responds `429 Too Many Requests` with a `Retry-After` header.
37|
38|---
39|
40|## REST endpoints
41|
42|### `GET /api/v1/signal/latest`
43|
44|The headline read: current regime, risk score, allocation, factor breakdown,
45|confidence, and timestamp.
46|
47|```bash
48|curl -s http://localhost:4317/api/v1/signal/latest \
49| -H "X-API-Key: ***
50|```
51|
52|```json
53|{
54| "timestamp": "2026-06-19T00:00:00.000Z",
55| "regime": { "key": "mild_on", "label": "Mild On", "tag": "Accumulation" },
56| "riskScore": 18.4,
57| "allocation": { "btc": 75, "cash": 25 },
58| "factors": { "momentum": 22.1, "trend": 14.0, "flow": 9.3, "volatility": -4.2 },
59| "confidence": 0.41,
60| "daysInRegime": 6,
61| "model_version": "1.0.0",
62| "dataSource": "coingecko",
63| "auth": "key",
64| "disclaimer": "Informational only. Not financial advice." 
65|}
66|```
67|
68|`confidence` is computed as:
69|1. **Strength**: `min(1, abs(riskScore) / 100)`
   - Scales `riskScore` (range -100 to 100) to [0,1] by absolute value.
2. **Persistence**: `min(1, daysInRegime / 21)`
   - Scales `daysInRegime` (default 1 if missing) to [0,1] over the S&P 21-day mean streak benchmark.

Final confidence: `round(0.6 * strength + 0.4 * persistence, 2)`

**Interpretation boundary:** This is a stability/strength transparency proxy only — not a calibrated probability of being correct, historical win-rate, or HMM/factor-agreement membership. The UI may display as a percentage, but this does **not** imply probability space semantics.

71|### `GET /api/v1/signal/history?days=N`
72|
73|Recent daily history. `days` defaults to `30` and is capped at `365`.
74|
75|```bash
76|curl -s "http://localhost:4317/api/v1/signal/history?days=7" \
77| -H "X-API-Key: ***
78|```
79|
80|```json
81|{
82| "days": 7,
83| "history": [
84| { "date": "2026-06-13", "score": 12.5, "regime": "mild_on", "btcAllocation": 75 },
85| { "date": "2026-06-14", "score": 9.8, "regime": "mild_on", "btcAllocation": 75 }
86| ],
87| "model_version": "1.0.0",
88| "disclaimer": "Informational only. Not financial advice." 
89|}
90|```
91|
92|### `GET /api/v1/regimes`
93|
94|The four regime definitions used by the engine.
95|
96|```bash
97|curl -s http://localhost:4317/api/v1/regimes \
98| -H "X-API-Key: ***
99|```
100|
101|```json
102|{
103| "regimes": [
104| { "key": "strong_off", "label": "Strong Off", "tag": "Capitulation", "scoreRange": { "min": -100, "max": -50 }, "btcAllocation": 0 },
105| { "key": "mild_off", "label": "Mild Off", "tag": "Caution", "scoreRange": { "min": -50, "max": 0 }, "btcAllocation": 35 },
106| { "key": "mild_on", "label": "Mild On", "tag": "Accumulation", "scoreRange": { "min": 0, "max": 50 }, "btcAllocation": 75 },
107| { "key": "strong_on", "label": "Strong On", "tag": "Euphoria", "scoreRange": { "min": 50, "max": 100 }, "btcAllocation": 100 }
108| ],
109| "disclaimer": "Informational only. Not financial advice." 
110|}
111|```
112|
113|### `GET /api/v1/health`
114|
115|Liveness probe and active data source.
116|
117|```bash
118|curl -s http://localhost:4317/api/v1/health -H "X-API-Key: ***"
119|```
120|
121|```json
122|{ "status": "ok", "version": "1.0.0", "dataSource": "coingecko", "auth": "key" }
123|```
124|
125|---
126|
127|## WebSocket stream — `/api/v1/stream`
128|
129|A live push channel implementing the RFC6455 handshake with the Node standard
130|library only. On connect the server sends a `welcome` frame followed by the
131|current `signal`, then pushes an updated `signal` every **30 seconds**.
132|
133|Message envelope (server → client, JSON text frames):
134|
135|```json
136|{ "type": "welcome", "message": "Zero Point Data signal stream", "model_version": "1.0.0", "disclaimer": "Informational only. Not financial advice." }
137|{ "type": "signal", "data": { /* same shape as GET /api/v1/signal/latest */ } }
138|```
139|
140|Authentication for the stream: send `X-API-Key` as a header, or — for browser
141|`WebSocket` clients that cannot set custom headers — append `?api_key=...` to the
142|URL. Both are subject to the same rate limit.
143|
144|### Browser
145|
146|```js
147|const ws = new WebSocket("ws://localhost:4317/api/v1/stream?api_key=key_alpha");
148|ws.onmessage = (e) => {
149| const msg = JSON.parse(e.data);
150| if (msg.type === "signal") {
151| console.log("regime:", msg.data.regime.label, "score:", msg.data.riskScore);
152| }
153|};
154|```
155|
156|### Node (stdlib only — no `ws` package)
157|
158|```js
159|const http = require("http");
160|const crypto = require("crypto");
161|const key = crypto.randomBytes(16).toString("base64");
162|const req = http.request("http://localhost:4317/api/v1/stream", {
163| headers: {
164| Connection: "Upgrade",
165| Upgrade: "websocket",
166| "Sec-WebSocket-Version": "13",
167| "Sec-WebSocket-Key": key,
168| "X-API-Key": "key_alpha",
169| },
170|});
171|req.on("upgrade", (res, socket) => {
172| socket.on("data", (buf) => {
173| // minimal unmasked text-frame reader for the demo
174| let len = buf[1] & 0x7f, off = 2;
175| if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
176| console.log(buf.slice(off, off + len).toString("utf8"));
177| });
178|});
179|req.end();
180|```
181|
182|### Handshake (low level)
183|
184|```bash
185|curl -i -N \
186| -H "Connection: Upgrade" \
187| -H "Upgrade: websocket" \
188| -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
189| -H "Sec-WebSocket-Version: 13" \
190| http://localhost:4317/api/v1/stream
191|```
192|
193|Expected: `HTTP/1.1 101 Switching Protocols` with a `Sec-WebSocket-Accept`
194|header derived from your `Sec-WebSocket-Key`.
195|
196|---
197|
198|## Errors
199|
200|| Status | Meaning |
201|| ------ | ------- |
202|| `401` | Missing/invalid `X-API-Key` (only when `API_KEYS` is set) |
203|| `404` | Unknown `/api/v1/*` endpoint (response lists valid endpoints) |
204|| `429` | Rate limit exceeded — see `Retry-After` |
205|| `502` | Upstream signal temporarily unavailable |
206|
207|Every error body includes the `disclaimer` field.
208|
209|---
210|
211|**Informational only. Not financial advice.** Zero Point Data signals are a
212|research tool and do not constitute an offer, solicitation, or recommendation to
213|buy or sell any asset.
214|