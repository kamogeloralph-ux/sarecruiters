/*
 * SA Recruiters -- app.js split 1/8: app-core.js
 * Config, analytics, manager-token helpers, theme, slug/escape utilities
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */


// ===== Supabase config (database only — file storage moved to R2, see below) =====
var SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';
// ===== Cloudflare R2 upload worker (candidate photos, daily tracks) =====
// Set this to your deployed Worker URL, e.g.
// 'https://sarecruiters-uploader.<your-subdomain>.workers.dev'
var R2_WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
var STARTUP_DATA_URL = R2_WORKER_URL + '/api/startup';
var supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
if (!supabaseClient) console.warn('[SA Recruiters] Supabase client unavailable; using local read-only fallback until the connection is restored.');

// The public PWA does not include the admin-only settings controls. Keep the
// shared loader safe when the admin page's UI helper is not present.
if (typeof window.updateEmployerRegUI !== 'function') {
  window.updateEmployerRegUI = function() {
    var toggle = document.getElementById('emp-reg-toggle');
    var sub = document.getElementById('emp-reg-sub');
    if (toggle) toggle.checked = !!publicEmployerRegistrationOpen;
    if (sub) sub.textContent = publicEmployerRegistrationOpen ? 'Open — anyone can register a company right now' : 'Closed — spam protected';
  };
}
// First-party analytics: no IP address, user-agent, name, phone, or email is stored.
// visitor_id persists in this browser; session_id is renewed after 30 minutes.
function analyticsRandomId(prefix) {
  try { if (window.crypto && crypto.randomUUID) return prefix + crypto.randomUUID(); } catch(e) {}
  return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
}
var analyticsVisitorId = (function(){ try { var k='sa_analytics_visitor'; var v=localStorage.getItem(k); if(!v){ v=analyticsRandomId('v_'); localStorage.setItem(k,v); } return v; } catch(e){ return analyticsRandomId('v_'); } })();
var analyticsSessionId = (function(){ try { var k='sa_analytics_session', t='sa_analytics_session_started', now=Date.now(), v=localStorage.getItem(k), started=Number(localStorage.getItem(t)||0); if(!v || !started || now-started >= 30*60*1000){ v=analyticsRandomId('s_'); localStorage.setItem(k,v); localStorage.setItem(t,String(now)); } return v; } catch(e){ return analyticsRandomId('s_'); } })();
var analyticsPublicTraffic = null;
async function canTrackPublicTraffic() {
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
function trackEvent(eventName, entityType, entityId, metadata) {
  try {
    canTrackPublicTraffic().then(function(allowed){
      if (!allowed || !supabaseClient) return;
      var row = { event_name:String(eventName||'unknown'), entity_type:entityType ? String(entityType) : null, entity_id:entityId ? String(entityId) : null, visitor_id:analyticsVisitorId, session_id:analyticsSessionId, is_admin:false, page_path:location.pathname, metadata:metadata || {} };
      supabaseClient.from('analytics_events').insert([row]).then(function(){}, function(){});
    });
  } catch(e) {}
}

var editingId = null;
var agenciesCache = [];
var branchesCache = [];
var vacanciesCache = [];
var employersCache = [];
var generalVacancyCount = 0;
var generalVacancyPageSize = 30;
var generalVacancyPage = 0;
var generalVacancyHasMore = false;
var generalVacancyLoading = false;
var generalVacancyRows = [];
var generalVacancyQueryKey = '';
var generalVacancyRequestId = 0;
// Public static listing URLs are generated from the same deterministic maps
// used by generate-pages.js. This keeps links correct when names repeat.
var publicAgencySlugs = Object.create(null);
var publicVacancySlugs = Object.create(null);
var publicVacancyRecordSlugs = typeof WeakMap === 'function' ? new WeakMap() : null;
var isAdmin = false;
var publicVacancyPostingOpen = false;
var publicEmployerRegistrationOpen = false;
var employerDirectoryOpen = true; // when false, only Supabase-verified Talent Pool registrants may browse employers and employer vacancies
var talentPoolVerified = false;
var savedSet = new Set(JSON.parse(localStorage.getItem('savedVacancies') || '[]'));
// ===== SMART MANAGER: agency self-service links =====
var managerMode = false;   // true when URL has ?manage=TOKEN
var managerAgency = null;  // the agency object the manager is allowed to update
var managerTokenMap = {};  // { tokenId: agencyId } — persisted in localStorage
var managerPendingToken = null; // token detected before agencies loaded
// ===== SMART MANAGER: employer self-service links (vacancies only) =====
var employerManagerMode = false;   // true when URL has ?manage_employer=TOKEN
var managerEmployer = null;        // the employer object the manager is allowed to post vacancies for
var employerManagerTokenMap = {};  // { tokenId: employerId } — persisted in localStorage
var employerManagerPendingToken = null; // token detected before employers loaded

// Seed editable content sections (FAQ, CV prep, etc.) with defaults if needed
if (window.ContentMgr) ContentMgr.ensureSeeded();

function genToken() {
  // 12-char URL-safe token
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var s = '';
  for (var i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function managerTokenKey(agencyId) { return 'sa_manager_token_' + agencyId; }
function getManagerToken(agencyId) {
  // Source of truth is Supabase (agenciesCache), so the token resolves on
  // any device, not just the one that generated it. Fall back to a local
  // cache copy only if the agency isn't in agenciesCache yet (e.g. called
  // before loadAll() finishes).
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  if (a && a.manage_token) return a.manage_token;
  try { return localStorage.getItem(managerTokenKey(agencyId)) || ''; } catch(e){ return ''; }
}
function setManagerToken(agencyId, token) {
  // Update in-memory cache immediately so the UI reflects it right away
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  if (a) a.manage_token = token;
  managerTokenMap[token] = agencyId;
  try { localStorage.setItem(managerTokenKey(agencyId), token); } catch(e){}
  // Persist to Supabase so the link works from any device
  saveManagerTokenToSupabase(agencyId, token);
}
function agencyIdFromToken(token) {
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
function buildManagerLink(token) {
  // Use the current app URL with ?manage=TOKEN
  var base = window.location.origin + window.location.pathname;
  return base + '?manage=' + token;
}

// ----- Employer manager tokens (mirrors the agency ones above, but keyed
// off the `employers` table and its own ?manage_employer=TOKEN param, so
// the two self-service links never collide) -----
function employerManagerTokenKey(employerId) { return 'sa_emp_manager_token_' + employerId; }
function getEmployerManagerToken(employerId) {
  var e = employersCache.find(function(x){ return x.id === employerId; });
  if (e && e.manage_token) return e.manage_token;
  try { return localStorage.getItem(employerManagerTokenKey(employerId)) || ''; } catch(e){ return ''; }
}
function setEmployerManagerToken(employerId, token) {
  var e = employersCache.find(function(x){ return x.id === employerId; });
  if (e) e.manage_token = token;
  employerManagerTokenMap[token] = employerId;
  try { localStorage.setItem(employerManagerTokenKey(employerId), token); } catch(e){}
  saveEmployerManagerTokenToSupabase(employerId, token);
}
async function saveEmployerManagerTokenToSupabase(employerId, token) {
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
function employerIdFromToken(token) {
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
function buildEmployerManagerLink(token) {
  var base = window.location.origin + window.location.pathname;
  return base + '?manage_employer=' + token;
}

/* ── First-paint splash: hide the raw shell until CSS + first data are
   ready, then fade it out. Prevents the "flash of unstyled zeroed shell"
   on load, hard refresh, and relaunch after being idle. ───────────────── */
var __saDataReady = false;
window.__saTryReveal = function () {
  if (!__saDataReady || !window.__saCssReady) return;
  document.body.classList.add('app-ready');
  var splash = document.getElementById('app-splash');
  if (splash) {
    splash.classList.add('hide');
    setTimeout(function () {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 300);
  }
};
function markAppDataReady() {
  __saDataReady = true;
  window.__saTryReveal();
}
// Safety net: never leave the splash up more than 2.5s even if the
// stylesheet load event is somehow missed (slow network, browser quirk).
setTimeout(function () {
  window.__saCssReady = true;
  markAppDataReady();
}, 2500);

/* ── Theme (day / night) ───────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.getElementById('meta-theme');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F2F2F7' : '#000000');
  // Update menu label/icon
  var mIcon = document.getElementById('theme-menu-icon');
  var mLabel = document.getElementById('theme-menu-label');
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
}
function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light';
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('saTheme', next);
  applyTheme(next);
}
(function initTheme() {
  var saved = localStorage.getItem('saTheme') || 'light';
  applyTheme(saved);
})();

function slugify(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'listing';
}

function rebuildPublicListingSlugs() {
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
function publicAgencySlug(a) {
  return publicAgencySlugs[a && a.id] || slugify(a && a.name);
}
function publicVacancySlug(v) {
  return (v && publicVacancyRecordSlugs && publicVacancyRecordSlugs.get(v)) || publicVacancySlugs[v && v.id] || slugify(v && v.title);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function initials(n) {
  return (n || '?').trim().split(/\s+/).map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase();
}

