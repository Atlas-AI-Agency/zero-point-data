/* Zero Point Data — Dashboard HISTORY module
 * Self-contained sibling module. Registers on window.ZPD_DASH.history.
 * Contract: window.ZPD_DASH.history = { render(mountEl, ctx) }
 *   ctx = { latest, regimes, getRegimeColor(key)->css, fmtDate(isoOrDate)->string }
 */
(function () {
  'use strict';

  window.ZPD_DASH = window.ZPD_DASH || {};

  var STYLE_ID = 'zpd-history-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.zpd-hist-strip{display:flex;gap:2px;flex-wrap:nowrap;overflow:hidden;border-radius:6px;height:34px;margin:10px 0}',
      '.zpd-hist-strip > span{flex:1 1 0;min-width:2px;border-radius:1px}',
      '.zpd-hist-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted,#8a94a6);margin-top:6px}',
      '.zpd-hist-legend .it{display:inline-flex;align-items:center;gap:6px}',
      '.zpd-hist-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:0 0 auto}',
      '.zpd-hist-canvas-wrap{position:relative;width:100%;margin:10px 0 4px}',
      '.zpd-hist-canvas-wrap canvas{display:block;width:100%;height:160px}',
      '.zpd-hist-tablewrap{max-height:360px;overflow:auto;border:1px solid var(--border,#22293a);border-radius:8px}',
      '.zpd-hist-tablewrap .dash-table{margin:0;width:100%;border-collapse:collapse;font-size:14px}',
      '.zpd-hist-tablewrap .dash-table th,.zpd-hist-tablewrap .dash-table td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--border,#22293a);white-space:nowrap}',
      '.zpd-hist-tablewrap .dash-table thead th{position:sticky;top:0;background:var(--panel,#121723);color:var(--muted,#8a94a6);font-weight:600;z-index:1}',
      '.zpd-hist-tablewrap .dash-table td.num{font-variant-numeric:tabular-nums;text-align:right}',
      '.zpd-hist-regime{display:inline-flex;align-items:center;gap:8px}',
      '.zpd-hist-foot{font-size:11px;color:var(--muted,#8a94a6);margin-top:10px;font-style:italic}',
      '.zpd-hist-msg{color:var(--muted,#8a94a6);padding:16px 0}',
      '.zpd-hist-sec-title{margin:0 0 4px;font-size:13px;color:var(--muted,#8a94a6);text-transform:uppercase;letter-spacing:.04em}'
    ].join('\n');
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  var REGIME_LABELS = {
    strong_off: 'Strong Off',
    mild_off: 'Mild Off',
    mild_on: 'Mild On',
    strong_on: 'Strong On'
  };

  function regimeLabel(key, regimes) {
    if (regimes && regimes.length) {
      for (var i = 0; i < regimes.length; i++) {
        if (regimes[i].key === key) return regimes[i].label || REGIME_LABELS[key] || key;
      }
    }
    return REGIME_LABELS[key] || key || '—';
  }

  // Fallback color if ctx.getRegimeColor is unavailable.
  function fallbackColor(key) {
    switch (key) {
      case 'strong_off': return '#e5484d';
      case 'mild_off': return '#f5a524';
      case 'mild_on': return '#7cc7ff';
      case 'strong_on': return '#2fe6c8';
      default: return '#8a94a6';
    }
  }

  function makeColorFn(ctx) {
    return function (key) {
      if (ctx && typeof ctx.getRegimeColor === 'function') {
        var c = ctx.getRegimeColor(key);
        if (c) return c;
      }
      return fallbackColor(key);
    };
  }

  function makeDateFn(ctx) {
    return function (d) {
      if (ctx && typeof ctx.fmtDate === 'function') {
        try { return ctx.fmtDate(d); } catch (e) { /* fall through */ }
      }
      return String(d);
    };
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildStrip(history, colorFn, dateFn) {
    // Last ~90 days, oldest -> newest left-to-right.
    var rows = history.slice(-90);
    var strip = el('div', 'zpd-hist-strip');
    rows.forEach(function (r) {
      var cell = el('span');
      cell.style.background = colorFn(r.regime);
      cell.title = dateFn(r.date) + ' · ' + regimeLabel(r.regime) + ' · score ' + r.score;
      strip.appendChild(cell);
    });
    return strip;
  }

  function buildLegend(regimes, colorFn) {
    var keys = ['strong_off', 'mild_off', 'mild_on', 'strong_on'];
    var legend = el('div', 'zpd-hist-legend');
    keys.forEach(function (k) {
      var item = el('span', 'it');
      var dot = el('span', 'zpd-hist-dot');
      dot.style.background = colorFn(k);
      item.appendChild(dot);
      item.appendChild(document.createTextNode(regimeLabel(k, regimes)));
      legend.appendChild(item);
    });
    return legend;
  }

  function buildChart(history) {
    var wrap = el('div', 'zpd-hist-canvas-wrap');
    var canvas = document.createElement('canvas');
    wrap.appendChild(canvas);

    function draw() {
      var cssW = wrap.clientWidth || 600;
      var cssH = 160;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';

      var g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cssW, cssH);

      var pad = { l: 34, r: 8, t: 10, b: 16 };
      var plotW = cssW - pad.l - pad.r;
      var plotH = cssH - pad.t - pad.b;
      if (plotW <= 0 || plotH <= 0) return;

      var pts = history.slice(-120);
      var n = pts.length;

      // Fixed score domain -100..100.
      var minV = -100, maxV = 100;
      function x(i) { return pad.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW); }
      function y(v) { return pad.t + (1 - (v - minV) / (maxV - minV)) * plotH; }

      var border = readVar('--border', '#22293a');
      var muted = readVar('--muted', '#8a94a6');
      var accent = readVar('--accent', '#2fe6c8');

      // Gridlines + labels at -100,-50,0,50,100.
      g.lineWidth = 1;
      g.font = '10px system-ui, sans-serif';
      g.textBaseline = 'middle';
      [-100, -50, 0, 50, 100].forEach(function (v) {
        var yy = y(v);
        g.strokeStyle = (v === 0) ? muted : border;
        g.globalAlpha = (v === 0) ? 0.8 : 0.5;
        g.beginPath();
        g.moveTo(pad.l, yy);
        g.lineTo(cssW - pad.r, yy);
        g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = muted;
        g.textAlign = 'right';
        g.fillText(String(v), pad.l - 6, yy);
      });

      if (n === 0) return;

      // Score line.
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.beginPath();
      for (var i = 0; i < n; i++) {
        var px = x(i), py = y(clamp(pts[i].score, minV, maxV));
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();

      // Latest marker.
      if (n) {
        var lx = x(n - 1), ly = y(clamp(pts[n - 1].score, minV, maxV));
        g.fillStyle = accent;
        g.beginPath();
        g.arc(lx, ly, 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Redraw on resize (debounced).
    var raf = null;
    function onResize() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }
    window.addEventListener('resize', onResize);

    // Draw after attach so clientWidth is real.
    wrap._zpdDraw = draw;
    return wrap;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function readVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function buildTable(history, regimes, colorFn, dateFn) {
    var wrap = el('div', 'zpd-hist-tablewrap');
    var table = el('table', 'dash-table');

    var thead = el('thead');
    var htr = el('tr');
    ['Date', 'Risk Score', 'Regime', 'BTC %'].forEach(function (h, idx) {
      var th = el('th', idx === 1 || idx === 3 ? 'num' : null, h);
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el('tbody');
    // Most recent first, ~30 rows.
    var rows = history.slice().reverse().slice(0, 30);
    rows.forEach(function (r) {
      var tr = el('tr');

      tr.appendChild(el('td', null, dateFn(r.date)));

      var scoreTd = el('td', 'num', (r.score > 0 ? '+' : '') + r.score);
      tr.appendChild(scoreTd);

      var regTd = el('td');
      var span = el('span', 'zpd-hist-regime');
      var dot = el('span', 'zpd-hist-dot');
      dot.style.background = colorFn(r.regime);
      span.appendChild(dot);
      span.appendChild(document.createTextNode(regimeLabel(r.regime, regimes)));
      regTd.appendChild(span);
      tr.appendChild(regTd);

      tr.appendChild(el('td', 'num', (r.btcAllocation != null ? r.btcAllocation : 0) + '%'));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function showMessage(mountEl, msg) {
    clear(mountEl);
    var card = el('section', 'dash-card');
    card.appendChild(el('h2', null, 'Signal History'));
    card.appendChild(el('div', 'zpd-hist-msg', msg));
    mountEl.appendChild(card);
  }

  function renderInto(mountEl, history, ctx) {
    var regimes = (ctx && ctx.regimes) || [];
    var colorFn = makeColorFn(ctx);
    var dateFn = makeDateFn(ctx);

    clear(mountEl);

    var card = el('section', 'dash-card');
    card.appendChild(el('h2', null, 'Signal History'));

    if (!history || !history.length) {
      card.appendChild(el('div', 'zpd-hist-msg', 'No signal history available yet.'));
      mountEl.appendChild(card);
      return;
    }

    // Sort oldest -> newest for strip/chart.
    var ordered = history.slice().sort(function (a, b) {
      return String(a.date) < String(b.date) ? -1 : (String(a.date) > String(b.date) ? 1 : 0);
    });

    // 1) Regime strip (last ~90 days).
    card.appendChild(el('p', 'zpd-hist-sec-title', 'Regime · last 90 days'));
    card.appendChild(buildStrip(ordered, colorFn, dateFn));
    card.appendChild(buildLegend(regimes, colorFn));

    // 2) Score line chart.
    card.appendChild(el('p', 'zpd-hist-sec-title', 'Risk score over time'));
    var chart = buildChart(ordered);
    card.appendChild(chart);

    // 3) Signal table (most recent first).
    card.appendChild(el('p', 'zpd-hist-sec-title', 'Recent signals'));
    card.appendChild(buildTable(ordered, regimes, colorFn, dateFn));

    // 4) Footnote.
    card.appendChild(el('div', 'zpd-hist-foot',
      'Zero Point Data — informational only, not financial advice.'));

    mountEl.appendChild(card);

    // Draw chart now that it's attached and has width.
    if (chart && typeof chart._zpdDraw === 'function') {
      requestAnimationFrame(chart._zpdDraw);
    }
  }

  window.ZPD_DASH.history = {
    render: function (mountEl, ctx) {
      if (!mountEl) return;
      injectStyle();

      // Optimistic loading state.
      showMessage(mountEl, 'Loading signal history…');

      fetch('/api/v1/signal/history?days=120', { headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var history = (data && Array.isArray(data.history)) ? data.history : [];
          renderInto(mountEl, history, ctx || {});
        })
        .catch(function () {
          showMessage(mountEl, 'Unable to load signal history right now. Please try again later.');
        });
    }
  };
})();
