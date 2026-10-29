/*
 * SA Recruiters -- app.js split 1/8: app-core.js
 * Config, analytics, manager-token helpers, theme, slug/escape utilities
 *
 * Part of the original monolithic app.js. Now an ES module: it imports what it
 * uses from the other app-*.js files and exports its top-level declarations.
 * A window bridge at the bottom keeps inline onclick="" handlers and the
 * classic scripts (app-vacancy-v2.js, app-alerts.js, content*.js) working.
 * Bundled by Vite via app-entry.js (see scripts/bundle-app.js).
 */

import { saveManagerTokenToSupabase } from './app-data.js';
import { renderSaved } from './app-cards.js';
import { closeSiteMenu, renderAccountDetails, renderAccountIdentity, showToast } from './app-ui.js';



// ===== Supabase config (database only — file storage moved to R2, see below) =====
export var SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
export var SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';
// ===== Cloudflare R2 upload worker (candidate photos, daily tracks) =====
// Set this to your deployed Worker URL, e.g.
// 'https://sarecruiters-uploader.<your-subdomain>.workers.dev'
export var R2_WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
export var STARTUP_DATA_URL = R2_WORKER_URL + '/api/startup';
// Public inventory is served by the Cloudflare Worker (D1/R2). Keep the
// committed snapshot for SEO/build tooling, but do not let browsers use it as
// a parallel serving layer or fall back to direct Supabase vacancy reads.
export var STATIC_DATA_URL = 'data/startup.json';
export var staticDataEnabled = false;
export var supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
if (!supabaseClient) console.warn('[SA Recruiters] Supabase client unavailable; using local read-only fallback until the connection is restored.');

// ===== Required Google sign-in for the public app =====
export var saAuthUser = null;
export var saAuthStarted = false;
export var saAuthStartCallback = null;
export var saAuthRedirecting = false;

// ===== Employer / agency Smart Manager links bypass Google sign-in AND the
// Talent Pool profile gate entirely (see detectManagerMode() in
// app-manager-employer.js, which calls window.__saEnterManagerLinkMode() the
// moment it sees ?manage=TOKEN or ?manage_employer=TOKEN in the URL — before
// Google auth has had any chance to resolve). A visitor on one of these
// links is an employer/agency being taken straight to their manager screen;
// they must never see the consumer sign-in curtain. =====
export var __saManagerLinkMode = false;
window.__saEnterManagerLinkMode = function () {
  if (__saManagerLinkMode) return;
  __saManagerLinkMode = true;
  __saAuthReady = true;
  var gate = document.getElementById('auth-gate');
  if (gate) gate.style.display = 'none';
  var splash = document.getElementById('app-splash');
  if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
  document.body.classList.add('app-ready');
  __saRevealed = true;
};
export function authRedirectUrl() {
  return window.location.origin + window.location.pathname + window.location.search;
}
export function isGoogleUser(user) {
  if (!user) return false;
  if (user.app_metadata && user.app_metadata.provider === 'google') return true;
  return Array.isArray(user.identities) && user.identities.some(function(identity) { return identity.provider === 'google'; });
}
export function renderAuthUser(user) {
  var name = user && (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user.email) || 'Guest';
  var avatar = user && user.user_metadata && (user.user_metadata.profile_photo || user.user_metadata.avatar_url);
  var authName = document.getElementById('welcome-user-name');
  if (authName) authName.textContent = user ? name : 'Guest';
  var modeLabel = document.getElementById('site-menu-account-mode');
  if (modeLabel) modeLabel.textContent = user ? 'Signed in with Google' : 'Browsing as a guest';
  var authAvatar = document.getElementById('welcome-user-avatar');
  if (authAvatar) {
    authAvatar.innerHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" alt="" decoding="async" referrerpolicy="no-referrer">' : '<span>' + escapeHtml((user ? name : 'A').charAt(0).toUpperCase()) + '</span>';
  }
  // Keep the My Account screen in sync with the identity (guest or signed in).
  if (typeof renderAccountIdentity === 'function') renderAccountIdentity(user);
  try { document.dispatchEvent(new CustomEvent('sa-auth-change', { detail: { user: user || null } })); } catch (e) {}
}
// ===== Open app: auth is optional =====
// The app is browsable by guests; a Google account unlocks unlimited
// vacancy views, cross-device saved jobs, submissions tracking, and the
// Talent Pool. There is no blocking gate: the account screen (Profile tab)
// carries the sign-in card for guests.
export function setAuthGateState(state, message) {
  // Legacy name kept: pending-submissions and other modules still call this
  // with friendly status text. The status now lives on the account screen's
  // sign-in card instead of a fullscreen gate.
  var status = document.getElementById('account-signin-status');
  if (status && typeof message === 'string') status.textContent = message;
  var button = document.getElementById('google-sign-in');
  if (button) button.disabled = state === 'loading' || state === 'redirecting';
}
export async function signInWithGoogle() {
  if (!supabaseClient || saAuthRedirecting) return;
  saAuthRedirecting = true;
  setAuthGateState('redirecting', 'Opening Google sign-in…');
  var timeoutId;
  try {
    var timeout = new Promise(function(resolve, reject) {
      timeoutId = window.setTimeout(function() { reject(new Error('Google sign-in request timed out.')); }, 12000);
    });
    var result = await Promise.race([
      supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authRedirectUrl(),
          queryParams: { access_type: 'offline', prompt: 'select_account' },
          skipBrowserRedirect: true
        }
      }),
      timeout
    ]);
    if (timeoutId) window.clearTimeout(timeoutId);
    if (result && result.error) throw result.error;
    var oauthUrl = result && result.data && result.data.url;
    if (!oauthUrl) throw new Error('Google sign-in did not return a redirect URL.');
    // Use a top-level navigation so mobile browsers do not strand users on
    // the disabled account card after the OAuth URL has been created.
    window.location.assign(oauthUrl);
  } catch (error) {
    if (timeoutId) window.clearTimeout(timeoutId);
    saAuthRedirecting = false;
    var timedOut = error && /timed out/i.test(String(error.message || error));
    setAuthGateState('error', timedOut
      ? 'Google sign-in is taking too long. Check your connection and try again.'
      : 'Google sign-in could not start. Please try again.');
    console.error('Google sign-in', error);
  }
}
window.signInWithGoogle = signInWithGoogle;
export async function signOutSaRecruiters() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  // No reload: the signed-in-only listeners stay attached, so we just clear
  // the user, reset the guest quota clock, and repaint the account screen
  // (and any signed-in-only UI) as guest mode.
  saAuthUser = null;
  saAuthStarted = false;
  resetGuestQuotaIfNewDay();
  renderAuthUser(null);
  renderAccountDetails();
  closeSiteMenu();
  showToast('Signed out — you can keep browsing as a guest.');
}
export function startAuthenticatedApp(callback) {
  saAuthStartCallback = callback;
  // The app boots EXACTLY ONCE, signed in or not: guests boot immediately
  // once the session check resolves, so the directory is browsable without
  // any account. The boot callback is consumed on first run so a later
  // auth event can never double-boot (loadAll twice).
  var booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    if (saAuthStartCallback) { var cb = saAuthStartCallback; saAuthStartCallback = null; cb(); }
  }
  // Wire every sign-in button (account screen card + guest-limit sheet).
  document.querySelectorAll('#google-sign-in').forEach(function(button) {
    button.addEventListener('click', signInWithGoogle);
  });
  if (!supabaseClient || !supabaseClient.auth) {
    setAuthGateState('error', 'Sign-in is unavailable right now. Browsing still works.');
    bootOnce();
    return;
  }
  // Do not make an offline launch wait for Supabase's session request. The
  // service-worker shell and IndexedDB directory cache are sufficient for a
  // useful guest session; auth can resolve later when connectivity returns.
  if (navigator.onLine === false) bootOnce();
  supabaseClient.auth.onAuthStateChange(function(event, session) {
    saAuthUser = session && session.user ? session.user : null;
    if (saAuthUser && !isGoogleUser(saAuthUser)) {
      saAuthUser = null;
      supabaseClient.auth.signOut();
      setAuthGateState('error', 'Please continue with Google.');
      return;
    }
    renderAuthUser(saAuthUser);
    if (saAuthUser && !saAuthStarted) {
      saAuthStarted = true;
      __saAuthReady = true;
      bootOnce();
      // Covers the rare guest → signed-in transition without a page reload
      // (boot already ran, so its signed-in-only sync was skipped).
      if (typeof loadSavedVacanciesFromSupabase === 'function') loadSavedVacanciesFromSupabase();
      if (typeof renderAccountDetails === 'function') renderAccountDetails();
    } else if (!saAuthUser && saAuthStarted) {
      // Session expired mid-session: drop back to guest mode in place.
      saAuthStarted = false;
      __saAuthReady = false;
      renderAccountDetails();
      showToast('Your session ended — you can keep browsing as a guest.');
    }
  });
  supabaseClient.auth.getSession().then(async function(result) {
    if (result.error) throw result.error;
    var session = result.data && result.data.session;
    saAuthUser = session && session.user ? session.user : null;
    if (saAuthUser && !isGoogleUser(saAuthUser)) {
      await supabaseClient.auth.signOut();
      saAuthUser = null;
    }
    renderAuthUser(saAuthUser);
    if (saAuthUser && !saAuthStarted) {
      saAuthStarted = true;
      __saAuthReady = true;
    }
    // Guests and signed-in users both boot here.
    bootOnce();
  }).catch(function(error) {
    console.error('Supabase auth session', error);
    // Browsing must still work when the auth check fails.
    bootOnce();
  });
}

// ===== Guest free-view quota =====
// Guests can open GUEST_DAILY_VACANCY_LIMIT vacancies per calendar day
// (device-local). Signed-in users are unmetered. The counter resets at
// midnight via resetGuestQuotaIfNewDay(), which runs on boot, on sign-out,
// and on the visibility/pageshow resume hooks.
export var GUEST_DAILY_VACANCY_LIMIT = 5;
export function guestQuotaState() {
  try {
    var raw = JSON.parse(localStorage.getItem('sa_guest_quota_v1') || 'null') || {};
    var today = new Date();
    var key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    if (raw.day !== key) return { day: key, used: 0, limit: GUEST_DAILY_VACANCY_LIMIT };
    return { day: raw.day || key, used: Math.max(0, Number(raw.used) || 0), limit: GUEST_DAILY_VACANCY_LIMIT };
  } catch(e) {
    return { day: '', used: 0, limit: GUEST_DAILY_VACANCY_LIMIT };
  }
}
export function resetGuestQuotaIfNewDay() {
  // Called on boot/resume: writing the fresh day key is the reset.
  guestQuotaState();
}
export function registerVacancyOpen() {
  // Returns true if the open is allowed. Guests consume one view; signed-in
  // users are always allowed.
  if (saAuthUser) return true;
  var q = guestQuotaState();
  if (q.used >= q.limit) return false;
  q.used += 1;
  try { localStorage.setItem('sa_guest_quota_v1', JSON.stringify(q)); } catch(e) {}
  if (typeof renderAccountDetails === 'function') renderAccountDetails();
  return true;
}
export function guestViewsRemaining() {
  if (saAuthUser) return Infinity;
  var q = guestQuotaState();
  return Math.max(0, q.limit - q.used);
}

export function analyticsRandomId(prefix) {
  try { if (window.crypto && crypto.randomUUID) return prefix + crypto.randomUUID(); } catch(e) {}
  return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
}
export var analyticsVisitorId = (function(){ try { var k='sa_analytics_visitor'; var v=localStorage.getItem(k); if(!v){ v=analyticsRandomId('v_'); localStorage.setItem(k,v); } return v; } catch(e){ return analyticsRandomId('v_'); } })();
export var analyticsSessionId = (function(){ try { var k='sa_analytics_session', t='sa_analytics_session_started', now=Date.now(), v=localStorage.getItem(k), started=Number(localStorage.getItem(t)||0); if(!v || !started || now-started >= 30*60*1000){ v=analyticsRandomId('s_'); localStorage.setItem(k,v); localStorage.setItem(t,String(now)); } return v; } catch(e){ return analyticsRandomId('s_'); } })();
export var analyticsPublicTraffic = null;
export async function canTrackPublicTraffic() {
  if (analyticsPublicTraffic !== null) return analyticsPublicTraffic;
  try {
    var auth = await supabaseClient.auth.getSession();
    var user = auth.data && auth.data.session && auth.data.session.user;
    if (!user) return (analyticsPublicTraffic = true);
    var check = await supabaseClient.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
    analyticsPublicTraffic = !(check.data && check.data.user_id);
  } catch(e) {
    // Never count authenticated sessions when admin status cannot be verified.
    analyticsPublicTraffic = false;
  }
  return analyticsPublicTraffic;
}
export function trackEvent(eventName, entityType, entityId, metadata) {
  try {
    canTrackPublicTraffic().then(function(allowed){
      if (!allowed || !supabaseClient) return;
      var row = { event_name:String(eventName||'unknown'), entity_type:entityType ? String(entityType) : null, entity_id:entityId ? String(entityId) : null, visitor_id:analyticsVisitorId, session_id:analyticsSessionId, is_admin:false, page_path:location.pathname, metadata:metadata || {} };
      supabaseClient.from('analytics_events').insert([row]).then(function(){}, function(){});
    });
  } catch(e) {}
}

export var editingId = null;
export var agenciesCache = [];
export var branchesCache = [];
export var vacanciesCache = [];
export var staticVacanciesCache = [];
export var employersCache = [];
export var generalVacancyCount = 0;
export var generalVacancyCountLoaded = false;
export var generalVacancyPageSize = 30;
export var generalVacancyPage = 0;
export var generalVacancyNextCursor = null;
export var generalVacancyHasMore = false;
export var generalVacancyLoading = false;
export var generalVacancyError = false;
export var generalVacancyRows = [];
export var generalVacancyQueryKey = '';
export var generalVacancyRequestId = 0;
// Dedicated-source vacancy folders (Himalayas/Adzuna/Government/Retail/
// Learnerships) used to be fully embedded in vacanciesCache via the startup
// payload -- that was ~95% of all vacancy rows and the main cause of a slow
// first load. They now lazy-load a page at a time, the same pattern as the
// General Vacancies folder just above, sharing this one state machine since
// only one folder is ever open at a time.
export var dedicatedVacancyFolder = '';
export var dedicatedVacancyPageSize = 30;
export var dedicatedVacancyPage = 0;
export var dedicatedVacancyNextCursor = null;
export var dedicatedVacancyHasMore = false;
export var dedicatedVacancyLoading = false;
export var dedicatedVacancyError = false;
export var dedicatedVacancyRows = [];
export var dedicatedVacancyQueryKey = '';
export var dedicatedVacancyRequestId = 0;
// Folder counts for the overview grid (Himalayas · N vacancies, etc.),
// populated from startup.counts.dedicated -- a handful of small indexed
// COUNT queries server-side, not the rows themselves.
export var dedicatedVacancyCounts = { himalayas: 0, adzuna: 0, government: 0, retail: 0, learnerships: 0 };
export var dedicatedVacancyCountsLoaded = false;
// Numbered-page browsing for vacancy listings (General/Agency/dedicated
// source folders all share this one page size). Rows still load from the
// server in batches behind the scenes -- see goToGeneralVacancyPage() /
// goToDedicatedVacancyPage() / goToAgencyFolderPage() in app-ui.js -- but
// the visible list only ever shows one page's worth of cards at a time.
export var VAC_PAGE_SIZE = 10;
export var generalVacancyDisplayPage = 1;
export var dedicatedVacancyDisplayPage = 1;
export var agencyFolderDisplayPage = 1;
// Public static listing URLs are generated from the same deterministic maps
// used by generate-pages.js. This keeps links correct when names repeat.
export var publicAgencySlugs = Object.create(null);
export var publicVacancySlugs = Object.create(null);
export var publicVacancyRecordSlugs = typeof WeakMap === 'function' ? new WeakMap() : null;
export var isAdmin = false;
export var publicVacancyPostingOpen = false;
export var publicEmployerRegistrationOpen = false;
export var employerDirectoryOpen = true; // when false, only Supabase-verified Talent Pool registrants may browse employers and employer vacancies
export var talentPoolVerified = false;
export var savedSet = new Set(JSON.parse(localStorage.getItem('savedVacancies') || '[]'));
// ===== Saved vacancies: per-account sync (saved_vacancies table) =====
// savedSet above still seeds instantly from localStorage so Saved renders
// with zero lag, but Supabase (RLS: one row per signed-in user) is now the
// source of truth across devices. loadSavedVacanciesFromSupabase() is called
// once auth resolves (see startAuthenticatedApp's callback in app-ui.js) and
// merges in both directions: pulls the account's saved rows into savedSet,
// and pushes up any vacancies that were only saved locally pre-sign-in so
// that history isn't lost.
export var savedVacanciesSynced = false;
export async function loadSavedVacanciesFromSupabase() {
  if (!supabaseClient || !saAuthUser || savedVacanciesSynced) return;
  savedVacanciesSynced = true;
  try {
    var result = await supabaseClient.from('saved_vacancies').select('vacancy_id').eq('user_id', saAuthUser.id);
    if (result.error) { console.error('load saved_vacancies', result.error); return; }
    var remoteIds = (result.data || []).map(function(r){ return r.vacancy_id; });
    var localOnly = Array.from(savedSet).filter(function(id){ return remoteIds.indexOf(id) === -1; });
    remoteIds.forEach(function(id){ savedSet.add(id); });
    localStorage.setItem('savedVacancies', JSON.stringify(Array.from(savedSet)));
    if (typeof renderSaved === 'function') renderSaved();
    // Push up anything saved locally before this account had synced yet.
    if (localOnly.length) {
      var rows = localOnly.map(function(id){ return { user_id: saAuthUser.id, vacancy_id: id }; });
      supabaseClient.from('saved_vacancies').upsert(rows, { onConflict: 'user_id,vacancy_id' }).then(function(){}, function(){});
    }
  } catch(e) { console.error('load saved_vacancies', e); }
}
export function syncSavedVacancy(vacancyId, isSaved) {
  if (!supabaseClient || !saAuthUser) return;
  try {
    if (isSaved) {
      supabaseClient.from('saved_vacancies').upsert([{ user_id: saAuthUser.id, vacancy_id: vacancyId }], { onConflict: 'user_id,vacancy_id' }).then(function(){}, function(){});
    } else {
      supabaseClient.from('saved_vacancies').delete().eq('user_id', saAuthUser.id).eq('vacancy_id', vacancyId).then(function(){}, function(){});
    }
  } catch(e) {}
}
// ===== SMART MANAGER: agency self-service links =====
export var managerMode = false;   // true when URL has ?manage=TOKEN
export var managerAgency = null;  // the agency object the manager is allowed to update
export var managerTokenMap = {};  // { tokenId: agencyId } — persisted in localStorage
export var managerPendingToken = null; // token detected before agencies loaded
// ===== SMART MANAGER: employer self-service links (vacancies only) =====
export var employerManagerMode = false;   // true when URL has ?manage_employer=TOKEN
export var managerEmployer = null;        // the employer object the manager is allowed to post vacancies for
export var employerManagerTokenMap = {};  // { tokenId: employerId } — persisted in localStorage
export var employerManagerPendingToken = null; // token detected before employers loaded

// Seed editable content sections (FAQ, CV prep, etc.) with defaults if needed
if (window.ContentMgr) ContentMgr.ensureSeeded();

export function genToken() {
  // 12-char URL-safe token
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var s = '';
  for (var i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export function managerTokenKey(agencyId) { return 'sa_manager_token_' + agencyId; }
export function getManagerToken(agencyId) {
  // Source of truth is Supabase (agenciesCache), so the token resolves on
  // any device, not just the one that generated it. Fall back to a local
  // cache copy only if the agency isn't in agenciesCache yet (e.g. called
  // before loadAll() finishes).
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  if (a && a.manage_token) return a.manage_token;
  try { return localStorage.getItem(managerTokenKey(agencyId)) || ''; } catch(e){ return ''; }
}
export function setManagerToken(agencyId, token) {
  // Update in-memory cache immediately so the UI reflects it right away
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  if (a) a.manage_token = token;
  managerTokenMap[token] = agencyId;
  try { localStorage.setItem(managerTokenKey(agencyId), token); } catch(e){}
  // Persist to Supabase so the link works from any device
  saveManagerTokenToSupabase(agencyId, token);
}
export function agencyIdFromToken(token) {
  if (!token) return null;
  // check cache first
  if (managerTokenMap[token]) return managerTokenMap[token];
  // Look up against Supabase-loaded agenciesCache (works cross-device)
  for (var i = 0; i < agenciesCache.length; i++) {
    if (agenciesCache[i].manage_token === token) {
      managerTokenMap[token] = agenciesCache[i].id;
      return agenciesCache[i].id;
    }
  }
  // Fallback: scan localStorage (covers agencies loaded before this fix
  // shipped, on the same browser that originally generated the token)
  for (var j = 0; j < agenciesCache.length; j++) {
    try {
      if (localStorage.getItem(managerTokenKey(agenciesCache[j].id)) === token) {
        managerTokenMap[token] = agenciesCache[j].id;
        return agenciesCache[j].id;
      }
    } catch(e){}
  }
  return null;
}
export function buildManagerLink(token) {
  // Use the current app URL with ?manage=TOKEN
  var base = window.location.origin + window.location.pathname;
  return base + '?manage=' + token;
}

// ----- Employer manager tokens (mirrors the agency ones above, but keyed
// off the `employers` table and its own ?manage_employer=TOKEN param, so
// the two self-service links never collide) -----
export function employerManagerTokenKey(employerId) { return 'sa_emp_manager_token_' + employerId; }
export function getEmployerManagerToken(employerId) {
  var e = employersCache.find(function(x){ return x.id === employerId; });
  if (e && e.manage_token) return e.manage_token;
  try { return localStorage.getItem(employerManagerTokenKey(employerId)) || ''; } catch(e){ return ''; }
}
export function setEmployerManagerToken(employerId, token) {
  var e = employersCache.find(function(x){ return x.id === employerId; });
  if (e) e.manage_token = token;
  employerManagerTokenMap[token] = employerId;
  try { localStorage.setItem(employerManagerTokenKey(employerId), token); } catch(e){}
  saveEmployerManagerTokenToSupabase(employerId, token);
}
export async function saveEmployerManagerTokenToSupabase(employerId, token) {
  // Token writes are privileged (see supabase/migrations/20260918_lock_down_manager_tokens.sql):
  // signed-in admins go through the admin_set_employer_manager_token RPC; the
  // direct update below is a fallback for deployments where the authenticated
  // role still holds the column grant. Anonymous visitors cannot write tokens.
  try {
    var rpc = await supabaseClient.rpc('admin_set_employer_manager_token', { p_employer_id: employerId, p_token: token });
    if (!rpc.error && rpc.data === true) return;
  } catch(e) { /* fall through to the legacy path */ }
  try {
    var { error } = await supabaseClient.from('employers').update({ manage_token: token }).eq('id', employerId);
    if (error) {
      console.error('employer manage_token save', error);
      if (typeof showToast === 'function') showToast('⚠ Manager link not saved — generate links from the admin console (Regenerate ALL tokens).');
    }
  } catch(e) { console.error('employer manage_token save', e); }
}
export function employerIdFromToken(token) {
  if (!token) return null;
  if (employerManagerTokenMap[token]) return employerManagerTokenMap[token];
  for (var i = 0; i < employersCache.length; i++) {
    if (employersCache[i].manage_token === token) {
      employerManagerTokenMap[token] = employersCache[i].id;
      return employersCache[i].id;
    }
  }
  for (var j = 0; j < employersCache.length; j++) {
    try {
      if (localStorage.getItem(employerManagerTokenKey(employersCache[j].id)) === token) {
        employerManagerTokenMap[token] = employersCache[j].id;
        return employersCache[j].id;
      }
    } catch(e){}
  }
  return null;
}
export function buildEmployerManagerLink(token) {
  var base = window.location.origin + window.location.pathname;
  return base + '?manage_employer=' + token;
}

/* ── First-paint reveal: hides the splash AND the sign-in gate together,
   but only once CSS has loaded, the user is authenticated, AND real app
   content (cached or freshly loaded) has actually been rendered — then
   waits two animation frames so the browser has genuinely painted that
   content before starting the fade.

   Previously the splash and the sign-in gate hid independently of each
   other and of real paint completion (the gate in particular used a
   hard, transition-less display:none, fired the instant auth succeeded
   — before bootAuthenticatedApp() had rendered anything). That's what
   produced the visible flicker/jump: an overlay could disappear a frame
   or two before the content behind it had actually painted, briefly
   exposing an empty/half-loaded shell that then visibly popped in a
   moment later as data streamed in. ───────────────────────────────── */
export var __saDataReady = false;
export var __saAuthReady = false;
export var __saRevealed = false;

export function __saHideOverlayNow(el, removeFromDom) {
  if (!el) return;
  if (removeFromDom) { if (el.parentNode) el.parentNode.removeChild(el); }
  else { el.style.display = 'none'; }
}
export function __saHideOverlayWithFade(el, removeFromDom) {
  if (!el || el.classList.contains('hide')) return;
  el.classList.add('hide');
  setTimeout(function () { __saHideOverlayNow(el, removeFromDom); }, 300);
}
export function __saApplyReveal(usingViewTransition) {
  if (typeof window.__saNormalizeStartupScreen === 'function') window.__saNormalizeStartupScreen();
  document.body.classList.add('app-ready');
  if (typeof __saClearSlowLoadStatus === 'function') __saClearSlowLoadStatus();
  var splash = document.getElementById('app-splash');
  var gate = document.getElementById('auth-gate');
  if (usingViewTransition) {
    // document.startViewTransition() already animates the before/after
    // states itself (a native cross-fade snapshot-to-snapshot), so the
    // overlays are removed outright here rather than also running our
    // own CSS opacity fade, which would otherwise double up the animation.
    __saHideOverlayNow(splash, true);
    __saHideOverlayNow(gate, false);
  } else {
    __saHideOverlayWithFade(splash, true);
    __saHideOverlayWithFade(gate, false);
  }
}
window.__saTryReveal = function () {
  // Guests are first-class: the reveal never waits for auth. __saAuthReady
  // only gates the signed-in data work (saved sync etc.), not the UI.
  if (__saRevealed || !__saDataReady || !window.__saCssReady) return;
  __saRevealed = true;
  // Two nested rAFs: the first runs once the browser has processed the
  // style/layout work from whatever just called this (e.g. the cards a
  // data load just rendered into the still-hidden .app); the second only
  // runs after that frame has actually been painted. Only then do we
  // start hiding the overlays, so neither the CSS fade nor the native
  // view-transition cross-fade can start before there's real, painted
  // content underneath them.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (typeof document.startViewTransition === 'function') {
        document.startViewTransition(function () { __saApplyReveal(true); });
      } else {
        __saApplyReveal(false);
      }
    });
  });
};
export function markAppDataReady() {
  __saDataReady = true;
  window.__saTryReveal();
}

/* ── Slow-load status text: stays invisible for the first SA_SLOW_LOAD_DELAY
   ms, so a normal, fast load never shows it. If the splash is still up
   after that delay, it fades in and cycles through short status messages
   with the three animated dots — reassurance that something is happening
   rather than the app being stuck. Cleared the moment the real reveal
   happens, wherever that fires from. ───────────────────────────────── */
export var SA_SLOW_LOAD_DELAY = 1400; // ms before we admit the load is taking a while
export var SA_SLOW_LOAD_MESSAGES = [
  { title: 'Getting things ready…', sub: 'Loading the latest listings' },
  { title: 'Almost there…', sub: 'Fetching vacancies and agency data' },
  { title: 'Just a moment…', sub: 'This is taking a little longer than usual' }
];
export var __saSlowLoadTimer = null;
export var __saSlowLoadCycleTimer = null;
export var __saSlowLoadIndex = 0;

export function __saCycleSlowLoadMessage() {
  var titleEl = document.getElementById('app-splash-title');
  var subEl = document.getElementById('app-splash-sub');
  if (!titleEl || !subEl) return;
  var msg = SA_SLOW_LOAD_MESSAGES[__saSlowLoadIndex % SA_SLOW_LOAD_MESSAGES.length];
  titleEl.textContent = msg.title;
  subEl.textContent = msg.sub;
  __saSlowLoadIndex++;
}
export function __saShowSlowLoadStatus() {
  if (__saRevealed) return; // already loaded by the time the delay elapsed
  var status = document.getElementById('app-splash-status');
  if (!status) return;
  status.classList.add('show');
  __saCycleSlowLoadMessage();
  __saSlowLoadCycleTimer = setInterval(__saCycleSlowLoadMessage, 2200);
}
export function __saClearSlowLoadStatus() {
  if (__saSlowLoadTimer) { clearTimeout(__saSlowLoadTimer); __saSlowLoadTimer = null; }
  if (__saSlowLoadCycleTimer) { clearInterval(__saSlowLoadCycleTimer); __saSlowLoadCycleTimer = null; }
}
__saSlowLoadTimer = setTimeout(__saShowSlowLoadStatus, SA_SLOW_LOAD_DELAY);
// Safety net: never leave the splash up more than 2.5s even if the
// stylesheet load event is somehow missed (slow network, browser quirk).
// Data may still be loading when this fires — the app paints whatever it
// has (cached shell or skeletons) and refreshes in place afterwards.
setTimeout(function () {
  window.__saCssReady = true;
  markAppDataReady();
}, 2500);

/* ── Theme (day / night) ───────────────────────────── */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.getElementById('meta-theme');
  if (meta) meta.setAttribute('content', '#000000');
  // Update menu label/icon
  var mIcon = document.getElementById('theme-menu-icon');
  var mLabel = document.getElementById('theme-menu-label');
  var siteMenuThemeLabel = document.getElementById('site-menu-theme-label');
  /* Tile icons: CSS .profile-menu-item .mi-icon svg sets stroke:#fff, size, etc. */
  if (mIcon) mIcon.innerHTML = theme === 'light'
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  if (mLabel) {
    // Update only the title text node, preserving the .mi-sub subtitle
    var labelText = theme === 'light' ? 'Switch to night mode' : 'Switch to day mode';
    if (mLabel.firstChild && mLabel.firstChild.nodeType === 3) {
      mLabel.firstChild.nodeValue = labelText;
    } else {
      // Fallback: rebuild with subtitle
      mLabel.innerHTML = labelText + '<span class="mi-sub">Toggle between light &amp; dark appearance</span>';
    }
  }
  if (siteMenuThemeLabel) siteMenuThemeLabel.textContent = theme === 'light' ? 'Switch to night mode' : 'Switch to day mode';
}
export function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light';
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('saTheme', next);
  applyTheme(next);
}
(function initTheme() {
  var saved = localStorage.getItem('saTheme') || 'light';
  applyTheme(saved);
})();

export function slugify(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'listing';
}

export function rebuildPublicListingSlugs() {
  publicAgencySlugs = Object.create(null);
  publicVacancySlugs = Object.create(null);
  publicVacancyRecordSlugs = typeof WeakMap === 'function' ? new WeakMap() : null;

  var agencyCounts = Object.create(null);
  agenciesCache.forEach(function(a) {
    var base = slugify(a.name);
    agencyCounts[base] = (agencyCounts[base] || 0) + 1;
  });
  agenciesCache.forEach(function(a) {
    var base = slugify(a.name);
    publicAgencySlugs[a.id] = agencyCounts[base] > 1
      ? base + '-' + String(a.id).slice(0, 6)
      : base;
  });

  var vacancyCounts = Object.create(null);
  var usedVacancySlugs = Object.create(null);
  vacanciesCache.forEach(function(v) {
    var base = slugify(v.title);
    vacancyCounts[base] = (vacancyCounts[base] || 0) + 1;
  });
  vacanciesCache.forEach(function(v, index) {
    var base = slugify(v.title);
    var hasStableId = v.id !== undefined && v.id !== null && v.id !== '';
    var slug = vacancyCounts[base] > 1 && hasStableId
      ? base + '-' + String(v.id).slice(0, 6)
      : (hasStableId ? base : base + '-row-' + index);
    if (usedVacancySlugs[slug]) slug = slug + '-row-' + index;
    usedVacancySlugs[slug] = true;
    if (hasStableId) publicVacancySlugs[v.id] = slug;
    if (publicVacancyRecordSlugs) publicVacancyRecordSlugs.set(v, slug);
  });
}
export function publicAgencySlug(a) {
  return publicAgencySlugs[a && a.id] || slugify(a && a.name);
}
export function publicVacancySlug(v) {
  return (v && publicVacancyRecordSlugs && publicVacancyRecordSlugs.get(v)) || publicVacancySlugs[v && v.id] || slugify(v && v.title);
}

export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
export function initials(n) {
  return (n || '?').trim().split(/\s+/).map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase();
}


// ===== window bridge (generated by the ES-module migration) =====
// Inline onclick=""/oninput="" handlers in index.html, string-built handlers in the
// templates above, and the classic scripts (app-vacancy-v2.js, app-alerts.js,
// content*.js) look these names up on window, exactly like they did when every
// file shared one global scope. Remove an entry only after checking nothing
// outside the module graph reads it.
export function set_saAuthUser(v) { saAuthUser = v; return v; }
export function set_editingId(v) { editingId = v; return v; }
export function set_agenciesCache(v) { agenciesCache = v; return v; }
export function set_branchesCache(v) { branchesCache = v; return v; }
export function set_vacanciesCache(v) { vacanciesCache = v; return v; }
export function set_staticVacanciesCache(v) { staticVacanciesCache = v; return v; }
export function set_employersCache(v) { employersCache = v; return v; }
export function set_generalVacancyCount(v) { generalVacancyCount = v; return v; }
export function set_generalVacancyCountLoaded(v) { generalVacancyCountLoaded = v; return v; }
export function set_generalVacancyPage(v) { generalVacancyPage = v; return v; }
export function set_generalVacancyNextCursor(v) { generalVacancyNextCursor = v; return v; }
export function set_generalVacancyHasMore(v) { generalVacancyHasMore = v; return v; }
export function set_generalVacancyLoading(v) { generalVacancyLoading = v; return v; }
export function set_generalVacancyError(v) { generalVacancyError = v; return v; }
export function set_generalVacancyRows(v) { generalVacancyRows = v; return v; }
export function set_generalVacancyQueryKey(v) { generalVacancyQueryKey = v; return v; }
export function set_generalVacancyRequestId(v) { generalVacancyRequestId = v; return v; }
export function set_dedicatedVacancyFolder(v) { dedicatedVacancyFolder = v; return v; }
export function set_dedicatedVacancyPage(v) { dedicatedVacancyPage = v; return v; }
export function set_dedicatedVacancyNextCursor(v) { dedicatedVacancyNextCursor = v; return v; }
export function set_dedicatedVacancyHasMore(v) { dedicatedVacancyHasMore = v; return v; }
export function set_dedicatedVacancyLoading(v) { dedicatedVacancyLoading = v; return v; }
export function set_dedicatedVacancyError(v) { dedicatedVacancyError = v; return v; }
export function set_dedicatedVacancyRows(v) { dedicatedVacancyRows = v; return v; }
export function set_dedicatedVacancyQueryKey(v) { dedicatedVacancyQueryKey = v; return v; }
export function set_dedicatedVacancyRequestId(v) { dedicatedVacancyRequestId = v; return v; }
export function set_dedicatedVacancyCounts(v) { dedicatedVacancyCounts = v; return v; }
export function set_dedicatedVacancyCountsLoaded(v) { dedicatedVacancyCountsLoaded = v; return v; }
export function set_generalVacancyDisplayPage(v) { generalVacancyDisplayPage = v; return v; }
export function set_dedicatedVacancyDisplayPage(v) { dedicatedVacancyDisplayPage = v; return v; }
export function set_agencyFolderDisplayPage(v) { agencyFolderDisplayPage = v; return v; }
export function set_publicVacancyPostingOpen(v) { publicVacancyPostingOpen = v; return v; }
export function set_publicEmployerRegistrationOpen(v) { publicEmployerRegistrationOpen = v; return v; }
export function set_employerDirectoryOpen(v) { employerDirectoryOpen = v; return v; }
export function set_talentPoolVerified(v) { talentPoolVerified = v; return v; }
export function set_managerMode(v) { managerMode = v; return v; }
export function set_managerAgency(v) { managerAgency = v; return v; }
export function set_managerPendingToken(v) { managerPendingToken = v; return v; }
export function set_employerManagerMode(v) { employerManagerMode = v; return v; }
export function set_managerEmployer(v) { managerEmployer = v; return v; }
export function set_employerManagerPendingToken(v) { employerManagerPendingToken = v; return v; }
Object.assign(window, {
  authRedirectUrl,
  isGoogleUser,
  renderAuthUser,
  setAuthGateState,
  signInWithGoogle,
  signOutSaRecruiters,
  startAuthenticatedApp,
  guestQuotaState,
  resetGuestQuotaIfNewDay,
  registerVacancyOpen,
  guestViewsRemaining,
  analyticsRandomId,
  canTrackPublicTraffic,
  trackEvent,
  loadSavedVacanciesFromSupabase,
  syncSavedVacancy,
  genToken,
  managerTokenKey,
  getManagerToken,
  setManagerToken,
  agencyIdFromToken,
  buildManagerLink,
  employerManagerTokenKey,
  getEmployerManagerToken,
  setEmployerManagerToken,
  saveEmployerManagerTokenToSupabase,
  employerIdFromToken,
  buildEmployerManagerLink,
  __saHideOverlayNow,
  __saHideOverlayWithFade,
  __saApplyReveal,
  markAppDataReady,
  __saCycleSlowLoadMessage,
  __saShowSlowLoadStatus,
  __saClearSlowLoadStatus,
  applyTheme,
  toggleTheme,
  slugify,
  rebuildPublicListingSlugs,
  publicAgencySlug,
  publicVacancySlug,
  escapeHtml,
  initials,
});
Object.defineProperties(window, {
  SUPABASE_URL: { get: () => SUPABASE_URL, set: (v) => { SUPABASE_URL = v; }, configurable: true, enumerable: true },
  SUPABASE_ANON_KEY: { get: () => SUPABASE_ANON_KEY, set: (v) => { SUPABASE_ANON_KEY = v; }, configurable: true, enumerable: true },
  R2_WORKER_URL: { get: () => R2_WORKER_URL, set: (v) => { R2_WORKER_URL = v; }, configurable: true, enumerable: true },
  STARTUP_DATA_URL: { get: () => STARTUP_DATA_URL, set: (v) => { STARTUP_DATA_URL = v; }, configurable: true, enumerable: true },
  STATIC_DATA_URL: { get: () => STATIC_DATA_URL, set: (v) => { STATIC_DATA_URL = v; }, configurable: true, enumerable: true },
  staticDataEnabled: { get: () => staticDataEnabled, set: (v) => { staticDataEnabled = v; }, configurable: true, enumerable: true },
  supabaseClient: { get: () => supabaseClient, set: (v) => { supabaseClient = v; }, configurable: true, enumerable: true },
  saAuthUser: { get: () => saAuthUser, set: (v) => { saAuthUser = v; }, configurable: true, enumerable: true },
  saAuthStarted: { get: () => saAuthStarted, set: (v) => { saAuthStarted = v; }, configurable: true, enumerable: true },
  saAuthStartCallback: { get: () => saAuthStartCallback, set: (v) => { saAuthStartCallback = v; }, configurable: true, enumerable: true },
  saAuthRedirecting: { get: () => saAuthRedirecting, set: (v) => { saAuthRedirecting = v; }, configurable: true, enumerable: true },
  __saManagerLinkMode: { get: () => __saManagerLinkMode, set: (v) => { __saManagerLinkMode = v; }, configurable: true, enumerable: true },
  GUEST_DAILY_VACANCY_LIMIT: { get: () => GUEST_DAILY_VACANCY_LIMIT, set: (v) => { GUEST_DAILY_VACANCY_LIMIT = v; }, configurable: true, enumerable: true },
  analyticsVisitorId: { get: () => analyticsVisitorId, set: (v) => { analyticsVisitorId = v; }, configurable: true, enumerable: true },
  analyticsSessionId: { get: () => analyticsSessionId, set: (v) => { analyticsSessionId = v; }, configurable: true, enumerable: true },
  analyticsPublicTraffic: { get: () => analyticsPublicTraffic, set: (v) => { analyticsPublicTraffic = v; }, configurable: true, enumerable: true },
  editingId: { get: () => editingId, set: (v) => { editingId = v; }, configurable: true, enumerable: true },
  agenciesCache: { get: () => agenciesCache, set: (v) => { agenciesCache = v; }, configurable: true, enumerable: true },
  branchesCache: { get: () => branchesCache, set: (v) => { branchesCache = v; }, configurable: true, enumerable: true },
  vacanciesCache: { get: () => vacanciesCache, set: (v) => { vacanciesCache = v; }, configurable: true, enumerable: true },
  staticVacanciesCache: { get: () => staticVacanciesCache, set: (v) => { staticVacanciesCache = v; }, configurable: true, enumerable: true },
  employersCache: { get: () => employersCache, set: (v) => { employersCache = v; }, configurable: true, enumerable: true },
  generalVacancyCount: { get: () => generalVacancyCount, set: (v) => { generalVacancyCount = v; }, configurable: true, enumerable: true },
  generalVacancyCountLoaded: { get: () => generalVacancyCountLoaded, set: (v) => { generalVacancyCountLoaded = v; }, configurable: true, enumerable: true },
  generalVacancyPageSize: { get: () => generalVacancyPageSize, set: (v) => { generalVacancyPageSize = v; }, configurable: true, enumerable: true },
  generalVacancyPage: { get: () => generalVacancyPage, set: (v) => { generalVacancyPage = v; }, configurable: true, enumerable: true },
  generalVacancyNextCursor: { get: () => generalVacancyNextCursor, set: (v) => { generalVacancyNextCursor = v; }, configurable: true, enumerable: true },
  generalVacancyHasMore: { get: () => generalVacancyHasMore, set: (v) => { generalVacancyHasMore = v; }, configurable: true, enumerable: true },
  generalVacancyLoading: { get: () => generalVacancyLoading, set: (v) => { generalVacancyLoading = v; }, configurable: true, enumerable: true },
  generalVacancyError: { get: () => generalVacancyError, set: (v) => { generalVacancyError = v; }, configurable: true, enumerable: true },
  generalVacancyRows: { get: () => generalVacancyRows, set: (v) => { generalVacancyRows = v; }, configurable: true, enumerable: true },
  generalVacancyQueryKey: { get: () => generalVacancyQueryKey, set: (v) => { generalVacancyQueryKey = v; }, configurable: true, enumerable: true },
  generalVacancyRequestId: { get: () => generalVacancyRequestId, set: (v) => { generalVacancyRequestId = v; }, configurable: true, enumerable: true },
  dedicatedVacancyFolder: { get: () => dedicatedVacancyFolder, set: (v) => { dedicatedVacancyFolder = v; }, configurable: true, enumerable: true },
  dedicatedVacancyPageSize: { get: () => dedicatedVacancyPageSize, set: (v) => { dedicatedVacancyPageSize = v; }, configurable: true, enumerable: true },
  dedicatedVacancyPage: { get: () => dedicatedVacancyPage, set: (v) => { dedicatedVacancyPage = v; }, configurable: true, enumerable: true },
  dedicatedVacancyNextCursor: { get: () => dedicatedVacancyNextCursor, set: (v) => { dedicatedVacancyNextCursor = v; }, configurable: true, enumerable: true },
  dedicatedVacancyHasMore: { get: () => dedicatedVacancyHasMore, set: (v) => { dedicatedVacancyHasMore = v; }, configurable: true, enumerable: true },
  dedicatedVacancyLoading: { get: () => dedicatedVacancyLoading, set: (v) => { dedicatedVacancyLoading = v; }, configurable: true, enumerable: true },
  dedicatedVacancyError: { get: () => dedicatedVacancyError, set: (v) => { dedicatedVacancyError = v; }, configurable: true, enumerable: true },
  dedicatedVacancyRows: { get: () => dedicatedVacancyRows, set: (v) => { dedicatedVacancyRows = v; }, configurable: true, enumerable: true },
  dedicatedVacancyQueryKey: { get: () => dedicatedVacancyQueryKey, set: (v) => { dedicatedVacancyQueryKey = v; }, configurable: true, enumerable: true },
  dedicatedVacancyRequestId: { get: () => dedicatedVacancyRequestId, set: (v) => { dedicatedVacancyRequestId = v; }, configurable: true, enumerable: true },
  dedicatedVacancyCounts: { get: () => dedicatedVacancyCounts, set: (v) => { dedicatedVacancyCounts = v; }, configurable: true, enumerable: true },
  dedicatedVacancyCountsLoaded: { get: () => dedicatedVacancyCountsLoaded, set: (v) => { dedicatedVacancyCountsLoaded = v; }, configurable: true, enumerable: true },
  VAC_PAGE_SIZE: { get: () => VAC_PAGE_SIZE, set: (v) => { VAC_PAGE_SIZE = v; }, configurable: true, enumerable: true },
  generalVacancyDisplayPage: { get: () => generalVacancyDisplayPage, set: (v) => { generalVacancyDisplayPage = v; }, configurable: true, enumerable: true },
  dedicatedVacancyDisplayPage: { get: () => dedicatedVacancyDisplayPage, set: (v) => { dedicatedVacancyDisplayPage = v; }, configurable: true, enumerable: true },
  agencyFolderDisplayPage: { get: () => agencyFolderDisplayPage, set: (v) => { agencyFolderDisplayPage = v; }, configurable: true, enumerable: true },
  publicAgencySlugs: { get: () => publicAgencySlugs, set: (v) => { publicAgencySlugs = v; }, configurable: true, enumerable: true },
  publicVacancySlugs: { get: () => publicVacancySlugs, set: (v) => { publicVacancySlugs = v; }, configurable: true, enumerable: true },
  publicVacancyRecordSlugs: { get: () => publicVacancyRecordSlugs, set: (v) => { publicVacancyRecordSlugs = v; }, configurable: true, enumerable: true },
  isAdmin: { get: () => isAdmin, set: (v) => { isAdmin = v; }, configurable: true, enumerable: true },
  publicVacancyPostingOpen: { get: () => publicVacancyPostingOpen, set: (v) => { publicVacancyPostingOpen = v; }, configurable: true, enumerable: true },
  publicEmployerRegistrationOpen: { get: () => publicEmployerRegistrationOpen, set: (v) => { publicEmployerRegistrationOpen = v; }, configurable: true, enumerable: true },
  employerDirectoryOpen: { get: () => employerDirectoryOpen, set: (v) => { employerDirectoryOpen = v; }, configurable: true, enumerable: true },
  talentPoolVerified: { get: () => talentPoolVerified, set: (v) => { talentPoolVerified = v; }, configurable: true, enumerable: true },
  savedSet: { get: () => savedSet, set: (v) => { savedSet = v; }, configurable: true, enumerable: true },
  savedVacanciesSynced: { get: () => savedVacanciesSynced, set: (v) => { savedVacanciesSynced = v; }, configurable: true, enumerable: true },
  managerMode: { get: () => managerMode, set: (v) => { managerMode = v; }, configurable: true, enumerable: true },
  managerAgency: { get: () => managerAgency, set: (v) => { managerAgency = v; }, configurable: true, enumerable: true },
  managerTokenMap: { get: () => managerTokenMap, set: (v) => { managerTokenMap = v; }, configurable: true, enumerable: true },
  managerPendingToken: { get: () => managerPendingToken, set: (v) => { managerPendingToken = v; }, configurable: true, enumerable: true },
  employerManagerMode: { get: () => employerManagerMode, set: (v) => { employerManagerMode = v; }, configurable: true, enumerable: true },
  managerEmployer: { get: () => managerEmployer, set: (v) => { managerEmployer = v; }, configurable: true, enumerable: true },
  employerManagerTokenMap: { get: () => employerManagerTokenMap, set: (v) => { employerManagerTokenMap = v; }, configurable: true, enumerable: true },
  employerManagerPendingToken: { get: () => employerManagerPendingToken, set: (v) => { employerManagerPendingToken = v; }, configurable: true, enumerable: true },
  __saDataReady: { get: () => __saDataReady, set: (v) => { __saDataReady = v; }, configurable: true, enumerable: true },
  __saAuthReady: { get: () => __saAuthReady, set: (v) => { __saAuthReady = v; }, configurable: true, enumerable: true },
  __saRevealed: { get: () => __saRevealed, set: (v) => { __saRevealed = v; }, configurable: true, enumerable: true },
  SA_SLOW_LOAD_DELAY: { get: () => SA_SLOW_LOAD_DELAY, set: (v) => { SA_SLOW_LOAD_DELAY = v; }, configurable: true, enumerable: true },
  SA_SLOW_LOAD_MESSAGES: { get: () => SA_SLOW_LOAD_MESSAGES, set: (v) => { SA_SLOW_LOAD_MESSAGES = v; }, configurable: true, enumerable: true },
  __saSlowLoadTimer: { get: () => __saSlowLoadTimer, set: (v) => { __saSlowLoadTimer = v; }, configurable: true, enumerable: true },
  __saSlowLoadCycleTimer: { get: () => __saSlowLoadCycleTimer, set: (v) => { __saSlowLoadCycleTimer = v; }, configurable: true, enumerable: true },
  __saSlowLoadIndex: { get: () => __saSlowLoadIndex, set: (v) => { __saSlowLoadIndex = v; }, configurable: true, enumerable: true },
});
