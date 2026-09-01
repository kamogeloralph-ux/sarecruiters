
// ===== Supabase config =====
var SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';
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
var analyticsSessionId = (function(){ try { var k='sa_analytics_session'; var v=localStorage.getItem(k); if(!v){ v='s_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10); localStorage.setItem(k,v); } return v; } catch(e){ return 's_'+Date.now().toString(36); } })();
function trackEvent(eventName, entityType, entityId, metadata) {
  try {
    var row = { event_name:String(eventName||'unknown'), entity_type:entityType ? String(entityType) : null, entity_id:entityId ? String(entityId) : null, session_id:analyticsSessionId, page_path:location.pathname, metadata:metadata || {} };
    supabaseClient.from('analytics_events').insert([row]).then(function(){}, function(){});
  } catch(e) {}
}

var editingId = null;
var agenciesCache = [];
var branchesCache = [];
var vacanciesCache = [];
var employersCache = [];
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
  try {
    var { error } = await supabaseClient.from('employers').update({ manage_token: token }).eq('id', employerId);
    if (error) {
      console.error('employer manage_token save', error);
      if (typeof showToast === 'function') showToast('⚠ Manager link not saved to Supabase — run SMART_MANAGER_SETUP.sql.');
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

// ===== Data: AGENCIES (live Supabase table that works) =====
async function getAgencies() {
  try {
    var { data, error } = await supabaseClient.from('agencies').select('id,name,website,contact,email,location,address,cvpref,photo,companies,trades,verified,manage_token').order('created_at', { ascending: false });
    if (error) { console.error('agencies load', error); return markLoadError([]); }
    return data.map(function(a) { return { id: a.id, name: a.name, website: a.website, contact: a.contact, email: a.email, location: a.location, address: a.address, cvpref: a.cvpref, photo: a.photo, companies: a.companies, trades: a.trades, verified: !!a.verified, manage_token: a.manage_token || '' }; });
  } catch(e) { console.error('agencies load', e); return markLoadError([]); }
}
// Persist a SMART MANAGER token to Supabase so any device can resolve it
// (not just the browser that generated it). Run SMART_MANAGER_SETUP.sql
// once so the `manage_token` column exists — without it this save fails
// silently and the link only "works" in the browser that generated it.
async function saveManagerTokenToSupabase(agencyId, token) {
  try {
    var { error } = await supabaseClient.from('agencies').update({ manage_token: token }).eq('id', agencyId);
    if (error) {
      console.error('manage_token save', error);
      if (typeof showToast === 'function') showToast('⚠ Manager link not saved to Supabase — run SMART_MANAGER_SETUP.sql.');
    }
  } catch(e) { console.error('manage_token save', e); }
}
async function upsertAgency(a) {
  // Send the FULL payload (including trades) to Supabase.
  // The `trades` column must exist on the agencies table — run
  // ADD_TRADES_COLUMN.sql once in the Supabase SQL Editor if it doesn't.
  // To stay resilient, if the upsert fails specifically because the
  // `trades` column is missing, we retry once without trades so the rest
  // of the agency record still saves (and trades keeps working via the
  // cached in-memory copy until the column is added).
  var safe = Object.assign({}, a);
  var { error } = await supabaseClient.from('agencies').upsert(safe);
  if (error) {
    var msg = (error.message || '') + ' ' + (error.hint || '') + ' ' + JSON.stringify(error.details || '');
    if (/trades/i.test(msg)) {
      // Column missing — retry without trades so the agency still saves.
      var safeNoTrades = Object.assign({}, a); delete safeNoTrades.trades;
      var r2 = await supabaseClient.from('agencies').upsert(safeNoTrades);
      if (r2.error) { console.error('agency save', r2.error); alert('Could not save. Check your Supabase setup.'); }
      else { console.warn('Saved agency, but the `trades` column is missing — run ADD_TRADES_COLUMN.sql so trades persist.'); }
      return;
    }
    console.error('agency save', error);
    alert('Could not save. Check your Supabase setup.');
  }
}
async function removeAgency(id) {
  var { error } = await supabaseClient.from('agencies').delete().eq('id', id);
  if (error) { console.error('agency delete', error); alert('Could not delete. Check your Supabase setup.'); }
}

/* ── Data: EMPLOYERS ──────────────────────────────────
   Companies that register directly and post their own vacancies (separate
   from the recruitment-agency directory). Same try-Supabase-then-fall-back
   pattern as branches/vacancies, so this works immediately even before the
   `employers` table + `employer_id` vacancies column are created — run
   CREATE_EMPLOYERS_TABLE.sql in the Supabase SQL Editor to make it live. */
async function getEmployers() {
  try {
    var { data, error } = await supabaseClient.from('employers').select('id,name,industry,website,contact,email,location,address,photo,verified,manage_token').order('created_at', { ascending: false });
    if (!error && data) return data.map(function(e) { return { id: e.id, name: e.name, industry: e.industry, website: e.website, contact: e.contact, email: e.email, location: e.location, address: e.address, photo: e.photo, verified: !!e.verified, manage_token: e.manage_token || '' }; });
  } catch(err){}
  return markLoadError(readLocal('employers'));
}
async function getManagedPosters() {
  try {
    var { data, error } = await supabaseClient.from('posters').select('id,audience,title,subtitle,image_url,sort_order').eq('is_active', true).order('audience', { ascending: true }).order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (!error) return data || [];
    console.warn('managed posters load', error);
  } catch (e) { console.warn('managed posters load', e); }
  return [];
}
function renderManagedPoster(poster, targetId) {
  var target = document.getElementById(targetId);
  if (!target) return;
  if (!poster || !poster.image_url) { target.hidden = true; target.innerHTML = ''; return; }
  target.hidden = false;
  target.innerHTML = '<img loading="lazy" src="'+escapeHtml(poster.image_url)+'" alt="'+escapeHtml(poster.title || '')+'" onerror="this.closest(\'.managed-poster\').hidden=true">' +
    ((poster.title || poster.subtitle) ? '<div class="managed-poster-copy">'+(poster.title?'<strong>'+escapeHtml(poster.title)+'</strong>':'')+(poster.subtitle?'<span>'+escapeHtml(poster.subtitle)+'</span>':'')+'</div>' : '');
}
function renderManagedPosters(posters) {
  var target = document.getElementById('poster-managed-poster');
  if (!target) return;
  posters = (posters || []).filter(function(p){ return p && p.image_url; });
  if (!posters.length) {
    target.innerHTML = '<div class="poster-empty">Campaign posters will appear here soon.</div>';
    return;
  }
  // The page intentionally displays one poster at a time. Admin ordering controls
  // which active poster is shown, while the fixed frame prevents layout shifts.
  var p = posters[0];
  var label = p.audience === 'employers' ? 'For Employers' : 'For Candidates';
  target.innerHTML = '<article class="managed-poster poster-page-card"><img loading="lazy" src="'+escapeHtml(p.image_url)+'" alt="'+escapeHtml(p.title || label+' campaign poster')+'" onerror="this.closest(\'.poster-page-card\').remove()">'+
    '<div class="managed-poster-copy"><strong>'+escapeHtml(p.title || label)+'</strong>'+(p.subtitle?'<span>'+escapeHtml(p.subtitle)+'</span>':'')+'</div></article>';
}

// ===== HOME SCREEN CANDIDATE SPOTLIGHT =====
// Advertises real Talent Pool candidates on the home CTA carousel: their
// square profile photo, name, and position/experience heading. Pulled
// straight from pool_candidates (no separate admin upload needed) —
// tapping a card sends the visitor to the full Talent Pool for the
// complete Mini-CV. RLS only ever returns status = 'active' rows to
// anonymous visitors, but the status filter below is defense-in-depth.
async function loadCandidateSpotlight() {
  var target = document.getElementById('candidate-spotlight-deck');
  if (!target) return;
  var list = [];
  try {
    var { data, error } = await supabaseClient.from('pool_candidates')
      .select('id,full_name,position,experience_years,photo_url,verified,status,created_at')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    list = (data || []).filter(function(c){ return (c.status || 'pending') === 'active' && c.photo_url; });
  } catch (e) { console.warn('candidate spotlight load', e); list = []; }
  // Verified candidates first, then most recently joined; cap the deck at 10 cards.
  list.sort(function(a, b) { return (b.verified?1:0) - (a.verified?1:0); });
  renderCandidateSpotlight(list.slice(0, 10));
}
function renderCandidateSpotlight(list) {
  var target = document.getElementById('candidate-spotlight-deck');
  if (!target) return;
  if (!list.length) {
    target.innerHTML = '<div class="poster-empty">Candidate photos will appear here as people join the Talent Pool.</div>';
    return;
  }
  target.innerHTML = list.map(function(c) {
    var expText = (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '')
      ? (c.experience_years >= 10 ? '10+ yrs exp' : c.experience_years + ' yrs exp')
      : '';
    var subtitle = [c.position, expText].filter(Boolean).join(' · ') || 'Looking for opportunities';
    return '<button type="button" class="spotlight-card" data-ripple onclick="goPool(\'home\')">' +
      '<span class="spotlight-photo"><img loading="lazy" src="'+escapeHtml(c.photo_url)+'" alt="'+escapeHtml(c.full_name||'Candidate')+'"></span>' +
      '<span class="spotlight-copy"><strong>'+escapeHtml(c.full_name||'Candidate')+(c.verified?' <span class="verified-check" title="Screened & Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>':'')+'</strong>' +
      '<span>'+escapeHtml(subtitle)+'</span></span></button>';
  }).join('') + '<button type="button" class="spotlight-card spotlight-more" data-ripple onclick="goPool(\'home\')"><span class="spotlight-more-copy">View full<br>Talent Pool</span></button>';
}

async function upsertEmployer(e) {
  try {
    var { error } = await supabaseClient.from('employers').upsert(e);
    if (!error) return true;
  } catch(err){}
  var arr = readLocal('employers');
  var i = arr.findIndex(function(x){ return x.id === e.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], e); else arr.push(e);
  writeLocal('employers', arr);
  return false;
}
async function removeEmployer(id) {
  try { await supabaseClient.from('employers').delete().eq('id', id); } catch(err){}
  var arr = readLocal('employers').filter(function(x){ return x.id !== id; });
  writeLocal('employers', arr);
}

/* ── Data: BRANCHES & VACANCIES ─────────────────────────
   The `branches` table now EXISTS in Supabase (verified).
   The `vacancies` table was NOT yet created — run CREATE_VACANCIES_TABLE.sql
   in the Supabase SQL Editor, otherwise every vacancy save silently falls
   back to THIS device's localStorage and other users will not see it.
   To keep the features fully functional in the meantime we:
     1) TRY to read/write Supabase (so the moment the table exists it works)
     2) FALL BACK to localStorage so nothing is ever lost and the UX works.
   When a save is NOT live, saveVacancy()/saveGeneralVacancy() now show a
   clear warning toast.                                              */
function localKey(kind) { return 'sa_' + kind + '_local'; }
function readLocal(kind) {
  try { return JSON.parse(localStorage.getItem(localKey(kind)) || '[]'); } catch(e){ return []; }
}
function writeLocal(kind, arr) {
  try { localStorage.setItem(localKey(kind), JSON.stringify(arr)); } catch(e){ console.warn('storage full', e); }
}

// ----- Branches -----
async function getBranches() {
  try {
    var { data, error } = await supabaseClient.from('branches').select('id,agency_id,name,location,phone,email').order('name', { ascending: true });
    if (!error && data) return data;
  } catch(e){}
  return markLoadError(readLocal('branches'));
}
async function upsertBranch(b) {
  try {
    var { error } = await supabaseClient.from('branches').upsert(b);
    if (!error) return true;
  } catch(e){}
  // fallback: save locally
  var arr = readLocal('branches');
  var i = arr.findIndex(function(x){ return x.id === b.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], b); else arr.push(b);
  writeLocal('branches', arr);
  return false; // indicates it was stored locally, not in Supabase
}
async function removeBranch(id) {
  try { await supabaseClient.from('branches').delete().eq('id', id); } catch(e){}
  var arr = readLocal('branches').filter(function(x){ return x.id !== id; });
  writeLocal('branches', arr);
}

// ----- App settings (admin-controlled, e.g. public vacancy posting toggle) -----
async function getAppSetting(key, fallback) {
  try {
    var { data, error } = await supabaseClient.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    return data.value;
  } catch(e) { return fallback; }
}
async function setAppSetting(key, value) {
  try {
    var { error } = await supabaseClient.from('app_settings').upsert({ key: key, value: value, updated_at: new Date().toISOString() });
    return !error;
  } catch(e) { return false; }
}
async function loadPostingSetting() {
  var v = await getAppSetting('public_vacancy_posting', 'false');
  publicVacancyPostingOpen = (v === true || v === 'true');
  updatePostingToggleUI();
}
function updatePostingToggleUI() {
  var input = document.getElementById('posting-toggle-input');
  if (input) input.checked = !!publicVacancyPostingOpen;
  var sub = document.getElementById('posting-toggle-sub');
  if (sub) sub.textContent = publicVacancyPostingOpen ? 'Open — anyone can post right now' : 'Closed — spam protected';
}
async function loadEmployerRegSetting() {
  var v = await getAppSetting('public_employer_registration', 'false');
  publicEmployerRegistrationOpen = (v === true || v === 'true');
}

/* ===== Track of the Day =====
   Reads the newest track published within the seven-day retention window from
   the `daily_tracks` table (Supabase). This keeps an uploaded track available
   to visitors for at least seven days instead of showing it only on its upload
   date. The audio file is served from the `daily-tracks` storage bucket. */
var todayTrack = null;       // {id,title,artist,track_date,file_url}
var trackAudio = null;       // <audio> element
var trackIsPlaying = false;

function todayISO() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

async function loadTodayTrack() {
  try {
    var today = todayISO();
    var cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 7);
    var cutoffISO = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    var { data, error } = await supabaseClient
      .from('daily_tracks')
      .select('id,title,artist,track_date,file_url')
      .gte('track_date', cutoffISO)
      .lte('track_date', today)
      .order('track_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) { renderTrackEmpty(); return; }
    if (data && data.length > 0) {
      todayTrack = data[0];
      renderTrackReady();
    } else {
      // No track has been published in the current seven-day window.
      todayTrack = null;
      renderTrackEmpty();
    }
  } catch(e) {
    todayTrack = null;
    renderTrackEmpty();
  }
}

function renderTrackEmpty() {
  var card = document.getElementById('track-card');
  var info = document.getElementById('track-info');
  var btn = document.getElementById('track-play');
  if (!card) return;
  card.classList.remove('has-track', 'playing');
  if (info) info.classList.add('track-empty');
  var t = document.getElementById('track-title');
  var a = document.getElementById('track-artist');
  if (t) t.textContent = 'No track today';
  if (a) a.textContent = 'Check back tomorrow for a fresh pick';
  if (btn) btn.disabled = true;
  var prog = document.getElementById('track-progress');
  if (prog) prog.style.display = 'none';
}

function renderTrackReady() {
  if (!todayTrack) { renderTrackEmpty(); return; }
  var card = document.getElementById('track-card');
  var info = document.getElementById('track-info');
  var btn = document.getElementById('track-play');
  if (!card) return;
  card.classList.add('has-track');
  if (info) info.classList.remove('track-empty');
  var t = document.getElementById('track-title');
  var a = document.getElementById('track-artist');
  if (t) t.textContent = todayTrack.title || 'Today\'s track';
  if (a) a.textContent = todayTrack.artist || '';
  if (btn) btn.disabled = false;
  // Set audio source
  trackAudio = document.getElementById('track-audio');
  if (trackAudio && todayTrack.file_url) {
    trackAudio.src = todayTrack.file_url;
    trackAudio.load();
  }
}

function toggleTrackPlay() {
  if (!todayTrack || !trackAudio) return;
  if (trackIsPlaying) {
    trackAudio.pause();
  } else {
    trackAudio.play().catch(function(){ /* autoplay blocked or load error */ });
  }
}

function onTrackLoaded() {
  // metadata loaded — nothing needed yet
}

function updateTrackProgress() {
  if (!trackAudio) return;
  var prog = document.getElementById('track-progress');
  var fill = document.getElementById('track-progress-fill');
  if (!prog || !fill) return;
  prog.style.display = 'block';
  var pct = 0;
  if (trackAudio.duration && isFinite(trackAudio.duration)) {
    pct = (trackAudio.currentTime / trackAudio.duration) * 100;
  }
  fill.style.width = pct + '%';
}

function onTrackEnded() {
  trackIsPlaying = false;
  var card = document.getElementById('track-card');
  var icon = document.getElementById('track-play-icon');
  if (card) card.classList.remove('playing');
  if (icon) icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  var fill = document.getElementById('track-progress-fill');
  if (fill) fill.style.width = '0%';
}

// Update play/pause icon + state on play & pause events
document.addEventListener('play', function(e){
  if (e.target && e.target.id === 'track-audio') {
    trackIsPlaying = true;
    var card = document.getElementById('track-card');
    var icon = document.getElementById('track-play-icon');
    if (card) card.classList.add('playing');
    if (icon) icon.innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>';
  }
}, true);
document.addEventListener('pause', function(e){
  if (e.target && e.target.id === 'track-audio') {
    trackIsPlaying = false;
    var card = document.getElementById('track-card');
    var icon = document.getElementById('track-play-icon');
    if (card) card.classList.remove('playing');
    if (icon) icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}, true);
async function togglePublicPosting(checked) {
  var ok = await setAppSetting('public_vacancy_posting', checked ? 'true' : 'false');
  if (ok) {
    publicVacancyPostingOpen = checked;
    showToast(checked ? 'Vacancy posting opened to the public' : 'Vacancy posting locked');
  } else {
    showToast('Could not update setting — try again');
  }
  updatePostingToggleUI();
}
function openVacancyLockedSheet() {
  var msg = 'Hi, I\'d like to post a vacancy on SA Recruiters. Please could you open vacancy posting for me?';
  var link = document.getElementById('vacancy-locked-wa-link');
  if (link) link.href = 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + encodeURIComponent(msg);
  document.getElementById('vacancy-locked-overlay').classList.add('open');
}
function openEmployerLockedSheet() {
  var msg = 'Hi, I\'d like to register my company as an employer on SA Recruiters. Please could you set this up for me?';
  var link = document.getElementById('employer-locked-wa-link');
  if (link) link.href = 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + encodeURIComponent(msg);
  document.getElementById('employer-locked-overlay').classList.add('open');
}

// ----- Vacancies -----
async function getVacancies() {
  try {
    var { data, error } = await supabaseClient.from('vacancies').select('id,agency_id,employer_id,title,company,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at').order('created_at', { ascending: false });
    if (!error && data) return data;
  } catch(e){}
  return markLoadError(readLocal('vacancies'));
}
async function upsertVacancy(v) {
  // First attempt: send all fields
  try {
    var { error } = await supabaseClient.from('vacancies').upsert(v);
    if (!error) return true;
    // Log every failed save (constraint violations, RLS denials, etc.) so
    // future issues show up in the console instead of failing silently.
    console.error('vacancy upsert', error);
    // If the error is about a missing column, retry with only the
    // columns that are guaranteed to exist in the original schema.
    if (error && error.message && error.message.indexOf('column') > -1) {
      var safe = {
        id: v.id,
        agency_id: v.agency_id || 'general',
        title: v.title || '',
        company: v.company || '',
        location: v.location || '',
        closing_date: v.closing_date || '',
        notes: v.notes || '',
        link: v.link || '',
        email: v.email || '',
        phone: v.phone || ''
      };
      try {
        var { error: err2 } = await supabaseClient.from('vacancies').upsert(safe);
        if (!err2) return true;
      } catch(e2){}
    }
  } catch(e){}
  var arr = readLocal('vacancies');
  var i = arr.findIndex(function(x){ return x.id === v.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], v); else arr.push(v);
  writeLocal('vacancies', arr);
  return false;
}
async function removeVacancy(id) {
  try { await supabaseClient.from('vacancies').delete().eq('id', id); } catch(e){}
  var arr = readLocal('vacancies').filter(function(x){ return x.id !== id; });
  writeLocal('vacancies', arr);
}

// Vacancies are removed automatically 60 days after they were posted.
// A daily Supabase scheduled job (see AUTO_DELETE_OLD_VACANCIES.sql) is the
// real cleanup; this is a client-side safety net so a vacancy never shows
// publicly past its 60 days even on a visit before that job next runs.
var VACANCY_TTL_DAYS = 60;
function isVacancyExpired(v) {
  if (!v || !v.created_at) return false;
  var posted = new Date(v.created_at).getTime();
  if (isNaN(posted)) return false;
  return (Date.now() - posted) / 86400000 >= VACANCY_TTL_DAYS;
}
async function purgeExpiredVacancies(list) {
  var expired = (list || []).filter(isVacancyExpired);
  if (!expired.length) return list;
  var ids = expired.map(function(v){ return v.id; });
  try { await supabaseClient.from('vacancies').delete().in('id', ids); } catch(e){}
  return (list || []).filter(function(v){ return ids.indexOf(v.id) === -1; });
}

/* ── Data: REPORTS ───────────────────────────────────
   `reports` table exists but RLS blocks anonymous inserts. We try the
   live insert first; if RLS blocks it we store locally AND offer to send
   via the support WhatsApp/email so the report always reaches the admin. */
function readLocalReports() {
  try { return JSON.parse(localStorage.getItem('sa_reports_local') || '[]'); } catch(e){ return []; }
}
function writeLocalReports(arr) {
  try { localStorage.setItem('sa_reports_local', JSON.stringify(arr)); } catch(e){}
}
async function submitReportToSupabase(payload) {
  // Use same pattern as suggestions: insert without .select()
  // (.select() requires SELECT RLS permission which anon users don't have)
  var safePayload = {
    agency_name: payload.agency_name || null,
    reason: payload.reason || null,
    details: payload.details || null,
    status: payload.status || 'open'
  };
  // Only include agency_id if it's a valid value (avoid FK errors)
  if (payload.agency_id) safePayload.agency_id = payload.agency_id;
  var { error } = await supabaseClient.from('reports').insert([safePayload]);
  if (error) { console.error('report insert', error); return { ok: false, error: error }; }
  return { ok: true };
}

// Marks an array result as having come from a failed fetch (network error,
// Supabase error, etc.) without changing its shape — callers elsewhere just
// see a plain array. loadAll() checks this flag to decide whether to (a)
// keep showing the last good cached data instead of wiping it to empty, and
// (b) surface the retry banner. See initIdleResumeRefresh/retryLoadAll.
function markLoadError(arr) { try { arr.__loadError = true; } catch(e) {} return arr; }

// ----- Local data cache: lets the app paint instantly from the last
// successful load while fresh data streams in behind the scenes, instead
// of showing a blank screen every time while Supabase responds. -----
var DATA_CACHE_KEY = 'sa_data_cache_v1';
var lastDataRefreshAt = null;
function formatDataAge(timestamp) {
  if (!timestamp) return '';
  var age = Math.max(0, Date.now() - timestamp);
  if (age < 60000) return 'just now';
  var minutes = Math.floor(age / 60000);
  if (minutes < 60) return minutes + ' min ago';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' hr ago';
  return Math.floor(hours / 24) + ' days ago';
}
function vacancyScreenStateMarkup(screen, hasRows, hasQuery) {
  if (hasRows) return '';
  var message = 'New listings will appear here once they are posted.';
  if (screen === 'search') message = hasQuery ? 'Try a different agency name, trade, role, or location.' : 'Find agencies, vacancies, trades, or locations.';
  else if (screen === 'saved') message = 'Use the star on a vacancy card to keep it here for later.';
  else if (screen === 'employer') message = 'New employer listings will appear here after they are saved.';
  else if (screen === 'manager') message = 'No vacancies added yet.';
  else if (screen === 'all') message = hasQuery ? 'Try a different search or adjust your filters.' : message;
  return '<div class="screen-state" data-screen="' + screen + '" data-vacancy-state="empty">' + message + '</div>';
}

function connectionStatusLabel(state, timestamp, isOnline) {
  var isOffline = state === 'offline' || !isOnline;
  if (state === 'loading') return 'Updating listings…';
  if (isOffline) return timestamp ? 'Offline · showing saved listings from ' + formatDataAge(timestamp) : 'Offline · saved listings only';
  if (state === 'cached') return timestamp ? 'Saved listings · last checked ' + formatDataAge(timestamp) : 'Saved listings · waiting for connection';
  if (state === 'error') return timestamp ? 'Could not refresh · showing listings from ' + formatDataAge(timestamp) : 'Could not refresh the latest listings';
  if (state === 'live') return 'Live listings · updated ' + formatDataAge(timestamp || Date.now());
  return '';
}
function setConnectionStatus(state, timestamp) {
  var el = document.getElementById('connection-status');
  if (!el) return;
  var isOffline = state === 'offline' || !navigator.onLine;
  var label = connectionStatusLabel(state, timestamp, navigator.onLine);
  el.textContent = label;
  el.dataset.state = state;
  el.classList.toggle('show', !!label);
  el.title = timestamp ? 'Last successful listing refresh: ' + new Date(timestamp).toLocaleString() : '';
}

function initConnectionStatus() {
  window.addEventListener('offline', function() { setConnectionStatus('offline', lastDataRefreshAt); });
  window.addEventListener('online', function() {
    setConnectionStatus('loading', lastDataRefreshAt);
    loadAll();
  });
  setConnectionStatus(navigator.onLine ? (lastDataRefreshAt ? 'cached' : 'loading') : 'offline', lastDataRefreshAt);
}
function saveDataCache() {
  try {
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
      agencies: agenciesCache,
      branches: branchesCache,
      vacancies: vacanciesCache,
      employers: employersCache,
      poolCount: poolCandidateCount,
      savedAt: Date.now()
    }));
  } catch(e) { /* storage full or unavailable — safe to skip */ }
}
function loadDataCache() {
  try {
    var raw = localStorage.getItem(DATA_CACHE_KEY);
    if (!raw) return false;
    var d = JSON.parse(raw);
    if (!d || !Array.isArray(d.agencies)) return false;
    agenciesCache = d.agencies || [];
    branchesCache = d.branches || [];
    vacanciesCache = d.vacancies || [];
    employersCache = d.employers || [];
    poolCandidateCount = (typeof d.poolCount === 'number') ? d.poolCount : 0;
    lastDataRefreshAt = (typeof d.savedAt === 'number') ? d.savedAt : null;
    return true;
  } catch(e) { return false; }
}

async function loadAll() {
  setConnectionStatus(navigator.onLine ? 'loading' : 'offline', lastDataRefreshAt);
  // Fetch all startup data and the two public settings concurrently. The
  // home screen can render from the fastest useful response instead of
  // waiting for a chain of independent requests.
  var results = await Promise.all([
    getAgencies(), getBranches(), getVacancies(), getEmployers(),
    getAppSetting('public_vacancy_posting', 'false'),
    getAppSetting('public_employer_registration', 'false'),
    getAppSetting('public_employer_directory', 'true'),
    getPoolCandidateCount()
  ]);
  // If a fetch failed, keep whatever was already on screen (last good cache)
  // instead of wiping it to an empty list — a failed refresh should never
  // make the directory look emptier than it did a moment ago. Track whether
  // anything failed so we can surface the retry banner below.
  var hadLoadError = false;
  if (results[0].__loadError) { hadLoadError = true; } else { agenciesCache = results[0]; }
  if (results[1].__loadError) { hadLoadError = true; } else { branchesCache = results[1]; }
  if (results[2].__loadError) { hadLoadError = true; } else {
    vacanciesCache = sortVacancies(results[2].filter(function(v){ return !isVacancyExpired(v); }));
    // Best-effort background delete of the expired ones we just filtered out.
    purgeExpiredVacancies(results[2]);
  }
  if (results[3].__loadError) { hadLoadError = true; } else { employersCache = results[3]; }
  setRetryBanner(hadLoadError);
  if (!hadLoadError) lastDataRefreshAt = Date.now();
  setConnectionStatus(!navigator.onLine ? 'offline' : (hadLoadError ? 'error' : 'live'), lastDataRefreshAt);
  publicVacancyPostingOpen = (results[4] === true || results[4] === 'true');
  publicEmployerRegistrationOpen = (results[5] === true || results[5] === 'true');
  employerDirectoryOpen = (results[6] === true || results[6] === 'true');
  // Only overwrite the count if the query succeeded — a failed count fetch
  // should leave the last-known number on screen rather than dropping to 0.
  if (typeof results[7] === 'number') poolCandidateCount = results[7];
  // Sort employers: verified first, then alphabetical
  employersCache.sort(function(a,b){
    if ((a.verified?1:0) !== (b.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return (a.name||'').localeCompare(b.name||'');
  });
  // Sort agencies: verified first, then alphabetical by name
  agenciesCache.sort(function(a,b){
    var av = a.verified ? 1 : 0, bv = b.verified ? 1 : 0;
    if (av !== bv) return bv - av;            // verified sinks to top
    return (a.name||'').localeCompare(b.name||'');           // alphabetical tie-break
  });
  // Token backfills are maintenance work, not startup-critical. Defer them
  // until after the first paint so they never compete with the home screen.
  var runBackfill = function() {
    agenciesCache.forEach(function(a) {
      if (!getManagerToken(a.id)) setManagerToken(a.id, genToken());
    });
    employersCache.forEach(function(e) {
      if (!getEmployerManagerToken(e.id)) setEmployerManagerToken(e.id, genToken());
    });
  };
  if (window.requestIdleCallback) requestIdleCallback(runBackfill, { timeout: 2500 });
  else setTimeout(runBackfill, 1200);
  rebuildPublicListingSlugs();
  updateStats();
  filterAndRenderCached();
  // Candidate spotlight is non-critical; fetch it after the first useful home render.
  loadCandidateSpotlight();
  saveDataCache();
  updatePostingToggleUI();
  updateEmployerRegUI();
  // If in manager mode, re-render the manager panel with fresh data
  if (managerMode) renderManagerMode();
  if (employerManagerMode) renderEmployerManagerMode();
  restoreTalentPoolMembership();
  // If a pending manager token was detected before agencies loaded, enter manager mode now
  if (managerPendingToken) {
    var tok = managerPendingToken;
    managerPendingToken = null;
    enterManagerMode(tok);
  }
  if (employerManagerPendingToken) {
    var etok = employerManagerPendingToken;
    employerManagerPendingToken = null;
    enterEmployerManagerMode(etok);
  }
  // If admin is viewing SMART MANAGER section, re-render it
  if (typeof renderSmartManager === 'function' && document.getElementById('screen-smartmanager') && document.getElementById('screen-smartmanager').classList.contains('active')) {
    renderSmartManager();
  }
}

function updateStats() {
  document.getElementById('stat-agencies').textContent = agenciesCache.length;
  document.getElementById('stat-branches').textContent = branchesCache.length;
  document.getElementById('stat-vacancies').textContent = vacanciesCache.length;
  var statEmployers = document.getElementById('stat-employers');
  if (statEmployers) statEmployers.textContent = employersCache.length;
  var statPool = document.getElementById('stat-pool');
  if (statPool) statPool.textContent = poolLoaded ? poolCache.filter(function(c){ return (c.status || 'pending') === 'active'; }).length : poolCandidateCount;
}

function branchesFor(agencyId) { return branchesCache.filter(function(b){ return b.agency_id === agencyId; }); }
function vacanciesFor(agencyId) { return sortVacancies(vacanciesCache.filter(function(v){ return v.agency_id === agencyId; })); }
function vacanciesForEmployer(employerId) { return sortVacancies(vacanciesCache.filter(function(v){ return v.employer_id === employerId; })); }

// Best-effort parse of the free-text closing_date field (e.g. "26 August
// 2026", "2026-08-26") into a timestamp. Returns null when it can't be
// parsed (blank, "ASAP", etc.) so callers can push those to the end
// instead of mis-sorting them.
function parseClosingDate(str) {
  if (!str) return null;
  var t = Date.parse(str);
  return isNaN(t) ? null : t;
}

// Newest posting first (most recently added), then — for vacancies added
// in the same batch/moment, where created_at ties — soonest closing date
// first, so deadlines run in order rather than appearing scrambled.
// Vacancies with no parseable closing date sort after ones that have one.
function sortVacancies(list) {
  return list.slice().sort(function(a, b) {
    var ca = new Date(a.created_at || 0).getTime();
    var cb = new Date(b.created_at || 0).getTime();
    if (cb !== ca) return cb - ca;
    var da = parseClosingDate(a.closing_date);
    var db = parseClosingDate(b.closing_date);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

// ===== Hub card (agency) =====
function avatarHtml(a) {
  if (a.photo) return '<div class="avatar"><img src="' + a.photo + '"></div>';
  return '<div class="avatar">' + initials(a.name) + '</div>';
}

function hubCard(a) {
  var bCount = branchesFor(a.id).length;
  var headOfficeLocation = (a.location || a.address || '').trim();
  var verifiedCheck = a.verified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
  // Compact notification-style badge showing the agency's branch count.
  var branchBadge = bCount > 0 ? '<span class="hub-branch-badge" title="' + bCount + ' branch' + (bCount===1?'':'es') + '" aria-label="' + bCount + ' branch' + (bCount===1?'':'es') + '"><span class="hub-branch-pin" aria-hidden="true">' + VAC_ICONS.pin + '</span><span>' + bCount + '</span></span>' : '';
  return '' +
  '<div class="hub-card" id="hub-' + a.id + '">' +
    '<button class="hub-summary" data-ripple onclick="toggleHub(\'' + a.id + '\')" aria-expanded="false">' +
      avatarHtml(a) +
      '<div class="hub-summary-body">' +
        '<div class="agency-name-row">' + verifiedCheck + '<span class="agency-name">' + escapeHtml(a.name || 'Unnamed agency') + '</span></div>' +
        (headOfficeLocation ? '<div class="hub-summary-desc hub-head-office-location">' + VAC_ICONS.pin + '<span>' + escapeHtml(headOfficeLocation) + '</span></div>' : '') +
      '</div>' +
      branchBadge +
      '<span class="chevron">' + ICON_CHEVRON + '</span>' +
    '</button>' +
    '<div class="hub-panel" id="hub-panel-' + a.id + '">' +
      '<div class="hub-panel-inner">' +
        '<div class="hub-listing-row">' +
          '<a href="agency/' + publicAgencySlug(a) + '/" target="_blank" rel="noopener" class="hub-listing-link" onclick="event.stopPropagation()">View public listing page ↗</a>' +
          '<button class="hub-share-btn" onclick="event.stopPropagation();shareAgency(\'' + a.id + '\')" aria-label="Share agency">' + SHARE_SVG + '<span>Share</span></button>' +
        '</div>' +
        '<div class="hub-tabs">' +
          '<button class="hub-tab active" data-ripple onclick="switchHubTab(this,\'' + a.id + '\',\'vacancies\')">Vacancies</button>' +
          '<button class="hub-tab" data-ripple onclick="switchHubTab(this,\'' + a.id + '\',\'branches\')">Branches</button>' +
          '<button class="hub-tab" data-ripple onclick="switchHubTab(this,\'' + a.id + '\',\'contact\')">Contact</button>' +
        '</div>' +
        '<div class="hub-tab-content" data-agency="' + a.id + '">' + hubVacancies(a) + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function hubVacancies(a) {
  var list = vacanciesFor(a.id);
  var html = '<div class="hub-list" style="padding:4px 0;">';
  if (!list.length) {
    html += '<div style="font-size:12.5px;color:var(--text-2);padding:8px 2px;">No vacancies listed right now.</div>';
  } else {
    list.forEach(function(v) {
      /* Use the new expandable vacancy card (agency vacancies show the agency photo) */
      html += vacancyCard(v, a);
      if (isAdmin) {
        html += '<div style="text-align:right;margin:-4px 0 10px;"><button class="hub-row-del" data-ripple onclick="deleteVacancy(\'' + v.id + '\',\'' + a.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>';
      }
    });
  }
  html += '</div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openVacancySheet(\'' + a.id + '\')">+ Add vacancy</button></div>';
  }
  return html;
}

function hubBranches(a) {
  var list = branchesFor(a.id);
  var html = '';
  if (!list.length) {
    html += '<div style="font-size:12.5px;color:var(--text-2);padding:8px 2px;">No branches listed yet.</div>';
  } else {
    list.forEach(function(b) {
      var bid = 'hb-' + a.id + '-' + b.id;
      /* Collapsed: name + location only, Indeed-style. Tap to reveal contact details. */
      html += '<div class="branch-block" id="' + bid + '">';
      html += '<div class="branch-block-head" onclick="toggleBranchBlock(\'' + bid + '\')">' +
        '<div class="hub-contact-body">' +
          '<div class="hub-contact-value">' + escapeHtml(b.name || 'Branch') + '</div>' +
          (b.location ? '<div class="branch-sub">' + VAC_ICONS.pin + escapeHtml(b.location) + '</div>' : '') +
        '</div>' +
        (isAdmin ? '<div class="branch-block-actions">' +
          '<button class="hub-row-edit" data-ripple title="Edit branch" onclick="event.stopPropagation();openBranchSheet(\'' + a.id + '\',\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>' +
          '<button class="hub-row-del" data-ripple title="Delete branch" onclick="event.stopPropagation();deleteBranch(\'' + b.id + '\',\'' + a.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' : '') +
        '<span class="chevron">' + ICON_CHEVRON + '</span>' +
      '</div>';
      /* Expanded: plain labeled rows, matching the agency contact tab */
      html += '<div class="branch-detail"><div class="branch-detail-inner"><div class="det-plain">';
      if (b.location) {
        html += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(b.location) + '</div>';
      }
      if (b.phone) {
        html += '<div class="det-row"><span class="det-label">Phone:</span> ' + telLink(b.phone) + '</div>';
      }
      if (b.email) {
        html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(b.email) + '</div>';
      }
      html += '</div></div></div>'; // close det-plain, branch-detail-inner, branch-detail
      html += '</div>'; // close branch-block
    });
  }
  if (isAdmin) {
    html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openBranchSheet(\'' + a.id + '\')">+ Add branch</button></div>';
  }
  return html;
}

function hubContact(a) {
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  var html = '<div class="det-plain">';
  var headOfficeAddress = a.address || a.location || '';
  var pref = (a.cvpref || '').trim();
  if (pref) html += '<div class="det-row"><span class="det-label">Preferred contact:</span> <span class="hub-contact-preferred">' + (prefIcon(pref) || ICON_SEND) + escapeHtml(pref) + '</span></div>';
  if (a.contact) html += '<div class="det-row"><span class="det-label">Contact:</span> ' + telLink(a.contact) + '</div>';
  if (a.email) html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(a.email) + '</div>';
  if (a.website) html += '<div class="det-row"><span class="det-label">Website:</span> ' + webLink(a.website) + '</div>';
  if (headOfficeAddress) html += '<div class="det-row"><span class="det-label">Head office address:</span> ' + mapsLink(headOfficeAddress) + '</div>';
  if (a.companies) html += '<div class="det-row"><span class="det-label">Companies:</span> ' + escapeHtml(a.companies) + '</div>';
  if (a.trades) html += '<div class="det-row"><span class="det-label">Trades:</span> ' + escapeHtml(a.trades) + '</div>';
  if (html === '<div class="det-plain">') html += '<div class="det-row muted">No additional details</div>';
  html += '</div>';
  // Always show a "report" link so users can flag wrong info
  html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openReportSheet(\'' + (a.name||'').replace(/'/g,"\\'") + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-3px;margin-right:5px"><path d="M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>Report wrong info</button></div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row" style="margin-top:8px;">' +
      '<button class="hub-add-btn" data-ripple onclick="openForm(\'' + a.id + '\')">Edit agency</button>' +
      '<button class="btn-ghost-danger" data-ripple onclick="deleteAgencyById(\'' + a.id + '\')" style="flex-shrink:0;">Delete</button>' +
    '</div>';
  }
  return html;
}

// ===== Hub card (employer) =====
// Same visual structure as the agency hub card, but scoped to employers:
// employers only ever appear in the Employers section, and posting a
// vacancy from here tags it with employer_id so it also shows in the
// main Vacancies list/section.
function employerHubCard(e) {
  var vCount = vacanciesForEmployer(e.id).length;
  var verifiedCheck = e.verified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
  var jobsBadge = vCount > 0 ? '<span class="hub-stat hub-stat-right" title="' + vCount + ' job' + (vCount===1?'':'s') + '"><span class="hub-stat-num"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>' + vCount + '</span></span>' : '';
  return '' +
  '<div class="hub-card" id="emphub-' + e.id + '">' +
    '<button class="hub-summary" data-ripple onclick="toggleEmpHub(\'' + e.id + '\')" aria-expanded="false">' +
      avatarHtml(e) +
      '<div class="hub-summary-body">' +
        '<div class="agency-name-row">' + verifiedCheck + '<span class="agency-name">' + escapeHtml(e.name || 'Unnamed company') + '</span></div>' +
        (e.industry ? '<div class="hub-summary-desc"><span style="color:var(--text);font-weight:600">Industry:</span> ' + escapeHtml(e.industry) + '</div>' : (e.location ? '<div class="hub-summary-desc"><span style="color:var(--text);font-weight:600">Location:</span> ' + escapeHtml(e.location) + '</div>' : '')) +
      '</div>' +
      jobsBadge +
      '<span class="chevron">' + ICON_CHEVRON + '</span>' +
    '</button>' +
    '<div class="hub-panel" id="emphub-panel-' + e.id + '">' +
      '<div class="hub-panel-inner">' +
        '<div class="hub-tabs">' +
          '<button class="hub-tab active" data-ripple onclick="switchEmpHubTab(this,\'' + e.id + '\',\'vacancies\')">Vacancies</button>' +
          '<button class="hub-tab" data-ripple onclick="switchEmpHubTab(this,\'' + e.id + '\',\'contact\')">Contact</button>' +
        '</div>' +
        '<div class="hub-tab-content" data-employer="' + e.id + '">' + employerHubVacancies(e) + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function employerHubVacancies(e) {
  var list = vacanciesForEmployer(e.id);
  var html = '<div class="hub-list" data-vacancy-state="' + (list.length ? 'ready' : 'empty') + '" style="padding:4px 0;">';
  if (!list.length) {
    html += vacancyScreenStateMarkup('employer', false, false);
  } else {
    list.forEach(function(v) {
      html += vacancyCard(v, {});
      if (isAdmin) {
        html += '<div style="text-align:right;margin:-4px 0 10px;"><button class="hub-row-del" data-ripple onclick="deleteGeneralVacancy(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>';
      }
    });
  }
  html += '</div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openEmployerVacancySheet(\'' + e.id + '\')">+ Post vacancy</button></div>';
  }
  return html;
}

function employerHubContact(e) {
  var html = '<div class="det-plain">';
  if (e.contact) html += '<div class="det-row"><span class="det-label">Contact:</span> ' + telLink(e.contact) + '</div>';
  if (e.email) html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(e.email) + '</div>';
  if (e.website) html += '<div class="det-row"><span class="det-label">Website:</span> ' + webLink(e.website) + '</div>';
  if (e.location) html += '<div class="det-row"><span class="det-label">Location:</span> ' + mapsLink(e.location) + '</div>';
  if (e.address && e.address !== e.location) html += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(e.address) + '</div>';
  if (e.industry) html += '<div class="det-row"><span class="det-label">Industry:</span> ' + escapeHtml(e.industry) + '</div>';
  if (html === '<div class="det-plain">') html += '<div class="det-row muted">No additional details</div>';
  html += '</div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row" style="margin-top:8px;">' +
      '<button class="hub-add-btn" data-ripple onclick="openEmployerForm(\'' + e.id + '\')">Edit employer</button>' +
      '<button class="btn-ghost-danger" data-ripple onclick="deleteEmployerById(\'' + e.id + '\')" style="flex-shrink:0;">Delete</button>' +
    '</div>';
  }
  return html;
}

window.toggleEmpHub = function(id) {
  if (!requireEmployerDirectoryAccess()) return;
  var card = null;
  var active = document.querySelector('.screen.active');
  if (active) card = active.querySelector('#emphub-' + id);
  if (!card) card = document.getElementById('emphub-' + id);
  if (!card) return;
  var wasOpen = card.classList.contains('open');
  if (active) active.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  else document.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  if (!wasOpen) {
    card.classList.add('open');
    trackEvent('employer_view', 'employer', id);
    setTimeout(function(){ card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 200);
  }
};

window.switchEmpHubTab = function(btn, employerId, tab) {
  if (!requireEmployerDirectoryAccess()) return;
  btn.parentElement.querySelectorAll('.hub-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  var e = employersCache.find(function(x){ return x.id === employerId; });
  var card = btn.closest('.hub-card');
  var target = card ? card.querySelector('.hub-tab-content') : null;
  if (!target) return;
  if (tab === 'vacancies') target.innerHTML = employerHubVacancies(e);
  if (tab === 'contact') target.innerHTML = employerHubContact(e);
};

var directoryReturnScreen = 'home';

function talentPoolIdentityRecord() {
  try { return JSON.parse(localStorage.getItem('sa_pool_identity') || 'null'); } catch(e) { return null; }
}
function hasTalentPoolAccess() {
  return employerDirectoryOpen || talentPoolVerified;
}
function rememberTalentPoolIdentity(phone, email) {
  try { localStorage.setItem('sa_pool_identity', JSON.stringify({ phone: phone || '', email: email || '' })); } catch(e) {}
}
async function verifyTalentPoolMembership(phone, email, quiet) {
  phone = (phone || '').trim(); email = (email || '').trim().toLowerCase();
  if (!phone || !email) { if (!quiet) showToast('Enter the email and phone number used for Talent Pool registration.'); return false; }
  try {
    var result = await supabaseClient.rpc('verify_talent_pool_access', { p_email: email, p_phone: phone });
    if (result.error) { console.error('Talent Pool verification', result.error); if (!quiet) showToast('Membership verification is not configured yet. Run CREATE_TALENT_POOL_ACCESS.sql in Supabase.'); return false; }
    talentPoolVerified = result.data === true;
    if (talentPoolVerified) rememberTalentPoolIdentity(phone, email);
    else if (!quiet) showToast('We could not verify that Talent Pool registration. Check your details.');
    return talentPoolVerified;
  } catch(e) { if (!quiet) showToast('Could not verify Talent Pool membership right now.'); return false; }
}
async function restoreTalentPoolMembership() {
  if (employerDirectoryOpen) return;
  var identity = talentPoolIdentityRecord();
  if (identity) await verifyTalentPoolMembership(identity.phone, identity.email, true);
}
function openEmployerDirectoryAccessMessage() {
  var sheet = document.getElementById('employer-directory-locked-overlay');
  var identity = talentPoolIdentityRecord();
  var phone = document.getElementById('employer-access-phone');
  var email = document.getElementById('employer-access-email');
  if (phone && identity) phone.value = identity.phone || '';
  if (email && identity) email.value = identity.email || '';
  if (sheet) sheet.classList.add('open');
  else showToast('Please verify your Talent Pool registration first to browse employers and employer vacancies.');
}
async function verifyEmployerDirectoryAccess() {
  var phone = (document.getElementById('employer-access-phone') || {}).value || '';
  var email = (document.getElementById('employer-access-email') || {}).value || '';
  var ok = await verifyTalentPoolMembership(phone, email, false);
  if (ok) {
    closeSheet('employer-directory-locked-overlay');
    showToast('Talent Pool membership verified');
    showAllEmployers();
  }
}
function requireEmployerDirectoryAccess() {
  if (employerDirectoryOpen || talentPoolVerified) return true;
  openEmployerDirectoryAccessMessage();
  return false;
}

function showAllEmployers() {
  if (!requireEmployerDirectoryAccess()) return;
  directoryReturnScreen = 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allemployers').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllEmployersList();
}

function renderAllEmployersList() {
  var q = ((document.getElementById('allemployers-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('allemployers', q);
  var el = document.getElementById('allemployers-list');
  var list = employersCache.slice();
  if (q) {
    list = list.filter(function(e){
      var hay = ((e.name||'') + ' ' + (e.industry||'') + ' ' + (e.location||'') + ' ' + (e.address||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  list.sort(function(a,b){
    if ((a.verified?1:0) !== (b.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return (a.name||'').localeCompare(b.name||'');
  });
  if (!list.length) { el.dataset.state = 'empty'; el.innerHTML = '<div class="empty-state"><h3>No employers yet</h3><p>Be the first company to register and post a vacancy.</p></div>'; return; }
  el.dataset.state = 'ready';
  el.innerHTML = list.map(employerHubCard).join('');
}

function prefIcon(pref) {
  var p = (pref||'').toLowerCase();
  if (p === 'whatsapp') return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.2 14.8l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0 1 12 4z"/></svg>';
  if (p === 'email') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  if (p === 'website') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
  if (p === 'walk-in') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  return '';
}
function mailLink(email) {
  // email may contain multiple comma separated
  var first = email.split(',')[0].trim();
  return '<a href="mailto:' + escapeHtml(first) + '" class="contact-link">' + escapeHtml(email) + '</a>';
}
function webLink(url) {
  var href = url;
  if (!/^https?:\/\//i.test(href)) href = 'https://' + href;
  return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="contact-link">' + escapeHtml(url) + '</a>';
}
function telLink(phone) {
  // Extract first phone number, strip non-dial chars for tel:
  var raw = phone.split(',')[0].trim();
  var dial = raw.replace(/[^\d+]/g, '');
  if (dial.charAt(0) === '0' && dial.length > 9) dial = '+27' + dial.substring(1);
  return '<a href="tel:' + escapeHtml(dial) + '" class="contact-link">' + escapeHtml(phone) + '</a>';
}
function mapsLink(location) {
  var href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location);
  return '<a href="' + href + '" target="_blank" rel="noopener" class="contact-link">' + escapeHtml(location) + '</a>';
}

var ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

/* ── Modern flat black-and-white icon set (currentColor, 2px stroke) ── */
var IS = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
var ICON_LOCK    = '<svg viewBox="0 0 24 24"' + IS + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
var ICON_UNLOCK  = '<svg viewBox="0 0 24 24"' + IS + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
var ICON_LINK    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
var ICON_CHAT    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>';
var ICON_HEART   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
var ICON_FLAG    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M4 21V4M4 4h12l-2 4 2 4H4"/></svg>';
var ICON_BOOK    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5H6.5A2.5 2.5 0 0 0 4 19.5z"/></svg>';
var ICON_DOC     = '<svg viewBox="0 0 24 24"' + IS + '><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h6"/></svg>';
var ICON_SPARKLE = '<svg viewBox="0 0 24 24"' + IS + '><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/></svg>';
var ICON_MIC     = '<svg viewBox="0 0 24 24"' + IS + '><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
var ICON_SCALES  = '<svg viewBox="0 0 24 24"' + IS + '><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0zM8 21h8"/></svg>';
var ICON_HELP    = '<svg viewBox="0 0 24 24"' + IS + '><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/></svg>';
var ICON_PIN     = '<svg viewBox="0 0 24 24"' + IS + '><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
var ICON_BRIEFCASE = '<svg viewBox="0 0 24 24"' + IS + '><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>';
var ICON_BUILDING = '<svg viewBox="0 0 24 24"' + IS + '><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M14 21V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v12M4 21h16"/><path d="M7 7h2M7 11h2M7 15h2"/></svg>';
var ICON_PHONE   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>';
var ICON_MAIL    = '<svg viewBox="0 0 24 24"' + IS + '><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
var ICON_WARN    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
var ICON_CHECK   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M20 6L9 17l-5-5"/></svg>';
var ICON_CLOSE   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M18 6L6 18M6 6l12 12"/></svg>';
/* Wrap an icon for a 18px menu slot */
function miSvg(svg) { return '<span class="mi-icon">' + svg + '</span>'; }
/* Small inline icon (12-14px) for stats / sub-text */
function tinySvg(svg) { return '<span class="ti">' + svg + '</span>'; }

window.switchHubTab = function(btn, agencyId, tab) {
  btn.parentElement.querySelectorAll('.hub-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  // Scope to the card that contains this button so duplicate IDs across screens don't conflict
  var card = btn.closest('.hub-card');
  var target = card ? card.querySelector('.hub-tab-content') : null;
  if (!target) {
    var active = document.querySelector('.screen.active');
    target = active ? active.querySelector('.hub-tab-content[data-agency="' + agencyId + '"]') : document.querySelector('.hub-tab-content[data-agency="' + agencyId + '"]');
  }
  if (!target) return;
  if (tab === 'vacancies') target.innerHTML = hubVacancies(a);
  if (tab === 'branches') target.innerHTML = hubBranches(a);
  if (tab === 'contact') target.innerHTML = hubContact(a);
};

window.toggleHub = function(id) {
  var card = null;
  var active = document.querySelector('.screen.active');
  if (active) card = active.querySelector('#hub-' + id);
  if (!card) card = document.getElementById('hub-' + id);
  if (!card) return;
  var wasOpen = card.classList.contains('open');
  if (active) active.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  else document.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  if (!wasOpen) {
    card.classList.add('open');
    setTimeout(function(){ card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 200);
  }
};

function filterAndRenderCached() {
  var q = (document.getElementById('home-search').value || '').trim().toLowerCase();
  var list = agenciesCache;
  if (q) {
    // Build set of agency IDs whose branches match the query (name, location, phone, email)
    var branchMatchIds = {};
    branchesCache.forEach(function(b) {
      var bHay = ((b.name||'') + ' ' + (b.location||'') + ' ' + (b.phone||'') + ' ' + (b.email||'')).toLowerCase();
      if (bHay.indexOf(q) !== -1 && b.agency_id) branchMatchIds[b.agency_id] = true;
    });
    // Build set of agency IDs whose vacancies match the query (title, notes, location)
    var vacancyMatchIds = {};
    vacanciesCache.forEach(function(v) {
      var hay = ((v.title||'') + ' ' + (v.notes||'') + ' ' + (v.location||'')).toLowerCase();
      if (hay.indexOf(q) !== -1 && v.agency_id) vacancyMatchIds[v.agency_id] = true;
    });
    // Search across name, location, address, companies, trades/industries, branch matches, vacancy matches
    list = list.filter(function(a){
      var hay = ((a.name||'') + ' ' + (a.location||'') + ' ' + (a.address||'') + ' ' + (a.companies||'') + ' ' + (a.trades||'') + ' ' + (a.contact||'') + ' ' + (a.email||'')).toLowerCase();
      return hay.indexOf(q) !== -1 || branchMatchIds[a.id] || vacancyMatchIds[a.id];
    });
  }
  var empty = document.getElementById('empty-msg');
  if (empty) {
    empty.style.display = list.length ? 'none' : 'block';
    var emptyTitle = empty.querySelector('h3');
    var emptyCopy = empty.querySelector('p');
    if (emptyTitle) emptyTitle.textContent = q ? 'No agencies match that search' : 'No agencies yet';
    if (emptyCopy) emptyCopy.textContent = q ? 'Try a different agency, job, or location.' : 'Tap + to add the first one.';
  }
  document.getElementById('hub-list').innerHTML = list.map(hubCard).join('');
}

// ===== Search screen =====


window.toggleSave = function(btn, key) {
  if (savedSet.has(key)) { savedSet.delete(key); btn.classList.remove('saved'); showToast('Removed from saved'); }
  else { savedSet.add(key); btn.classList.add('saved'); showToast('Saved \u2605'); }
  localStorage.setItem('savedVacancies', JSON.stringify(Array.from(savedSet)));
  renderSaved();
};

function renderSaved() {
  var list = vacanciesCache.filter(function(v){ return savedSet.has(v.id); });
  var el = document.getElementById('saved-list');
  if (el) el.dataset.state = list.length ? 'ready' : 'empty';
  if (!list.length) {
    el.innerHTML = vacancyScreenStateMarkup('saved', false, false);
    return;
  }
  el.innerHTML = list.map(function(v) {
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
    return vacancyCard(v, agency);
  }).join('');
}

// ===== Search screen =====
window.handleSearchScreen = function(val) {
  var q = val.trim().toLowerCase();
  var el = document.getElementById('search-results');
  if (!q) { el.dataset.state = 'empty'; el.innerHTML = vacancyScreenStateMarkup('search', false, false); return; }
  // Build set of agency IDs whose branches match (name, location, phone, email)
  var branchMatchIds = {};
  branchesCache.forEach(function(b) {
    var bHay = ((b.name||'') + ' ' + (b.location||'') + ' ' + (b.phone||'') + ' ' + (b.email||'')).toLowerCase();
    if (bHay.indexOf(q) !== -1 && b.agency_id) branchMatchIds[b.agency_id] = true;
  });
  // Agencies: match name, location, address, companies, trades/industries, contact, email, or branch match
  var am = agenciesCache.filter(function(a){
    var hay = ((a.name||'') + ' ' + (a.location||'') + ' ' + (a.address||'') + ' ' + (a.companies||'') + ' ' + (a.trades||'') + ' ' + (a.contact||'') + ' ' + (a.email||'')).toLowerCase();
    return hay.indexOf(q)!==-1 || branchMatchIds[a.id];
  });
  // Vacancies: match title, notes, location, or parent agency name/trades/companies/address
  var vm = vacanciesCache.filter(function(v){
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
    var hay = ((v.title||'') + ' ' + (v.notes||'') + ' ' + (v.location||'')).toLowerCase();
    if (hay.indexOf(q)!==-1) return true;
    if (agency) {
      var aHay = ((agency.name||'') + ' ' + (agency.trades||'') + ' ' + (agency.companies||'') + ' ' + (agency.address||'') + ' ' + (agency.location||'')).toLowerCase();
      if (aHay.indexOf(q)!==-1) return true;
    }
    return false;
  });
  if (!am.length && !vm.length) { el.dataset.state = 'empty'; el.innerHTML = vacancyScreenStateMarkup('search', false, true); return; }
  var html = '';
  if (am.length) html += am.map(hubCard).join('');
  if (vm.length) {
    vm.forEach(function(v) {
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
      html += vacancyCard(v, agency);
    });
  }
  el.dataset.state = 'ready';
  el.innerHTML = html;
};

function vacancyCard(v, agency) {
  var key = v.id;
  var saved = savedSet.has(key);
  var isGeneral = v.agency_id === 'general';
  var employer = v.employer_id ? (employersCache.find(function(e){ return e.id === v.employer_id; }) || null) : null;
  var isEmployerPost = !!employer;
  var employerAccessLocked = isEmployerPost && !employerDirectoryOpen && !hasTalentPoolAccess();
  var orgName = isEmployerPost ? (employer.name || 'Employer') : (isGeneral ? (v.company || 'General Vacancy') : (agency.name || ''));
  var title = escapeHtml(v.title || 'Untitled role');
  var verifiedCheck = ((isEmployerPost && employer.verified) || (!isEmployerPost && !isGeneral && agency && agency.verified)) ? '<span class="verified-check" title="' + (isEmployerPost ? 'Verified employer' : 'Verified agency') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';

  /* Logo tile: employer/agency photo -> img; else company/agency initials on a gradient */
  var logo;
  if (isEmployerPost && employer.photo) {
    logo = '<div class="vac-logo"><img src="' + escapeHtml(employer.photo) + '" alt="" onerror="this.style.display=\'none\'"></div>';
  } else if (!isEmployerPost && !isGeneral && agency && agency.photo) {
    logo = '<div class="vac-logo"><img src="' + escapeHtml(agency.photo) + '" alt="" onerror="this.style.display=\'none\'"></div>';
  } else {
    var grad = vacGradFor(orgName);
    logo = '<div class="vac-logo ' + grad + '">' + escapeHtml(initials(orgName)) + '</div>';
  }

  /* Indeed-style summary: title, company, location, posted time — nothing else.
     Everything else (work arrangement, salary, closing date, contacts...) only
     shows once the card is tapped open. */
  var locLine = v.location ? ('<div class="vac-loc-line">' + VAC_ICONS.pin + escapeHtml(v.location) + '</div>') : '';
  var postedLine = '<div class="vac-posted">' + timeAgo(v.created_at) + '</div>';

  /* Detail rows (inside expandable section) */
  var detail = '';
  if (v.location) detail += vacDetRow(VAC_ICONS.pin, 'Location', escapeHtml(v.location));
  if (v.remote) detail += vacDetRow(VAC_ICONS.globe, 'Work Arrangement', escapeHtml(v.remote));
  if (v.experience_level) detail += vacDetRow(VAC_ICONS.star, 'Experience Level', escapeHtml(v.experience_level));
  if (v.employment_type) detail += vacDetRow(VAC_ICONS.briefcase, 'Employment Type', escapeHtml(v.employment_type + (v.contract_type ? ' \u2014 ' + v.contract_type : '')));
  if (v.salary) detail += vacDetRow(VAC_ICONS.money, 'Salary', escapeHtml(v.salary));
  if (v.hours) detail += vacDetRow(VAC_ICONS.clock, 'Hours', escapeHtml(v.hours));
  if (v.work_schedule) detail += vacDetRow(VAC_ICONS.calendar, 'Work Schedule', escapeHtml(v.work_schedule));
  if (v.start_date) detail += vacDetRow(VAC_ICONS.calendar, 'Start Date', escapeHtml(v.start_date));
  if (v.closing_date) detail += vacDetRow(VAC_ICONS.calendar, 'Closing Date', escapeHtml(v.closing_date));
  if (orgName) detail += vacDetRow(VAC_ICONS.building, isEmployerPost ? 'Employer' + (employer.verified ? ' \u2713 Verified' : '') : (isGeneral ? 'Company' : 'Agency' + ((agency && agency.verified) ? ' \u2713 Verified' : '')), escapeHtml(orgName));
  /* Email and phone detail rows with clickable links */
  if (v.email) detail += vacDetRow(VAC_ICONS.mail, 'Contact Email', mailLink(v.email));
  if (v.phone) detail += vacDetRow(VAC_ICONS.phone, 'Contact Phone', telLink(v.phone));

  var desc = v.notes ? '<div class="vac-desc-title">Job description</div><div class="vac-desc">' + escapeHtml(v.notes) + '</div>' : '';

  /* Action buttons */
  var actions = '<div class="vac-actions">';
  if (v.link) {
    actions += '<a class="vac-apply" href="' + escapeHtml(v.link) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.apply + 'Apply here</a>';
  } else if (v.email || v.phone) {
    /* No link but has email/phone — show contact buttons */
    if (v.email) {
      actions += '<a class="vac-apply" href="mailto:' + escapeHtml(v.email) + '" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.mail + 'Email to apply</a>';
    }
    if (v.phone) {
      actions += '<a class="vac-apply' + (v.email ? ' vac-apply-secondary' : '') + '" href="tel:' + escapeHtml(v.phone.replace(/\s/g,'')) + '" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.phone + 'Call to apply</a>';
    }
  } else if (isEmployerPost && (employer.contact || employer.email || employer.website)) {
    var ecta = employer.website ? escapeHtml(employer.website) : '#';
    actions += '<a class="vac-apply" href="' + ecta + '" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.apply + 'Contact employer</a>';
  } else if (!isGeneral && !isEmployerPost && agency && (agency.contact || agency.email || agency.website)) {
    var cta = agency.website ? escapeHtml(agency.website) : '#';
    actions += '<a class="vac-apply" href="' + cta + '" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.apply + 'Contact agency</a>';
  } else {
    actions += '<button class="vac-apply" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId);showToast(\'Contact the agency or company directly to apply.\')">' + VAC_ICONS.apply + 'Contact to apply</button>';
  }
  actions += '<a class="vac-apply vac-apply-secondary" href="vacancy/' + publicVacancySlug(v) + '/" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">View public listing ↗</a>';
  actions += '<button class="vac-close-btn" onclick="event.stopPropagation();closeVac(this)">Close</button></div>';

  /* Admin actions (general vacancies + employer vacancies, when admin) */
  var admin = '';
  if (isAdmin && (isGeneral || isEmployerPost)) {
    admin = '<div class="vac-admin-actions">' +
      '<button class="rate-action-btn" data-ripple onclick="event.stopPropagation();openEditGeneralVacancySheet(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>' +
      '<button class="rate-action-btn danger" data-ripple onclick="event.stopPropagation();deleteGeneralVacancy(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>' +
    '</div>';
  }

  return '' +
  '<article class="vac-card' + (employerAccessLocked ? ' vac-card-locked' : '') + '" id="vc-' + key + '" data-vacancy-id="' + escapeHtml(v.id) + '" onclick="' + (employerAccessLocked ? 'openEmployerDirectoryAccessMessage()' : 'toggleVac(this)') + '">' +
    '<div class="vac-card-main">' +
      logo +
      '<div class="vac-body">' +
        '<div class="vac-title">' + title + '</div>' +
        '<div class="vac-company">' + verifiedCheck + escapeHtml(orgName) + '</div>' +
        locLine +
        postedLine +
      '</div>' +
      '<div class="vac-card-side">' +
        '<button class="vac-share" onclick="event.stopPropagation();shareVacancy(\'' + key + '\')" aria-label="Share vacancy">' + SHARE_SVG + '</button>' +
        '<button class="vac-save' + (saved ? ' saved' : '') + '" onclick="event.stopPropagation();toggleSave(this,\'' + key + '\')" aria-label="Save vacancy">' + STAR_SVG + '</button>' +
        '<span class="chevron">' + ICON_CHEVRON + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="vac-detail"><div class="vac-detail-inner">' +
      detail + desc + actions + admin +
    '</div></div>' +
  '</article>';
}

/* Human-friendly relative time, Indeed-style ("Just posted", "1 day ago", "3 days ago"...) */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  var then = new Date(dateStr).getTime();
  if (!then || isNaN(then)) return '';
  var diff = Date.now() - then;
  if (diff < 0) diff = 0;
  var min = Math.floor(diff / 60000);
  if (min < 60) return min < 1 ? 'Just posted' : (min + (min === 1 ? ' minute ago' : ' minutes ago'));
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
  var day = Math.floor(hr / 24);
  if (day < 30) return day + (day === 1 ? ' day ago' : ' days ago');
  var month = Math.floor(day / 30);
  if (month < 12) return month + (month === 1 ? ' month ago' : ' months ago');
  var year = Math.floor(month / 12);
  return year + (year === 1 ? ' year ago' : ' years ago');
}

/* Shorten a full street address down to "Suburb, City" for compact collapsed rows.
   Drops a trailing postal code / "South Africa" if present, then keeps the last
   two comma-separated segments. Falls back gracefully for short addresses. */
function shortLocation(loc) {
  if (!loc) return '';
  var parts = loc.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  while (parts.length > 2 && (/^\d+$/.test(parts[parts.length - 1]) || /^south africa$/i.test(parts[parts.length - 1]))) {
    parts.pop();
  }
  if (parts.length <= 2) return parts.join(', ');
  return parts.slice(-2).join(', ');
}

/* Helper: detail row with icon + label + value */
function vacDetRow(icn, label, val) {
  return '<div class="vac-detail-row"><span class="vac-detail-icon">' + icn + '</span><div><div class="vac-detail-label">' + label + '</div><div class="vac-detail-value">' + val + '</div></div></div>';
}

/* Helper: deterministic gradient class from a name (so each company gets a stable color) */
var VAC_GRADS = ['grad-blue','grad-green','grad-orange','grad-purple','grad-teal','grad-pink','grad-indigo','grad-mint','grad-amber','grad-red','grad-brown','grad-gray'];
function vacGradFor(name) {
  if (!name) return 'grad-gray';
  var h = 0;
  for (var i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return VAC_GRADS[Math.abs(h) % VAC_GRADS.length];
}

/* Vacancy card small inline icons (white stroke, sized by CSS) */
var VAC_ICONS = {
  pin:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  briefcase:'<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
  doc:'<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  money:'<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>',
  clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  calendar:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  building:'<svg viewBox="0 0 24 24"><path d="M3 22h18M4 21h16M3.5 10L12 4.5 20.5 10M5 21V11M9 21V11M15 21V11M19 21V11M2 10h20"/></svg>',
  mail:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  phone:'<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  apply:'<svg viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  globe:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  edit:'<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
};

/* Share icon for the vacancy card's share button (node network glyph, matches vac-save sizing) */
var SHARE_SVG = '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 10.51l6.83-3.98M8.59 13.49l6.83 3.98"/></svg>';

/* Toggle expand/collapse of a vacancy card */
window.toggleVac = function(target) {
  var c = target && target.closest ? target.closest('.vac-card') : document.getElementById('vc-' + target);
  if (c) {
    var opening = !c.classList.contains('open');
    c.classList.toggle('open');
    if (opening && c.dataset.vacancyId) trackEvent('vacancy_view', 'vacancy', c.dataset.vacancyId);
  }
};
window.closeVac = function(target) {
  var c = target && target.closest ? target.closest('.vac-card') : document.getElementById('vc-' + target);
  if (c) c.classList.remove('open');
};

/* Toggle expand/collapse of a branch block/row (used by hub branch tab and the All Branches screen) */
window.toggleBranchBlock = function(id) {
  var c = document.getElementById(id);
  if (c) c.classList.toggle('open');
};

window.toggleSave = function(btn, key) {
  if (savedSet.has(key)) { savedSet.delete(key); btn.classList.remove('saved'); btn.innerHTML = STAR_SVG; showToast('Removed from saved'); }
  else { savedSet.add(key); btn.classList.add('saved'); btn.innerHTML = STAR_SVG; showToast('Saved'); }
  localStorage.setItem('savedVacancies', JSON.stringify(Array.from(savedSet)));
  renderSaved();
};

function renderSaved() {
  var list = vacanciesCache.filter(function(v){ return savedSet.has(v.id); });
  var el = document.getElementById('saved-list');
  if (el) el.dataset.state = list.length ? 'ready' : 'empty';
  if (!list.length) {
    el.innerHTML = vacancyScreenStateMarkup('saved', false, false);
    return;
  }
  el.innerHTML = list.map(function(v) {
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
    return vacancyCard(v, agency);
  }).join('');
}

// ===== Agency form =====
function openForm(id) {
  editingId = id || null;
  var a = id ? agenciesCache.find(function(x){ return x.id === id; }) : null;
  document.getElementById('form-title').textContent = id ? 'Edit agency' : 'Add agency';
  document.getElementById('f-name').value = a ? a.name : '';
  document.getElementById('f-website').value = a ? a.website : '';
  document.getElementById('f-contact').value = a ? a.contact : '';
  document.getElementById('f-email').value = a ? a.email : '';
  document.getElementById('f-location').value = a ? a.location : '';
  document.getElementById('f-address').value = a ? (a.address || '') : '';
  document.getElementById('f-cvpref').value = a ? a.cvpref : 'Email';
  document.getElementById('f-companies').value = a ? (a.companies || '') : '';
  document.getElementById('f-trades').value = a ? (a.trades || '') : '';
  document.getElementById('f-verified').checked = a ? !!a.verified : false;
  document.getElementById('verified-toggle-row').style.display = isAdmin ? 'flex' : 'none';
  window.pendingPhoto = a ? a.photo : null;
  var preview = document.getElementById('photo-preview');
  var fallback = document.getElementById('photo-fallback');
  if (a && a.photo) { preview.src = a.photo; preview.style.display='block'; fallback.style.display='none'; }
  else { preview.style.display='none'; fallback.style.display='flex'; }
  document.getElementById('hub-list') && document.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  document.getElementById('form-overlay').classList.add('open');
}
function handlePhoto(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxDim = 480;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      window.pendingPhoto = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('photo-preview').src = window.pendingPhoto;
      document.getElementById('photo-preview').style.display = 'block';
      document.getElementById('photo-fallback').style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
// Talent Pool candidate photos go into Supabase Storage (not the DB row)
// so thousands of registrations don't eat into the 500MB database cap —
// only a short URL is stored on the candidate record.
// Photos are centre-cropped to a fixed 512x512 square so every candidate's
// photo is a consistent, predictable size wherever it's used — the pool
// list avatar, their expanded card, and the home screen candidate spotlight.
function handlePoolPhoto(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  var preview = document.getElementById('pool-photo-preview');
  var fallback = document.getElementById('pool-photo-fallback');
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = function() {
      var SIZE = 512;
      var side = Math.min(img.width, img.height);
      var sx = (img.width - side) / 2;
      var sy = (img.height - side) / 2;
      var canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      canvas.toBlob(function(blob) {
        window.pendingPoolPhotoBlob = blob;
        var url = URL.createObjectURL(blob);
        if (preview) { preview.src = url; preview.style.display = 'block'; }
        if (fallback) fallback.style.display = 'none';
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
// Uploads the compressed pool photo (if one was chosen) to the
// candidate-photos bucket and returns its public URL, or null if no
// photo was selected or the bucket/policies haven't been set up yet
// (registration still succeeds without a photo either way).
async function uploadPoolPhotoIfAny() {
  if (!window.pendingPoolPhotoBlob) return null;
  try {
    var path = Date.now().toString(36) + Math.random().toString(36).slice(2) + '.jpg';
    var upload = await supabaseClient.storage.from('candidate-photos').upload(path, window.pendingPoolPhotoBlob, { contentType: 'image/jpeg', upsert: false });
    if (upload.error) { console.error('pool photo upload', upload.error); return null; }
    var pub = supabaseClient.storage.from('candidate-photos').getPublicUrl(path);
    return (pub && pub.data && pub.data.publicUrl) || null;
  } catch(e) { console.error('pool photo upload', e); return null; }
}
async function saveAgency() {
  var name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Add at least the agency name.'); return; }
  var id = editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var payload = {
    id: id,
    name: name,
    website: document.getElementById('f-website').value.trim(),
    contact: document.getElementById('f-contact').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    cvpref: document.getElementById('f-cvpref').value,
    companies: document.getElementById('f-companies').value.trim(),
    trades: document.getElementById('f-trades').value.trim(),
    photo: window.pendingPhoto
  };
  if (isAdmin) payload.verified = document.getElementById('f-verified').checked;
  await upsertAgency(payload);
  // Auto-generate a SMART MANAGER token for new agencies
  if (!editingId) {
    var token = genToken();
    setManagerToken(id, token);
  }
  closeSheet('form-overlay');
  showToast(editingId ? 'Agency updated' : 'Agency added — SMART MANAGER link created');
  editingId = null;
  await loadAll();
}
async function deleteAgencyById(id) {
  if (!confirm('Delete this agency? This cannot be undone.')) return;
  await removeAgency(id);
  showToast('Agency deleted');
  await loadAll();
}

// ===== Employer form =====
var editingEmployerId = null;
function openEmployerForm(id) {
  if (!id && !isAdmin && !publicEmployerRegistrationOpen) { openEmployerLockedSheet(); return; }
  editingEmployerId = id || null;
  var e = id ? employersCache.find(function(x){ return x.id === id; }) : null;
  document.getElementById('employer-form-title').textContent = id ? 'Edit employer' : 'Register your company';
  document.getElementById('e-name').value = e ? e.name : '';
  document.getElementById('e-industry').value = e ? (e.industry || '') : '';
  document.getElementById('e-website').value = e ? (e.website || '') : '';
  document.getElementById('e-contact').value = e ? (e.contact || '') : '';
  document.getElementById('e-email').value = e ? (e.email || '') : '';
  document.getElementById('e-location').value = e ? (e.location || '') : '';
  document.getElementById('e-address').value = e ? (e.address || '') : '';
  document.getElementById('e-verified').checked = e ? !!e.verified : false;
  document.getElementById('employer-verified-toggle-row').style.display = isAdmin ? 'flex' : 'none';
  window.pendingEmployerPhoto = e ? e.photo : null;
  var preview = document.getElementById('emp-photo-preview');
  var fallback = document.getElementById('emp-photo-fallback');
  if (e && e.photo) { preview.src = e.photo; preview.style.display='block'; fallback.style.display='none'; }
  else { preview.style.display='none'; fallback.style.display='flex'; }
  document.getElementById('employer-form-overlay').classList.add('open');
}
function handleEmployerPhoto(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxDim = 480;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      window.pendingEmployerPhoto = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('emp-photo-preview').src = window.pendingEmployerPhoto;
      document.getElementById('emp-photo-preview').style.display = 'block';
      document.getElementById('emp-photo-fallback').style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function saveEmployer() {
  var name = document.getElementById('e-name').value.trim();
  if (!name) { alert('Add at least the company name.'); return; }
  var id = editingEmployerId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var payload = {
    id: id,
    name: name,
    industry: document.getElementById('e-industry').value.trim(),
    website: document.getElementById('e-website').value.trim(),
    contact: document.getElementById('e-contact').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    location: document.getElementById('e-location').value.trim(),
    address: document.getElementById('e-address').value.trim(),
    photo: window.pendingEmployerPhoto
  };
  if (isAdmin) payload.verified = document.getElementById('e-verified').checked;
  var live = await upsertEmployer(payload);
  closeSheet('employer-form-overlay');
  showToast(editingEmployerId ? 'Employer updated' : (live ? 'Company registered — you can now post vacancies' : '⚠ Only saved on THIS device — run CREATE_EMPLOYERS_TABLE.sql so it shows for everyone.'));
  editingEmployerId = null;
  await loadAll();
  if (document.getElementById('screen-allemployers').classList.contains('active')) renderAllEmployersList();
}
async function deleteEmployerById(id) {
  if (!confirm('Delete this employer? Their posted vacancies will remain listed as unattributed unless you also remove them.')) return;
  await removeEmployer(id);
  showToast('Employer deleted');
  await loadAll();
  if (document.getElementById('screen-allemployers').classList.contains('active')) renderAllEmployersList();
}

// ===== Branch form =====
var pendingBranchAgency = null;
var pendingBranchId = null; // set when EDITING an existing branch; null when adding
function openBranchSheet(agencyId, branchId) {
  pendingBranchAgency = agencyId;
  pendingBranchId = branchId || null;
  // Find existing branch (for editing) — looks in both cache and localStorage fallback
  var existing = null;
  if (branchId) {
    existing = branchesCache.find(function(x){ return x.id === branchId; });
    if (!existing) {
      var local = readLocal('branches');
      existing = local.find(function(x){ return x.id === branchId; });
    }
  }
  // Update sheet title
  var titleEl = document.querySelector('#branch-overlay .sheet h3');
  if (titleEl) titleEl.textContent = existing ? 'Edit branch' : 'Add branch';
  // Populate fields
  document.getElementById('b-name').value = existing ? (existing.name || '') : '';
  document.getElementById('b-location').value = existing ? (existing.location || '') : '';
  document.getElementById('b-phone').value = existing ? (existing.phone || '') : '';
  document.getElementById('b-email').value = existing ? (existing.email || '') : '';
  document.getElementById('branch-overlay').classList.add('open');
}
async function saveBranch() {
  var name = document.getElementById('b-name').value.trim();
  if (!name) { alert('Add a branch name.'); return; }
  // Reuse existing id when editing; generate a new one only when adding
  var id = pendingBranchId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var live = await upsertBranch({ id: id, agency_id: pendingBranchAgency, name: name, location: document.getElementById('b-location').value.trim(), phone: document.getElementById('b-phone').value.trim(), email: document.getElementById('b-email').value.trim() });
  var editing = !!pendingBranchId;
  pendingBranchId = null; // reset
  closeSheet('branch-overlay');
  showToast(live ? (editing ? 'Branch updated' : 'Branch added') : (editing ? 'Branch updated (saved on this device)' : 'Branch added (saved on this device)'));
  await loadAll();
  if (managerMode) { renderManagerMode(); return; }
  var card = document.getElementById('hub-' + pendingBranchAgency);
  if (card) { card.classList.add('open'); switchHubTab(card.querySelector('.hub-tab'), pendingBranchAgency, 'branches'); }
}
async function deleteBranch(id, agencyId) {
  if (!confirm('Delete this branch?')) return;
  await removeBranch(id);
  await loadAll();
  var card = document.getElementById('hub-' + agencyId);
  if (card) card.classList.add('open');
}

// ===== Vacancy form =====
var MANAGER_TERMS_VERSION = '1.1';
var MANAGER_TERMS_PDF = 'terms/vacancy-posting-terms.pdf';
function resetVacancyTermsAcceptance() {
  ['vacancy-terms-accept', 'general-vacancy-terms-accept'].forEach(function(id) {
    var input = document.getElementById(id);
    if (input) input.checked = false;
  });
}
function requireVacancyTermsAcceptance(inputId) {
  var input = document.getElementById(inputId);
  if (!input || !input.checked) {
    alert('Please read the SA Recruiters Vacancy Posting Terms & Conditions and tick the agreement box before publishing.');
    if (input) input.focus();
    return false;
  }
  return true;
}
function currentTermsManagerType() {
  if (managerMode) return 'agency';
  if (employerManagerMode) return 'employer';
  return 'public';
}
async function recordVacancyTermsAcceptance(vacancyId, agencyId, employerId) {
  try {
    var result = await supabaseClient.from('manager_terms_acceptances').insert({
      manager_type: currentTermsManagerType(),
      agency_id: agencyId || null,
      employer_id: employerId || null,
      vacancy_id: vacancyId || null,
      terms_version: MANAGER_TERMS_VERSION,
      accepted_at: new Date().toISOString(),
      user_agent: navigator.userAgent || null
    });
    if (result.error) { console.warn('terms acceptance record unavailable', result.error); return false; }
    return true;
  } catch (e) { console.warn('terms acceptance record failed', e); return false; }
}
var pendingVacancyAgency = null;
function openVacancySheet(agencyId) {
  pendingVacancyAgency = agencyId;
  document.getElementById('v-title').value = '';
  document.getElementById('v-location').value = '';
  document.getElementById('v-etype').value = '';
  document.getElementById('v-contract').value = '';
  document.getElementById('v-salary').value = '';
  document.getElementById('v-hours').value = '';
  document.getElementById('v-schedule').value = '';
  document.getElementById('v-start').value = '';
  document.getElementById('v-closing').value = '';
  document.getElementById('v-notes').value = '';
  document.getElementById('v-link').value = '';
  resetVacancyTermsAcceptance();
  document.getElementById('vacancy-overlay').classList.add('open');
}
function normalizeVacancyLink(value) {
  var link = (value || '').trim();
  if (!link || /^https?:\/\//i.test(link)) return link;
  return /^[^\s/]+\.[^\s/]+/.test(link) ? 'https://' + link : link;
}
function setVacancySaveBusy(busy) {
  document.querySelectorAll('#vacancy-overlay .sheet-submit,#general-vacancy-overlay .sheet-submit').forEach(function(btn) {
    btn.disabled = !!busy;
    if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  });
}

async function saveVacancy() {
  var title = document.getElementById('v-title').value.trim();
  if (!title) { alert('Add a role/title.'); return; }
  if (!isAdmin && !requireVacancyTermsAcceptance('vacancy-terms-accept')) return;
  setVacancySaveBusy(true);
  try {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    var live = await upsertVacancy({
      id: id, agency_id: pendingVacancyAgency, title: title,
      location: document.getElementById('v-location').value.trim(),
      employment_type: document.getElementById('v-etype').value.trim(),
      contract_type: document.getElementById('v-contract').value.trim(),
      salary: document.getElementById('v-salary').value.trim(),
      hours: document.getElementById('v-hours').value.trim(),
      work_schedule: document.getElementById('v-schedule').value.trim(),
      start_date: document.getElementById('v-start').value.trim(),
      closing_date: document.getElementById('v-closing').value.trim(),
      notes: document.getElementById('v-notes').value.trim(),
      link: normalizeVacancyLink(document.getElementById('v-link').value)
    });
    var termsRecorded = live ? await recordVacancyTermsAcceptance(id, managerMode && managerAgency ? managerAgency.id : pendingVacancyAgency, null) : false;
    closeSheet('vacancy-overlay');
    showToast(live ? (termsRecorded ? 'Vacancy published' : 'Vacancy published — terms acceptance could not be recorded') : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
    await loadAll();
    if (managerMode) { renderManagerMode(); return; }
    var card = document.getElementById('hub-' + pendingVacancyAgency);
    if (card) { card.classList.add('open'); switchHubTab(card.querySelector('.hub-tab'), pendingVacancyAgency, 'vacancies'); }
  } catch (error) {
    console.error('[SA Recruiters] Vacancy save failed', error);
    showToast('Could not save the vacancy. Please try again.');
  } finally {
    setVacancySaveBusy(false);
  }
}
async function deleteVacancy(id, agencyId) {
  if (!confirm('Delete this vacancy?')) return;
  await removeVacancy(id);
  await loadAll();
  var card = document.getElementById('hub-' + agencyId);
  if (card) card.classList.add('open');
}

// ===== General vacancy posting (profile section, admin) =====
var editingGeneralVacancyId = null;
var pendingVacancyEmployer = null; // set when posting/editing a vacancy from an employer's profile
function openGeneralVacancySheet() {
  if (!isAdmin && !publicVacancyPostingOpen) { openVacancyLockedSheet(); return; }
  editingGeneralVacancyId = null;
  pendingVacancyEmployer = null;
  document.getElementById('gv-title').textContent = 'Post a vacancy';
  document.getElementById('gv-submit-btn').textContent = 'Publish vacancy';
  document.getElementById('gv-role').value = '';
  document.getElementById('gv-company').value = '';
  document.getElementById('gv-location').value = '';
  document.getElementById('gv-remote').value = '';
  document.getElementById('gv-etype').value = '';
  document.getElementById('gv-exp').value = '';
  document.getElementById('gv-contract').value = '';
  document.getElementById('gv-salary').value = '';
  document.getElementById('gv-hours').value = '';
  document.getElementById('gv-schedule').value = '';
  document.getElementById('gv-start').value = '';
  document.getElementById('gv-closing').value = '';
  document.getElementById('gv-notes').value = '';
  document.getElementById('gv-link').value = '';
  document.getElementById('gv-email').value = '';
  document.getElementById('gv-phone').value = '';
  resetVacancyTermsAcceptance();
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
// Post a vacancy as a specific registered employer — same form, but the
// company field is locked to the employer's name and the saved vacancy is
// tagged with employer_id so it shows the employer's logo/verified badge
// and appears in both the employer's profile AND the main Vacancies list.
function openEmployerVacancySheet(employerId) {
  var isSelfManaging = employerManagerMode && managerEmployer && managerEmployer.id === employerId;
  if (!isAdmin && !isSelfManaging) { showToast('Vacancy posting for employers is managed by the admin.'); return; }
  var emp = employersCache.find(function(x){ return x.id === employerId; });
  if (!emp) { showToast('Employer not found'); return; }
  editingGeneralVacancyId = null;
  pendingVacancyEmployer = employerId;
  document.getElementById('gv-title').textContent = 'Post a vacancy — ' + emp.name;
  document.getElementById('gv-submit-btn').textContent = 'Publish vacancy';
  document.getElementById('gv-role').value = '';
  document.getElementById('gv-company').value = emp.name || '';
  document.getElementById('gv-location').value = emp.location || '';
  document.getElementById('gv-remote').value = '';
  document.getElementById('gv-etype').value = '';
  document.getElementById('gv-exp').value = '';
  document.getElementById('gv-contract').value = '';
  document.getElementById('gv-salary').value = '';
  document.getElementById('gv-hours').value = '';
  document.getElementById('gv-schedule').value = '';
  document.getElementById('gv-start').value = '';
  document.getElementById('gv-closing').value = '';
  document.getElementById('gv-notes').value = '';
  document.getElementById('gv-link').value = '';
  document.getElementById('gv-email').value = emp.email || '';
  document.getElementById('gv-phone').value = emp.contact || '';
  resetVacancyTermsAcceptance();
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
function openEditGeneralVacancySheet(id) {
  var v = vacanciesCache.find(function(x) { return x.id === id; });
  if (!v) { showToast('Vacancy not found'); return; }
  editingGeneralVacancyId = id;
  pendingVacancyEmployer = v.employer_id || null;
  document.getElementById('gv-title').textContent = 'Edit vacancy';
  document.getElementById('gv-submit-btn').textContent = 'Save changes';
  document.getElementById('gv-role').value = v.title || '';
  document.getElementById('gv-company').value = v.company || '';
  document.getElementById('gv-location').value = v.location || '';
  document.getElementById('gv-remote').value = v.remote || '';
  document.getElementById('gv-etype').value = v.employment_type || '';
  document.getElementById('gv-exp').value = v.experience_level || '';
  document.getElementById('gv-contract').value = v.contract_type || '';
  document.getElementById('gv-salary').value = v.salary || '';
  document.getElementById('gv-hours').value = v.hours || '';
  document.getElementById('gv-schedule').value = v.work_schedule || '';
  document.getElementById('gv-start').value = v.start_date || '';
  document.getElementById('gv-closing').value = v.closing_date || '';
  document.getElementById('gv-notes').value = v.notes || '';
  document.getElementById('gv-link').value = v.link || '';
  document.getElementById('gv-email').value = v.email || '';
  document.getElementById('gv-phone').value = v.phone || '';
  resetVacancyTermsAcceptance();
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
async function saveGeneralVacancy() {
  var title = document.getElementById('gv-role').value.trim();
  if (!title) { alert('Add a role/title.'); return; }
  if (!isAdmin && !requireVacancyTermsAcceptance('general-vacancy-terms-accept')) return;
  setVacancySaveBusy(true);
  try {
    var data = {
      title: title,
      company: document.getElementById('gv-company').value.trim(),
      location: document.getElementById('gv-location').value.trim(),
      // The vacancies table's CHECK constraint only allows NULL, 'On-site',
      // 'Remote', or 'Hybrid' — an empty string (the dropdown's default
      // "— Not specified —" option) violates it and silently fails the
      // whole save. Send null instead whenever it's left unset.
      remote: document.getElementById('gv-remote').value || null,
      employment_type: document.getElementById('gv-etype').value.trim(),
      experience_level: document.getElementById('gv-exp').value,
      contract_type: document.getElementById('gv-contract').value.trim(),
      salary: document.getElementById('gv-salary').value.trim(),
      hours: document.getElementById('gv-hours').value.trim(),
      work_schedule: document.getElementById('gv-schedule').value.trim(),
      start_date: document.getElementById('gv-start').value.trim(),
      closing_date: document.getElementById('gv-closing').value.trim(),
      notes: document.getElementById('gv-notes').value.trim(),
      link: normalizeVacancyLink(document.getElementById('gv-link').value),
      email: document.getElementById('gv-email').value.trim(),
      phone: document.getElementById('gv-phone').value.trim(),
      agency_id: pendingVacancyEmployer ? 'employer' : 'general'
    };
    if (pendingVacancyEmployer) data.employer_id = pendingVacancyEmployer;
    var wasEmployerPost = !!pendingVacancyEmployer;
    var employerIdForRefresh = pendingVacancyEmployer;
    var termsRecordedGeneral = false;
    if (editingGeneralVacancyId) {
      data.id = editingGeneralVacancyId;
      var live2 = await upsertVacancy(data);
      termsRecordedGeneral = live2 ? await recordVacancyTermsAcceptance(data.id, null, pendingVacancyEmployer || (employerManagerMode && managerEmployer ? managerEmployer.id : null)) : false;
      closeSheet('general-vacancy-overlay');
      showToast(live2 ? (termsRecordedGeneral ? 'Vacancy updated' : 'Vacancy updated — terms acceptance could not be recorded') : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
    } else {
      data.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      var live3 = await upsertVacancy(data);
      termsRecordedGeneral = live3 ? await recordVacancyTermsAcceptance(data.id, null, pendingVacancyEmployer || (employerManagerMode && managerEmployer ? managerEmployer.id : null)) : false;
      closeSheet('general-vacancy-overlay');
      showToast(live3 ? (termsRecordedGeneral ? 'Vacancy published' : 'Vacancy published — terms acceptance could not be recorded') : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
    }
    editingGeneralVacancyId = null;
    pendingVacancyEmployer = null;
    await loadAll();
    if (document.getElementById('screen-allvacancies').classList.contains('active')) renderAllVacanciesList();
    if (wasEmployerPost && employerIdForRefresh && document.getElementById('screen-allemployers').classList.contains('active')) {
      renderAllEmployersList();
      var empCard = document.getElementById('emphub-' + employerIdForRefresh);
      if (empCard) empCard.classList.add('open');
    }
  } catch (error) {
    console.error('[SA Recruiters] General vacancy save failed', error);
    showToast('Could not save the vacancy. Please try again.');
  } finally {
    setVacancySaveBusy(false);
  }
}
async function deleteGeneralVacancy(id) {
  if (!confirm('Delete this vacancy?')) return;
  await removeVacancy(id);
  showToast('Vacancy deleted');
  await loadAll();
  if (document.getElementById('screen-allvacancies').classList.contains('active')) {
    renderAllVacanciesList();
  }
  if (document.getElementById('screen-allemployers').classList.contains('active')) {
    renderAllEmployersList();
  }
}

// ===== Sheets / misc =====
function closeSheet(id) { document.getElementById(id).classList.remove('open'); }
function openSupportSheet() { document.getElementById('support-overlay').classList.add('open'); }
// ===== Private device Notes =====
var NOTES_KEY = 'sa_recruiters_private_notes_v1';
function readNotes() {
  try { var notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); return Array.isArray(notes) ? notes : []; } catch(e) { return []; }
}
function writeNotes(notes) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch(e) { showToast('Could not save note'); }
}
function openNotesSheet() {
  resetNoteForm();
  renderNotes();
  loadSocialLinks();
  var overlay = document.getElementById('notes-overlay');
  if (overlay) overlay.classList.add('open');
}
function resetNoteForm() {
  var id = document.getElementById('note-edit-id');
  var title = document.getElementById('note-title');
  var body = document.getElementById('note-body');
  if (id) id.value = '';
  if (title) title.value = '';
  if (body) body.value = '';
  var save = document.querySelector('#notes-overlay .sheet-submit');
  if (save) save.textContent = 'Save note';
}
function renderNotes() {
  var list = document.getElementById('notes-list');
  if (!list) return;
  var notes = readNotes();
  if (!notes.length) { list.innerHTML = '<div class="notes-empty">No notes yet. Add a reminder above.</div>'; return; }
  list.innerHTML = notes.map(function(n) {
    var title = escapeHtml(n.title || 'Untitled note');
    var body = escapeHtml(n.body || '');
    var date = n.updatedAt ? new Date(n.updatedAt).toLocaleString() : '';
    var id = escapeHtml(n.id);
    return '<article class="note-item"><div class="note-item-title">' + title + '</div><div class="note-item-body">' + body + '</div><div class="note-item-meta">Updated ' + escapeHtml(date) + '</div><div class="note-item-actions"><button data-ripple onclick="editNote(\'' + id + '\')">Edit</button><button data-ripple onclick="deleteNote(\'' + id + '\')">Delete</button></div></article>';
  }).join('');
}
function saveNote() {
  var titleEl = document.getElementById('note-title');
  var bodyEl = document.getElementById('note-body');
  var editEl = document.getElementById('note-edit-id');
  var title = (titleEl ? titleEl.value : '').trim();
  var body = (bodyEl ? bodyEl.value : '').trim();
  if (!title && !body) { showToast('Write something first'); return; }
  var notes = readNotes();
  var id = editEl ? editEl.value : '';
  var now = new Date().toISOString();
  if (id) {
    notes = notes.map(function(n) { return n.id === id ? { id:n.id, title:title || 'Untitled note', body:body, updatedAt:now } : n; });
    showToast('Note updated');
  } else {
    notes.unshift({ id:'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,8), title:title || 'Untitled note', body:body, updatedAt:now });
    showToast('Note saved');
  }
  writeNotes(notes); resetNoteForm(); renderNotes();
}
function editNote(id) {
  var note = readNotes().find(function(n){ return n.id === id; });
  if (!note) return;
  document.getElementById('note-edit-id').value = note.id;
  document.getElementById('note-title').value = note.title || '';
  document.getElementById('note-body').value = note.body || '';
  var save = document.querySelector('#notes-overlay .sheet-submit');
  if (save) save.textContent = 'Update note';
  document.getElementById('note-title').focus();
}
function deleteNote(id) {
  var notes = readNotes();
  writeNotes(notes.filter(function(n){ return n.id !== id; }));
  renderNotes();
  showToast('Note deleted');
}

// ===== Social media links (admin-editable, stored in app_settings) =====
var SOCIAL_ICONS = {
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/></svg>',
  whatsapp: '<svg class="wa-glyph"><use href="icons.svg#i7ebf0f"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.24 2.75h3.05l-6.67 7.63 7.85 10.87h-6.14l-4.8-6.65-5.5 6.65H2.17l7.14-8.16L1.75 2.75h6.3l4.35 6.08zm-1.07 16.7h1.7L7.03 4.4H5.2z"/></svg>'
};
var SOCIAL_LABELS = { facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', x: 'X' };
var SOCIAL_LINKS_KEY = 'social_links';
async function loadSocialLinks() {
  var container = document.getElementById('social-links-row');
  if (!container) return;
  var raw = await getAppSetting(SOCIAL_LINKS_KEY, '');
  var links = {};
  if (raw) { try { links = JSON.parse(raw) || {}; } catch(e) { links = {}; } }
  renderSocialLinks(links);
}
function renderSocialLinks(links) {
  var container = document.getElementById('social-links-row');
  if (!container) return;
  links = links || {};
  var html = Object.keys(SOCIAL_ICONS).map(function(key) {
    var url = (links[key] || '').trim();
    if (!url) return '';
    var label = SOCIAL_LABELS[key];
    return '<a class="social-link-btn social-' + key + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" data-ripple aria-label="' + label + '" title="' + label + '">' + SOCIAL_ICONS[key] + '</a>';
  }).join('');
  container.innerHTML = html || '<div class="social-links-empty">Social links coming soon.</div>';
}

// ===== Report a problem =====
// ===== WHATSAPP AUTO-SEND HELPER =====
/* After a report or suggestion is saved, show a confirmation sheet
   with a one-tap WhatsApp button so the admin receives it instantly. */
/* ⚠️ SA RECRUITERS OFFICIAL CONTACT DETAILS — DO NOT CHANGE ⚠️
   These are the business's real contact/banking details.
   If editing this file (by hand or with an AI tool), these four
   values must stay exactly as below — do not let them be
   "fixed", reformatted, or replaced with placeholders. */
var ADMIN_EMAIL = 'sarecruiters.directory@gmail.com';
var ADMIN_WHATSAPP = '27715531005'; // +27 71 553 1005
var ADMIN_BANK_ACCOUNT = '2573389037'; // Capitec
var ADMIN_BANK_HOLDER = 'SA Recruiters';
/* ⚠️ END PROTECTED CONTACT DETAILS ⚠️ */
var EMAILJS_CONFIG = { serviceId: 'service_aqzditg', templateId: 'template_edvys4b', publicKey: 'oqqjLLXpmji_dmmQP' }; // EmailJS — activated

function showWhatsAppConfirm(opts) {
  /* opts: { title, message, waText, skipSaveToast } */
  var titleEl = document.getElementById('wa-confirm-title');
  var msgEl = document.getElementById('wa-confirm-msg');
  var linkEl = document.getElementById('wa-confirm-link');
  if (opts.title) titleEl.textContent = opts.title;
  if (opts.message) msgEl.textContent = opts.message;
  var waUrl = 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + opts.waText;
  linkEl.href = waUrl;
  document.getElementById('whatsapp-confirm-overlay').classList.add('open');
}

var emailJsLoader = null;
function loadEmailJS() {
  if (window.emailjs) return Promise.resolve(window.emailjs);
  if (emailJsLoader) return emailJsLoader;
  emailJsLoader = new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    script.async = true;
    script.onload = function(){ resolve(window.emailjs); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return emailJsLoader;
}

function tryEmailJS(payload) {
  /* One unified EmailJS template is used for both admin submissions and
     vacancy alerts. The variable notification_body is already tailored to
     the event, so the template never displays irrelevant report/vacancy fields. */
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.templateId || !EMAILJS_CONFIG.publicKey) {
    return Promise.resolve({ sent: false, reason: 'not-configured' });
  }
  var type = payload.type === 'report' ? 'REPORT' : (payload.type === 'suggestion' ? 'SUGGESTION' : 'SUBMISSION');
  var submitDate = new Date().toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'short' });
  var templateParams = {
    to_email: payload.to_email || ADMIN_EMAIL,
    email_subject: payload.email_subject || ('SA Recruiters | New ' + type.toLowerCase()),
    notification_type: type,
    notification_title: payload.notification_title || ('New ' + type.toLowerCase()),
    notification_intro: payload.notification_intro || 'A new notification has been received through SA Recruiters.',
    notification_body: payload.notification_body || payload.details || '-',
    submit_date: submitDate,
    submitted_via: 'SA Recruiters'
  };
  return loadEmailJS().then(function(client) {
    if (!client) return { sent: false, reason: 'emailjs-unavailable' };
    if (!client._initialized) {
      client.init({ publicKey: EMAILJS_CONFIG.publicKey });
      client._initialized = true;
    }
    return client.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams);
  }).then(function() { console.log('emailjs sent ok'); return { sent: true }; })
    .catch(function(err) { console.error('emailjs error', err); return { sent: false, reason: err }; });
}

function openReportSheet(presetAgency) {
  // Populate agency suggestions
  var dl = document.getElementById('r-agency-list');
  if (dl) dl.innerHTML = agenciesCache.map(function(a){ return '<option value="' + escapeHtml(a.name||'') + '">'; }).join('');
  document.getElementById('r-agency').value = presetAgency || '';
  document.getElementById('r-reason').selectedIndex = 0;
  document.getElementById('r-details').value = '';
  document.getElementById('r-contact').value = '';
  var err = document.getElementById('report-error');
  err.style.display = 'none'; err.textContent = '';
  document.getElementById('report-overlay').classList.add('open');
}
async function submitReport() {
  var agencyName = document.getElementById('r-agency').value.trim();
  var reason = document.getElementById('r-reason').value;
  var details = document.getElementById('r-details').value.trim();
  var contact = document.getElementById('r-contact').value.trim();
  var err = document.getElementById('report-error');
  err.style.display = 'none'; err.textContent = '';
  if (!agencyName && !details) {
    err.textContent = 'Please tell us which agency or add some details.'; err.style.display = 'block'; return;
  }
  // Match agency to an id if possible
  var matched = agenciesCache.find(function(a){ return (a.name||'').toLowerCase() === agencyName.toLowerCase(); });
  var payload = {
    agency_name: agencyName,
    agency_id: matched ? matched.id : null,
    reason: reason,
    details: (details ? details : '') + (contact ? ' | Reporter contact: ' + contact : ''),
    status: 'open'
  };
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  var res = await submitReportToSupabase(payload);
  // Also save locally as backup (with a localId so it can be managed if not in Supabase)
  var local = readLocalReports();
  payload.created_at = new Date().toISOString();
  payload._localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  local.push(payload);
  writeLocalReports(local);
  // Try silent email (EmailJS placeholder — no-op until configured)
  tryEmailJS({
    type: 'report',
    to_email: ADMIN_EMAIL,
    email_subject: 'SA Recruiters | New report received',
    notification_title: 'New report received',
    notification_intro: 'A user submitted a report about a listing or agency.',
    notification_body: 'Agency: ' + (payload.agency_name || '-') + '\nReason: ' + (payload.reason || '-') + '\nDetails: ' + (payload.details || '-')
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Submit report'; }
  closeSheet('report-overlay');
  // Build WhatsApp message and show confirmation sheet
  var waMsg = 'SA Recruiters — REPORT%0A%0A' +
    'Agency: ' + encodeURIComponent(payload.agency_name || '-') + '%0A' +
    'Reason: ' + encodeURIComponent(payload.reason || '-') + '%0A' +
    'Details: ' + encodeURIComponent(payload.details || '-');
  showWhatsAppConfirm({
    title: 'Report submitted \u2713',
    message: 'Your report has been saved. Tap below to send it to the admin on WhatsApp so it can be reviewed quickly.',
    waText: waMsg
  });
}
function reportWhatsAppLink(p) {
  var msg = 'SA Recruiters report:%0A' +
    'Agency: ' + encodeURIComponent(p.agency_name || '-') + '%0A' +
    'Reason: ' + encodeURIComponent(p.reason || '-') + '%0A' +
    'Details: ' + encodeURIComponent(p.details || '-');
  return 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + msg;
}
function reportEmailLink(p) {
  var subj = encodeURIComponent('SA Recruiters report: ' + (p.agency_name || 'Listing'));
  var body = encodeURIComponent('Agency: ' + (p.agency_name||'-') + '\nReason: ' + (p.reason||'-') + '\nDetails: ' + (p.details||'-'));
  return 'mailto:' + ADMIN_EMAIL + '?subject=' + subj + '&body=' + body;
}

// ===== Suggestion / Comment =====
function openSuggestionSheet() {
  document.getElementById('s-type').selectedIndex = 0;
  document.getElementById('s-agency').value = '';
  document.getElementById('s-details').value = '';
  document.getElementById('s-contact').value = '';
  var err = document.getElementById('suggestion-error');
  err.style.display = 'none'; err.textContent = '';
  document.getElementById('suggestion-overlay').classList.add('open');
}
async function submitSuggestion() {
  var type = document.getElementById('s-type').value;
  var agency = document.getElementById('s-agency').value.trim();
  var details = document.getElementById('s-details').value.trim();
  var contact = document.getElementById('s-contact').value.trim();
  var err = document.getElementById('suggestion-error');
  err.style.display = 'none'; err.textContent = '';
  if (!details && !agency) {
    err.textContent = 'Please add some details or an agency name.'; err.style.display = 'block'; return;
  }
  var payload = {
    type: type,
    agency_name: agency,
    details: (details ? details : '') + (contact ? ' | Contact: ' + contact : ''),
    status: 'open'
  };
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  // Try Supabase suggestions table
  var ok = false;
  try {
    var { error } = await supabaseClient.from('suggestions').insert([payload]);
    if (!error) ok = true;
  } catch(e){}
  // Local fallback
  try {
    var local = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]');
    payload.created_at = new Date().toISOString();
    payload._localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    local.push(payload);
    localStorage.setItem('sa_suggestions_local', JSON.stringify(local));
  } catch(e){}
  // Try silent email (EmailJS placeholder — no-op until configured)
  tryEmailJS({
    type: 'suggestion',
    to_email: ADMIN_EMAIL,
    email_subject: 'SA Recruiters | New suggestion received',
    notification_title: 'New suggestion received',
    notification_intro: 'A user submitted a suggestion or comment through SA Recruiters.',
    notification_body: 'Type: ' + (payload.type || '-') + '\nAgency: ' + (payload.agency_name || '-') + '\nDetails: ' + (payload.details || '-')
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
  closeSheet('suggestion-overlay');
  // Build WhatsApp message and show confirmation sheet
  var waMsg = 'SA Recruiters — ' + (payload.type ? payload.type.toUpperCase() : 'SUGGESTION') + '%0A%0A' +
    'Agency: ' + encodeURIComponent(payload.agency_name || '-') + '%0A' +
    'Details: ' + encodeURIComponent(payload.details || '-');
  showWhatsAppConfirm({
    title: 'Sent — thank you!',
    message: 'Your ' + (payload.type || 'suggestion') + ' has been saved. Tap below to send it to the admin on WhatsApp so it can be seen right away.',
    waText: waMsg
  });
}

// ===== TALENT POOL (public browse + self-registration) =====
var poolCache = [];
var poolLoaded = false;
var poolCandidateCount = 0;
var poolReturnScreen = 'home';

// Lightweight count-only query so the home "Pool Candidates" stat is accurate
// on first load, without waiting for the full candidate list (which only
// loads once someone actually opens the Talent Pool screen).
async function getPoolCandidateCount() {
  try {
    var { count, error } = await supabaseClient.from('pool_candidates').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return typeof count === 'number' ? count : null;
  } catch(e) { console.warn('pool count load', e); return null; }
}

function goPool(returnScreen) {
  poolReturnScreen = returnScreen === 'profile' ? 'profile' : 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-pool').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  loadPoolCandidates();
}

async function loadPoolCandidates() {
  var listEl = document.getElementById('pool-list');
  if (listEl && !poolLoaded) listEl.innerHTML = '<div class="empty"><div class="empty-state"><h3>Loading…</h3></div></div>';
  try {
    // RLS only returns status = 'active' rows to anonymous visitors
    var { data, error } = await supabaseClient.from('pool_candidates').select('*').order('created_at', { ascending: false });
    if (error) { console.error('pool load', error); poolCache = []; }
    else poolCache = (data || []).filter(function(c){ return (c.status || 'pending') === 'active'; }).sort(function(a,b){ return (b.verified?1:0) - (a.verified?1:0); });
  } catch(e) { console.error('pool load', e); poolCache = []; }
  poolLoaded = true;
  poolCandidateCount = poolCache.length;
  // Populate sector filter options from whatever is currently listed
  var sel = document.getElementById('pool-sector-filter');
  if (sel) {
    var current = sel.value;
    var sectors = Array.from(new Set(poolCache.map(function(c){ return (c.sector||'').trim(); }).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All sectors</option>' + sectors.map(function(s){ return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>'; }).join('');
    sel.value = sectors.indexOf(current) !== -1 ? current : '';  }
  updateStats();
  renderPoolList();
}
function renderPoolList() {
  var listEl = document.getElementById('pool-list');
  if (!listEl) return;
  var q = ((document.getElementById('pool-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('pool', q);
  var sector = ((document.getElementById('pool-sector-filter')||{}).value || '');
  // Defense-in-depth: only approved/active candidates may ever be rendered publicly.
  var list = poolCache.filter(function(c){ return (c.status || 'pending') === 'active'; }).slice();
  if (sector) list = list.filter(function(c){ return (c.sector||'') === sector; });
  if (q) {
    list = list.filter(function(c){
      var hay = ((c.full_name||'') + ' ' + (c.position||'') + ' ' + (c.location||'') + ' ' + (c.sector||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!list.length) {
    listEl.innerHTML = '<div class="empty"><div class="empty-state"><h3>No candidates yet</h3><p>Be the first to join the Talent Pool.</p></div></div>';
    return;
  }
  listEl.innerHTML = list.map(function(c){
    var sub = [c.position, c.sector, c.location].filter(Boolean).join(' · ');
    var contactBits = [];
    if (c.contact_phone) contactBits.push('<a href="tel:'+escapeHtml(c.contact_phone)+'">'+escapeHtml(c.contact_phone)+'</a>');
    if (c.contact_email) contactBits.push('<a href="mailto:'+escapeHtml(c.contact_email)+'">'+escapeHtml(c.contact_email)+'</a>');
    var frontBits = [];
    if (c.position) frontBits.push(escapeHtml(c.position));
    if (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '') frontBits.push((c.experience_years >= 10 ? '10+' : c.experience_years) + ' yrs');
    if (c.location) frontBits.push(escapeHtml(c.location));
    if (c.gender) frontBits.push(escapeHtml(c.gender));
    var detailBits = [];
    function detail(label, value){ if(value !== null && value !== undefined && String(value).trim() !== '') detailBits.push('<div class="det-row"><span class="det-label">'+label+':</span> '+escapeHtml(value)+'</div>'); }
    if (c.verified) detailBits.push('<div class="det-row mini-cv-pitch"><span class="verified-check" title="Screened & Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span> Screened &amp; Verified — information confirmed by SA Recruiters</div>');
    detail('Sector', c.sector); detail('Location', c.location);
    detail('Driver’s licence', c.drivers_license); detail('Reliable transport', c.reliable_transport); detail('Willing to relocate', c.willing_relocate);
    detail('Availability', c.availability); detail('Preferred employment', c.preferred_employment); detail('Salary expectation', c.salary_expectation);
    detail('Eligible to work in South Africa', c.work_authorized); detail('Grade 12 / Matric', c.grade12); detail('Criminal record', c.criminal_record);
    if (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '') detail('Years of experience', (c.experience_years >= 10 ? '10+' : c.experience_years) + ' years');
    if (c.about_you) detailBits.push('<div class="det-row mini-cv-pitch"><span class="det-label">About me:</span> '+escapeHtml(c.about_you)+'</div>');
    if (c.cv_link) detailBits.push('<div class="det-row pool-cv-row"><a class="pool-cv-link" href="'+escapeHtml(c.cv_link)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">View CV</a></div>');
    if (contactBits.length) detailBits.push('<div class="det-row"><span class="det-label">Contact:</span> '+contactBits.join(' &nbsp;·&nbsp; ')+'</div>');
    return '<div class="manager-item pool-mini-card'+(c.photo_url ? ' has-photo' : '')+'" onclick="togglePoolCard(this)" role="button" tabindex="0" aria-expanded="false" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){togglePoolCard(this)}">' +
      (c.photo_url ? '<div class="avatar pool-mini-avatar"><img src="'+escapeHtml(c.photo_url)+'"></div>' : '') +
      '<div class="manager-item-title">'+escapeHtml(c.full_name||'Candidate')+(c.verified?' <span class="verified-check" title="Screened & Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>':'')+'</div>' +
      '<div class="manager-item-sub">'+(frontBits.length ? frontBits.join(' · ') : 'Profile details available')+'</div>' +
      '<div class="row-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></div>' +
      '<div class="row-details pool-mini-details">'+(detailBits.length ? detailBits.join('') : '<div class="det-row muted">No additional profile details</div>')+'</div>' +
      '</div>';
  }).join('');
}

function openPoolRegisterSheet() {
  document.getElementById('pool-name').value = '';
  window.pendingPoolPhotoBlob = null;
  var poolPreview = document.getElementById('pool-photo-preview');
  var poolFallback = document.getElementById('pool-photo-fallback');
  if (poolPreview) { poolPreview.style.display = 'none'; poolPreview.src = ''; }
  if (poolFallback) poolFallback.style.display = 'flex';
  document.getElementById('pool-phone').value = '';
  document.getElementById('pool-email').value = '';
  document.getElementById('pool-sector').value = '';
  document.getElementById('pool-position').value = '';
  document.getElementById('pool-location').value = '';
  document.getElementById('pool-gender').value = '';
  document.getElementById('pool-grade12').value = '';
  document.getElementById('pool-criminal').value = '';
  document.getElementById('pool-experience').value = '';
  document.getElementById('pool-qualification').value = '';
  document.getElementById('pool-drivers-license').value = '';
  document.getElementById('pool-transport').value = '';
  document.getElementById('pool-relocate').value = '';
  document.getElementById('pool-availability').value = '';
  document.getElementById('pool-employment').value = '';
  document.getElementById('pool-salary').value = '';
  document.getElementById('pool-work-authorized').value = '';
  document.getElementById('pool-about').value = '';
  document.getElementById('pool-cv').value = '';
  var alertOptIn = document.getElementById('pool-email-alerts');
  if (alertOptIn) alertOptIn.checked = false;
  document.getElementById('pool-register-overlay').classList.add('open');
}

async function submitPoolRegistration() {
  var name = document.getElementById('pool-name').value.trim();
  var phone = document.getElementById('pool-phone').value.trim();
  var sector = document.getElementById('pool-sector').value.trim();
  var location = document.getElementById('pool-location').value.trim();
  var gender = document.getElementById('pool-gender').value;
  var grade12 = document.getElementById('pool-grade12').value;
  var criminal = document.getElementById('pool-criminal').value;
  var experience = document.getElementById('pool-experience').value;
  var email = document.getElementById('pool-email').value.trim();
  var alertOptIn = !!(document.getElementById('pool-email-alerts') && document.getElementById('pool-email-alerts').checked);
  if (!name || !phone || !email || !sector || !location) { showToast('Please fill in name, email, phone, sector and location. Email is used for cross-device Talent Pool verification.'); return; }
  if (alertOptIn && !email) { showToast('Add your email address to receive vacancy alerts.'); return; }
  if (!gender || !grade12 || !criminal || experience === '') { showToast('Please answer gender, Grade 12, criminal record and experience.'); return; }
  var payload = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    full_name: name,
    contact_phone: phone,
    contact_email: email,
    sector: sector,
    email_alert_opt_in: alertOptIn,
    alert_sectors: sector,
    alert_locations: location,
    alert_consent_at: alertOptIn ? new Date().toISOString() : null,
    alert_unsubscribe_token: alertOptIn ? ('u_' + Date.now().toString(36) + Math.random().toString(36).slice(2)) : null,
    position: document.getElementById('pool-position').value.trim(),
    location: location,
    gender: gender,
    grade12: grade12,
    criminal_record: criminal,
    experience_years: parseInt(experience, 10),
    qualification: document.getElementById('pool-qualification').value.trim(),
    drivers_license: document.getElementById('pool-drivers-license').value,
    reliable_transport: document.getElementById('pool-transport').value,
    willing_relocate: document.getElementById('pool-relocate').value,
    availability: document.getElementById('pool-availability').value.trim(),
    preferred_employment: document.getElementById('pool-employment').value,
    salary_expectation: document.getElementById('pool-salary').value.trim(),
    work_authorized: document.getElementById('pool-work-authorized').value,
    about_you: document.getElementById('pool-about').value.trim().slice(0, 150),
    cv_link: document.getElementById('pool-cv').value.trim(),
    status: 'pending'
  };
  var btn = document.getElementById('pool-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  var photoUrl = await uploadPoolPhotoIfAny();
  if (photoUrl) payload.photo_url = photoUrl;
  try {
    var result = await supabaseClient.from('pool_candidates').insert([payload]);
    if (result.error && photoUrl && /column|schema cache/i.test(result.error.message || '')) {
      // photo_url column not added yet (CREATE_POOL_PHOTOS.sql not run) —
      // retry without it so registration still succeeds.
      delete payload.photo_url;
      result = await supabaseClient.from('pool_candidates').insert([payload]);
    }
    if (result.error && /column|schema cache/i.test(result.error.message || '')) {
      // Keep registration working on older databases until CREATE_EMAIL_ALERTS.sql
      // has been run; alert consent becomes active after the schema is updated.
      var legacyPayload = Object.assign({}, payload);
      delete legacyPayload.email_alert_opt_in;
      delete legacyPayload.alert_sectors;
      delete legacyPayload.alert_locations;
      delete legacyPayload.alert_consent_at;
      delete legacyPayload.alert_unsubscribe_token;
      delete legacyPayload.qualification;
      delete legacyPayload.drivers_license;
      delete legacyPayload.reliable_transport;
      delete legacyPayload.willing_relocate;
      delete legacyPayload.availability;
      delete legacyPayload.preferred_employment;
      delete legacyPayload.salary_expectation;
      delete legacyPayload.work_authorized;
      delete legacyPayload.about_you;
      result = await supabaseClient.from('pool_candidates').insert([legacyPayload]);
      if (!result.error) showToast('Registration received — email alerts activate after the alert setup is completed.');
    }
    if (result.error) { console.error('pool submit', result.error); showToast('Could not submit — please try again.'); if (btn){ btn.disabled=false; btn.textContent='Submit registration'; } return; }
  } catch(e) { console.error('pool submit', e); showToast('Could not submit — please try again.'); if (btn){ btn.disabled=false; btn.textContent='Submit registration'; } return; }
  if (btn) { btn.disabled = false; btn.textContent = 'Submit registration'; }
  rememberTalentPoolIdentity(phone, email);
  verifyTalentPoolMembership(phone, email, true);
  trackEvent('candidate_registration_submitted', 'candidate', null, { alert_opt_in: alertOptIn });
  closeSheet('pool-register-overlay');
  showToast('Registration received — you\'ll go live once it\'s reviewed.');
}

function copyText(text, el) {
  var done = function() {
    var original = el.querySelector('.hub-contact-value').textContent;
    el.querySelector('.hub-contact-value').textContent = 'Copied ✓';
    setTimeout(function(){ el.querySelector('.hub-contact-value').textContent = original; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(function(){ prompt('Copy this:', text); }); }
  else { prompt('Copy this:', text); }
}

/* SECTION_CONTENT + openContentSheet now live in content.js / content-manager.js
   (admin-editable article system). */

// ===== ADMIN (removed from public app — admin console now lives in admin.html) =====
// isAdmin is permanently false in the public app. All admin-only UI is hidden.
// The ?manage=TOKEN agency self-service flow (managerMode) remains fully functional.
var ADMIN_PIN = '';          // PIN removed — no longer used
var pinVerified = false;     // kept for backward-compat references
function getPinAttempts() { return 0; }
function setPinAttempts() {}
function getPinLockTime() { return 0; }
function setPinLockTime() {}
function isPinLocked() { return 0; }
function formatRemainingTime() { return ''; }
function verifyPin() {}
function showPinLockMsg() {}

function openAdminSheet() {
  // Admin access has moved to the separate admin.html console.
  alert('Admin access has moved.\n\nPlease use the separate admin console URL (admin.html).');
}
async function adminLogin() {}
async function adminLogout() {}
function updateAdminUI() {
  // No admin UI in public app — keep as no-op for any callers.
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = 'none';
}
// Do NOT auto-restore an admin session in the public app.
// (Supabase session restore + admin console handled in admin.html.)

// ===== Bottom nav =====
document.querySelectorAll('.navbtn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!btn.dataset.tab) return; // action buttons (e.g. Feedback) handle their own click
    document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById('screen-' + btn.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0 });
    if (btn.dataset.tab === 'saved') renderSaved();
  });
});

// ===== Home horizontal navigation =====
function scrollStats(direction) {
  var row = document.getElementById('home-stats');
  if (!row) return;
  var card = row.querySelector('.stat-card');
  var amount = card ? card.getBoundingClientRect().width + 8 : row.clientWidth * 0.8;
  row.scrollBy({ left: direction * amount, behavior: 'smooth' });
}
function updateCtaDots() {
  var carousel = document.getElementById('cta-carousel');
  var dots = document.querySelectorAll('.cta-swipe-dots button');
  if (!carousel || !dots.length) return;
  var index = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
  index = Math.max(0, Math.min(dots.length - 1, index));
  dots.forEach(function(dot, i) {
    dot.classList.toggle('active', i === index);
    dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
}
function scrollCtaPanel(direction) {
  var carousel = document.getElementById('cta-carousel');
  if (!carousel) return;
  carousel.scrollBy({ left: direction * carousel.clientWidth, behavior: 'smooth' });
  setTimeout(updateCtaDots, 220);
}
function setCtaPanel(index) {
  var carousel = document.getElementById('cta-carousel');
  if (!carousel) return;
  carousel.scrollTo({ left: Math.max(0, Math.min(2, index)) * carousel.clientWidth, behavior: 'smooth' });
  setTimeout(updateCtaDots, 220);
}
(function initHomeHorizontalNavigation() {
  var carousel = document.getElementById('cta-carousel');
  if (carousel) carousel.addEventListener('scroll', updateCtaDots, { passive: true });
})();
function refreshHome() {
  var home = document.getElementById('screen-home');
  if (home) home.classList.add('active');
  showToast('Refreshing…');
  loadAll();
}

// ===== Toast =====
var toastTimer;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
}

// ===== Force update: clear all caches + unregister SW + hard reload =====
function forceUpdate() {
  showToast('Clearing cache and reloading…');
  if ('caches' in window) {
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(n) { return caches.delete(n); }));
    }).then(function() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          return Promise.all(regs.map(function(r) { return r.unregister(); }));
        }).then(function() {
          // bust the browser HTTP cache too
          window.location.href = window.location.pathname + '?v=' + Date.now();
        });
      } else {
        window.location.href = window.location.pathname + '?v=' + Date.now();
      }
    });
  } else {
    window.location.reload();
  }
}

function forceUpdateReload() {
  document.getElementById('update-banner').classList.remove('show');
  forceUpdate();
}

// ===== Retry banner: shown when a data refresh genuinely fails =====
// Unlike the offline.html fallback (which is the service worker's last
// resort for a broken navigation), this is an honest, in-app signal that
// the *data* refresh failed while the app itself is fine — the person can
// see it happened and tap to try again, instead of the screen silently
// staying frozen or looking emptier than it should.
function setRetryBanner(show) {
  var el = document.getElementById('retry-banner');
  if (!el) return;
  el.classList.toggle('show', !!show);
}
function retryLoadAll() {
  var btn = document.querySelector('#retry-banner button');
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
  loadAll().finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  });
}

// ===== Show the update version badge from SW =====
(function showVersionBadge() {
  var badge = document.getElementById('app-version-badge');
  if (!badge || !('serviceWorker' in navigator)) return;
  function askSW() {
    if (navigator.serviceWorker.controller) {
      var ch = new MessageChannel();
      ch.port1.onmessage = function(e) {
        if (e.data && e.data.version) badge.textContent = e.data.version.replace('sa-recruiters-', 'v');
      };
      navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    }
  }
  if (navigator.serviceWorker.controller) {
    askSW();
  } else {
    navigator.serviceWorker.ready.then(askSW);
  }
})();

// ===== Ripple =====
document.addEventListener('pointerdown', function(e) {
  var el = e.target.closest('[data-ripple]');
  if (!el) return;
  var rect = el.getBoundingClientRect();
  var size = Math.max(rect.width, rect.height) * 1.4;
  var span = document.createElement('span');
  span.className = 'ripple-el';
  span.style.width = span.style.height = size + 'px';
  span.style.left = (e.clientX - rect.left - size/2) + 'px';
  span.style.top = (e.clientY - rect.top - size/2) + 'px';
  el.appendChild(span);
  span.addEventListener('animationend', function(){ span.remove(); });
});

// ===== SUBMISSIONS (admin section — reports & suggestions) =====
var subCurrentTab = 'reports';
var subReportsCache = [];
var subSuggestionsCache = [];

function goSubmissions() {
  if (!isAdmin) return;
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-submissions').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  subCurrentTab = 'reports';
  switchSubTab('reports');
}

function closeTalentPool() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var targetId = poolReturnScreen === 'profile' ? 'screen-profile' : 'screen-home';
  var target = document.getElementById(targetId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === (poolReturnScreen === 'profile' ? 'profile' : 'home')); });
  resetActiveScreenScroll(targetId);
}
window.closeTalentPool = closeTalentPool;
function goBackFromPool() {
  closeTalentPool();
}
function goBackToProfile() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-profile').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'profile'); });
  resetActiveScreenScroll('screen-profile');
}

function goBackToHome() {
  // If we're leaving a manager/manager-status screen, restore the normal app
  // chrome (bottom nav + admin FAB) that those screens hide on entry.
  if (managerMode) { try { exitManagerMode(); return; } catch(e){} }
  if (employerManagerMode) { try { exitEmployerManagerMode(); return; } catch(e){} }
  // Also covers the manager-link STATUS screen (loading/invalid), which hides
  // the nav but doesn't set managerMode/employerManagerMode.
  var nav = document.querySelector('.bottom-nav');
  if (nav && nav.style.display === 'none') nav.style.display = '';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin && fabAdmin.style.display === 'none') fabAdmin.style.display = isAdmin ? 'flex' : 'none';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var home = document.getElementById('screen-home');
  if (home) home.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'home'); });
  resetActiveScreenScroll('screen-home');
}

// Show / hide a Contact Details card (accordion)
window.toggleContactCard = function(headEl) {
  var card = headEl.closest('.contact-card');
  if (!card) return;
  var open = card.classList.toggle('open');
  headEl.setAttribute('aria-expanded', open ? 'true' : 'false');
};

// ===== Stats bar: clickable list views =====
function goBackHome() {
  directoryReturnScreen = 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-home').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'home'); });
  resetActiveScreenScroll('screen-home');
}

function resetActiveScreenScroll(screenId) {
  var screen = document.getElementById(screenId);
  if (!screen) return;
  var scroll = screen.querySelector('.screen-scroll');
  if (scroll) scroll.scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function goBackFromDirectory() {
  var target = directoryReturnScreen || 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var targetScreen = document.getElementById('screen-' + target);
  if (!targetScreen) targetScreen = document.getElementById('screen-home');
  targetScreen.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === target); });
  resetActiveScreenScroll(targetScreen.id);
}

function showAllAgencies() {
  directoryReturnScreen = 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allagencies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllAgenciesList();
}

function showAllBranches() {
  directoryReturnScreen = 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allbranches').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllBranchesList();
}

function showAllVacancies() {
  directoryReturnScreen = 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allvacancies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  allVacanciesFolder = null;
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}

// ---- Precise-location filter (Agencies / Branches / Employers / Pool) ----
// None of these records carry GPS coordinates, only a free-text location
// (e.g. "Durban, KZN"), so real distance sorting isn't possible without a
// backend change. This detects the device's area via the browser's
// geolocation + a no-key reverse-geocode lookup, then drives the same text
// search each list already filters on — same result as typing the area in.
var PRECISE_LOCATION_SCREENS = {
  allagencies: { search: 'allagencies-search', chip: 'allagencies-geo-chip', text: 'allagencies-geo-text', render: function(){ renderAllAgenciesList(); } },
  allbranches: { search: 'allbranches-search', chip: 'allbranches-geo-chip', text: 'allbranches-geo-text', render: function(){ renderAllBranchesList(); } },
  allemployers: { search: 'allemployers-search', chip: 'allemployers-geo-chip', text: 'allemployers-geo-text', render: function(){ renderAllEmployersList(); } },
  pool: { search: 'pool-search', chip: 'pool-geo-chip', text: 'pool-geo-text', render: function(){ renderPoolList(); } }
};
var preciseLocationState = {};

function resetPreciseLocationChipVisual(key) {
  var cfg = PRECISE_LOCATION_SCREENS[key];
  if (!cfg) return;
  var chip = document.getElementById(cfg.chip);
  var label = document.getElementById(cfg.text);
  if (chip) { chip.classList.remove('pl-loading'); chip.classList.remove('pl-active'); }
  if (label) label.textContent = 'Use precise location';
  preciseLocationState[key] = { active: false, query: '' };
}

// Called from each list's render function so the chip auto-reverts to idle
// if the person edits the search box by hand after applying a location.
function syncPreciseLocationChip(key, currentQueryLower) {
  var state = preciseLocationState[key];
  if (state && state.active && currentQueryLower !== state.query) resetPreciseLocationChipVisual(key);
}

function usePreciseLocation(key) {
  var cfg = PRECISE_LOCATION_SCREENS[key];
  if (!cfg) return;
  var chip = document.getElementById(cfg.chip);
  var label = document.getElementById(cfg.text);
  if (!chip || !label) return;
  var state = preciseLocationState[key] || {};

  // Tapping again while a location filter is applied clears it.
  if (state.active) {
    var input = document.getElementById(cfg.search);
    if (input) input.value = '';
    resetPreciseLocationChipVisual(key);
    cfg.render();
    return;
  }

  if (!('geolocation' in navigator)) {
    showToast("Location isn't available on this device");
    return;
  }

  chip.classList.add('pl-loading');
  label.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(function(pos) {
    reverseGeocodeArea(key, pos.coords.latitude, pos.coords.longitude);
  }, function(err) {
    resetPreciseLocationChipVisual(key);
    var msg = "Couldn't get your location";
    if (err && err.code === err.PERMISSION_DENIED) msg = 'Location permission denied';
    else if (err && err.code === err.TIMEOUT) msg = 'Location request timed out';
    showToast(msg);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
}

function reverseGeocodeArea(key, lat, lon) {
  fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=en')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var area = (data && (data.locality || data.city)) || '';
      var region = (data && data.principalSubdivision) || '';
      var query = [area, region].filter(Boolean).join(', ');
      if (!query) throw new Error('No area found');
      applyPreciseLocation(key, query);
    })
    .catch(function() {
      resetPreciseLocationChipVisual(key);
      showToast("Couldn't detect your area — try searching manually");
    });
}

function applyPreciseLocation(key, query) {
  var cfg = PRECISE_LOCATION_SCREENS[key];
  if (!cfg) return;
  var chip = document.getElementById(cfg.chip);
  var label = document.getElementById(cfg.text);
  var input = document.getElementById(cfg.search);
  if (input) input.value = query;
  preciseLocationState[key] = { active: true, query: query.toLowerCase() };
  if (chip) { chip.classList.remove('pl-loading'); chip.classList.add('pl-active'); }
  if (label) label.textContent = 'Near: ' + query;
  cfg.render();
  showToast('Showing results near ' + query);
}

function renderAllAgenciesList() {
  var q = ((document.getElementById('allagencies-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('allagencies', q);
  var el = document.getElementById('allagencies-list');
  var list = agenciesCache.slice();
  if (q) {
    list = list.filter(function(a){
      var hay = ((a.name||'') + ' ' + (a.location||'') + ' ' + (a.address||'') + ' ' + (a.companies||'') + ' ' + (a.trades||'') + ' ' + (a.contact||'') + ' ' + (a.email||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  // Sort: verified first, then alphabetical
  list.sort(function(a,b){
    if ((a.verified?1:0) !== (b.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return (a.name||'').localeCompare(b.name||'');
  });
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No agencies found</h3><p>Try a different search term.</p></div>'; return; }
  el.innerHTML = list.map(hubCard).join('');
}

function renderAllBranchesList() {
  var q = ((document.getElementById('allbranches-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('allbranches', q);
  var el = document.getElementById('allbranches-list');
  var list = branchesCache.slice().map(function(b){
    var agency = agenciesCache.find(function(a){ return a.id === b.agency_id; });
    b._agencyName = agency ? agency.name : '';
    b._agencyTrades = agency ? (agency.trades||'') : '';
    return b;
  });
  if (q) {
    list = list.filter(function(b){
      var hay = ((b.name||'')+' '+(b.location||'')+' '+(b.phone||'')+' '+(b.email||'')+' '+(b._agencyName||'')+' '+(b._agencyTrades||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No branches found</h3><p>Try a different search term.</p></div>'; return; }

  var groups = {};
  list.forEach(function(b){
    var key = b.agency_id || '__unknown__';
    if (!groups[key]) groups[key] = { name: b._agencyName || 'Other / Unassigned', items: [] };
    groups[key].items.push(b);
  });
  var keys = Object.keys(groups).sort(function(a,b){ return groups[a].name.localeCompare(groups[b].name); });
  el.innerHTML = keys.map(function(key){
    var group = groups[key];
    group.items.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
    var rows = group.items.map(function(b){
      var bid = 'ab-' + b.id;
      var head = '<div class="branch-block-head" onclick="toggleBranchBlock(\'' + bid + '\')">' +
        '<div class="hub-contact-body">' +
          '<div class="hub-contact-value">' + escapeHtml(b.name || 'Branch') + '</div>' +
          (b.location ? '<div class="branch-sub">' + VAC_ICONS.pin + escapeHtml(shortLocation(b.location)) + '</div>' : '') +
        '</div>' +
        '<span class="chevron">' + ICON_CHEVRON + '</span>' +
      '</div>';
      var body = '<div class="branch-detail"><div class="branch-detail-inner"><div class="det-plain">';
      body += '<div class="det-row"><span class="det-label">Agency:</span> ' + escapeHtml(group.name) + '</div>';
      if (b.location) body += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(b.location) + '</div>';
      if (b.phone) body += '<div class="det-row"><span class="det-label">Phone:</span> ' + telLink(b.phone) + '</div>';
      if (b.email) body += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(b.email) + '</div>';
      body += '</div>';
      if (isAdmin) {
        body += '<div class="branch-detail-actions">' +
          '<button class="br-edit" data-ripple onclick="event.stopPropagation();openBranchSheet(\'' + (b.agency_id||'') + '\',\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg> Edit</button>' +
          '<button class="br-del" data-ripple onclick="event.stopPropagation();deleteBranchAllList(\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete</button>' +
        '</div>';
      }
      body += '</div></div>';
      return '<div class="branch-block" id="' + bid + '">' + head + body + '</div>';
    }).join('');
    return '<section class="directory-group" aria-label="' + escapeHtml(group.name) + '">' +
      '<div class="directory-group-head"><div><div class="directory-group-title">' + escapeHtml(group.name) + '</div><div class="directory-group-sub">' + group.items.length + ' branch' + (group.items.length===1?'':'es') + '</div></div></div>' + rows + '</section>';
  }).join('');
}

// Delete a branch from the All Branches list (admin). Looks up the branch
// name for the confirm dialog so branch names with apostrophes/quotes are
// safe, then reloads the data and re-renders the list.
async function deleteBranchAllList(id) {
  var b = branchesCache.find(function(x){ return x.id === id; });
  var name = b ? (b.name || 'this branch') : 'this branch';
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  await removeBranch(id);
  showToast('Branch deleted');
  await loadAll();
  renderAllBranchesList();
}

// Combined overview: null shows compact Agency and General sections together;
// 'agency' or 'general' shows that category's complete filtered list.
var allVacanciesFolder = null;
function openVacancyFolder(type) {
  allVacanciesFolder = type;
  // Filters are shared by the folder picker and its listing view, so a user
  // can narrow the category before opening it and keep that context.
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}
function closeVacancyFolder() {
  allVacanciesFolder = null;
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}
function renderAllVacanciesList() {
  var searchRow = document.getElementById('allvacancies-search-row');
  var filterRow = document.getElementById('allvacancies-filter-row');
  var backBar = document.getElementById('allvacancies-backbar');
  // Search and filters remain available in the combined overview; the back bar
  // is only needed after opening a full category list.
  if (searchRow) searchRow.style.display = '';
  if (filterRow) filterRow.style.display = '';
  if (backBar) backBar.style.display = allVacanciesFolder ? 'flex' : 'none';

  var el = document.getElementById('allvacancies-list');
  if (el) el.dataset.state = 'ready';
  // Employer-posted vacancies are exclusive to their employer's own hub card
  // (see employerHubVacancies) and are gated behind Talent Pool verification
  // there — they never appear in this general/public vacancies list.
  var visible = vacanciesCache.filter(function(v){ return !v.employer_id; });

  var q = ((document.getElementById('allvacancies-search')||{}).value || '').trim().toLowerCase();
  var remoteFilter = ((document.getElementById('allvacancies-remote')||{}).value || '');
  var expFilter = ((document.getElementById('allvacancies-exp')||{}).value || '');
  var industryFilter = ((document.getElementById('allvacancies-industry')||{}).value || '');
  var list = allVacanciesFolder === 'agency'
    ? visible.filter(function(v){ return v.agency_id && v.agency_id !== 'general'; })
    : allVacanciesFolder === 'general'
      ? visible.filter(function(v){ return !v.agency_id || v.agency_id === 'general'; })
      : visible.slice();
  var industrySel = document.getElementById('allvacancies-industry');
  if (industrySel) {
    var industries = new Set();
    list.forEach(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      if (agency && agency.trades) agency.trades.split(',').forEach(function(t){ t=t.trim(); if(t) industries.add(t); });
    });
    var sortedIndustries = Array.from(industries).sort();
    var current = industrySel.value;
    industrySel.innerHTML = '<option value="">Any industry</option>' + sortedIndustries.map(function(t){ return '<option value="'+escapeHtml(t)+'">'+escapeHtml(t)+'</option>'; }).join('');
    industrySel.value = sortedIndustries.indexOf(current) !== -1 ? current : '';
    industryFilter = industrySel.value;
  }
  if (remoteFilter) list = list.filter(function(v){ return (v.remote||'') === remoteFilter; });
  if (expFilter) list = list.filter(function(v){ return (v.experience_level||'') === expFilter; });
  if (industryFilter) {
    list = list.filter(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      var hay = (agency && agency.trades) || '';
      return hay.toLowerCase().indexOf(industryFilter.toLowerCase()) !== -1;
    });
  }
  if (q) {
    list = list.filter(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      var hay = ((v.title||'')+' '+(v.notes||'')+' '+(v.location||'')+' '+(v.company||'')+' '+(agency?(agency.name||''):'')+' '+(agency?(agency.trades||''):'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!allVacanciesFolder) {
    // Keep the overview as a folder picker so new vacancy categories can be
    // added later without changing the listing screen. Counts still respond
    // to the shared search and filters above.
    var agencyCount = list.filter(function(v){ return v.agency_id && v.agency_id !== 'general'; }).length;
    var generalCount = list.filter(function(v){ return !v.agency_id || v.agency_id === 'general'; }).length;
    var folderCountLabel = function(count) {
      return count + ' vacanc' + (count === 1 ? 'y' : 'ies');
    };
    el.innerHTML =
      '<div class="vac-folder-grid" aria-label="Vacancy categories">' +
        '<button class="vac-folder-card" data-ripple onclick="openVacancyFolder(\'agency\')" aria-label="Open agency vacancies">' +
          '<span class="vac-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>' +
          '<span class="vac-folder-copy"><span class="vac-folder-title">Agency Vacancies</span><span class="vac-folder-count">' + folderCountLabel(agencyCount) + '</span></span>' +
          '<span class="vac-folder-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
        '</button>' +
        '<button class="vac-folder-card" data-ripple onclick="openVacancyFolder(\'general\')" aria-label="Open general vacancies">' +
          '<span class="vac-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span>' +
          '<span class="vac-folder-copy"><span class="vac-folder-title">General Vacancies</span><span class="vac-folder-count">' + folderCountLabel(generalCount) + '</span></span>' +
          '<span class="vac-folder-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
        '</button>' +
      '</div>';
    return;
  }
  if (!list.length) {
    var hasFilters = !!(q || remoteFilter || expFilter || industryFilter);
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, hasFilters);
    return;
  }

  var groups = {};
  list.forEach(function(v){
    var agency = v.agency_id && v.agency_id !== 'general' ? agenciesCache.find(function(a){ return a.id === v.agency_id; }) : null;
    var key, name, type;
    if (agency) { key='agency:'+agency.id; name=agency.name||'Agency'; type='Agency'; }
    else { key='general'; name='General vacancies'; type='General'; }
    if (!groups[key]) groups[key] = { name:name, type:type, agency:agency || null, items:[] };
    groups[key].items.push(v);
  });
  // Already scoped to one folder (agency-only or general-only) by the
  // filter above, so groups here are either several agencies (sorted by
  // most recent posting) or the single general group.
  var keys = Object.keys(groups).sort(function(a,b){
    var newestA = Math.max.apply(null, groups[a].items.map(function(v){ return new Date(v.created_at || 0).getTime(); }));
    var newestB = Math.max.apply(null, groups[b].items.map(function(v){ return new Date(v.created_at || 0).getTime(); }));
    return newestB - newestA;
  });
  var sectionTitle = allVacanciesFolder === 'agency' ? 'Agency Vacancies' : 'General Vacancies';
  el.innerHTML = '<div class="pgroup-label">' + sectionTitle + '</div>' + keys.map(function(key){
    var group = groups[key];
    group.items = sortVacancies(group.items);
    var agency = group.agency || {};
    var cards = group.items.map(function(v){ return vacancyCard(v, agency); }).join('');
    var groupVerified = group.type === 'Agency' && group.agency && group.agency.verified;
    var groupVerifiedCheck = groupVerified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
    return '<section class="directory-group vacancy-directory-group" aria-label="' + escapeHtml(group.name) + '">' +
      '<div class="directory-group-head"><div><div class="directory-group-title">' + groupVerifiedCheck + escapeHtml(group.name) + '</div><div class="directory-group-sub">' + group.type + ' · ' + group.items.length + ' vacanc' + (group.items.length===1?'y':'ies') + '</div></div></div>' + cards + '</section>';
  }).join('');
}

function switchSubTab(tab) {
  subCurrentTab = tab;
  document.getElementById('sub-tab-reports').classList.toggle('active', tab === 'reports');
  document.getElementById('sub-tab-suggestions').classList.toggle('active', tab === 'suggestions');
  renderSubmissionsList();
  // Load data if not yet loaded
  if (tab === 'reports' && subReportsCache.length === 0) loadReportsFromSupabase();
  if (tab === 'suggestions' && subSuggestionsCache.length === 0) loadSuggestionsFromSupabase();
}

async function loadReportsFromSupabase() {
  var list = document.getElementById('submissions-list');
  if (list) list.innerHTML = '<div class="empty-state"><h3>Loading reports…</h3></div>';
  var supaReports = [];
  var supaOk = false;
  try {
    var { data, error } = await supabaseClient.from('reports').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    supaReports = data || [];
    supaOk = true;
  } catch(e) {
    console.error('load reports supabase', e);
  }
  // Always merge localStorage backups so reports that failed to insert to
  // Supabase (or were submitted before the fix) still appear in the panel.
  var localReports = readLocalReports().slice().reverse();
  var seenKeys = {};
  var merged = [];
  // Add Supabase reports first (they have real IDs for toggle/delete)
  supaReports.forEach(function(r){
    var key = (r.agency_name||'') + '|' + (r.reason||'') + '|' + (r.details||'') + '|' + (r.created_at||'');
    if (!seenKeys[key]) { seenKeys[key] = true; merged.push(r); }
  });
  // Then add local-only reports that aren't already in Supabase
  localReports.forEach(function(r){
    var key = (r.agency_name||'') + '|' + (r.reason||'') + '|' + (r.details||'') + '|' + (r.created_at||'');
    if (!seenKeys[key]) {
      seenKeys[key] = true;
      // Generate a pseudo-id for local-only items so toggle/delete can work locally
      r._localId = r._localId || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
      merged.push(r);
    }
  });
  subReportsCache = merged;
  updateSubBadges();
  renderSubmissionsList();
  if (!supaOk && subReportsCache.length === 0) {
    if (list) list.innerHTML = '<div class="empty-state"><h3>Could not load reports</h3><p>Check your Supabase setup or run the SQL script.</p></div>';
  }
}

async function loadSuggestionsFromSupabase() {
  var list = document.getElementById('submissions-list');
  if (list) list.innerHTML = '<div class="empty-state"><h3>Loading suggestions…</h3></div>';
  var supaSugg = [];
  var supaOk = false;
  try {
    var { data, error } = await supabaseClient.from('suggestions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    supaSugg = data || [];
    supaOk = true;
  } catch(e) {
    console.error('load suggestions supabase', e);
  }
  // Merge localStorage backups so locally-saved suggestions also appear
  var localSugg = [];
  try { localSugg = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]').slice().reverse(); } catch(e2){}
  var seenKeys = {};
  var merged = [];
  supaSugg.forEach(function(s){
    var key = (s.type||'') + '|' + (s.agency_name||'') + '|' + (s.details||'') + '|' + (s.created_at||'');
    if (!seenKeys[key]) { seenKeys[key] = true; merged.push(s); }
  });
  localSugg.forEach(function(s){
    var key = (s.type||'') + '|' + (s.agency_name||'') + '|' + (s.details||'') + '|' + (s.created_at||'');
    if (!seenKeys[key]) {
      seenKeys[key] = true;
      s._localId = s._localId || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
      merged.push(s);
    }
  });
  subSuggestionsCache = merged;
  updateSubBadges();
  renderSubmissionsList();
  if (!supaOk && subSuggestionsCache.length === 0) {
    if (list) list.innerHTML = '<div class="empty-state"><h3>Could not load suggestions</h3><p>Check your Supabase setup or run the SQL script.</p></div>';
  }
}

function updateSubBadges() {
  var reportsOpen = subReportsCache.filter(function(r){ return (r.status || 'open') === 'open'; }).length;
  var suggOpen = subSuggestionsCache.filter(function(s){ return (s.status || 'open') === 'open'; }).length;
  var rb = document.getElementById('reports-badge');
  var sb = document.getElementById('suggestions-badge');
  if (reportsOpen > 0) { rb.textContent = reportsOpen; rb.style.display = 'inline-block'; }
  else { rb.style.display = 'none'; }
  if (suggOpen > 0) { sb.textContent = suggOpen; sb.style.display = 'inline-block'; }
  else { sb.style.display = 'none'; }
}

function renderSubmissionsList() {
  var list = document.getElementById('submissions-list');
  if (!list) return;
  var items = subCurrentTab === 'reports' ? subReportsCache : subSuggestionsCache;
  if (!items || items.length === 0) {
    var label = subCurrentTab === 'reports' ? 'reports' : 'suggestions';
    list.innerHTML = '<div class="empty-state"><h3>No ' + label + ' yet</h3><p>When users submit ' + label + ', they will appear here.</p>' +
      '<button class="sheet-cancel" data-ripple onclick="' + (subCurrentTab === 'reports' ? 'loadReportsFromSupabase' : 'loadSuggestionsFromSupabase') + '()" style="margin-top:12px;">Refresh</button></div>';
    return;
  }
  var html = items.map(function(item) {
    var isReport = subCurrentTab === 'reports';
    var iconClass = isReport ? 'report' : 'suggestion';
    var iconEmoji = isReport ? '⚠️' : '💡';
    var title = isReport ? (item.reason || 'Report') : (item.type || 'Suggestion');
    var agency = item.agency_name ? escapeHtml(item.agency_name) : '';
    var details = escapeHtml(item.details || '');
    var dateStr = item.created_at ? new Date(item.created_at).toLocaleString('en-ZA', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    var status = item.status || 'open';
    var statusClass = status === 'resolved' || status === 'closed' ? 'resolved' : 'open';
    var statusLabel = status === 'resolved' ? '✓ Resolved' : (status === 'closed' ? 'Closed' : 'Open');
    var id = item.id || item._localId || '';
    var metaLine = agency ? 'Agency: ' + agency : '';
    if (dateStr) metaLine += (metaLine ? ' · ' : '') + dateStr;
    return '<div class="sub-card">' +
      '<div class="sub-card-head">' +
        '<div class="sub-card-icon ' + iconClass + '">' + iconEmoji + '</div>' +
        '<div class="sub-card-title">' + escapeHtml(title) + (metaLine ? '<div class="sub-card-meta">' + metaLine + '</div>' : '') + '</div>' +
      '</div>' +
      (details ? '<div class="sub-card-body">' + details + '</div>' : '') +
      '<div class="sub-card-actions">' +
        '<button class="sub-status-pill ' + statusClass + '" data-ripple onclick="toggleSubStatus(\'' + (isReport ? 'reports' : 'suggestions') + '\',\'' + id + '\')">' + statusLabel + '</button>' +
        '<button class="sub-del-btn" data-ripple onclick="deleteSubmission(\'' + (isReport ? 'reports' : 'suggestions') + '\',\'' + id + '\')">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
  html += '<button class="sheet-cancel" data-ripple onclick="' + (subCurrentTab === 'reports' ? 'loadReportsFromSupabase' : 'loadSuggestionsFromSupabase') + '()" style="margin:12px auto 20px;max-width:180px;">Refresh</button>';
  list.innerHTML = html;
}

async function toggleSubStatus(table, id) {
  if (!id) { showToast('Cannot update — missing ID'); return; }
  var cache = table === 'reports' ? subReportsCache : subSuggestionsCache;
  // Support both real Supabase id and local _localId
  var item = cache.find(function(x){ return (x.id && x.id === id) || (x._localId && x._localId === id); });
  if (!item) return;
  var newStatus = (item.status === 'resolved' || item.status === 'closed') ? 'open' : 'resolved';
  item.status = newStatus;
  // Only update Supabase if this is a real DB row (has numeric/uuid id, not _localId)
  if (item.id && !String(id).startsWith('local_')) {
    try {
      await supabaseClient.from(table).update({ status: newStatus }).eq('id', id);
    } catch(e) { console.error('update status', e); }
  } else {
    // Local-only item: update localStorage backup
    if (table === 'reports') {
      var local = readLocalReports();
      var li = local.findIndex(function(x){ return x._localId === id || ((x.agency_name||'')+'|'+(x.reason||'')+'|'+(x.details||'')+'|'+(x.created_at||'')) === ((item.agency_name||'')+'|'+(item.reason||'')+'|'+(item.details||'')+'|'+(item.created_at||'')); });
      if (li >= 0) { local[li].status = newStatus; writeLocalReports(local); }
    } else {
      try {
        var ls = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]');
        var si = ls.findIndex(function(x){ return x._localId === id; });
        if (si >= 0) { ls[si].status = newStatus; localStorage.setItem('sa_suggestions_local', JSON.stringify(ls)); }
      } catch(e2){}
    }
  }
  updateSubBadges();
  renderSubmissionsList();
  showToast(newStatus === 'resolved' ? 'Marked as resolved' : 'Reopened');
}

async function deleteSubmission(table, id) {
  if (!id) { showToast('Cannot delete — missing ID'); return; }
  if (!confirm('Delete this submission? This cannot be undone.')) return;
  // Delete from Supabase only if it's a real DB row
  if (!String(id).startsWith('local_')) {
    try {
      await supabaseClient.from(table).delete().eq('id', id);
    } catch(e) { console.error('delete submission', e); }
  }
  // Also remove from localStorage backup
  if (table === 'reports') {
    var local = readLocalReports();
    local = local.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
    writeLocalReports(local);
  } else {
    try {
      var ls = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]');
      ls = ls.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
      localStorage.setItem('sa_suggestions_local', JSON.stringify(ls));
    } catch(e2){}
  }
  // Remove from cache
  if (table === 'reports') subReportsCache = subReportsCache.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
  else subSuggestionsCache = subSuggestionsCache.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
  updateSubBadges();
  renderSubmissionsList();
  showToast('Deleted');
}

// ===== SMART MANAGER (admin section) =====
function goSmartManager() {
  if (!isAdmin) return; // admin-only — managed via admin.html now
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-smartmanager').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderSmartManager();
}
function renderSmartManager() {
  var list = document.getElementById('smartmanager-list');
  if (!list) return;
  if (!agenciesCache.length) {
    list.innerHTML = '<div class="empty-state"><h3>No agencies yet</h3><p>Add agencies first, then their links will appear here.</p></div>';
    return;
  }
  var q = (document.getElementById('sm-search').value || '').trim().toLowerCase();
  var filtered = agenciesCache;
  if (q) {
    filtered = agenciesCache.filter(function(a) {
      return ((a.name || '') + ' ' + (a.location || '') + ' ' + (a.contact || '') + ' ' + (a.email || '')).toLowerCase().indexOf(q) !== -1;
    });
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>No agencies found for "' + escapeHtml(q) + '".</p></div>';
    return;
  }
  var html = '';
  filtered.forEach(function(a) {
    var token = getManagerToken(a.id);
    var link = token ? buildManagerLink(token) : '(generating...)';
    html += '<div class="sm-card">' +
      '<div class="sm-card-head">' +
        '<div class="sm-card-avatar">' + initials(a.name) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="sm-card-name">' + escapeHtml(a.name) + '</div>' +
          (a.location ? '<div class="sm-card-loc">' + escapeHtml(a.location) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="sm-link-box" id="sm-link-' + a.id + '">' + escapeHtml(link) + '</div>' +
      '<div class="sm-link-actions">' +
        '<button class="sm-copy-btn" data-ripple onclick="copyManagerLink(\'' + a.id + '\')">Copy link</button>' +
        '<button class="sm-share-btn" data-ripple onclick="shareManagerLink(\'' + a.id + '\')">Share</button>' +
        '<button class="sm-share-btn" data-ripple onclick="openManagerLink(\'' + a.id + '\')">Open</button>' +
      '</div>' +
    '</div>';
  });
  list.innerHTML = html;
}
function filterSmartManager() {
  renderSmartManager();
}
function copyManagerLink(agencyId) {
  var token = getManagerToken(agencyId);
  if (!token) { showToast('Link not ready'); return; }
  var link = buildManagerLink(token);
  copyText(link, document.getElementById('sm-link-' + agencyId));
}
function shareManagerLink(agencyId) {
  var token = getManagerToken(agencyId);
  if (!token) { showToast('Link not ready'); return; }
  var link = buildManagerLink(token);
  var agency = agenciesCache.find(function(a){ return a.id === agencyId; });
  var shareText = 'Hello ' + (agency ? agency.name : '') + ', here is your link to add branches and vacancies to SA Recruiters: ' + link;
  if (navigator.share) {
    navigator.share({ title: 'SA Recruiters — Agency Update Link', text: shareText, url: link }).catch(function(){});
  } else {
    copyText(link, null);
    showToast('Link copied — paste it into a message to the agency');
  }
}
/* Share a vacancy via the OS share sheet (WhatsApp, Messages, Gmail, etc.),
   pointing at its static public listing page (see generate-pages.js) so the
   link works and looks right (title/description/og:image) when opened by
   someone without the app. Falls back to copy-link where navigator.share
   isn't available (desktop browsers). */
/* Share an agency via the OS share sheet, pointing at its static public
   listing page (see generate-pages.js). Falls back to copy-link where
   navigator.share isn't available (desktop browsers). */
function shareAgency(agencyId) {
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  if (!a) { showToast('Agency not found'); return; }
  var link = window.location.origin + '/agency/' + publicAgencySlug(a) + '/';
  var loc = (a.location || a.address || '').trim();
  var shareText = (a.name || 'Recruitment agency') + (loc ? ' — ' + loc : '');
  trackEvent('agency_share', 'agency', agencyId);
  if (navigator.share) {
    navigator.share({ title: (a.name || 'Agency') + ' — SA Recruiters', text: shareText, url: link }).catch(function(){});
  } else {
    copyText(link, null);
    showToast('Link copied — paste it into a message');
  }
}
function shareVacancy(vacancyId) {
  var v = vacanciesCache.find(function(x){ return x.id === vacancyId; });
  if (!v) { showToast('Vacancy not found'); return; }
  var agency = v.agency_id ? agenciesCache.find(function(a){ return a.id === v.agency_id; }) : null;
  var link = window.location.origin + '/vacancy/' + publicVacancySlug(v) + '/';
  var orgName = (agency && agency.name) || v.company || '';
  var shareText = v.title + (orgName ? ' — ' + orgName : '') + (v.location ? ' (' + v.location + ')' : '');
  trackEvent('vacancy_share', 'vacancy', vacancyId);
  if (navigator.share) {
    navigator.share({ title: v.title + ' — SA Recruiters', text: shareText, url: link }).catch(function(){});
  } else {
    copyText(link, null);
    showToast('Link copied — paste it into a message');
  }
}
function openManagerLink(agencyId) {
  var token = getManagerToken(agencyId);
  if (!token) { showToast('Link not ready'); return; }
  window.open(buildManagerLink(token), '_blank');
}

// ===== MANAGER MODE (agency self-service, add-only) =====
var managerTokenRetries = 0;
var MANAGER_TOKEN_MAX_RETRIES = 12;   // ~30s of patient retries while data loads
var managerTokenKind = null;          // 'agency' | 'employer' (for the status screen)
var managerStatusWatchdog = null;     // safety timeout that flips loading -> error

// Show the dedicated manager-link status screen so a token URL never silently
// drops the visitor onto the normal home screen while it is still resolving.
function showManagerStatus(state, heading, body) {
  var screen = document.getElementById('screen-manager-status');
  if (!screen) return;
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  screen.classList.add('active');
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = 'none';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = 'none';
  var spinner = document.getElementById('manager-status-spinner');
  var h = document.getElementById('manager-status-heading');
  var p = document.getElementById('manager-status-body');
  var retry = document.getElementById('manager-status-retry');
  var home = document.getElementById('manager-status-home');
  var ctx = document.querySelector('#screen-manager-status .screen-context');
  if (spinner) spinner.style.display = (state === 'loading') ? '' : 'none';
  if (h) h.textContent = heading || '';
  if (p) p.textContent = body || '';
  if (ctx) ctx.textContent = (state === 'loading') ? 'Please wait' : 'Link problem';
  if (retry) retry.style.display = (state === 'error') ? '' : 'none';
  if (home) home.style.display = (state === 'error') ? '' : 'none';
}
function retryManagerTokenFromStatus() {
  // Re-trigger resolution for whichever token kind is pending.
  if (managerPendingToken) { enterManagerMode(managerPendingToken); return; }
  if (employerManagerPendingToken) { enterEmployerManagerMode(employerManagerPendingToken); return; }
  goBackToHome();
}
function enterManagerMode(token) {
  // Always surface the status screen first so the visitor sees that their
  // manager link is being opened, not the generic directory home screen.
  if (!managerMode) showManagerStatus('loading', 'Loading your manager link…', 'We\'re connecting to SA Recruiters. This usually takes a moment.');
  var agencyId = agencyIdFromToken(token);
  if (!agencyId) {
    // Data hasn't arrived yet (cold start, slow/flaky connection, or Supabase
    // is momentarily unreachable — e.g. a paused free-tier project waking up,
    // which can easily take 15-20s+ on the very first query). Keep the token
    // pending and keep retrying for a generous window instead of giving up
    // after 3 attempts, which is what previously dumped people back onto the
    // home screen.
    if (agenciesCache.length === 0 && managerTokenRetries < MANAGER_TOKEN_MAX_RETRIES) {
      managerTokenRetries++;
      managerPendingToken = token;
      managerTokenKind = 'agency';
      var backoff = Math.min(1200 + (managerTokenRetries * 300), 3000);
      // Push the watchdog out so it never fires mid-retry — see bumpManagerWatchdog().
      bumpManagerWatchdog(backoff + 8000);
      // Use the lightweight single-table fetch instead of the full loadAll()
      // bundle — a manager link only needs `agencies` to resolve, so retries
      // shouldn't wait on branches/vacancies/employers/settings too.
      setTimeout(function(){ if (managerPendingToken) fastResolveManagerToken(); }, backoff);
      return false;
    }
    // Data has loaded and the token still doesn't match any agency — the
    // link is genuinely invalid/expired. Show a clear, dedicated invalid-link
    // state (with a retry + back-to-directory option) rather than silently
    // landing on the home screen, which just looks like a dead link.
    managerPendingToken = null;
    managerTokenKind = null;
    showManagerStatus('error',
      'This management link is invalid or expired',
      'We couldn\'t find an agency for this link. It may have expired or been replaced. Please request a new link from SA Recruiters, or try again in case the connection was interrupted.');
    return false;
  }
  managerTokenRetries = 0;
  managerPendingToken = null;
  managerTokenKind = null;
  clearTimeout(managerStatusWatchdog);
  managerMode = true;
  managerAgency = agenciesCache.find(function(a){ return a.id === agencyId; });
  if (!managerAgency) { managerMode = false; return false; }
  // Hide normal app chrome, show manager screen
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-manager').classList.add('active');
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = 'none';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = 'none';
  document.getElementById('manager-agency-name').textContent = managerAgency.name || 'Agency';
  renderManagerMode();
  return true;
}
function exitManagerMode() {
  managerMode = false;
  managerAgency = null;
  managerPendingToken = null;
  // Clean URL
  if (window.history && window.history.replaceState) {
    var clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, clean);
  }
  // Restore app chrome
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = '';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = isAdmin ? 'flex' : 'none';
  // Go back to home
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-home').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'home'); });
}
function renderManagerMode() {
  if (!managerMode || !managerAgency) return;
  renderManagerAgencyProfile();
  // Branches
  var branches = branchesFor(managerAgency.id);
  var bHtml = '';
  if (branches.length) {
    branches.forEach(function(b) {
      bHtml += '<div class="manager-item">' +
        '<div class="manager-item-title">' + escapeHtml(b.name || '') + '</div>' +
        (b.location ? '<div class="manager-item-sub">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>' + escapeHtml(b.location) + '</div>' : '') +
        (b.phone ? '<div class="manager-item-sub">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>' + escapeHtml(b.phone) + '</div>' : '') +
        (b.email ? '<div class="manager-item-sub">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + escapeHtml(b.email) + '</div>' : '') +
        '<span class="manager-read-only-tag">Saved — contact admin to edit</span>' +
      '</div>';
    });
  } else {
    bHtml = '<div class="empty-state" style="padding:16px 0"><p style="font-size:13px;color:var(--text-2)">No branches added yet.</p></div>';
  }
  document.getElementById('manager-branch-list').innerHTML = bHtml;
  // Vacancies
  var vacancies = vacanciesFor(managerAgency.id);
  var vHtml = '';
  if (vacancies.length) {
    vacancies.forEach(function(v) {
      vHtml += '<div class="manager-item manager-item-compact">' +
        '<div class="manager-item-title">' + escapeHtml(v.title || '') + '</div>' +
      '</div>';
    });
  } else {
    vHtml = vacancyScreenStateMarkup('manager', false, false);
  }
  document.getElementById('manager-vacancy-list').innerHTML = vHtml;
}
// Small profile card shown at the top of the agency self-service screen so
// the agency can confirm who they're managing — mirrors the admin card's
// photo + contact details (read-only here; edits go through the admin).
function renderManagerAgencyProfile() {
  var el = document.getElementById('manager-agency-profile');
  if (!el || !managerAgency) return;
  var a = managerAgency;
  var ICON_PIN = '<svg viewBox="0 0 24 24"' + IS + ' style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  var ICON_PHONE = '<svg viewBox="0 0 24 24"' + IS + ' style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>';
  var ICON_MAIL = '<svg viewBox="0 0 24 24"' + IS + ' style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  var rows = '';
  if (a.contact) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_PHONE + escapeHtml(a.contact) + '</div>';
  if (a.email) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_MAIL + escapeHtml(a.email) + '</div>';
  if (a.address || a.location) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_PIN + escapeHtml(a.address || a.location) + '</div>';
  if (a.website) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_LINK.replace('<svg ', '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:4px" ') + escapeHtml(a.website) + '</div>';
  el.innerHTML =
    '<div class="sm-card-head">' +
      '<div class="sm-card-avatar">' + (a.photo ? '<img src="' + a.photo + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : initials(a.name)) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="sm-card-name">' + escapeHtml(a.name || 'Agency') + (a.verified ? ' <span style="color:var(--accent);font-size:11px;font-weight:700">✓ Verified</span>' : '') + '</div>' +
      '</div>' +
    '</div>' +
    (rows || '<div class="manager-item-sub">No contact details on file yet.</div>');
}
function managerAddBranch() {
  if (!managerAgency) return;
  // Use openBranchSheet in "add" mode (no branchId) so the title and
  // pendingBranchId stay consistent with the edit-aware branch sheet.
  openBranchSheet(managerAgency.id, null);
}
function managerAddVacancy() {
  if (!managerAgency) return;
  pendingVacancyAgency = managerAgency.id;
  document.getElementById('v-title').value = '';
  document.getElementById('v-location').value = '';
  document.getElementById('v-closing').value = '';
  document.getElementById('v-notes').value = '';
  document.getElementById('v-link').value = '';
  document.getElementById('vacancy-overlay').classList.add('open');
}

// ===== EMPLOYER MANAGER MODE (employer self-service, vacancies only) =====
// Mirrors the agency manager mode above, but scoped to a single employer's
// vacancies via ?manage_employer=TOKEN. Employers can add vacancies for
// themselves here; everything else (contact details, verification) stays
// admin-controlled. Once saved, a vacancy is read-only from this screen.
var employerManagerTokenRetries = 0;
var EMPLOYER_MANAGER_TOKEN_MAX_RETRIES = 12;
function enterEmployerManagerMode(token) {
  if (!employerManagerMode) showManagerStatus('loading', 'Loading your manager link…', 'We\'re connecting to SA Recruiters. This usually takes a moment.');
  var employerId = employerIdFromToken(token);
  if (!employerId) {
    // Employers genuinely haven't loaded yet (cold start / slow connection) —
    // keep retrying for a generous window instead of giving up after 3 tries,
    // which previously dropped the visitor back onto the home screen.
    if (employersCache.length === 0 && employerManagerTokenRetries < EMPLOYER_MANAGER_TOKEN_MAX_RETRIES) {
      employerManagerTokenRetries++;
      employerManagerPendingToken = token;
      managerTokenKind = 'employer';
      var backoff = Math.min(1200 + (employerManagerTokenRetries * 300), 3000);
      bumpManagerWatchdog(backoff + 8000);
      setTimeout(function(){ if (employerManagerPendingToken) fastResolveManagerToken(); }, backoff);
      return false;
    }
    employerManagerPendingToken = null;
    managerTokenKind = null;
    showManagerStatus('error',
      'This management link is invalid or expired',
      'We couldn\'t find a company for this link. It may have expired or been replaced. Please request a new link from SA Recruiters, or try again in case the connection was interrupted.');
    return false;
  }
  employerManagerTokenRetries = 0;
  employerManagerPendingToken = null;
  managerTokenKind = null;
  clearTimeout(managerStatusWatchdog);
  employerManagerMode = true;
  managerEmployer = employersCache.find(function(e){ return e.id === employerId; });
  if (!managerEmployer) { employerManagerMode = false; return false; }
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-manager-employer').classList.add('active');
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = 'none';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = 'none';
  document.getElementById('manager-employer-name').textContent = managerEmployer.name || 'Company';
  renderEmployerManagerMode();
  return true;
}
function exitEmployerManagerMode() {
  employerManagerMode = false;
  managerEmployer = null;
  employerManagerPendingToken = null;
  if (window.history && window.history.replaceState) {
    var clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, clean);
  }
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = '';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = isAdmin ? 'flex' : 'none';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-home').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'home'); });
}
function renderEmployerManagerMode() {
  if (!employerManagerMode || !managerEmployer) return;
  renderManagerEmployerProfile();
  var vacancies = vacanciesForEmployer(managerEmployer.id);
  var vHtml = '';
  if (vacancies.length) {
    vacancies.forEach(function(v) {
      vHtml += '<div class="manager-item manager-item-compact">' +
        '<div class="manager-item-title">' + escapeHtml(v.title || '') + '</div>' +
      '</div>';
    });
  } else {
    vHtml = vacancyScreenStateMarkup('manager', false, false);
  }
  document.getElementById('manager-employer-vacancy-list').innerHTML = vHtml;
}
// Same idea as renderManagerAgencyProfile(), scoped to the employer
// self-service screen (?manage_employer=TOKEN).
function renderManagerEmployerProfile() {
  var el = document.getElementById('manager-employer-profile');
  if (!el || !managerEmployer) return;
  var e = managerEmployer;
  var ICON_PIN = '<svg viewBox="0 0 24 24"' + IS + ' style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  var ICON_PHONE = '<svg viewBox="0 0 24 24"' + IS + ' style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>';
  var ICON_MAIL = '<svg viewBox="0 0 24 24"' + IS + ' style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  var rows = '';
  if (e.contact) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_PHONE + escapeHtml(e.contact) + '</div>';
  if (e.email) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_MAIL + escapeHtml(e.email) + '</div>';
  if (e.address || e.location) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_PIN + escapeHtml(e.address || e.location) + '</div>';
  if (e.website) rows += '<div class="manager-item-sub" style="margin-top:2px">' + ICON_LINK.replace('<svg ', '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:4px" ') + escapeHtml(e.website) + '</div>';
  if (e.industry) rows += '<div class="manager-item-sub" style="margin-top:2px">' + escapeHtml(e.industry) + '</div>';
  el.innerHTML =
    '<div class="sm-card-head">' +
      '<div class="sm-card-avatar">' + (e.photo ? '<img src="' + e.photo + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : initials(e.name)) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="sm-card-name">' + escapeHtml(e.name || 'Company') + (e.verified ? ' <span style="color:var(--accent);font-size:11px;font-weight:700">✓ Verified</span>' : '') + '</div>' +
      '</div>' +
    '</div>' +
    (rows || '<div class="manager-item-sub">No contact details on file yet.</div>');
}
function managerEmployerAddVacancy() {
  if (!managerEmployer) return;
  openEmployerVacancySheet(managerEmployer.id);
}
// ===== Talent Pool email-alert unsubscribe =====
async function processAlertUnsubscribe() {
  var token = new URLSearchParams(window.location.search).get('unsubscribe');
  if (!token) return;
  try {
    var result = await supabaseClient.rpc('unsubscribe_pool_email_alerts', { p_token: token });
    if (result && result.data) showToast('Email alerts stopped');
    else showToast('This unsubscribe link is invalid or already used');
  } catch (e) { showToast('Could not update email alerts — please try again'); }
}

// Safety watchdog: if the token still hasn't resolved a while after the link
// was opened (or after the most recent retry attempt), switch from the
// indefinite "loading" spinner to an actionable "couldn't load / try again"
// state instead of leaving the visitor staring at a spinner forever.
//
// This is intentionally a "bump" rather than a single fixed timer set once on
// page load: token resolution retries for up to ~30s in the background (see
// MANAGER_TOKEN_MAX_RETRIES), most commonly because a paused free-tier
// Supabase project needs 10-20s+ to wake up on its first query. A flat 20s
// timer fired WHILE those retries were still legitimately in progress, so
// the error screen showed up before the app had even finished trying — which
// is why "Try again" kept appearing on slow connections. Every retry now
// pushes this watchdog forward instead of racing it.
function bumpManagerWatchdog(delayMs) {
  clearTimeout(managerStatusWatchdog);
  managerStatusWatchdog = setTimeout(function() {
    if (managerPendingToken || employerManagerPendingToken) {
      showManagerStatus('error',
        'Couldn\'t load your manager link',
        'We weren\'t able to reach SA Recruiters. Please check your connection and try again.');
    }
  }, delayMs);
}

// Fast-path token resolution: a manager link only needs ONE table (agencies,
// or employers) to resolve the token — it doesn't need the other six queries
// loadAll() fires (branches, vacancies, employers/agencies, and three
// app_settings lookups). Resolving the token from a single lightweight query
// means the link stops waiting on unrelated data. loadAll() still runs
// separately to load everything else the app needs.
async function fastResolveManagerToken() {
  if (managerPendingToken && agenciesCache.length === 0) {
    var agencies = await getAgencies();
    if (!agencies.__loadError) agenciesCache = agencies;
    if (managerPendingToken) enterManagerMode(managerPendingToken);
  }
  if (employerManagerPendingToken && employersCache.length === 0) {
    var employers = await getEmployers();
    if (!employers.__loadError) employersCache = employers;
    if (employerManagerPendingToken) enterEmployerManagerMode(employerManagerPendingToken);
  }
}

// ===== Detect manager mode from URL (?manage=TOKEN or ?manage_employer=TOKEN) =====
(function detectManagerMode() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('manage');
  var empToken = params.get('manage_employer');
  if (token) {
    // Agencies aren't loaded yet; set pending token — loadAll() will enter manager mode
    managerPendingToken = token;
    managerTokenKind = 'agency';
  }
  if (empToken) {
    // Employers aren't loaded yet; set pending token — loadAll() will enter employer manager mode
    employerManagerPendingToken = empToken;
    managerTokenKind = 'employer';
  }
  // If a manager token is present in the URL, immediately take over the
  // screen with the manager-link status view. This prevents the normal home
  // screen from flashing up (and looking like the link "redirected back to
  // the app") while the data required to resolve the token is still loading.
  if (token || empToken) {
    showManagerStatus('loading', 'Loading your manager link…', 'We\'re connecting to SA Recruiters. This usually takes a moment.');
    bumpManagerWatchdog(20000);
    // Kick off the lightweight single-table fetch immediately, in parallel
    // with loadAll() below — whichever resolves the token first wins.
    fastResolveManagerToken();
  }
})();

// Paint immediately from whatever was cached on the last successful load
// (if any), then loadAll() below fetches fresh data in the background and
// silently re-renders once it lands — so repeat visits never show a blank
// screen while waiting on the network.
if (loadDataCache()) {
  updateStats();
  filterAndRenderCached();
  markAppDataReady();
}

loadAll().then(markAppDataReady);
initConnectionStatus();
processAlertUnsubscribe();
// The shell and cached directory paint first; secondary settings are already
// included in loadAll, while the optional daily track loads just after paint.
setTimeout(loadTodayTrack, 250);
loadSocialLinks();

// ===== Refresh data when the app comes back from being idle =====
// A PWA that's been backgrounded (screen locked, app switched away from)
// doesn't reload — the page just sits frozen with whatever it last had in
// memory. Without this, reopening after a while shows stale counts/listings
// until the user manually pulls to refresh. Re-fetch quietly once the tab
// has been hidden for more than a couple of minutes and becomes visible again.
(function initIdleResumeRefresh() {
  var hiddenAt = null;
  var MIN_HIDDEN_MS = 2 * 60 * 1000; // only refetch if it's been idle a while
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (hiddenAt && (Date.now() - hiddenAt) > MIN_HIDDEN_MS) {
      hiddenAt = null;
      loadAll();
    }
  });
  // Covers the back/forward-cache restore case (Safari/iOS in particular),
  // which visibilitychange doesn't always catch.
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) loadAll();
  });
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js', { scope: '/', updateViaCache: 'none' }).then(function(reg) {
      // Listen for updates
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content is available. Do not take over or reload automatically:
            // an idle update must never interrupt the section the user is viewing.
            // The existing update banner lets the user choose when to reload.
            var banner = document.getElementById('update-banner');
            if (banner) banner.classList.add('show');
          }
        });
      });
      // Check for new content without automatically reloading the current page.
      // This preserves the user’s current section after the app has been idle.
      reg.update();
      setInterval(function() { reg.update(); }, 60000);
    }).catch(function(err) {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// ===== PWA Shortcut / share_target param handling =====
(function handlePwaParams() {
  try {
    var params = new URLSearchParams(window.location.search);
    var action = params.get('action');
    var tab = params.get('tab');
    // Defer until DOM + app data ready
    function whenReady(cb) {
      if (document.readyState === 'complete') setTimeout(cb, 300);
      else window.addEventListener('load', function(){ setTimeout(cb, 600); });
    }
    whenReady(function() {
      if (typeof openGeneralVacancySheet === 'function' && action === 'post-vacancy') openGeneralVacancySheet();
      else if (typeof openSuggestionSheet === 'function' && action === 'suggest') openSuggestionSheet();
      else if (typeof openContentSheet === 'function' && tab === 'learning-hub') openContentSheet('learning-hub');
      else if (typeof focusSearch === 'function' && tab === 'search') focusSearch();
      else if (action === 'share-received' && typeof showToast === 'function') showToast('Thanks! Your shared content was received.');
    });
  } catch (e) { /* no-op */ }
})();


// Mini-CV pitch character counter
(function initMiniCvCounter(){
  function update(el){
    var counter = document.querySelector('.char-counter[data-for="'+el.id+'"]');
    if(counter) counter.textContent = String(el.value.length) + ' / 150';
  }
  document.addEventListener('input', function(e){
    if(e.target && (e.target.id === 'pool-about' || e.target.id === 'pc-about')) update(e.target);
  });
  document.addEventListener('focusin', function(e){
    if(e.target && (e.target.id === 'pool-about' || e.target.id === 'pc-about')) update(e.target);
  });
})();


// Public Talent Pool cards use their own toggle so expanded details stay hidden until opened.
function togglePoolCard(card){
  if (!card) return;
  var expanded = card.classList.toggle('expanded');
  card.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}
