// ============================================================
//  SA RECRUITERS — app-pull-refresh.js
// ============================================================
//  Pull-to-refresh for every app section except Home.
//
//  Home scrolls with the page, so the browser's own pull-to-refresh already
//  works there and is deliberately left alone. Every other screen scrolls
//  inside its own container (overscroll-behavior: contain), which blocks the
//  browser gesture, so this adds one in-app gesture that reloads that
//  section's data IN PLACE (no page reload, the user keeps their place).
//
//  Not enabled on screens that are mostly forms with unsaved input
//  (Scam check, Smart manager, Manager, Employer manager) or on the static Menu.
//
//  Classic script (like app-alerts.js): it only talks to the app through the
//  window globals the module bridge already exposes, each guarded, so a missing
//  function degrades to "nothing to refresh" instead of throwing.
//  refreshScreen() is pure and unit-tested in scripts/pull-refresh.test.mjs.
// ============================================================
(function (root) {
  'use strict';

  function call(w, name) {
    var fn = w && w[name];
    if (typeof fn !== 'function') return Promise.resolve();
    var args = Array.prototype.slice.call(arguments, 2);
    try { return Promise.resolve(fn.apply(w, args)); } catch (e) { return Promise.reject(e); }
  }
  function seq(w, steps) {
    return steps.reduce(function (p, step) {
      return p.then(function () { return call.apply(null, [w].concat(step)); });
    }, Promise.resolve());
  }

  // screen id -> ordered [windowFunction, ...args] steps that reload and redraw it.
  var STEPS = {
    'screen-saved': [['loadAll', { fresh: true }], ['loadSavedVacanciesFromSupabase'], ['renderSaved']],
    'screen-account': [['loadSavedVacanciesFromSupabase'], ['renderAccountDetails']],
    'screen-allagencies': [['loadAll', { fresh: true }], ['renderAllAgenciesList']],
    'screen-allbranches': [['loadAll', { fresh: true }], ['renderAllBranchesList']],
    'screen-allemployers': [['loadAll', { fresh: true }], ['renderAllEmployersList']],
    'screen-allads': [['loadHouseAds'], ['renderAllAdsList']],
    // '__open__' makes the vacancy folders refetch from page 1 on the next draw.
    'screen-allvacancies': [['set_generalVacancyQueryKey', '__open__'], ['set_dedicatedVacancyQueryKey', '__open__'],
      ['loadAll', { fresh: true }], ['renderAllVacanciesList']],
    'screen-pool': [['loadPoolCandidates']],
    'screen-community': [['communityLoad']],
    'screen-submissions': [['loadReportsFromSupabase'], ['loadSuggestionsFromSupabase'], ['renderSubmissionsList']]
  };

  function canRefresh(screenId) { return Object.prototype.hasOwnProperty.call(STEPS, screenId); }

  function refreshScreen(screenId, w) {
    if (!canRefresh(screenId)) return Promise.resolve(false);
    return seq(w, STEPS[screenId]).then(function () { return true; });
  }

  var api = { STEPS: STEPS, canRefresh: canRefresh, refreshScreen: refreshScreen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  root.saPullRefresh = api;

  // ---------------- gesture + indicator (browser only) ----------------
  var THRESHOLD = 70;      // px of (damped) pull needed to trigger
  var MAX_PULL = 110;
  var MIN_SHOW_MS = 700;   // keep the spinner visible long enough to be seen
  var BLOCK = 'input,textarea,select,[contenteditable="true"],iframe,canvas,.leaflet-container,[data-no-ptr]';

  var css = document.createElement('style');
  css.textContent =
    '#sa-ptr{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 6px);z-index:10010;width:40px;height:40px;margin-left:-20px;' +
    'display:grid;place-items:center;border-radius:50%;background:var(--card,#fff);color:var(--accent,#1769cf);' +
    'border:1px solid var(--border,#d9e2ec);box-shadow:0 6px 16px rgba(0,0,0,.18);opacity:0;pointer-events:none;' +
    'transform:translate3d(0,-64px,0)}' +
    '#sa-ptr.sa-ptr-anim{transition:transform .22s ease,opacity .22s ease}' +
    '#sa-ptr svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}' +
    '#sa-ptr.sa-ptr-busy svg{animation:sa-ptr-spin .8s linear infinite}' +
    '@keyframes sa-ptr-spin{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){#sa-ptr.sa-ptr-anim{transition:none}#sa-ptr.sa-ptr-busy svg{animation:none}}' +
    // Stop the browser pulling the whole page down on top of this gesture.
    'html:has(.screen.active:not(#screen-home)){overscroll-behavior-y:contain}';
  document.head.appendChild(css);

  var el = document.createElement('div');
  el.id = 'sa-ptr';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>' +
    '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" id="sa-ptr-text"></span>';
  var textEl = el.lastChild;
  function mount() { if (!el.parentNode && document.body) document.body.appendChild(el); }

  var g = null;            // current gesture
  var busy = false;

  function toast(msg) { if (typeof window.showToast === 'function') { try { window.showToast(msg); } catch (e) {} } }

  function show(distance, animate) {
    mount();
    el.classList.toggle('sa-ptr-anim', !!animate);
    var p = Math.min(1, distance / THRESHOLD);
    el.style.opacity = String(p);
    el.style.transform = 'translate3d(0,' + (distance - 64) + 'px,0) rotate(' + Math.round(p * 270) + 'deg)';
  }
  function hide() {
    el.classList.add('sa-ptr-anim');
    el.classList.remove('sa-ptr-busy');
    el.style.opacity = '0';
    el.style.transform = 'translate3d(0,-64px,0)';
  }

  function overlayOpen() {
    return !!(document.body.classList.contains('site-menu-open') || document.querySelector('.sheet-scrim.open'));
  }

  // True when the touch started somewhere that can still scroll up.
  function scrolledDown(target, screen) {
    if ((window.scrollY || document.documentElement.scrollTop || 0) > 0) return true;
    for (var n = target; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var oy = window.getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return true;
      if (n === screen) break;
    }
    return false;
  }

  function onStart(e) {
    g = null;
    if (busy || !e.touches || e.touches.length !== 1 || overlayOpen()) return;
    var screen = document.querySelector('.screen.active');
    if (!screen || !canRefresh(screen.id)) return;
    var t = e.target;
    if (!t || !t.closest || t.closest(BLOCK)) return;
    if (scrolledDown(t, screen)) return;
    g = { id: screen.id, x: e.touches[0].clientX, y: e.touches[0].clientY, pulling: false, d: 0 };
  }

  function onMove(e) {
    if (!g || !e.touches || e.touches.length !== 1) { return; }
    var dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y;
    if (!g.pulling) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { g = null; return; }   // horizontal swipe
      if (dy < -4) { g = null; return; }                                              // scrolling down the page
      if (dy < 8) return;
      g.pulling = true;
    }
    if (e.cancelable) e.preventDefault();
    g.d = Math.min(MAX_PULL, Math.max(0, dy) * 0.5);
    show(g.d, false);
  }

  function finish(e) {
    if (!g) return;
    var s = g; g = null;
    if (!s.pulling) return;
    if (e && e.type === 'touchcancel' || s.d < THRESHOLD) { hide(); return; }
    run(s.id);
  }

  function run(screenId) {
    if (busy) return;
    if (navigator.onLine === false) { hide(); toast('You are offline. Reconnect to refresh.'); return; }
    busy = true;
    mount();
    el.classList.add('sa-ptr-anim', 'sa-ptr-busy');
    el.style.opacity = '1';
    el.style.transform = 'translate3d(0,' + (THRESHOLD - 24) + 'px,0)';
    textEl.textContent = 'Refreshing';
    var started = Date.now();
    refreshScreen(screenId, window).then(function () { return true; }, function (err) {
      try { console.warn('[pull-refresh]', screenId, err && err.message); } catch (_) {}
      return false;
    }).then(function (ok) {
      var wait = Math.max(0, MIN_SHOW_MS - (Date.now() - started));
      setTimeout(function () {
        busy = false;
        textEl.textContent = '';
        hide();
        toast(ok ? 'Updated' : 'Could not refresh. Please try again.');
      }, wait);
    });
  }

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', finish, { passive: true });
  document.addEventListener('touchcancel', finish, { passive: true });
})(typeof window !== 'undefined' ? window : globalThis);
