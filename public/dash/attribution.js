/* Zero Point Data — Dashboard module: ATTRIBUTION ("Why This Read")
 *
 * Self-contained. Acts only when render() is invoked by the shell.
 * Contract:
 *   window.ZPD_DASH.attribution = { render(mountEl, ctx) }
 *   ctx = { latest?, regimes?, getRegimeColor(key)->cssColor, fmtDate(x)->string }
 *
 * Renders:
 *   1. "Why This Read" heading + plain-English model summary.
 *   2. Diverging factor-attribution bars (momentum/trend/flow/volatility).
 *   3. Allocation rationale (regime -> BTC/cash stance + one-line reasoning).
 *   4. 30-day risk-score sparkline for temporal context.
 *   5. "informational only — not financial advice" footnote.
 */
(function () {
  'use strict';

  window.ZPD_DASH = window.ZPD_DASH || {};

  // ---- helpers ----------------------------------------------------------

  var ACCENT = '#2fe6c8';
  var DANGER = '#ff5a6e';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'style') node.setAttribute('style', attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function fmtSigned(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '--';
    return (n > 0 ? '+' : '') + n.toFixed(1);
  }

  function num(n, d) {
    return (typeof n === 'number' && isFinite(n)) ? n : d;
  }

  async function fetchJSON(url) {
    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  }

  // Fallback regime color if shell does not provide getRegimeColor.
  function defaultRegimeColor(key) {
    switch (key) {
      case 'strong_on': return ACCENT;
      case 'mild_on': return '#7fe8d6';
      case 'mild_off': return '#ffb27a';
      case 'strong_off': return DANGER;
      default: return ACCENT;
    }
  }

  var FACTOR_META = {
    momentum: { label: 'Momentum', blurb: 'price velocity & rate of change' },
    trend: { label: 'Trend', blurb: 'directional structure across timeframes' },
    flow: { label: 'Flow', blurb: 'on-chain & exchange capital movement' },
    volatility: { label: 'Volatility', blurb: 'realized risk / turbulence (inverted)' }
  };
  var FACTOR_ORDER = ['momentum', 'trend', 'flow', 'volatility'];

  // ---- view builders ----------------------------------------------------

  function buildSummary(latest, regimeColor) {
    var regime = latest.regime || {};
    var score = num(latest.riskScore, 0);
    var confPct = Math.round(num(latest.confidence, 0) * 100);
    var days = num(latest.daysInRegime, null);
    var color = regimeColor(regime.key);

    var lean = score > 0 ? 'risk-on' : (score < 0 ? 'risk-off' : 'neutral');

    var sentence =
      'The engine reads a ' + lean + ' market: regime ' +
      (regime.label || '—') + (regime.tag ? ' (' + regime.tag + ')' : '') +
      ', risk score ' + fmtSigned(score) + ' on a −100…+100 scale, ' +
      'at ' + confPct + '% confidence' +
      (days != null ? ', held for ' + days + ' day' + (days === 1 ? '' : 's') + '.' : '.');

    var pill = el('span', {
      class: 'zpd-attr-pill',
      style: 'display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;' +
        'font-weight:600;letter-spacing:.02em;color:#0b0f10;background:' + color + ';'
    }, [regime.label || '—']);

    return el('div', { class: 'zpd-attr-summary' }, [
      el('div', {
        style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;'
      }, [
        pill,
        el('span', {
          style: 'font-size:13px;color:var(--muted,#8a9499);',
          text: 'score ' + fmtSigned(score) + ' · ' + confPct + '% conf'
        })
      ]),
      el('p', {
        style: 'margin:0;line-height:1.55;color:var(--text,#e6edf0);font-size:15px;',
        text: sentence
      })
    ]);
  }

  function buildFactorRow(key, value, regimeColor) {
    var meta = FACTOR_META[key] || { label: key, blurb: '' };
    var v = num(value, 0);
    var mag = clamp(Math.abs(v), 0, 100); // 0..100 -> half-width %
    var halfPct = mag / 2; // each side spans up to 50% of track
    var positive = v >= 0;
    var barColor = positive ? ACCENT : DANGER;

    // diverging track centered at 50%
    var fill = el('div', {
      style:
        'position:absolute;top:0;bottom:0;height:100%;' +
        (positive
          ? 'left:50%;width:' + halfPct + '%;'
          : 'right:50%;width:' + halfPct + '%;') +
        'background:' + barColor + ';border-radius:3px;' +
        'transition:width .35s ease;'
    });

    var centerLine = el('div', {
      style: 'position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;' +
        'background:var(--border,#26313a);transform:translateX(-.5px);'
    });

    var track = el('div', {
      style: 'position:relative;height:14px;border-radius:3px;' +
        'background:color-mix(in srgb, var(--border,#26313a) 60%, transparent);' +
        'background:var(--border,#26313a);'
    }, [centerLine, fill]);

    var labelCell = el('div', {
      style: 'display:flex;flex-direction:column;gap:1px;'
    }, [
      el('span', {
        style: 'font-size:13px;font-weight:600;color:var(--text,#e6edf0);',
        text: meta.label
      }),
      el('span', {
        style: 'font-size:11px;color:var(--muted,#8a9499);',
        text: meta.blurb
      })
    ]);

    var valueCell = el('div', {
      style: 'font-variant-numeric:tabular-nums;font-size:14px;font-weight:600;' +
        'text-align:right;color:' + barColor + ';',
      text: fmtSigned(v)
    });

    return el('div', {
      style: 'display:grid;grid-template-columns:140px 1fr 56px;align-items:center;' +
        'gap:12px;padding:7px 0;'
    }, [labelCell, track, valueCell]);
  }

  function buildFactors(latest, regimeColor) {
    var factors = latest.factors || {};
    var rows = FACTOR_ORDER.map(function (k) {
      return buildFactorRow(k, factors[k], regimeColor);
    });

    var legend = el('div', {
      style: 'display:flex;justify-content:space-between;font-size:11px;' +
        'color:var(--muted,#8a9499);padding:0 56px 6px 140px;'
    }, [
      el('span', { style: 'color:' + DANGER + ';', text: '− risk-off ←' }),
      el('span', { text: '0' }),
      el('span', { style: 'color:' + ACCENT + ';', text: '→ risk-on +' })
    ]);

    return el('div', { class: 'dash-card', style: 'padding:16px;' }, [
      el('h3', {
        style: 'margin:0 0 4px;font-size:14px;letter-spacing:.04em;' +
          'text-transform:uppercase;color:var(--muted,#8a9499);',
        text: 'Factor Attribution'
      }),
      el('p', {
        style: 'margin:0 0 12px;font-size:12px;color:var(--muted,#8a9499);',
        text: 'The drivers behind today’s signal. Each factor contributes to the composite score.'
      }),
      legend,
      el('div', {}, rows)
    ]);
  }

  function rationaleFor(regime, alloc) {
    var btc = num(alloc.btc, null);
    var cash = num(alloc.cash, null);
    var key = regime.key;
    var reasons = {
      strong_on: 'Drivers are decisively risk-on; the model favors full BTC exposure and minimal cash.',
      mild_on: 'Drivers lean constructive; the model favors a majority-BTC stance while keeping a cash buffer.',
      mild_off: 'Drivers are softening; the model trims BTC and raises cash to reduce downside.',
      strong_off: 'Drivers are decisively risk-off; the model steps aside to cash to preserve capital.'
    };
    var reasoning = reasons[key] ||
      'The model maps the current factor mix to this BTC/cash stance.';
    return { btc: btc, cash: cash, reasoning: reasoning };
  }

  function buildAllocation(latest, regimeColor) {
    var regime = latest.regime || {};
    var alloc = latest.allocation || {};
    var r = rationaleFor(regime, alloc);
    var color = regimeColor(regime.key);

    function stanceBar() {
      var btcW = clamp(num(r.btc, 0), 0, 100);
      return el('div', {
        style: 'display:flex;height:22px;border-radius:5px;overflow:hidden;' +
          'border:1px solid var(--border,#26313a);'
      }, [
        el('div', {
          style: 'width:' + btcW + '%;background:' + ACCENT + ';display:flex;' +
            'align-items:center;justify-content:center;font-size:11px;font-weight:700;' +
            'color:#0b0f10;transition:width .35s ease;',
          text: r.btc != null ? 'BTC ' + r.btc + '%' : ''
        }),
        el('div', {
          style: 'flex:1;background:var(--border,#26313a);display:flex;' +
            'align-items:center;justify-content:center;font-size:11px;font-weight:600;' +
            'color:var(--muted,#8a9499);',
          text: r.cash != null ? 'Cash ' + r.cash + '%' : ''
        })
      ]);
    }

    return el('div', { class: 'dash-card', style: 'padding:16px;' }, [
      el('h3', {
        style: 'margin:0 0 10px;font-size:14px;letter-spacing:.04em;' +
          'text-transform:uppercase;color:var(--muted,#8a9499);',
        text: 'Allocation Rationale'
      }),
      el('div', {
        style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px;'
      }, [
        el('span', {
          style: 'width:10px;height:10px;border-radius:50%;background:' + color + ';' +
            'display:inline-block;'
        }),
        el('span', {
          style: 'font-size:13px;color:var(--text,#e6edf0);font-weight:600;',
          text: (regime.label || '—') + ' → ' +
            (r.btc != null ? r.btc + '% BTC / ' + r.cash + '% cash' : 'stance unavailable')
        })
      ]),
      stanceBar(),
      el('p', {
        style: 'margin:10px 0 0;font-size:13px;line-height:1.5;color:var(--muted,#8a9499);',
        text: r.reasoning
      })
    ]);
  }

  function buildSparkline(history) {
    var pts = (history || [])
      .map(function (h) { return num(h.score, null); })
      .filter(function (v) { return v != null; });

    if (pts.length < 2) return null;

    var W = 320, H = 56, pad = 4;
    var lo = Math.min.apply(null, pts);
    var hi = Math.max.apply(null, pts);
    var range = (hi - lo) || 1;

    function x(i) { return pad + (i / (pts.length - 1)) * (W - 2 * pad); }
    function y(v) { return pad + (1 - (v - lo) / range) * (H - 2 * pad); }

    var d = pts.map(function (v, i) {
      return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
    }).join(' ');

    var last = pts[pts.length - 1];
    var lastColor = last >= 0 ? ACCENT : DANGER;

    // zero baseline if within range
    var zeroLine = '';
    if (lo <= 0 && hi >= 0) {
      var zy = y(0).toFixed(1);
      zeroLine =
        '<line x1="' + pad + '" y1="' + zy + '" x2="' + (W - pad) + '" y2="' + zy +
        '" stroke="var(--border,#26313a)" stroke-width="1" stroke-dasharray="3 3"/>';
    }

    var svg =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H +
      '" preserveAspectRatio="none" role="img" aria-label="30-day risk score trend">' +
      zeroLine +
      '<path d="' + d + '" fill="none" stroke="' + lastColor +
      '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(last).toFixed(1) +
      '" r="2.5" fill="' + lastColor + '"/>' +
      '</svg>';

    return el('div', { class: 'dash-card', style: 'padding:16px;' }, [
      el('div', {
        style: 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;'
      }, [
        el('h3', {
          style: 'margin:0;font-size:14px;letter-spacing:.04em;' +
            'text-transform:uppercase;color:var(--muted,#8a9499);',
          text: 'Risk Score · 30d'
        }),
        el('span', {
          style: 'font-size:12px;color:var(--muted,#8a9499);font-variant-numeric:tabular-nums;',
          text: 'now ' + fmtSigned(last) + '  ·  range ' +
            fmtSigned(lo) + ' … ' + fmtSigned(hi)
        })
      ]),
      el('div', { html: svg })
    ]);
  }

  function buildFootnote() {
    return el('p', {
      style: 'margin:4px 0 0;font-size:11px;color:var(--muted,#8a9499);' +
        'font-style:italic;text-align:center;',
      text: 'Informational only — not financial advice.'
    });
  }

  function buildError(msg) {
    return el('div', { class: 'dash-card', style: 'padding:16px;' }, [
      el('p', {
        style: 'margin:0;color:var(--danger,#ff5a6e);font-size:14px;',
        text: 'Unable to load attribution: ' + msg
      })
    ]);
  }

  // ---- module entry point -----------------------------------------------

  window.ZPD_DASH.attribution = {
    render: async function render(mountEl, ctx) {
      if (!mountEl) return;
      ctx = ctx || {};
      var regimeColor = (typeof ctx.getRegimeColor === 'function')
        ? ctx.getRegimeColor
        : defaultRegimeColor;

      mountEl.innerHTML = '';

      var header = el('div', { style: 'margin-bottom:14px;' }, [
        el('h2', {
          style: 'margin:0 0 2px;font-size:20px;color:var(--text,#e6edf0);',
          text: 'Why This Read'
        }),
        el('p', {
          style: 'margin:0;font-size:13px;color:var(--muted,#8a9499);',
          text: 'Zero Point Data · transparent factor breakdown behind today’s signal.'
        })
      ]);
      mountEl.appendChild(header);

      var loading = el('div', { class: 'dash-card', style: 'padding:16px;' }, [
        el('p', {
          style: 'margin:0;color:var(--muted,#8a9499);font-size:14px;',
          text: 'Loading attribution…'
        })
      ]);
      mountEl.appendChild(loading);

      // latest: use ctx if provided, else fetch.
      var latest = ctx.latest;
      try {
        if (!latest || !latest.factors) {
          latest = await fetchJSON('/api/v1/signal/latest');
        }
      } catch (err) {
        mountEl.removeChild(loading);
        mountEl.appendChild(buildError(err.message || String(err)));
        mountEl.appendChild(buildFootnote());
        return;
      }

      // history: best-effort, non-fatal.
      var history = null;
      try {
        var h = await fetchJSON('/api/v1/signal/history?days=30');
        history = (h && h.history) || null;
      } catch (e) {
        history = null;
      }

      mountEl.removeChild(loading);

      var stack = el('div', {
        style: 'display:flex;flex-direction:column;gap:14px;'
      });

      var summaryCard = el('div', { class: 'dash-card', style: 'padding:16px;' }, [
        buildSummary(latest, regimeColor)
      ]);
      stack.appendChild(summaryCard);
      stack.appendChild(buildFactors(latest, regimeColor));
      stack.appendChild(buildAllocation(latest, regimeColor));

      var spark = buildSparkline(history);
      if (spark) stack.appendChild(spark);

      stack.appendChild(buildFootnote());
      mountEl.appendChild(stack);
    }
  };
})();
