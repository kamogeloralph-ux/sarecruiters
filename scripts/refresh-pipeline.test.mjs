// ============================================================
//  SA RECRUITERS — scripts/refresh-pipeline.test.mjs
// ============================================================
//  Regression tests for the cross-screen render contamination and the
//  state-safe refresh pipeline that replaced it.
//
//  These execute the REAL source files in a jsdom document rather than
//  re-implementing the logic, so a change that quietly removes an epoch guard,
//  a container-ownership check or a transient-state reset fails here instead of
//  resurfacing as a production render bug. See docs/REFRESH_STATE_TRACE.md.
//
//  Run with: node --test scripts/refresh-pipeline.test.mjs
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const BUNDLE_FILES = [
  'app-core.js',
  'app-data.js',
  'app-cards.js',
  'app-forms.js',
  'app-sheets.js',
  'app-ui.js',
  'app-manager.js',
  'app-manager-employer.js',
  'app-pending-submissions.js',
  'app-refresh-bundle.js',
  'scripts/app-refresh.js',
];

const SCREEN_IDS = [
  'home', 'saved', 'account', 'menu', 'allagencies', 'allbranches',
  'allvacancies', 'allposters', 'allemployers', 'pool',
];

/**
 * Build a jsdom document with the app's screen containers, then evaluate the
 * real source files in it. Network and storage APIs the app touches at load
 * time are stubbed so the module graph evaluates headlessly.
 */
function buildApp({ html = '' } = {}) {
  const screens = SCREEN_IDS.map(
    (name, i) => `<div class="screen${i === 0 ? ' active' : ''}" id="screen-${name}"></div>`
  ).join('');

  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div class="toast" id="toast"></div>${screens}${html}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://sa-recruiters.test/' }
  );
  const { window } = dom;

  // Stub the browser APIs the app expects. Anything the pipeline needs is real;
  // only I/O is faked.
  window.fetch = () => Promise.reject(new Error('network disabled in tests'));
  window.indexedDB = undefined;
  window.localStorage.clear();
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  // jsdom defines window.crypto with only a getter, so define the stub instead
  // of assigning to it.
  Object.defineProperty(window, 'crypto', {
    value: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) },
    configurable: true,
    writable: true,
  });
  window.supabase = undefined;
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

  const src = BUNDLE_FILES
    .map((f) => `\n/* ---- ${f} ---- */\n${readFileSync(join(ROOT, f), 'utf8')}`)
    .join('\n;\n');

  window.eval(src);
  return { dom, window, document: window.document };
}

/**
 * A chainable, awaitable stand-in for the Supabase query builder. Every builder
 * method returns the same thenable, and awaiting it yields an empty result set,
 * which is enough to let loadAll() run its full length offline.
 */
function stubSupabase(window) {
  const RESULT = { data: [], error: null, count: 0 };
  const proxy = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve) => resolve(RESULT);
      if (prop === 'catch') return () => proxy;
      if (prop === 'finally') return (cb) => { cb(); return proxy; };
      return () => proxy;
    },
    apply() { return proxy; },
  });
  window.supabaseClient = proxy;
  window.supabase = { createClient: () => proxy };
}

/** Minimal valid /api/startup payload so loadAll() takes its aggregate path. */
function startupPayload(overrides = {}) {
  return {
    generated_at: '2026-09-25T04:00:00.000Z',
    agencies: [], branches: [], vacancies: [], employers: [],
    counts: { vacancies: 0, general: 0, candidates: 0, dedicated: {} },
    settings: {
      public_vacancy_posting: 'false',
      public_employer_registration: 'false',
      public_employer_directory: 'true',
    },
    ...overrides,
  };
}

/**
 * A page carrying every container loadAll()'s hydration tail touches, with the
 * network and database stubbed so the real loadAll() can be awaited offline.
 */
function buildHydratableApp() {
  const app = buildApp({
    html: `
      <input id="home-search" value="">
      <div id="home-stats"></div>
      <div id="hub-list"></div>
      <div id="empty-msg"><h3></h3><p></p></div>
      <div id="candidate-spotlight-deck"></div>
      <div id="connection-status" data-state="live"></div>
      <div id="retry-banner"></div>
      <div id="allvacancies-list">original</div>
      <div id="saved-list"></div>
      <div id="poster-feed"></div>
      <div id="pool-list"></div>
      <div id="update-banner"></div>
      <span id="stat-agencies"></span><span id="stat-vacancies"></span>
      <span id="stat-employers"></span><span id="stat-pool"></span>
    `,
  });
  const { window } = app;
  stubSupabase(window);
  window.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(startupPayload()),
  });
  // Hooks that belong to screens this page does not build. loadAll() calls them
  // unconditionally, so they are stubbed to keep the hydration tail reachable
  // rather than adding unrelated markup to every test fixture.
  //
  // renderRestoredScreenContent is deliberately NOT stubbed: it is defined in
  // app-ui.js and is the function the original code used to repaint the
  // remembered screen. Stubbing it would hide exactly the defect these tests
  // exist to catch.
  for (const fn of [
    'updateEmployerRegUI', 'updatePostingToggleUI', 'restoreTalentPoolMembership',
    'autoClaimGateRegistration', 'refreshGateStats', 'reorderStatCardsByCount',
    'updatePosterStat', 'loadCandidateSpotlight', 'loadPosterFeed', 'saveDataCache',
    'setRetryBanner', 'renderSmartManager',
  ]) {
    window[fn] = () => {};
  }
  return app;
}

// ---------------------------------------------------------------------------
// 1. Screen activation: at most one screen may be active at a time.
// ---------------------------------------------------------------------------
test('saShowScreen leaves exactly one active screen', () => {
  const { window, document } = buildApp();
  window.saShowScreen('allvacancies');
  const active = document.querySelectorAll('.screen.active');
  assert.equal(active.length, 1, 'exactly one screen must be active');
  assert.equal(active[0].id, 'screen-allvacancies');

  window.saShowScreen('home');
  const after = document.querySelectorAll('.screen.active');
  assert.equal(after.length, 1, 'switching must not leave the previous screen active');
  assert.equal(after[0].id, 'screen-home');
});

test('saShowScreen syncs the bottom nav', () => {
  const { window, document } = buildApp({
    html: '<button class="navbtn" data-tab="home"></button><button class="navbtn" data-tab="account"></button>',
  });
  window.saShowScreen('account');
  const navActive = document.querySelectorAll('.navbtn.active');
  assert.equal(navActive.length, 1);
  assert.equal(navActive[0].dataset.tab, 'account');
});

test('refreshHome switches cleanly instead of stacking active screens (regression)', () => {
  // refreshHome() previously only ADDED .active to #screen-home. Combined with
  // .screen.active{display:flex} that left two screens laid out at once and
  // rendering on top of each other — the most literal form of the reported
  // cross-screen contamination.
  const { window, document } = buildApp();
  window.saShowScreen('allvacancies');
  window.refreshHome();
  const active = document.querySelectorAll('.screen.active');
  assert.equal(active.length, 1, 'refreshHome must not leave a second screen active');
  assert.equal(active[0].id, 'screen-home');
});

// ---------------------------------------------------------------------------
// 2. Refresh epoch: newest generation wins.
// ---------------------------------------------------------------------------
test('a superseded refresh token is not current', () => {
  const { window } = buildApp();
  const first = window.saBeginRefresh('test-first');
  assert.equal(window.saIsCurrentRefresh(first), true);
  const second = window.saBeginRefresh('test-second');
  assert.notEqual(first, second);
  assert.equal(window.saIsCurrentRefresh(second), true);
  assert.equal(window.saIsCurrentRefresh(first), false, 'the older generation must be superseded');
});

test('epoch tokens are monotonic across refresh kinds', () => {
  const { window } = buildApp();
  const tokens = ['home-button', 'idle-resume', 'online'].map((r) => window.saBeginRefresh(r));
  assert.deepEqual(tokens, [...tokens].sort((a, b) => a - b), 'tokens must increase');
  assert.equal(tokens[2], window.saCurrentRefreshToken(), 'the newest token is the current one');
});

test('committing a refresh records it and rejects stale commits', () => {
  const { window } = buildApp();
  const first = window.saBeginRefresh('first');
  const second = window.saBeginRefresh('second');
  window.saCommitRefresh(second);
  assert.equal(window.saRefreshCommittedEpoch(), second);
  window.saCommitRefresh(first); // a late commit from the superseded generation
  assert.equal(window.saRefreshCommittedEpoch(), second, 'a stale commit must not win');
});

test('concurrent hydrations cannot both commit (interleaving guard)', async () => {
  // Two overlapping loadAll() shapes: the first starts, the second starts and
  // wins, then the first resumes past its await. Its write gate must fail.
  const { window } = buildApp();
  const first = window.saBeginRefresh('first');
  const second = window.saBeginRefresh('second');
  await Promise.resolve();
  assert.equal(window.saIsCurrentRefresh(first), false);
  assert.equal(window.saIsCurrentRefresh(second), true);
});

// ---------------------------------------------------------------------------
// 3. Container ownership: transient lists belong to their own screen.
// ---------------------------------------------------------------------------
test('transient containers are renderable only from their owning screen', () => {
  const { window } = buildApp();
  const cases = [
    ['allvacancies-list', 'allvacancies'],
    ['poster-feed', 'allposters'],
    ['pool-list', 'pool'],
    ['saved-list', 'saved'],
  ];
  for (const [container, screen] of cases) {
    window.saShowScreen(screen);
    assert.equal(window.saShouldRenderContainer(container), true, `${container} on ${screen}`);
    window.saShowScreen('home');
    assert.equal(window.saShouldRenderContainer(container), false, `${container} must not render from home`);
  }
});

test('unknown containers are not blocked', () => {
  const { window } = buildApp();
  window.saShowScreen('home');
  assert.equal(window.saShouldRenderContainer('some-other-container'), true);
});

test('an abandoned vacancy folder is not repainted while another screen is visible (regression)', () => {
  // The original leak: hydration called renderRestoredScreenContent(), which
  // rendered window.__saRestoredScreen — 'allvacancies' — even though the user
  // had navigated to Home, and the folder renderer wrote #allvacancies-list.
  const { window, document } = buildApp({
    html: '<div id="allvacancies-list">untouched</div>',
  });
  window.__saRestoredScreen = 'allvacancies';
  window.allVacanciesFolder = 'himalayas';
  window.saShowScreen('home');

  const el = document.getElementById('allvacancies-list');
  el.innerHTML = 'untouched';
  window.renderDedicatedVacancyCards(false);
  assert.equal(el.innerHTML, 'untouched', 'a hidden folder list must not be rewritten');

  // And the negative control: on its own screen, the same renderer does write.
  window.saShowScreen('allvacancies');
  window.dedicatedVacancyError = true; // forces the error branch, no data needed
  window.renderDedicatedVacancyCards(false);
  assert.notEqual(el.innerHTML, 'untouched', 'the owning screen must still render');
});

test('the vacancy overview is not repainted from another screen (regression)', () => {
  // The folder *picker* (overview) writes #allvacancies-list directly rather
  // than delegating to the guarded folder renderers, so it carried its own copy
  // of the same leak.
  const { window, document } = buildApp({
    html: `
      <div id="allvacancies-list">overview-original</div>
      <select id="allvacancies-industry"></select>
      <input id="allvacancies-search" value="">
      <select id="allvacancies-remote"></select>
      <select id="allvacancies-exp"></select>
      <button id="allvacancies-back"></button>
    `,
  });
  const el = document.getElementById('allvacancies-list');

  window.allVacanciesFolder = null;
  window.saShowScreen('home');
  window.renderAllVacanciesList();
  assert.equal(el.innerHTML, 'overview-original', 'the overview must not render from another screen');

  // On its own screen it still renders.
  window.saShowScreen('allvacancies');
  window.renderAllVacanciesList();
  assert.notEqual(el.innerHTML, 'overview-original', 'the owning screen must still render the overview');
});

// ---------------------------------------------------------------------------
// 4. Refresh repaints the visible screen, never a remembered one.
// ---------------------------------------------------------------------------
test('saRenderActiveScreen follows the visible screen, not the boot marker', () => {
  const calls = [];
  const { window } = buildApp({
    html: '<div id="hub-list"></div><div id="allvacancies-list"></div><div id="poster-feed"></div>',
  });
  window.renderAllVacanciesList = () => calls.push('allvacancies');
  window.renderPosterFeed = () => calls.push('posters');
  window.filterAndRenderCached = () => calls.push('home');
  window.updateStats = () => calls.push('stats');

  // Booted into All Vacancies, user has since moved to Home.
  window.__saRestoredScreen = 'allvacancies';
  window.saShowScreen('home');
  window.saRenderActiveScreen();

  assert.ok(calls.includes('home'), 'the visible home screen must be repainted');
  assert.ok(!calls.includes('allvacancies'), 'the abandoned screen must not be repainted');
});

test('saRenderActiveScreen is a no-op when no screen is active', () => {
  const { window, document } = buildApp();
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  assert.equal(window.saRenderActiveScreen(), false);
});

test('a real loadAll() hydration paints the visible screen and leaves hidden screens alone (regression)', async () => {
  // This runs the ACTUAL loadAll() end to end, which is what the original bug
  // needed: hydration reached renderRestoredScreenContent() and repainted
  // window.__saRestoredScreen regardless of where the user was. Asserting on
  // saRenderActiveScreen() alone would not catch a loadAll() that stopped
  // calling it.
  const { window, document } = buildHydratableApp();
  const rendered = [];
  window.renderAllVacanciesList = () => rendered.push('allvacancies');
  window.filterAndRenderCached = () => rendered.push('home');
  window.updateStats = () => rendered.push('stats');

  // Booted on All Vacancies, user has since navigated to Home.
  window.__saRestoredScreen = 'allvacancies';
  window.saShowScreen('home');

  const folderList = document.getElementById('allvacancies-list');
  await window.loadAll();

  assert.ok(rendered.includes('home'), 'hydration must repaint the visible home screen');
  assert.ok(!rendered.includes('allvacancies'), 'hydration must not repaint the abandoned screen');
  assert.equal(folderList.innerHTML, 'original', 'a hidden folder listing must survive hydration untouched');
});

test('a superseded loadAll() commits nothing', async () => {
  // The epoch must be enforced inside loadAll() itself, not only at its call
  // sites, so a hydration that was already in flight when a newer one started
  // cannot write its older generation into the shared caches.
  const { window, document } = buildHydratableApp();
  let rendered = 0;
  window.filterAndRenderCached = () => { rendered += 1; };
  window.updateStats = () => {};

  const staleToken = window.saBeginRefresh('stale');
  // A newer generation starts before the stale one reaches its commit block.
  const staleRun = window.loadAll(staleToken);
  window.saBeginRefresh('newer');
  await staleRun;

  assert.equal(rendered, 0, 'the superseded generation must not render');
  // Falsy rather than strictly null: the stale generation returns at its first
  // write gate, so it never publishes a payload at all.
  assert.ok(!window.__saStartupPayload, 'the superseded generation must not publish its payload');
  assert.ok(document.getElementById('allvacancies-list'), 'document sanity');
});

// ---------------------------------------------------------------------------
// 5. Refresh means refresh: transient state and the memo are cleared.
// ---------------------------------------------------------------------------
test('saResetTransientScreenState clears folder, pagination and restore markers', () => {
  const { window } = buildApp();
  window.allVacanciesFolder = 'adzuna';
  window.dedicatedVacancyFolder = 'adzuna';
  window.dedicatedVacancyPage = 3;
  window.dedicatedVacancyRows = [{ id: 'stale-row' }];
  window.dedicatedVacancyHasMore = true;
  window.generalVacancyPage = 2;
  window.generalVacancyRows = [{ id: 'stale-general' }];
  window.generalVacancyHasMore = true;
  window.vacancyFolderDisplayLimit = 90;
  window.generalVacancyCountLoaded = true;
  window.dedicatedVacancyCountsLoaded = true;
  window.__saRestoredScreen = 'allvacancies';
  const generalRequestId = window.generalVacancyRequestId;
  const dedicatedRequestId = window.dedicatedVacancyRequestId;

  window.saResetTransientScreenState();

  assert.equal(window.allVacanciesFolder, null, 'the open folder must be closed by a refresh');
  assert.equal(window.dedicatedVacancyFolder, '');
  assert.equal(window.dedicatedVacancyPage, 0);
  // The app's arrays live in the jsdom realm, so compare values rather than
  // prototypes: a deepStrictEqual against a Node-realm [] would fail on the
  // cross-realm Array.prototype even for identical contents.
  assert.equal(window.dedicatedVacancyRows.length, 0, 'stale folder rows must be dropped');
  assert.equal(window.dedicatedVacancyHasMore, false);
  assert.equal(window.generalVacancyPage, 0);
  assert.equal(window.generalVacancyRows.length, 0);
  assert.equal(window.vacancyFolderDisplayLimit, 30);
  assert.equal(window.generalVacancyCountLoaded, false, 'derived counts must be re-derived');
  assert.equal(window.dedicatedVacancyCountsLoaded, false);
  assert.equal(window.__saRestoredScreen, null, 'the boot-time screen marker must be cleared');
  assert.notEqual(window.generalVacancyRequestId, generalRequestId, 'in-flight folder reads must be invalidated');
  assert.notEqual(window.dedicatedVacancyRequestId, dedicatedRequestId);
});

test('a refresh cannot redeploy the previously-open folder (regression)', () => {
  // End-to-end shape of the reported bug: the page boots on All Vacancies with
  // the Himalayas folder open, the user goes Home and taps Home (refresh), and
  // the refresh used to leave allVacanciesFolder set so the folder listing was
  // rendered back over the visible screen.
  const { window, document } = buildApp({
    html: '<div id="allvacancies-list">original</div>',
  });
  window.allVacanciesFolder = 'himalayas';
  window.dedicatedVacancyFolder = 'himalayas';
  window.__saRestoredScreen = 'allvacancies';
  window.saShowScreen('home');

  window.saResetTransientScreenState();

  assert.equal(window.allVacanciesFolder, null);
  assert.equal(window.__saRestoredScreen, null);
  // The folder renderer can no longer reach the list at all.
  const el = document.getElementById('allvacancies-list');
  window.dedicatedVacancyError = true;
  window.renderDedicatedVacancyCards(false);
  assert.equal(el.innerHTML, 'original', 'the stale folder listing must not be redeployed');
  assert.equal(window.saActiveScreenName(), 'home');
});

test('saInvalidateStartupData drops the memoised payload', () => {
  const { window } = buildApp();
  window.__saStartupPayload = { generated_at: '2026-09-25T00:00:00Z', agencies: [] };
  window.saInvalidateStartupData();
  assert.equal(window.__saStartupPayload, null);
});

// ---------------------------------------------------------------------------
// 6. Data age comes from the payload, not from the fetch moment.
// ---------------------------------------------------------------------------
test('payloadDataAsOf reads the worker generated_at', () => {
  const { window } = buildApp();
  const iso = '2026-09-25T04:30:00.000Z';
  assert.equal(window.saPayloadDataAsOf({ generated_at: iso }), Date.parse(iso));
  assert.equal(window.saPayloadDataAsOf({ generatedAt: iso }), Date.parse(iso));
  assert.equal(window.saPayloadDataAsOf({ as_of: iso }), Date.parse(iso));
  assert.equal(window.saPayloadDataAsOf({ generated_at: Date.parse(iso) }), Date.parse(iso));
  assert.equal(window.saPayloadDataAsOf({}), null);
  assert.equal(window.saPayloadDataAsOf(null), null);
  assert.equal(window.saPayloadDataAsOf({ generated_at: 'not a date' }), null);
});

test('syncDataFreshnessFromPayload reports the payload age', () => {
  const { window } = buildApp();
  const iso = '2026-09-25T04:30:00.000Z';
  window.__saStartupPayload = { generated_at: iso };
  const before = Date.now();
  const asOf = window.saSyncDataFreshnessFromPayload();
  assert.equal(asOf, Date.parse(iso));
  assert.ok(asOf < before, 'a payload timestamp is older than the moment it was fetched');
  assert.equal(window.lastDataRefreshAt, Date.parse(iso));
});

// ---------------------------------------------------------------------------
// 7. The refresh entry point composes every guarantee together.
// ---------------------------------------------------------------------------
test('saRefreshAll resets state, invalidates the memo and takes one epoch', async () => {
  const { window } = buildApp();
  let observed = null;
  window.allVacanciesFolder = 'government';
  window.__saRestoredScreen = 'allvacancies';
  window.__saStartupPayload = { stale: true };
  // Replace loadAll with an observer that records the state it is handed.
  window.loadAll = (token) => {
    observed = {
      token,
      folder: window.allVacanciesFolder,
      restored: window.__saRestoredScreen,
      payload: window.__saStartupPayload,
    };
    return Promise.resolve();
  };

  const before = window.saCurrentRefreshToken();
  await window.saRefreshAll('test');

  assert.ok(observed, 'the refresh must run a hydration');
  assert.equal(observed.folder, null, 'transient state must be cleared before hydrating');
  assert.equal(observed.restored, null);
  assert.equal(observed.payload, null, 'the memo must be dropped before hydrating');
  assert.ok(observed.token > before, 'the refresh must run under a fresh epoch');
  assert.equal(observed.token, window.saCurrentRefreshToken(), 'the hydration shares the refresh epoch');
});

test('saRefreshAll surfaces load failures without rejecting', async () => {
  const { window } = buildApp();
  window.loadAll = () => Promise.reject(new Error('boom'));
  const token = await window.saRefreshAll('failure-path');
  assert.equal(typeof token, 'number', 'the caller still receives its token');
});

// ---------------------------------------------------------------------------
// 8. Listeners exist exactly once (no duplicate hydration per wake-up).
// ---------------------------------------------------------------------------
test('the pipeline registers the idle/pageshow/online lifecycle', () => {
  const added = [];
  const originalAdd = globalThis.document?.addEventListener;
  const { window, document } = buildApp();
  // jsdom already recorded app load-time listeners; count the ones the pipeline
  // owns by dispatching and observing that refreshAll is reached.
  let refreshes = 0;
  window.loadAll = () => { refreshes += 1; return Promise.resolve(); };
  void originalAdd;

  // pageshow with persisted=true is the tab-restore path.
  const evt = new window.Event('pageshow');
  Object.defineProperty(evt, 'persisted', { value: true });
  window.dispatchEvent(evt);
  assert.ok(document, 'document is available');
  assert.equal(refreshes, 1, 'pageshow restore must trigger exactly one hydration');
});

test('a persisted pageshow does not double-refresh', () => {
  const { window } = buildApp();
  let refreshes = 0;
  window.loadAll = () => { refreshes += 1; return Promise.resolve(); };
  const evt = new window.Event('pageshow');
  Object.defineProperty(evt, 'persisted', { value: true });
  window.dispatchEvent(evt);
  const nonPersisted = new window.Event('pageshow');
  Object.defineProperty(nonPersisted, 'persisted', { value: false });
  window.dispatchEvent(nonPersisted);
  assert.equal(refreshes, 1, 'a non-persisted pageshow must not refresh again');
});

test('a brief app switch does not refresh, a long idle does', () => {
  const { window, document } = buildApp();
  let refreshes = 0;
  window.loadAll = () => { refreshes += 1; return Promise.resolve(); };

  function hide() {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
  }
  function show() {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
  }

  hide();
  show();
  assert.equal(refreshes, 0, 'a quick app switch must keep the current view');

  // Simulate a long background period by backdating the recorded hide time.
  hide();
  // The pipeline reads its clock from the jsdom realm (window.Date), not
  // Node's, so advance that one.
  const realNow = window.Date.now;
  window.Date.now = () => realNow() + 3 * 60 * 1000;
  show();
  window.Date.now = realNow;
  assert.equal(refreshes, 1, 'an idle wake-up must refresh once');
});
