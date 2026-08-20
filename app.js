
// ===== Supabase config =====
var SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';
var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

var editingId = null;
var agenciesCache = [];
var branchesCache = [];
var vacanciesCache = [];
var employersCache = [];
var isAdmin = false;
var publicVacancyPostingOpen = false;
var publicEmployerRegistrationOpen = false;
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
    if (error) console.error('employer manage_token save', error);
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
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  var next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('saTheme', next);
  applyTheme(next);
}
(function initTheme() {
  var saved = localStorage.getItem('saTheme') || 'dark';
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
  var { data, error } = await supabaseClient.from('agencies').select('*').order('created_at', { ascending: false });
  if (error) { console.error('agencies load', error); return []; }
  return data.map(function(a) { return { id: a.id, name: a.name, website: a.website, contact: a.contact, email: a.email, location: a.location, address: a.address, cvpref: a.cvpref, photo: a.photo, companies: a.companies, trades: a.trades, verified: !!a.verified, manage_token: a.manage_token || '' }; });
}
// Persist a SMART MANAGER token to Supabase so any device can resolve it
// (not just the browser that generated it). See ADD_MANAGE_TOKEN_COLUMN.sql.
async function saveManagerTokenToSupabase(agencyId, token) {
  try {
    var { error } = await supabaseClient.from('agencies').update({ manage_token: token }).eq('id', agencyId);
    if (error) console.error('manage_token save', error);
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
    var { data, error } = await supabaseClient.from('employers').select('*').order('created_at', { ascending: false });
    if (!error && data) return data.map(function(e) { return { id: e.id, name: e.name, industry: e.industry, website: e.website, contact: e.contact, email: e.email, location: e.location, address: e.address, photo: e.photo, verified: !!e.verified, manage_token: e.manage_token || '' }; });
  } catch(err){}
  return readLocal('employers');
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
    var { data, error } = await supabaseClient.from('branches').select('*').order('created_at', { ascending: true });
    if (!error && data) return data;
  } catch(e){}
  return readLocal('branches');
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
   Reads today's track from the `daily_tracks` table (Supabase).
   If the table doesn't exist or no track is set for today, shows a graceful
   "No track today" message. The audio file is served from the `daily-tracks`
   storage bucket (public). */
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
    var { data, error } = await supabaseClient
      .from('daily_tracks')
      .select('id,title,artist,track_date,file_url')
      .eq('track_date', today)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) { renderTrackEmpty(); return; }
    if (data && data.length > 0) {
      todayTrack = data[0];
      renderTrackReady();
    } else {
      // Fallback: maybe there's a track for a nearby date? No — show empty.
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
    var { data, error } = await supabaseClient.from('vacancies').select('*').order('created_at', { ascending: false });
    if (!error && data) return data;
  } catch(e){}
  return readLocal('vacancies');
}
async function upsertVacancy(v) {
  // First attempt: send all fields
  try {
    var { error } = await supabaseClient.from('vacancies').upsert(v);
    if (!error) return true;
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

// ----- Local data cache: lets the app paint instantly from the last
// successful load while fresh data streams in behind the scenes, instead
// of showing a blank screen every time while Supabase responds. -----
var DATA_CACHE_KEY = 'sa_data_cache_v1';
function saveDataCache() {
  try {
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
      agencies: agenciesCache,
      branches: branchesCache,
      vacancies: vacanciesCache,
      employers: employersCache,
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
    return true;
  } catch(e) { return false; }
}

async function loadAll() {
  // Fire all four Supabase queries in parallel instead of one-after-another —
  // total wait time becomes the slowest single query, not the sum of all four.
  var results = await Promise.all([getAgencies(), getBranches(), getVacancies(), getEmployers()]);
  agenciesCache = results[0];
  branchesCache = results[1];
  vacanciesCache = results[2];
  employersCache = results[3];
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
  // Backfill SMART MANAGER tokens for agencies that were added before this feature
  agenciesCache.forEach(function(a) {
    if (!getManagerToken(a.id)) {
      var token = genToken();
      setManagerToken(a.id, token);
    }
  });
  // Backfill SMART MANAGER tokens for employers that were added before this feature
  employersCache.forEach(function(e) {
    if (!getEmployerManagerToken(e.id)) {
      var token = genToken();
      setEmployerManagerToken(e.id, token);
    }
  });
  updateStats();
  filterAndRenderCached();
  saveDataCache();
  // If in manager mode, re-render the manager panel with fresh data
  if (managerMode) renderManagerMode();
  if (employerManagerMode) renderEmployerManagerMode();
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
}

function branchesFor(agencyId) { return branchesCache.filter(function(b){ return b.agency_id === agencyId; }); }
function vacanciesFor(agencyId) { return vacanciesCache.filter(function(v){ return v.agency_id === agencyId; }); }
function vacanciesForEmployer(employerId) { return vacanciesCache.filter(function(v){ return v.employer_id === employerId; }); }

// ===== Hub card (agency) =====
function avatarHtml(a) {
  if (a.photo) return '<div class="avatar"><img src="' + a.photo + '"></div>';
  return '<div class="avatar">' + initials(a.name) + '</div>';
}

function hubCard(a) {
  var vCount = vacanciesFor(a.id).length;
  var bCount = branchesFor(a.id).length;
  var descBits = [];
  if (a.location) descBits.push(a.location);
  var verifiedCheck = a.verified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
  // Jobs badge: only shows when there is at least 1 vacancy; placed at right end of card
  var jobsBadge = vCount > 0 ? '<span class="hub-stat hub-stat-right" title="' + vCount + ' job' + (vCount===1?'':'s') + '"><span class="hub-stat-num"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>' + vCount + '</span></span>' : '';
  return '' +
  '<div class="hub-card" id="hub-' + a.id + '">' +
    '<button class="hub-summary" data-ripple onclick="toggleHub(\'' + a.id + '\')" aria-expanded="false">' +
      avatarHtml(a) +
      '<div class="hub-summary-body">' +
        '<div class="agency-name-row">' + verifiedCheck + '<span class="agency-name">' + escapeHtml(a.name || 'Unnamed agency') + '</span></div>' +
        (a.location ? '<div class="hub-summary-desc"><span style="color:var(--text);font-weight:600">Head office:</span> ' + escapeHtml(a.location) + '</div>' : '') +
      '</div>' +
      jobsBadge +
      '<span class="chevron">' + ICON_CHEVRON + '</span>' +
    '</button>' +
    '<div class="hub-panel" id="hub-panel-' + a.id + '">' +
      '<div class="hub-panel-inner">' +
        '<a href="/agency/' + slugify(a.name) + '/" target="_blank" rel="noopener" style="display:inline-block;font-size:12px;color:var(--accent);margin-bottom:8px;text-decoration:none;" onclick="event.stopPropagation()">View public listing page ↗</a>' +
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
  var pref = (a.cvpref || '').trim();
  if (pref) html += '<div class="det-row"><span class="det-label">Preferred contact:</span> <span class="hub-contact-preferred">' + (prefIcon(pref) || ICON_SEND) + escapeHtml(pref) + '</span></div>';
  if (a.contact) html += '<div class="det-row"><span class="det-label">Contact:</span> ' + telLink(a.contact) + '</div>';
  if (a.email) html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(a.email) + '</div>';
  if (a.website) html += '<div class="det-row"><span class="det-label">Website:</span> ' + webLink(a.website) + '</div>';
  if (a.location) html += '<div class="det-row"><span class="det-label">Head office:</span> ' + mapsLink(a.location) + '</div>';
  if (a.address && a.address !== a.location) html += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(a.address) + '</div>';
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
  var html = '<div class="hub-list" style="padding:4px 0;">';
  if (!list.length) {
    html += '<div style="font-size:12.5px;color:var(--text-2);padding:8px 2px;">No vacancies posted yet.</div>';
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
    setTimeout(function(){ card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 200);
  }
};

window.switchEmpHubTab = function(btn, employerId, tab) {
  btn.parentElement.querySelectorAll('.hub-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  var e = employersCache.find(function(x){ return x.id === employerId; });
  var card = btn.closest('.hub-card');
  var target = card ? card.querySelector('.hub-tab-content') : null;
  if (!target) return;
  if (tab === 'vacancies') target.innerHTML = employerHubVacancies(e);
  if (tab === 'contact') target.innerHTML = employerHubContact(e);
};

function showAllEmployers() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allemployers').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllEmployersList();
}

function renderAllEmployersList() {
  var q = ((document.getElementById('allemployers-search')||{}).value || '').trim().toLowerCase();
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
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No employers yet</h3><p>Be the first company to register and post a vacancy.</p></div>'; return; }
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
  document.getElementById('empty-msg').style.display = list.length ? 'none' : 'block';
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
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>Nothing saved yet</h3><p>Tap the star on any vacancy to keep it here.</p></div>'; return; }
  el.innerHTML = list.map(function(v) {
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
    return vacancyCard(v, agency);
  }).join('');
}

// ===== Search screen =====
window.handleSearchScreen = function(val) {
  var q = val.trim().toLowerCase();
  var el = document.getElementById('search-results');
  if (!q) { el.innerHTML = '<div class="empty-state"><h3>Search the directory</h3><p>Find agencies, vacancies, trades, or locations.</p></div>'; return; }
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
  if (!am.length && !vm.length) { el.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try a different agency name, trade, role, or location.</p></div>'; return; }
  var html = '';
  if (am.length) html += am.map(hubCard).join('');
  if (vm.length) {
    vm.forEach(function(v) {
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
      html += vacancyCard(v, agency);
    });
  }
  el.innerHTML = html;
};

function vacancyCard(v, agency) {
  var key = v.id;
  var saved = savedSet.has(key);
  var isGeneral = v.agency_id === 'general';
  var employer = v.employer_id ? (employersCache.find(function(e){ return e.id === v.employer_id; }) || null) : null;
  var isEmployerPost = !!employer;
  var orgName = isEmployerPost ? (employer.name || 'Employer') : (isGeneral ? (v.company || 'General Vacancy') : (agency.name || ''));
  var title = escapeHtml(v.title || 'Untitled role');
  var verifiedCheck = (isEmployerPost && employer.verified) ? '<span class="verified-check" title="Verified employer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';

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
  if (orgName) detail += vacDetRow(VAC_ICONS.building, isEmployerPost ? 'Employer' + (employer.verified ? ' \u2713 Verified' : '') : (isGeneral ? 'Company' : 'Agency'), escapeHtml(orgName));
  /* Email and phone detail rows with clickable links */
  if (v.email) detail += vacDetRow(VAC_ICONS.mail, 'Contact Email', mailLink(v.email));
  if (v.phone) detail += vacDetRow(VAC_ICONS.phone, 'Contact Phone', telLink(v.phone));

  var desc = v.notes ? '<div class="vac-desc-title">Job description</div><div class="vac-desc">' + escapeHtml(v.notes) + '</div>' : '';

  /* Action buttons */
  var actions = '<div class="vac-actions">';
  if (v.link) {
    actions += '<a class="vac-apply" href="' + escapeHtml(v.link) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + VAC_ICONS.apply + 'Apply here</a>';
  } else if (v.email || v.phone) {
    /* No link but has email/phone — show contact buttons */
    if (v.email) {
      actions += '<a class="vac-apply" href="mailto:' + escapeHtml(v.email) + '" onclick="event.stopPropagation()">' + VAC_ICONS.mail + 'Email to apply</a>';
    }
    if (v.phone) {
      actions += '<a class="vac-apply' + (v.email ? ' vac-apply-secondary' : '') + '" href="tel:' + escapeHtml(v.phone.replace(/\s/g,'')) + '" onclick="event.stopPropagation()">' + VAC_ICONS.phone + 'Call to apply</a>';
    }
  } else if (isEmployerPost && (employer.contact || employer.email || employer.website)) {
    var ecta = employer.website ? escapeHtml(employer.website) : '#';
    actions += '<a class="vac-apply" href="' + ecta + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + VAC_ICONS.apply + 'Contact employer</a>';
  } else if (!isGeneral && !isEmployerPost && agency && (agency.contact || agency.email || agency.website)) {
    var cta = agency.website ? escapeHtml(agency.website) : '#';
    actions += '<a class="vac-apply" href="' + cta + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + VAC_ICONS.apply + 'Contact agency</a>';
  } else {
    actions += '<button class="vac-apply" onclick="event.stopPropagation();showToast(\'Contact the agency or company directly to apply.\')">' + VAC_ICONS.apply + 'Contact to apply</button>';
  }
  actions += '<a class="vac-apply vac-apply-secondary" href="/vacancy/' + slugify(v.title) + '/" target="_blank" rel="noopener" onclick="event.stopPropagation()">View public listing ↗</a>';
  actions += '<button class="vac-close-btn" onclick="event.stopPropagation();closeVac(\'' + key + '\')">Close</button></div>';

  /* Admin actions (general vacancies + employer vacancies, when admin) */
  var admin = '';
  if (isAdmin && (isGeneral || isEmployerPost)) {
    admin = '<div class="vac-admin-actions">' +
      '<button class="rate-action-btn" data-ripple onclick="event.stopPropagation();openEditGeneralVacancySheet(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>' +
      '<button class="rate-action-btn danger" data-ripple onclick="event.stopPropagation();deleteGeneralVacancy(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>' +
    '</div>';
  }

  return '' +
  '<article class="vac-card" id="vc-' + key + '" onclick="toggleVac(\'' + key + '\')">' +
    '<div class="vac-card-main">' +
      logo +
      '<div class="vac-body">' +
        '<div class="vac-title">' + title + '</div>' +
        '<div class="vac-company">' + (isGeneral && !isEmployerPost ? '' : 'via ') + verifiedCheck + escapeHtml(orgName) + (isEmployerPost ? ' (Employer)' : (isGeneral ? '' : ' (Agency)')) + '</div>' +
        locLine +
        postedLine +
      '</div>' +
      '<div class="vac-card-side">' +
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

/* Toggle expand/collapse of a vacancy card */
window.toggleVac = function(id) {
  var c = document.getElementById('vc-' + id);
  if (c) c.classList.toggle('open');
};
window.closeVac = function(id) {
  var c = document.getElementById('vc-' + id);
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
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>Nothing saved yet</h3><p>Tap the star on any vacancy to keep it here.</p></div>'; return; }
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
  document.getElementById('vacancy-overlay').classList.add('open');
}
async function saveVacancy() {
  var title = document.getElementById('v-title').value.trim();
  if (!title) { alert('Add a role/title.'); return; }
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
    link: document.getElementById('v-link').value.trim()
  });
  closeSheet('vacancy-overlay');
  showToast(live ? 'Vacancy published' : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
  await loadAll();
  if (managerMode) { renderManagerMode(); return; }
  var card = document.getElementById('hub-' + pendingVacancyAgency);
  if (card) { card.classList.add('open'); switchHubTab(card.querySelector('.hub-tab'), pendingVacancyAgency, 'vacancies'); }
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
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
async function saveGeneralVacancy() {
  var title = document.getElementById('gv-role').value.trim();
  if (!title) { alert('Add a role/title.'); return; }
  var data = {
    title: title,
    company: document.getElementById('gv-company').value.trim(),
    location: document.getElementById('gv-location').value.trim(),
    remote: document.getElementById('gv-remote').value,
    employment_type: document.getElementById('gv-etype').value.trim(),
    experience_level: document.getElementById('gv-exp').value,
    contract_type: document.getElementById('gv-contract').value.trim(),
    salary: document.getElementById('gv-salary').value.trim(),
    hours: document.getElementById('gv-hours').value.trim(),
    work_schedule: document.getElementById('gv-schedule').value.trim(),
    start_date: document.getElementById('gv-start').value.trim(),
    closing_date: document.getElementById('gv-closing').value.trim(),
    notes: document.getElementById('gv-notes').value.trim(),
    link: document.getElementById('gv-link').value.trim(),
    email: document.getElementById('gv-email').value.trim(),
    phone: document.getElementById('gv-phone').value.trim(),
    agency_id: pendingVacancyEmployer ? 'employer' : 'general'
  };
  if (pendingVacancyEmployer) data.employer_id = pendingVacancyEmployer;
  var wasEmployerPost = !!pendingVacancyEmployer;
  var employerIdForRefresh = pendingVacancyEmployer;
  if (editingGeneralVacancyId) {
    data.id = editingGeneralVacancyId;
    var live2 = await upsertVacancy(data);
    closeSheet('general-vacancy-overlay');
    showToast(live2 ? 'Vacancy updated' : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
  } else {
    data.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    var live3 = await upsertVacancy(data);
    closeSheet('general-vacancy-overlay');
    showToast(live3 ? 'Vacancy published' : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
  }
  editingGeneralVacancyId = null;
  pendingVacancyEmployer = null;
  await loadAll();
  // If the all-vacancies screen is active, re-render it
  if (document.getElementById('screen-allvacancies').classList.contains('active')) {
    renderAllVacanciesList();
  }
  // If we posted from an employer's profile, re-open that employer's card
  if (wasEmployerPost && employerIdForRefresh && document.getElementById('screen-allemployers').classList.contains('active')) {
    renderAllEmployersList();
    var empCard = document.getElementById('emphub-' + employerIdForRefresh);
    if (empCard) empCard.classList.add('open');
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

function tryEmailJS(payload) {
  /* Silent email delivery via EmailJS.
     Sends an email to the admin automatically without any user action.
     The template uses these variables:
       {{submission_type}}  → "REPORT" or "SUGGESTION"
       {{agency_name}}      → agency name or "-"
       {{reason}}           → report reason or suggestion type
       {{details}}          → full details text
       {{submit_date}}      → date/time string
  */
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.templateId || !EMAILJS_CONFIG.publicKey) {
    return Promise.resolve({ sent: false, reason: 'not-configured' });
  }
  try {
    if (window.emailjs && !emailjs._initialized) {
      emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
      emailjs._initialized = true;
    }
  } catch(e) { console.warn('emailjs init', e); }
  var templateParams = {
    submission_type: (payload.type === 'report' ? 'REPORT' : (payload.type === 'suggestion' ? 'SUGGESTION' : (payload.submission_type || 'SUBMISSION'))),
    agency_name: payload.agency_name || '-',
    reason: payload.reason || payload.suggestion_type || '-',
    details: payload.details || '-',
    submit_date: new Date().toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'short' })
  };
  return emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams)
    .then(function() { console.log('emailjs sent ok'); return { sent: true }; })
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
  tryEmailJS({ type: 'report', agency_name: payload.agency_name, reason: payload.reason, details: payload.details });
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
  tryEmailJS({ type: 'suggestion', suggestion_type: payload.type, agency_name: payload.agency_name, details: payload.details });
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

function goPool() {
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
    else poolCache = data || [];
  } catch(e) { console.error('pool load', e); poolCache = []; }
  poolLoaded = true;
  // Populate sector filter options from whatever is currently listed
  var sel = document.getElementById('pool-sector-filter');
  if (sel) {
    var current = sel.value;
    var sectors = Array.from(new Set(poolCache.map(function(c){ return (c.sector||'').trim(); }).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All sectors</option>' + sectors.map(function(s){ return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>'; }).join('');
    sel.value = sectors.indexOf(current) !== -1 ? current : '';
  }
  renderPoolList();
}

function renderPoolList() {
  var listEl = document.getElementById('pool-list');
  if (!listEl) return;
  var q = ((document.getElementById('pool-search')||{}).value || '').trim().toLowerCase();
  var sector = ((document.getElementById('pool-sector-filter')||{}).value || '');
  var list = poolCache.slice();
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
    if (c.cv_link) contactBits.push('<a href="'+escapeHtml(c.cv_link)+'" target="_blank" rel="noopener">View CV</a>');
    var screenBits = [];
    if (c.gender) screenBits.push(escapeHtml(c.gender));
    if (c.grade12) screenBits.push('Grade 12: '+escapeHtml(c.grade12));
    if (c.criminal_record) screenBits.push('Criminal record: '+escapeHtml(c.criminal_record));
    if (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '') {
      screenBits.push((c.experience_years >= 10 ? '10+' : c.experience_years) + ' yrs experience');
    }
    return '<div class="manager-item">' +
      '<div class="manager-item-title">'+escapeHtml(c.full_name||'Candidate')+'</div>' +
      '<div class="manager-item-sub">'+escapeHtml(sub||'')+'</div>' +
      (screenBits.length ? '<div class="manager-item-meta">'+screenBits.join(', ')+'</div>' : '') +
      (contactBits.length ? '<div class="manager-item-meta">'+contactBits.join(' &nbsp;·&nbsp; ')+'</div>' : '') +
      '</div>';
  }).join('');
}

function openPoolRegisterSheet() {
  document.getElementById('pool-name').value = '';
  document.getElementById('pool-phone').value = '';
  document.getElementById('pool-email').value = '';
  document.getElementById('pool-sector').value = '';
  document.getElementById('pool-position').value = '';
  document.getElementById('pool-location').value = '';
  document.getElementById('pool-gender').value = '';
  document.getElementById('pool-grade12').value = '';
  document.getElementById('pool-criminal').value = '';
  document.getElementById('pool-experience').value = '';
  document.getElementById('pool-cv').value = '';
  document.getElementById('pool-payref').value = '';
  document.getElementById('pool-register-overlay').classList.add('open');
  loadPoolBankingDetails();
}

// ----- Talent Pool banking details (admin-editable, stored in app_settings) -----
async function loadPoolBankingDetails() {
  var boxes = document.querySelectorAll('.pool-banking-box');
  if (!boxes.length) return;
  var raw = await getAppSetting('pool_banking_details', '');
  var d = { account_name: 'SA Recruiters', bank: '', account_number: '', branch_code: '' };
  if (raw) { try { Object.assign(d, JSON.parse(raw)); } catch(e) {} }
  var html = '<strong>Banking details</strong><br>' +
    'Account name: ' + escapeHtml(d.account_name || 'SA Recruiters') + '<br>' +
    'Bank: ' + escapeHtml(d.bank || '[add bank name]') + '<br>' +
    'Account number: ' + escapeHtml(d.account_number || '[add account number]') + '<br>' +
    'Branch code: ' + escapeHtml(d.branch_code || '[add branch code]') + '<br>' +
    'Reference: use your full name';
  boxes.forEach(function(box){ box.innerHTML = html; });
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
  var payref = document.getElementById('pool-payref').value.trim();
  if (!name || !phone || !sector || !location) { showToast('Please fill in name, phone, sector and location.'); return; }
  if (!gender || !grade12 || !criminal || experience === '') { showToast('Please answer gender, Grade 12, criminal record and experience.'); return; }
  if (!payref) { showToast('Add the reference you used on your EFT so we can match your payment.'); return; }
  var payload = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    full_name: name,
    contact_phone: phone,
    contact_email: document.getElementById('pool-email').value.trim(),
    sector: sector,
    position: document.getElementById('pool-position').value.trim(),
    location: location,
    gender: gender,
    grade12: grade12,
    criminal_record: criminal,
    experience_years: parseInt(experience, 10),
    cv_link: document.getElementById('pool-cv').value.trim(),
    payment_ref: payref,
    status: 'pending'
  };
  var btn = document.getElementById('pool-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    var { error } = await supabaseClient.from('pool_candidates').insert([payload]);
    if (error) { console.error('pool submit', error); showToast('Could not submit — please try again.'); if (btn){ btn.disabled=false; btn.textContent='Submit registration'; } return; }
  } catch(e) { console.error('pool submit', e); showToast('Could not submit — please try again.'); if (btn){ btn.disabled=false; btn.textContent='Submit registration'; } return; }
  if (btn) { btn.disabled = false; btn.textContent = 'Submit registration'; }
  closeSheet('pool-register-overlay');
  showToast('Registration received — you\'ll go live once payment is confirmed.');
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

function goBackToProfile() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-profile').classList.add('active');
  document.querySelector('.navbtn[data-tab=profile]').classList.add('active');
  window.scrollTo({ top: 0 });
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
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-home').classList.add('active');
  document.querySelector('.navbtn[data-tab=home]').classList.add('active');
  window.scrollTo({ top: 0 });
}

function showAllAgencies() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allagencies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllAgenciesList();
}

function showAllBranches() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allbranches').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllBranchesList();
}

function showAllVacancies() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allvacancies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllVacanciesList();
}

function renderAllAgenciesList() {
  var q = ((document.getElementById('allagencies-search')||{}).value || '').trim().toLowerCase();
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
  var el = document.getElementById('allbranches-list');
  var list = branchesCache.slice();
  // Enrich each branch with its parent agency name
  list = list.map(function(b){
    var agency = agenciesCache.find(function(a){ return a.id === b.agency_id; });
    b._agencyName = agency ? agency.name : '';
    b._agencyTrades = agency ? (agency.trades||'') : '';
    return b;
  });
  if (q) {
    list = list.filter(function(b){
      var hay = ((b.name||'') + ' ' + (b.location||'') + ' ' + (b.phone||'') + ' ' + (b.email||'') + ' ' + (b._agencyName||'') + ' ' + (b._agencyTrades||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  // Sort by agency name then branch name
  list.sort(function(a,b){
    var c = (a._agencyName||'').localeCompare(b._agencyName||'');
    if (c !== 0) return c;
    return (a.name||'').localeCompare(b.name||'');
  });
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No branches found</h3><p>Try a different search term.</p></div>'; return; }
  var html = list.map(function(b){
    var bid = 'ab-' + b.id;
    var agencyName = b._agencyName || 'Unknown agency';
    /* Collapsed: agency name + short branch location only, Indeed-style.
       Tap to reveal the branch label, full address, phone and email. */
    var head = '<div class="branch-block-head" onclick="toggleBranchBlock(\'' + bid + '\')">' +
      '<div class="hub-contact-body">' +
        '<div class="hub-contact-value">' + escapeHtml(agencyName) + '</div>' +
        (b.location ? '<div class="branch-sub">' + VAC_ICONS.pin + escapeHtml(shortLocation(b.location)) + '</div>' : '') +
      '</div>' +
      '<span class="chevron">' + ICON_CHEVRON + '</span>' +
    '</div>';
    var body = '<div class="branch-detail"><div class="branch-detail-inner"><div class="det-plain">';
    body += '<div class="det-row"><span class="det-label">Branch:</span> ' + escapeHtml(b.name || 'Branch') + '</div>';
    if (b.location) {
      body += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(b.location) + '</div>';
    }
    if (b.phone) {
      body += '<div class="det-row"><span class="det-label">Phone:</span> ' + telLink(b.phone) + '</div>';
    }
    if (b.email) {
      body += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(b.email) + '</div>';
    }
    body += '</div>';
    if (isAdmin) {
      body += '<div class="branch-detail-actions">' +
        '<button class="br-edit" data-ripple onclick="event.stopPropagation();openBranchSheet(\'' + (b.agency_id||'') + '\',\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg> Edit</button>' +
        '<button class="br-del" data-ripple onclick="event.stopPropagation();deleteBranchAllList(\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete</button>' +
      '</div>';
    }
    body += '</div></div>'; // close branch-detail-inner, branch-detail
    return '<div class="branch-block" id="' + bid + '">' + head + body + '</div>';
  }).join('');
  el.innerHTML = html;
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

function renderAllVacanciesList() {
  var q = ((document.getElementById('allvacancies-search')||{}).value || '').trim().toLowerCase();
  var remoteFilter = ((document.getElementById('allvacancies-remote')||{}).value || '');
  var expFilter = ((document.getElementById('allvacancies-exp')||{}).value || '');
  var industryFilter = ((document.getElementById('allvacancies-industry')||{}).value || '');
  var el = document.getElementById('allvacancies-list');
  var list = vacanciesCache.slice();
  // Populate the industry dropdown from agency trades on the currently loaded vacancies
  var industrySel = document.getElementById('allvacancies-industry');
  if (industrySel) {
    var industries = new Set();
    vacanciesCache.forEach(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      if (agency && agency.trades) {
        agency.trades.split(',').forEach(function(t){ t = t.trim(); if (t) industries.add(t); });
      }
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
      return !!(agency && agency.trades && agency.trades.toLowerCase().indexOf(industryFilter.toLowerCase()) !== -1);
    });
  }
  if (q) {
    list = list.filter(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      var hay = ((v.title||'') + ' ' + (v.notes||'') + ' ' + (v.location||'') + ' ' + (v.company||'') + ' ' + (agency?(agency.name||''):'') + ' ' + (agency?(agency.trades||''):'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No vacancies found</h3><p>Try a different search or adjust your filters.</p></div>'; return; }
  var html = list.map(function(v){
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
    return vacancyCard(v, agency);
  }).join('');
  el.innerHTML = html;
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
function openManagerLink(agencyId) {
  var token = getManagerToken(agencyId);
  if (!token) { showToast('Link not ready'); return; }
  window.open(buildManagerLink(token), '_blank');
}

// ===== MANAGER MODE (agency self-service, add-only) =====
function enterManagerMode(token) {
  var agencyId = agencyIdFromToken(token);
  if (!agencyId) {
    // Token not found — agencies may not be loaded yet, retry after loadAll
    managerPendingToken = token;
    return false;
  }
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
      vHtml += '<div class="manager-item">' +
        '<div class="manager-item-title">' + escapeHtml(v.title || '') + '</div>' +
        (v.location ? '<div class="manager-item-sub">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>' + escapeHtml(v.location) + '</div>' : '') +
        (v.closing_date ? '<div class="manager-item-meta">Closes: ' + escapeHtml(v.closing_date) + '</div>' : '') +
        (v.notes ? '<div class="manager-item-sub" style="margin-top:6px">' + escapeHtml(v.notes) + '</div>' : '') +
        '<span class="manager-read-only-tag">Saved — contact admin to edit</span>' +
      '</div>';
    });
  } else {
    vHtml = '<div class="empty-state" style="padding:16px 0"><p style="font-size:13px;color:var(--text-2)">No vacancies added yet.</p></div>';
  }
  document.getElementById('manager-vacancy-list').innerHTML = vHtml;
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
function enterEmployerManagerMode(token) {
  var employerId = employerIdFromToken(token);
  if (!employerId) {
    // Employers may not be loaded yet — retry after loadAll
    employerManagerPendingToken = token;
    return false;
  }
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
  var vacancies = vacanciesForEmployer(managerEmployer.id);
  var vHtml = '';
  if (vacancies.length) {
    vacancies.forEach(function(v) {
      vHtml += '<div class="manager-item">' +
        '<div class="manager-item-title">' + escapeHtml(v.title || '') + '</div>' +
        (v.location ? '<div class="manager-item-sub">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>' + escapeHtml(v.location) + '</div>' : '') +
        (v.closing_date ? '<div class="manager-item-meta">Closes: ' + escapeHtml(v.closing_date) + '</div>' : '') +
        (v.notes ? '<div class="manager-item-sub" style="margin-top:6px">' + escapeHtml(v.notes) + '</div>' : '') +
        '<span class="manager-read-only-tag">Saved — contact admin to edit</span>' +
      '</div>';
    });
  } else {
    vHtml = '<div class="empty-state" style="padding:16px 0"><p style="font-size:13px;color:var(--text-2)">No vacancies added yet.</p></div>';
  }
  document.getElementById('manager-employer-vacancy-list').innerHTML = vHtml;
}
function managerEmployerAddVacancy() {
  if (!managerEmployer) return;
  openEmployerVacancySheet(managerEmployer.id);
}
// ===== Detect manager mode from URL (?manage=TOKEN or ?manage_employer=TOKEN) =====
(function detectManagerMode() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('manage');
  if (token) {
    // Agencies aren't loaded yet; set pending token — loadAll() will enter manager mode
    managerPendingToken = token;
  }
  var empToken = params.get('manage_employer');
  if (empToken) {
    // Employers aren't loaded yet; set pending token — loadAll() will enter employer manager mode
    employerManagerPendingToken = empToken;
  }
})();

// Paint immediately from whatever was cached on the last successful load
// (if any), then loadAll() below fetches fresh data in the background and
// silently re-renders once it lands — so repeat visits never show a blank
// screen while waiting on the network.
if (loadDataCache()) {
  updateStats();
  filterAndRenderCached();
}

loadAll();
loadPostingSetting();
loadEmployerRegSetting();
loadTodayTrack();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js', { scope: '/', updateViaCache: 'none' }).then(function(reg) {
      // Listen for updates
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content available — show banner + notify SW to take over
            var banner = document.getElementById('update-banner');
            if (banner) banner.classList.add('show');
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      // Auto-update when controller changes
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      // Aggressively check for updates on every load + every 60s
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
