/* Zero Point Data — dashboard shell / module loader.
 *
 * ============================ MODULE CONTRACT ============================
 * The shell owns the page; sibling modules own their card contents.
 *
 * 1. The namespace is created defensively. EVERY file (this shell AND each
 *    sibling module, regardless of load order) must do, as its first line:
 *
 *        window.ZPD_DASH = window.ZPD_DASH || {};
 *
 * 2. Each module registers itself under its own key with a render method:
 *
 *        window.ZPD_DASH.history     = { render(mountEl, ctx) { … } };
 *        window.ZPD_DASH.attribution = { render(mountEl, ctx) { … } };
 *
 * 3. After fetching data, the shell calls each module's render(mountEl, ctx):
 *
 *        mountEl  — the DOM element to render into:
 *                     history     -> document.getElementById('dash-history')
 *                     attribution -> document.getElementById('dash-attribution')
 *
 *        ctx = {
 *          latest,          // object from GET /api/v1/signal/latest
 *          regimes,         // array from GET /api/v1/regimes (regimes[]), or []
 *          getRegimeColor,  // (regimeKey: string) => string  (a CSS color)
 *          fmtDate,         // (dateish: string|number|Date) => string (e.g. "Jun 18")
 *        }
 *
 * 4. The shell GUARDS every call: a missing/throwing module never breaks the
 *    page. Modules should be self-contained and may fetch their own extra data
 *    (e.g. history endpoint) inside render().
 * ========================================================================
 */
window.ZPD_DASH = window.ZPD_DASH || {};

(function () {
  'use strict';

  // ---- regime color map (mirrors styles.css regime tokens) ----
  var REGIME_COLORS = {
    strong_on: 'var(--strong)',   // #2fe6c8 teal
    mild_on: 'var(--mild)',       // #6fd3ff
    mild_off: 'var(--warn)',      // #ffb547
    strong_off: 'var(--danger)',  // #ff5a6e
  };

  function getRegimeColor(key) {
    return REGIME_COLORS[key] || 'var(--muted)';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(d) {
    if (d == null) return '';
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
  }

  function pct(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return Math.round(n) + '%';
  }

  // ---- DOM helpers ----
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  // ---- summary strip ----
  function fillSummary(latest) {
    var regime = latest.regime || {};
    var alloc = latest.allocation || {};
    var color = getRegimeColor(regime.key);

    setText('ds-regime-label', regime.label || '—');
    setText('ds-regime-tag', regime.tag || '');

    var swatch = $('ds-swatch');
    if (swatch) {
      swatch.style.background = color;
      swatch.style.boxShadow = '0 0 14px ' + color;
    }

    var score = (typeof latest.riskScore === 'number') ? latest.riskScore : null;
    setText('ds-score', score == null ? '—' : String(score));

    if (typeof latest.confidence === 'number') {
      setText('ds-confidence', 'Confidence ' + pct(latest.confidence > 1 ? latest.confidence : latest.confidence * 100));
    } else {
      setText('ds-confidence', '');
    }

    setText('ds-btc', pct(alloc.btc));
    setText('ds-cash', pct(alloc.cash));

    if (latest.timestamp) {
      setText('ds-updated', 'Updated ' + fmtDate(latest.timestamp));
    }
  }

  function summaryError(msg) {
    var strip = $('dash-summary');
    if (strip) strip.classList.add('is-error');
    setText('ds-regime-label', 'Unavailable');
    setText('ds-regime-tag', msg || 'Could not load the latest signal.');
  }

  // ---- safely drive a registered module ----
  function driveModule(name, mountId, ctx) {
    var mod = window.ZPD_DASH[name];
    var mount = $(mountId);
    if (!mount) return;
    if (!mod || typeof mod.render !== 'function') {
      // Module not present — leave a quiet placeholder, never hard-fail.
      mount.innerHTML =
        '<div class="dash-card"><div class="dash-empty">Module “' +
        name + '” not loaded.</div></div>';
      return;
    }
    try {
      mod.render(mount, ctx);
    } catch (err) {
      console.error('[ZPD_DASH] module "' + name + '" render failed:', err);
      mount.innerHTML =
        '<div class="dash-card"><div class="dash-empty">This panel hit an error.</div></div>';
    }
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.json();
    });
  }

  // ---- boot ----
  function boot() {
    // Fetch the latest signal (required) and regimes (best-effort) in parallel.
    var latestP = getJSON('/api/v1/signal/latest');
    var regimesP = getJSON('/api/v1/regimes').catch(function () { return null; });

    latestP.then(function (latest) {
      fillSummary(latest);

      regimesP.then(function (regimesResp) {
        var regimes = (regimesResp && regimesResp.regimes) || [];
        var ctx = {
          latest: latest,
          regimes: regimes,
          getRegimeColor: getRegimeColor,
          fmtDate: fmtDate,
        };
        driveModule('history', 'dash-history', ctx);
        driveModule('attribution', 'dash-attribution', ctx);
      });
    }).catch(function (err) {
      console.error('[ZPD_DASH] failed to load latest signal:', err);
      summaryError();
      // Still try to drive modules with an empty context so they can show their
      // own empty/error states rather than nothing at all.
      var ctx = {
        latest: null,
        regimes: [],
        getRegimeColor: getRegimeColor,
        fmtDate: fmtDate,
      };
      driveModule('history', 'dash-history', ctx);
      driveModule('attribution', 'dash-attribution', ctx);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
