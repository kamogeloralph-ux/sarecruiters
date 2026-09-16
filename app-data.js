/*
 * SA Recruiters -- app.js split 2/8: app-data.js
 * Data layer: agencies, employers, branches, vacancies, app settings, daily track, local cache, loadAll()
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

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
    return '<button type="button" class="spotlight-card" data-ripple onclick="goPool(\'profile\')">' +
      '<span class="spotlight-photo"><img loading="lazy" src="'+escapeHtml(c.photo_url)+'" alt="'+escapeHtml(c.full_name||'Candidate')+'"></span>' +
      '<span class="spotlight-copy"><strong>'+escapeHtml(c.full_name||'Candidate')+(c.verified?' <span class="verified-check" title="Screened & Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>':'')+'</strong>' +
      '<span>'+escapeHtml(subtitle)+'</span></span></button>';
  }).join('') + '<button type="button" class="spotlight-card spotlight-more" data-ripple onclick="goPool(\'profile\')"><span class="spotlight-more-copy">View full<br>Talent Pool</span></button>';
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
var TRACKS_PUBLIC_BASE_URL = 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev';
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
      .select('id,title,artist,track_date,file_url,file_path')
      .gte('track_date', cutoffISO)
      .lte('track_date', today)
      .order('track_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) { renderTrackEmpty(); return; }
    if (data && data.length > 0) {
      todayTrack = data[0];
      // Older rows created during the R2 migration may have file_path but no
      // file_url. Derive the public URL so those tracks remain playable.
      if (!todayTrack.file_url) {
        var trackPath = todayTrack.file_path || ('daily-tracks/' + todayTrack.id + '.mp3');
        todayTrack.file_url = TRACKS_PUBLIC_BASE_URL + '/' + trackPath.replace(/^\/+/, '');
      }
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
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type';
  var pageSize = 1000;
  var rows = [];
  try {
    for (var offset = 0; ; offset += pageSize) {
      // General public vacancies are loaded lazily by the paginated directory
      // query below. Startup only needs agency/employer records for hub cards.
      var result = await supabaseClient.from('vacancies').select(columns)
        .or('agency_id.neq.general,employer_id.not.is.null,source_type.not.is.null')
        .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
      if (result.error) break;
      var page = result.data || [];
      rows = rows.concat(page);
      if (page.length < pageSize) return rows;
    }
  } catch(e){}
  return markLoadError(readLocal('vacancies'));
}
async function getGeneralVacancyCount() {
  try {
    var result = await supabaseClient.from('vacancies')
      .select('id', { count: 'exact', head: true })
      .or('agency_id.is.null,agency_id.eq.general')
      .is('employer_id', null)
      // The general folder historically includes unassigned agency and
      // government imports. Keep only the dedicated external sources in
      // their own folders; otherwise the count understates the directory
      // (e.g. 43 instead of several thousand rows).
      .or('source_type.is.null,source_type.not.in.(himalayas,adzuna,dpsa,retail,shoprite,picknpay,woolworths,truworths,spar)');
    if (result.error) return null;
    return typeof result.count === 'number' ? result.count : 0;
  } catch(e) { return null; }
}
function isDedicatedVacancySource(sourceType) {
  return ['himalayas', 'adzuna', 'dpsa', 'retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar'].indexOf(String(sourceType || '').toLowerCase()) !== -1;
}
function isGeneralDirectoryVacancy(v) {
  return !!v && !v.employer_id && (!v.agency_id || v.agency_id === 'general') && !isDedicatedVacancySource(v.source_type);
}
function hasAssignedAgency(v) {
  return !!v && !!v.agency_id && v.agency_id !== 'general';
}
function normalizeAgencyMatchText(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function matchVacanciesToAgencies(rows, agencies) {
  var list = rows || [];
  var directory = agencies || agenciesCache || [];
  var prepared = directory.map(function(a) {
    return { agency: a, name: normalizeAgencyMatchText(a.name) };
  }).filter(function(x){ return x.name.length >= 6; });
  list.forEach(function(v) {
    if (!v || v.employer_id || v.agency_id && v.agency_id !== 'general') return;
    var company = normalizeAgencyMatchText(v.company);
    if (!company || company.length < 6) return;
    // Only an exact name match, or one name being a clean prefix of the other
    // (e.g. "ABC Recruitment" vs "ABC Recruitment Pty Ltd"), counts as a match.
    // A plain "contains anywhere" substring test used to match any agency whose
    // name merely shared a short generic word (e.g. "Recruitment", "Group",
    // "Solutions") with the vacancy's company field -- silently re-tagging
    // unrelated general or scraped vacancies with that agency's agency_id and
    // pulling them into that agency's page.
    var match = prepared.find(function(x){
      return company === x.name || company.indexOf(x.name) === 0 || x.name.indexOf(company) === 0;
    });
    if (match) {
      v.agency_id = match.agency.id;
      if (match.agency.photo) v.company_photo = match.agency.photo;
    }
  });
  return list;
}
function generalVacancyQueryState() {
  return {
    q: ((document.getElementById('allvacancies-search')||{}).value || '').trim(),
    remote: ((document.getElementById('allvacancies-remote')||{}).value || ''),
    exp: ((document.getElementById('allvacancies-exp')||{}).value || '')
  };
}
function generalVacancyQueryKeyFor(state) {
  return [state.q, state.remote, state.exp].join('|').toLowerCase();
}
async function fetchGeneralVacancyPage(state, page) {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type';
  var from = page * generalVacancyPageSize;
  var query = supabaseClient.from('vacancies').select(columns)
    .or('agency_id.is.null,agency_id.eq.general')
    .is('employer_id', null)
    // Match the folder classification used by renderAllVacanciesList():
    // unassigned agency/government imports are general, while Himalayas,
    // Adzuna, DPSA, and retail feeds have dedicated folders.
    .or('source_type.is.null,source_type.not.in.(himalayas,adzuna,dpsa,retail,shoprite,picknpay,woolworths,truworths,spar)')
    .order('created_at', { ascending: false })
    .range(from, from + generalVacancyPageSize - 1);
  if (state.remote) query = query.eq('remote', state.remote);
  if (state.exp) query = query.eq('experience_level', state.exp);
  if (state.q) {
    var safe = state.q.replace(/[(),]/g, ' ').replace(/%/g, '').trim();
    if (safe) query = query.or('title.ilike.%' + safe + '%,company.ilike.%' + safe + '%,location.ilike.%' + safe + '%,notes.ilike.%' + safe + '%');
  }
  var result = await query;
  if (result.error) throw result.error;
  return result.data || [];
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
      generalVacancyCount: generalVacancyCount,
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
    generalVacancyCount = (typeof d.generalVacancyCount === 'number') ? d.generalVacancyCount : 0;
    employersCache = d.employers || [];
    poolCandidateCount = (typeof d.poolCount === 'number') ? d.poolCount : 0;
    lastDataRefreshAt = (typeof d.savedAt === 'number') ? d.savedAt : null;
    return true;
  } catch(e) { return false; }
}

async function getStartupData() {
  try {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = controller ? setTimeout(function() { controller.abort(); }, 8000) : null;
    var response = await fetch(STARTUP_DATA_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    });
    if (timeout) clearTimeout(timeout);
    if (!response.ok) return null;
    var payload = await response.json();
    if (!payload || !Array.isArray(payload.agencies) || !Array.isArray(payload.branches) ||
        !Array.isArray(payload.vacancies) || !Array.isArray(payload.employers) ||
        !payload.counts || !payload.settings) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function loadAll() {
  setConnectionStatus(navigator.onLine ? 'loading' : 'offline', lastDataRefreshAt);
  // Prefer the edge-cached aggregate. If it is unavailable, preserve the
  // original independent Supabase reads so launch remains resilient.
  var startup = await getStartupData();
  var results = startup ? [
    startup.agencies, startup.branches, startup.vacancies, startup.employers,
    typeof startup.counts.vacancies === 'number'
      ? Math.max(0, startup.counts.vacancies - startup.vacancies.length) : null,
    startup.settings.public_vacancy_posting,
    startup.settings.public_employer_registration,
    startup.settings.public_employer_directory,
    typeof startup.counts.candidates === 'number' ? startup.counts.candidates : null
  ] : await Promise.all([
    getAgencies(), getBranches(), getVacancies(), getEmployers(), getGeneralVacancyCount(),
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
    // Resolve imported/general records against the agency directory before
    // splitting the startup cache from the lazy General Vacancies feed.
    matchVacanciesToAgencies(results[2], agenciesCache);
    vacanciesCache = sortVacancies(results[2].filter(function(v){
      if (isVacancyExpired(v)) return false;
      // General-folder rows are loaded lazily. Do not retain them here or
      // updateStats() would add them a second time to generalVacancyCount.
      return !isGeneralDirectoryVacancy(v);
    }));
    // Best-effort background delete of the expired ones we just filtered out.
    purgeExpiredVacancies(results[2]);
  }
  if (results[3].__loadError) { hadLoadError = true; } else { employersCache = results[3]; }
  if (typeof results[4] === 'number') generalVacancyCount = results[4];
  else if (results[4] === null) hadLoadError = true;
  setRetryBanner(hadLoadError);
  if (!hadLoadError) lastDataRefreshAt = Date.now();
  setConnectionStatus(!navigator.onLine ? 'offline' : (hadLoadError ? 'error' : 'live'), lastDataRefreshAt);
  publicVacancyPostingOpen = (results[5] === true || results[5] === 'true');
  publicEmployerRegistrationOpen = (results[6] === true || results[6] === 'true');
  employerDirectoryOpen = (results[7] === true || results[7] === 'true');
  // Only overwrite the count if the query succeeded — a failed count fetch
  // should leave the last-known number on screen rather than dropping to 0.
  if (typeof results[8] === 'number') poolCandidateCount = results[8];
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
  document.getElementById('stat-vacancies').textContent = generalVacancyCount + vacanciesCache.length;
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

