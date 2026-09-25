/*
 * SA Recruiters -- state-safe refresh pipeline (standalone module)
 * ---------------------------------------------------------------------------
 * Loaded as its own unversioned <script> immediately AFTER app.bundle.min.js,
 * because deferred scripts execute in document order: the bundle defines
 * loadAll() and every renderer this pipeline drives, so those definitions must
 * already exist when this file evaluates.
 *
 * It is intentionally NOT part of the bundle. A client whose cached
 * app.bundle.min.js is still the pre-fix generation (served by an older
 * worker's navigation fallback, which ignores the ?v= hash when offline)
 * nevertheless receives this file once the new shell installs, so the refresh
 * pipeline takes effect without waiting for a second navigation.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   1. NEWEST GENERATION WINS. Every hydration runs under a monotonic epoch
 *      token; a superseded generation returns without touching shared state or
 *      the DOM.
 *   2. REFRESHES PAINT THE VISIBLE SCREEN. Rendering is driven by the screen
 *      that currently carries .active — never by a name captured at boot — and
 *      transient containers are only written while their own screen is shown.
 *   3. REFRESH MEANS REFRESH. Per-screen transient state and the memoised
 *      startup payload are cleared before a new generation starts, so a refresh
 *      cannot continue the previous screen's session or relabel stale data as
 *      freshly fetched.
 * ---------------------------------------------------------------------------
 */

(function() {
  'use strict';

  // The bundle (app-refresh-bundle.js) owns the epoch primitives so its guarded
  // call sites work even if this file is missing. Fall back to private copies
  // only if the bundle is an older generation that predates the bridge, in
  // which case nothing else in this file depends on the bundle's guards.
  var beginRefresh = typeof saBeginRefresh === 'function'
    ? saBeginRefresh
    : function() { return (typeof __saRefreshEpoch === 'number' ? ++__saRefreshEpoch : 1); };
  var isCurrent = typeof saIsCurrentRefresh === 'function'
    ? saIsCurrentRefresh
    : function(token) { return typeof __saRefreshEpoch !== 'number' || token === __saRefreshEpoch; };
  var commitRefresh = typeof saCommitRefresh === 'function' ? saCommitRefresh : function() {};
  var currentToken = typeof saCurrentRefreshToken === 'function' ? saCurrentRefreshToken : function() { return null; };

  // ===== Which screen is actually on screen? =====
  // Screens are <section class="screen"> toggled by the single .active class,
  // and .screen{display:none} / .screen.active{display:flex} mean exactly one
  // should ever be active. Some paths historically only ADDED .active (the Home
  // button did), which left two screens display:flex at once and rendering on
  // top of each other; reading the LAST active screen in document order picks
  // the one painted on top so the pipeline still behaves while those call sites
  // are being converted.
  function activeScreenElement() {
    var active = document.querySelectorAll('.screen.active');
    return active.length ? active[active.length - 1] : null;
  }
  function activeScreenName() {
    var el = activeScreenElement();
    return el ? el.id.replace(/^screen-/, '') : null;
  }
  function isScreenActive(name) {
    var el = document.getElementById('screen-' + name);
    return !!(el && el.classList.contains('active'));
  }

  // Canonical screen switch: clear every screen, activate exactly one, sync the
  // bottom nav. Using this instead of a bare classList.add() is what keeps two
  // screens from ever being display:flex simultaneously.
  function showScreen(name) {
    var target = document.getElementById('screen-' + name);
    if (!target) return false;
    document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
    target.classList.add('active');
    document.querySelectorAll('.navbtn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    return true;
  }

  // ===== Container ownership =====
  // A container is "transient" when its contents represent an open folder, a
  // query result or a filter selection belonging to one screen. Writing it
  // while the user has moved on is exactly the cross-screen render leak these
  // guards remove. Durable directory surfaces (home cards, stats, the
  // agency/branch/employer lists driven by their own search boxes) are absent
  // on purpose: they are epoch-scoped instead, so an idle refresh can keep the
  // directory current while the user is on another screen.
  var TRANSIENT_CONTAINERS = {
    'allvacancies-list': ['allvacancies'],
    'poster-feed': ['allposters'],
    'allposters-list': ['allposters'],
    'pool-list': ['pool'],
    'saved-list': ['saved'],
    'search-results': ['menu'],
    'candidate-spotlight-deck': ['menu', 'home']
  };
  function canRenderContainer(id) {
    var screens = TRANSIENT_CONTAINERS[id];
    // Unknown containers are not owned by a single screen; allow them (their
    // caller is still epoch-guarded).
    if (!screens) return true;
    var active = activeScreenName();
    return !!active && screens.indexOf(active) !== -1;
  }

  // ===== Per-screen transient state =====
  // Folder selection, pagination cursors, query keys and the boot-time restore
  // marker all describe one browsing session on one screen. A refresh is
  // presented as a clean reload, so it must not continue that session — leaving
  // them set is what allowed a refresh to redeploy the previously-open vacancy
  // folder.
  function resetTransientScreenState() {
    function clear(name, value) {
      if (typeof window[name] !== 'undefined') window[name] = value;
    }
    clear('allVacanciesFolder', null);
    clear('vacancyFolderDisplayLimit', 30);
    clear('vacancyFolderDisplayKey', '');
    clear('generalVacancyPage', 0);
    clear('generalVacancyHasMore', false);
    clear('generalVacancyQueryKey', '');
    clear('generalVacancyError', false);
    clear('generalVacancyLoading', false);
    clear('generalVacancyRows', []);
    clear('dedicatedVacancyFolder', '');
    clear('dedicatedVacancyPage', 0);
    clear('dedicatedVacancyHasMore', false);
    clear('dedicatedVacancyQueryKey', '');
    clear('dedicatedVacancyError', false);
    clear('dedicatedVacancyLoading', false);
    clear('dedicatedVacancyRows', []);
    // Bumping the request ids invalidates any folder request still in flight so
    // its late response cannot repopulate the list the user just cleared.
    if (typeof window.generalVacancyRequestId === 'number') window.generalVacancyRequestId += 1;
    if (typeof window.dedicatedVacancyRequestId === 'number') window.dedicatedVacancyRequestId += 1;
    // Derived stat counts belong to the generation being replaced; leaving the
    // "loaded" flags set is what let an older generation's numbers survive into
    // the new one and paint as if they were current.
    clear('generalVacancyCountLoaded', false);
    clear('dedicatedVacancyCountsLoaded', false);
    // The restore marker names the screen the page was reloaded on. Once a
    // refresh has run it is stale by definition and must not drive a render.
    window.__saRestoredScreen = null;
  }

  // ===== Startup payload invalidation =====
  // getStartupData() memoises one promise for the whole page lifetime on
  // success, so without this an explicit refresh re-renders the boot payload
  // while loadAll() stamps lastDataRefreshAt = Date.now() and presents it as
  // freshly fetched.
  function invalidateStartupData() {
    if (typeof __saInvalidateStartupPayload === 'function') __saInvalidateStartupPayload();
    window.__saStartupPayload = null;
  }

  // ===== Screen render registry =====
  // Which renderers belong to which screen. Names are resolved on the global
  // object because the app is a concatenation of classic scripts.
  var SCREEN_RENDERERS = {
    home: ['filterAndRenderCached', 'updateStats'],
    saved: ['renderSaved'],
    account: ['renderAccountDetails'],
    allagencies: ['renderAllAgenciesList'],
    allbranches: ['renderAllBranchesList'],
    allemployers: ['renderAllEmployersList'],
    allvacancies: ['renderAllVacanciesList'],
    allposters: ['renderPosterFeed'],
    pool: ['renderPoolList']
  };
  function runNamedRenderer(name) {
    if (typeof window[name] === 'function') { window[name](); return true; }
    return false;
  }
  // Repaint only the screen that is actually visible. This replaces
  // renderRestoredScreenContent() at hydration time: that helper unpacked
  // window.__saRestoredScreen (a name captured at boot) and would happily render
  // a screen the user had long since left, which is the cross-screen repaint.
  function renderActiveScreen() {
    var name = activeScreenName();
    if (!name) return false;
    var recipe = SCREEN_RENDERERS[name];
    if (recipe) recipe.forEach(runNamedRenderer);
    // Screens whose restore also starts a fetch (posters, Talent Pool) keep
    // their existing restore behaviour while they are the visible screen.
    if (typeof renderRestoredScreenContent === 'function' && window.__saRestoredScreen === name) {
      renderRestoredScreenContent();
    }
    return true;
  }

  // ===== Data age =====
  // loadAll() stamps lastDataRefreshAt = Date.now() when it succeeds, which
  // describes when THIS DEVICE fetched, not how old the DATA is: the worker's
  // /api/startup applies its own fresh/stale-while-revalidate policy and can
  // answer from its D1 mirror. Prefer the payload's authoritative timestamp and
  // keep the fetch time only as a fallback for older worker responses.
  function payloadDataAsOf(payload) {
    if (!payload) return null;
    var candidates = [payload.generated_at, payload.generatedAt, payload.as_of, payload.updated_at];
    for (var i = 0; i < candidates.length; i++) {
      var raw = candidates[i];
      if (raw === null || raw === undefined || raw === '') continue;
      var ms = typeof raw === 'number' ? raw : Date.parse(raw);
      if (!isNaN(ms)) return ms;
    }
    return null;
  }
  function syncDataFreshnessFromPayload() {
    var asOf = payloadDataAsOf(window.__saStartupPayload);
    if (!asOf) return null;
    if (typeof lastDataRefreshAt !== 'undefined') lastDataRefreshAt = asOf;
    var el = document.getElementById('connection-status');
    if (el && el.dataset && el.dataset.state === 'live' && typeof setConnectionStatus === 'function') {
      setConnectionStatus('live', asOf);
    }
    return asOf;
  }

  // ===== The refresh entry point =====
  // Shared by the Home button, idle wake-up, pageshow restore and online
  // recovery. Ordering matters: transient state and the memo are cleared BEFORE
  // the new generation starts, so nothing from the previous generation can be
  // read into the new one. loadAll() receives this epoch token so the refresh
  // and the hydration it awaits share one generation instead of the refresh
  // immediately superseding its own callee.
  function refreshAll(reason) {
    resetTransientScreenState();
    invalidateStartupData();
    if (typeof setRetryBanner === 'function') setRetryBanner(false);
    var token = beginRefresh(reason || 'saRefreshAll');
    var run;
    try {
      run = Promise.resolve(loadAll(token));
    } catch (e) {
      run = Promise.resolve();
    }
    return run.then(function() {
      if (isCurrent(token)) syncDataFreshnessFromPayload();
      return token;
    }, function(e) {
      if (isCurrent(token)) console.warn('[SA Recruiters] refresh failed', e);
      return token;
    });
  }

  // ===== Refresh lifecycle =====
  // One listener layer for the whole app. The wake-up path used to live in
  // app-manager-employer.js and could fire a second hydration for the same
  // wake-up while a boot or button refresh was still running.
  var hiddenAt = null;
  var MIN_HIDDEN_MS = 2 * 60 * 1000; // only refetch after a real idle period

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!hiddenAt) return;
    var idleFor = Date.now() - hiddenAt;
    hiddenAt = null;
    if (idleFor <= MIN_HIDDEN_MS) return; // brief app switch: keep the current view
    if (typeof resetGuestQuotaIfNewDay === 'function') resetGuestQuotaIfNewDay();
    refreshAll('idle-resume');
  });

  // Back/forward-cache restore (Safari/iOS in particular) does not always raise
  // visibilitychange, so pageshow covers it explicitly.
  window.addEventListener('pageshow', function(e) {
    if (!e.persisted) return;
    if (typeof resetGuestQuotaIfNewDay === 'function') resetGuestQuotaIfNewDay();
    refreshAll('pageshow-restore');
  });

  // Network recovery. Registered here rather than in initConnectionStatus so
  // there is exactly one online listener and it goes through the same
  // single-flight pipeline as every other refresh.
  window.addEventListener('online', function() {
    if (typeof setConnectionStatus === 'function') {
      setConnectionStatus('loading', typeof lastDataRefreshAt !== 'undefined' ? lastDataRefreshAt : null);
    }
    refreshAll('online');
  });

  // ===== Public surface (bundle call sites) =====
  window.saRefreshAll = refreshAll;
  // Self-registration. The normal load order (bundle, then this file) means the
  // bundle's loadAll() already carries the epoch preamble, so there is nothing
  // to do. This wrapper covers the reverse case — a client whose cached
  // index.html is newer than its cached app.bundle.min.js, which happens when
  // an older worker's navigation fallback answers with a bundle carrying an
  // older ?v= hash. There loadAll() would still be the unguarded legacy
  // version, so the pipeline takes ownership of the entry point itself.
  // The marker prevents double-wrapping on a second evaluation.
  if (typeof loadAll === 'function' && !loadAll.__saEpochWrapped) {
    var baseLoadAll = loadAll;
    var wrappedLoadAll = function(refreshToken) {
      if (typeof refreshToken !== 'number') refreshToken = beginRefresh('loadAll');
      var token = refreshToken;
      // A legacy loadAll ignores the token and commits its own results, so
      // re-check the epoch immediately before letting it run.
      if (!isCurrent(token)) return Promise.resolve(token);
      return Promise.resolve(baseLoadAll.call(this, token)).then(function(value) {
        commitRefresh(token);
        return value;
      });
    };
    wrappedLoadAll.__saEpochWrapped = true;
    window.loadAll = wrappedLoadAll;
  }
  window.saRenderActiveScreen = renderActiveScreen;
  window.saShouldRenderContainer = canRenderContainer;
  window.saCanRenderContainer = canRenderContainer;
  window.saShowScreen = showScreen;
  window.saActiveScreenName = activeScreenName;
  window.saIsScreenActive = isScreenActive;
  window.saResetTransientScreenState = resetTransientScreenState;
  window.saInvalidateStartupData = invalidateStartupData;
  window.saSyncDataFreshnessFromPayload = syncDataFreshnessFromPayload;
  window.saPayloadDataAsOf = payloadDataAsOf;
})();
