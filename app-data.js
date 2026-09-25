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
// SECURITY NOTE: manage_token is intentionally NOT selected here. The column
// is revoked from the anon role (see
// supabase/migrations/20260918_lock_down_manager_tokens.sql) so public reads
// can never leak Smart Manager links. Token resolution happens server-side
// via the Worker's /api/verify-manager endpoint (see app-manager.js).
async function getAgencies() {
  try {
    var { data, error } = await supabaseClient.from('agencies').select('id,name,website,contact,email,location,address,cvpref,photo,companies,trades,verified').order('created_at', { ascending: false });
    if (error) { console.error('agencies load', error); return markLoadError([]); }
    return data.map(function(a) { return { id: a.id, name: a.name, website: a.website, contact: a.contact, email: a.email, location: a.location, address: a.address, cvpref: a.cvpref, photo: a.photo, companies: a.companies, trades: a.trades, verified: !!a.verified, manage_token: '' }; });
  } catch(e) { console.error('agencies load', e); return markLoadError([]); }
}
// Persist a SMART MANAGER token so any device can resolve it (not just the
// browser that generated it). Token writes are privileged: signed-in admins
// go through the admin_set_manager_token RPC; the legacy direct update is
// kept as a fallback for deployments where the authenticated role still has
// the column grant. Anonymous visitors can no longer write tokens at all —
// that is the point of the lockdown migration.
async function saveManagerTokenToSupabase(agencyId, token) {
  try {
    var rpc = await supabaseClient.rpc('admin_set_manager_token', { p_agency_id: agencyId, p_token: token });
    if (!rpc.error && rpc.data === true) return;
  } catch(e) { /* fall through to the legacy path */ }
  try {
    var { error } = await supabaseClient.from('agencies').update({ manage_token: token }).eq('id', agencyId);
    if (error) {
      console.error('manage_token save', error);
      if (typeof showToast === 'function') showToast('⚠ Manager link not saved — generate links from the admin console (Regenerate ALL tokens).');
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
  // manage_token is intentionally not selected — see the note on getAgencies().
  try {
    var { data, error } = await supabaseClient.from('employers').select('id,name,industry,website,contact,email,location,address,photo,verified').order('created_at', { ascending: false });
    if (!error && data) return data.map(function(e) { return { id: e.id, name: e.name, industry: e.industry, website: e.website, contact: e.contact, email: e.email, location: e.location, address: e.address, photo: e.photo, verified: !!e.verified, manage_token: '' }; });
  } catch(err){}
  return markLoadError(readLocal('employers'));
}
// ===== First-party house ads =====
var houseAdsCache = [];
function safeHouseAdUrl(value) {
  try {
    var url = new URL(String(value || ''), window.location.href);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch(e) { return ''; }
}
function houseAdPlacementMatches(ad, placement) {
  return ad && (ad.placement === placement || ad.placement === 'directories');
}
function renderHouseAdSlot(targetId, placement) {
  var target = document.getElementById(targetId);
  if (!target) return;
  var ad = (houseAdsCache || []).filter(function(item){ return houseAdPlacementMatches(item, placement); })[0];
  var imageUrl = ad && safeHouseAdUrl(ad.image_url);
  var targetUrl = ad && safeHouseAdUrl(ad.target_url);
  if (!ad || !imageUrl || !targetUrl) { target.hidden = true; target.innerHTML = ''; return; }
  target.hidden = false;
  target.innerHTML = '<a class="house-ad-card" href="' + escapeHtml(targetUrl) + '" target="_blank" rel="noopener sponsored" onclick="trackHouseAdEvent(\'' + escapeHtml(ad.id) + '\',\'click\')">' +
    '<img loading="lazy" src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(ad.title || ad.advertiser_name || 'Sponsored promotion') + '" onerror="this.closest(\'.house-ad-slot\').hidden=true">' +
    '<span class="house-ad-copy"><strong>' + escapeHtml(ad.title || ad.advertiser_name || '') + '</strong>' + (ad.message ? '<small>' + escapeHtml(ad.message) + '</small>' : '') + '</span>' +
  '</a>';
  trackHouseAdEvent(ad.id, 'impression');
}
function renderHouseAdSlots() {
  renderHouseAdSlot('house-ad-agencies', 'agencies');
  renderHouseAdSlot('house-ad-employers', 'employers');
  renderHouseAdSlot('house-ad-candidates', 'candidates');
}
async function loadHouseAds() {
  try {
    var now = new Date().toISOString();
    var result = await supabaseClient.from('house_ads').select('id,advertiser_name,title,message,image_url,target_url,placement,starts_at,ends_at,sort_order').eq('is_active', true).lte('starts_at', now).or('ends_at.is.null,ends_at.gt.' + now).order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(20);
    if (result.error) throw result.error;
    houseAdsCache = result.data || [];
    renderHouseAdSlots();
  } catch(e) { console.warn('house ads load', e); }
}
function trackHouseAdEvent(id, eventName) {
  if (!id || !supabaseClient || ['impression','click'].indexOf(eventName) === -1) return;
  var key = 'sa_house_ad_' + eventName + '_' + id;
  if (eventName === 'impression') {
    try { if (sessionStorage.getItem(key) === '1') return; sessionStorage.setItem(key, '1'); } catch(e) {}
  }
  supabaseClient.rpc('record_house_ad_event', { p_ad_id: id, p_event: eventName }).then(function(result){ if (result.error) console.warn('house ad tracking', result.error); });
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
var publicPoolStartupPromise = null;
async function getPublicPoolCandidatesFromWorker() {
  if (window.__saStartupPayload && Array.isArray(window.__saStartupPayload.pool_candidates)) {
    return window.__saStartupPayload;
  }
  if (!publicPoolStartupPromise) {
    publicPoolStartupPromise = fetch(R2_WORKER_URL + '/api/startup', {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' }
    }).then(function(response) {
      if (!response.ok) throw new Error('Talent Pool Worker request failed');
      return response.json();
    });
  }
  try {
    return await publicPoolStartupPromise;
  } catch (e) {
    publicPoolStartupPromise = null;
    return null;
  }
}
async function loadCandidateSpotlight() {
  var target = document.getElementById('candidate-spotlight-deck');
  if (!target) return;
  var list = [];
  try {
    var startup = await getPublicPoolCandidatesFromWorker();
    if (startup && Array.isArray(startup.pool_candidates)) {
      list = startup.pool_candidates.filter(function(c){ return (c.status || 'pending') === 'active'; }).slice(0, 30);
    } else {
      // Resilience fallback for a temporary Worker/D1 outage.
      var result = await supabaseClient.from('pool_candidates_public')
        .select('id,full_name,position,sector,location,experience_years,about_you,photo_url,verified,status,created_at')
        .order('created_at', { ascending: false }).limit(30);
      if (result.error) throw result.error;
      list = (result.data || []).filter(function(c){ return (c.status || 'pending') === 'active'; });
    }
  } catch (e) { console.warn('candidate spotlight load', e); list = []; }
  // Keep complete profiles ahead of partial profiles. A profile is considered
  // complete for the public spotlight when its useful professional summary is
  // present: name, position, sector, location, experience and about text.
  // Photo is intentionally optional and does not make a candidate look
  // incomplete. Verified status remains the tie-breaker within each group.
  function spotlightCompleteness(c) {
    var score = 0;
    if (String(c.full_name || '').trim()) score++;
    if (String(c.position || '').trim()) score++;
    if (String(c.sector || '').trim()) score++;
    if (String(c.location || '').trim()) score++;
    if (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '') score++;
    if (String(c.about_you || '').trim()) score++;
    return score;
  }
  list.sort(function(a, b) {
    var aScore = spotlightCompleteness(a), bScore = spotlightCompleteness(b);
    var aComplete = aScore === 6, bComplete = bScore === 6;
    if (aComplete !== bComplete) return aComplete ? -1 : 1;
    if (aScore !== bScore) return bScore - aScore;
    if ((b.verified?1:0) !== (a.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
  renderCandidateSpotlight(list.slice(0, 10));
}
function renderCandidateSpotlight(list) {
  var target = document.getElementById('candidate-spotlight-deck');
  if (!target) return;
  if (!list.length) {
    target.innerHTML = '<div class="poster-empty">Candidates will appear here as people join the Talent Pool.</div>';
    return;
  }
  target.innerHTML = list.map(function(c) {
    var expText = (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '')
      ? (c.experience_years >= 10 ? '10+ yrs exp' : c.experience_years + ' yrs exp')
      : '';
    var subtitle = [c.position, expText].filter(Boolean).join(' · ') || 'Looking for opportunities';
    return '<button type="button" class="spotlight-card" data-ripple onclick="goPool(\'profile\',\''+escapeHtml(c.id)+'\')">' +
      (c.photo_url ? '<span class="spotlight-photo"><img loading="lazy" src="'+escapeHtml(c.photo_url)+'" alt="'+escapeHtml(c.full_name||'Candidate')+'"></span>' : '<span class="spotlight-photo spotlight-initials">'+initials(c.full_name)+'</span>') +
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
  // Keep the media element source-free until explicit play intent. Assigning
  // src plus load() here eagerly downloads multi-megabyte audio on startup.
  trackAudio = document.getElementById('track-audio');
}

function toggleTrackPlay() {
  if (!todayTrack || !trackAudio) return;
  if (trackIsPlaying) {
    trackAudio.pause();
  } else {
    if (!trackAudio.src && todayTrack.file_url) {
      trackAudio.src = todayTrack.file_url;
      trackAudio.load();
    }
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
// Self-service vacancy posting / employer registration is admin-gated (see
// publicVacancyPostingOpen / publicEmployerRegistrationOpen above), but a
// visitor should never just hit a WhatsApp-only wall for that — see
// openPostJobSheet() in app-sheets.js, which opens the always-open
// "Post a job" enquiry form (post-job-overlay, FirstJobly-style lead form).
// WhatsApp stays available as a secondary link inside that sheet.
function openVacancyLockedSheet() { openPostJobSheet(); }
function openEmployerLockedSheet() { openPostJobSheet(); }

// ----- Employer posters (swipeable poster feed) -----
var posterTotalCount = null;
function updatePosterStat() {
  var el = document.getElementById('stat-posters');
  if (el && posterTotalCount !== null) el.textContent = posterTotalCount;
}
async function getEmployerPosters() {
  var columns = 'id,employer_id,agency_id,image_url,caption,vacancy_id,created_at,expires_at';
  try {
    var result = await supabaseClient.from('employer_posters').select(columns, { count: 'exact' })
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(200);
    if (result.error) { console.error('getEmployerPosters', result.error); return []; }
    // Real total (not capped by the 50-row feed limit) for the home stat card.
    posterTotalCount = typeof result.count === 'number' ? result.count : (result.data || []).length;
    updatePosterStat();
    // The live count can differ from whatever was restored from cache —
    // re-sort in case it now belongs in a different spot (updateStats()'s
    // own sort already ran before this resolved, since this fetch is
    // deliberately deferred past the first paint).
    if (typeof reorderStatCardsByCount === 'function') reorderStatCardsByCount();
    // loadAll() fires loadPosterFeed() WITHOUT awaiting it (posters are
    // "non-critical to the first render"), then calls saveDataCache() on
    // the very next line — so the cache payload it writes is serialized
    // before this query has any chance to resolve, and posterTotalCount is
    // still null/stale at that point. Persisting the cache again here,
    // now that the real count is known, is what actually lets the NEXT
    // visit's instant-paint-from-cache pass restore a valid number instead
    // of null — without this, the earlier cache/restore plumbing had
    // nothing correct to save in the first place.
    if (typeof saveDataCache === 'function') saveDataCache();
    return result.data || [];
  } catch(e) { console.error('getEmployerPosters', e); return []; }
}

// ----- Vacancies -----
function parseVacancyClosingDate(value) {
  if (!value) return null;
  var s = String(value).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (m) {
    var months = { jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3, may:4, jun:5, june:5, jul:6, july:6, aug:7, august:7, sep:8, sept:8, september:8, oct:9, october:9, nov:10, november:10, dec:11, december:11 };
    var month = months[m[2].toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(+m[3], month, +m[1]));
  }
  return null;
}
function isVacancyExpired(v) {
  var closing = parseVacancyClosingDate(v && v.closing_date);
  if (!closing || isNaN(closing.getTime())) return false;
  var today = new Date();
  var todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return closing.getTime() < todayUtc;
}
function filterExpiredVacancies(rows) {
  return (rows || []).filter(function(v) { return !isVacancyExpired(v); });
}
async function getVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order';
  var pageSize = 1000;
  var rows = [];
  try {
    for (var offset = 0; ; offset += pageSize) {
      // General public vacancies are loaded lazily by the paginated directory
      // query below. Startup only needs agency/employer records for hub cards.
      var result = await supabaseClient.from('vacancies').select(columns)
        .or('agency_id.neq.general,employer_id.not.is.null')
        .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
      if (result.error) break;
      var page = result.data || [];
      rows = rows.concat(page);
      if (page.length < pageSize) return filterExpiredVacancies(rows);
    }
  } catch(e){}
  return filterExpiredVacancies(markLoadError(readLocal('vacancies')));
}
async function loadFeaturedVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order';
  try {
    var result = await supabaseClient.from('vacancies').select(columns)
      .eq('is_featured', true)
      .order('featured_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(12);
    if (result.error) throw result.error;
    featuredVacanciesCache = filterExpiredVacancies((result.data || []).filter(function(v){
      return !v.featured_until || new Date(v.featured_until).getTime() >= Date.now();
    }));
  } catch(e) {
    console.warn('featured vacancies load', e);
    if (!featuredVacanciesCache.length && window.__saStartupPayload && Array.isArray(window.__saStartupPayload.featured_vacancies)) {
      featuredVacanciesCache = filterExpiredVacancies(window.__saStartupPayload.featured_vacancies);
    }
  }
  if (typeof renderAllVacanciesList === 'function' && document.getElementById('screen-allvacancies') && document.getElementById('screen-allvacancies').classList.contains('active')) renderAllVacanciesList();
  return featuredVacanciesCache;
}
async function getEmployerVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type';
  var pageSize = 1000;
  var rows = [];
  try {
    for (var offset = 0; ; offset += pageSize) {
      var result = await supabaseClient.from('vacancies').select(columns)
        .not('employer_id', 'is', null)
        .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      var page = result.data || [];
      rows = rows.concat(page);
      if (page.length < pageSize) return filterExpiredVacancies(rows);
    }
  } catch(e) {
    console.warn('employer vacancies fetch', e);
    return [];
  }
}
async function getAgencyAdzunaVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type';
  try {
    var result = await supabaseClient.from('vacancies').select(columns)
      .eq('source_type', 'adzuna')
      .not('agency_id', 'is', null)
      .neq('agency_id', 'general')
      .is('employer_id', null)
      .order('created_at', { ascending: false }).limit(1000);
    if (result.error) throw result.error;
    return filterExpiredVacancies(result.data || []);
  } catch(e) {
    console.warn('agency Adzuna vacancies fetch', e);
    return [];
  }
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
      .or('source_type.is.null,source_type.not.in.(himalayas,adzuna,government,dpsa,retail,shoprite,picknpay,woolworths,truworths,spar,career_board,learnerships,careers_page)');
    if (result.error) return null;
    return typeof result.count === 'number' ? result.count : 0;
  } catch(e) { return null; }
}
// Fallback for when /api/startup is unreachable and loadAll() falls back to
// direct Supabase reads — mirrors the worker's per-folder counts (see
// DEDICATED_FOLDERS in Cloudflare-worker/worker.js) with 5 small indexed
// count queries instead of one big row fetch.
async function getDedicatedVacancyCounts() {
  var folders = { himalayas: ['himalayas'], adzuna: ['adzuna'], government: ['government','dpsa'], retail: ['retail','shoprite','picknpay','woolworths','truworths','spar'], learnerships: ['learnerships'], careers_page: ['careers_page'] };
  var out = { himalayas: 0, adzuna: 0, government: 0, retail: 0, learnerships: 0, careers_page: 0 };
  try {
    await Promise.all(Object.keys(folders).map(function(key){
      return supabaseClient.from('vacancies').select('id', { count: 'exact', head: true }).in('source_type', folders[key])
        .then(function(res){ if (typeof res.count === 'number') out[key] = res.count; });
    }));
  } catch(e) {}
  return out;
}
function isDedicatedVacancySource(sourceType) {
  return ['himalayas', 'adzuna', 'government', 'dpsa', 'retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar', 'career_board', 'learnerships', 'careers_page'].indexOf(String(sourceType || '').toLowerCase()) !== -1;
}
function isGeneralDirectoryVacancy(v) {
  return !!v && !v.employer_id && (!v.agency_id || v.agency_id === 'general') && !isDedicatedVacancySource(v.source_type);
}
function hasAssignedAgency(v) {
  // Dedicated external sources (Himalayas, Adzuna, DPSA, retail feeds) must
  // only ever appear in their own folder, never counted or listed as an
  // agency vacancy, even if agency_id was ever set on the row.
  return !!v && !!v.agency_id && v.agency_id !== 'general' && !isDedicatedVacancySource(v.source_type);
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
    // Dedicated external sources (Himalayas, Adzuna, DPSA, retail feeds) keep
    // their own folder as the single source of truth and must never be
    // re-tagged with an agency_id, or they leak into that agency's hub page
    // and the Agency Vacancies folder in addition to their own folder.
    if (!v || v.employer_id || v.agency_id && v.agency_id !== 'general' || isDedicatedVacancySource(v.source_type)) return;
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
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order';
  var from = page * generalVacancyPageSize;
  var query = supabaseClient.from('vacancies').select(columns)
    .or('agency_id.is.null,agency_id.eq.general')
    .is('employer_id', null)
    // Match the folder classification used by renderAllVacanciesList():
    // unassigned agency/government imports are general, while Himalayas,
    // Adzuna, DPSA, and retail feeds have dedicated folders.
    .or('source_type.is.null,source_type.not.in.(himalayas,adzuna,government,dpsa,retail,shoprite,picknpay,woolworths,truworths,spar,career_board,learnerships,careers_page)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + generalVacancyPageSize - 1);
  if (state.remote) query = query.eq('remote', state.remote);
  if (state.exp) query = query.eq('experience_level', state.exp);
  if (state.q) {
    var safe = state.q.replace(/[(),]/g, ' ').replace(/%/g, '').trim();
    if (safe) query = query.or('title.ilike.%' + safe + '%,company.ilike.%' + safe + '%,location.ilike.%' + safe + '%,notes.ilike.%' + safe + '%');
  }
  var result = await query;
  if (result.error) throw result.error;
  // Return raw pages so expired rows do not make a full page look like EOF.
  return result.data || [];
}
// Source-type groupings for the 5 dedicated-source folders, mirroring the
// classifier functions in renderAllVacanciesList() (isHimalayasVacancy etc.)
// and DEDICATED_FOLDERS in Cloudflare-worker/worker.js.
var DEDICATED_VACANCY_FOLDER_SOURCES = {
  himalayas: ['himalayas'],
  adzuna: ['adzuna'],
  government: ['government', 'dpsa'],
  retail: ['retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar'],
  learnerships: ['learnerships'],
  careers_page: ['careers_page']
};
// Each dedicated folder (Himalayas, Adzuna, Government, Retail,
// Learnerships) used to be a client-side filter over the fully-preloaded
// vacanciesCache. That cache no longer carries these ~8,700 rows (see
// worker.js loadStartupData), so each folder now fetches its own page
// directly, the same way fetchGeneralVacancyPage() already does.
async function fetchDedicatedVacancyPage(folder, state, page) {
  var sources = DEDICATED_VACANCY_FOLDER_SOURCES[folder];
  if (!sources) return [];
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order';
  var from = page * dedicatedVacancyPageSize;
  var query = supabaseClient.from('vacancies').select(columns)
    .in('source_type', sources)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + dedicatedVacancyPageSize - 1);
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

// Elapsed-time TTL expiry was removed: a vacancy is only ever considered
// gone once something has actually verified it's gone (currently
// scripts/verify-jobmail.mjs for Job Mail, which fetches each listing's
// own link and deletes on a real dead signal — 404/410, a redirect to a
// generic listing page, or matching "closed/filled/expired" wording).
// isVacancyExpired()/purgeExpiredVacancies() and the daily
// delete_expired_vacancies() Postgres job (see supabase/migrations) have
// both been retired — neither ever checked whether a listing was actually
// still live, only how old it was, which is exactly the guessing this
// removes. Sources with no real verification pass yet (manually-posted
// agency vacancies, Adzuna, Himalayas, DPSA, retail, Graduates24) are
// currently never auto-removed at all as a result — see the chat reply
// this shipped with for what that means and the options for closing that
// gap per source.

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
  if (payload.user_id) safePayload.user_id = payload.user_id;
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
//
// This holds the FULL dataset (every agency, branch, vacancy, employer) —
// easily hundreds of KB of JSON on an active install. localStorage's
// getItem/setItem are synchronous, so stringifying/parsing a payload that
// size blocks the main thread and can visibly jank the UI, especially on
// low-end phones. IndexedDB does the same job asynchronously, off the
// main thread, so it never blocks a render. We keep a tiny hand-rolled
// promise wrapper here rather than pulling in idb/Dexie as a dependency,
// since this is the only place in the app that needs it.
var DATA_CACHE_DB = 'sa_data_cache_db';
var DATA_CACHE_STORE = 'kv';
var DATA_CACHE_KEY = 'sa_data_cache_v1';
var lastDataRefreshAt = null;
var cachedVacancyTotal = null;

function openDataCacheDB() {
  return new Promise(function(resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var req = indexedDB.open(DATA_CACHE_DB, 1);
    req.onupgradeneeded = function() {
      if (!req.result.objectStoreNames.contains(DATA_CACHE_STORE)) req.result.createObjectStore(DATA_CACHE_STORE);
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}
async function idbGet(key) {
  var db = await openDataCacheDB();
  return new Promise(function(resolve, reject) {
    var req = db.transaction(DATA_CACHE_STORE, 'readonly').objectStore(DATA_CACHE_STORE).get(key);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}
async function idbSet(key, value) {
  var db = await openDataCacheDB();
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(DATA_CACHE_STORE, 'readwrite');
    tx.objectStore(DATA_CACHE_STORE).put(value, key);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
  });
}

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
async function saveDataCache() {
  var payload = {
    agencies: agenciesCache,
    branches: branchesCache,
    vacancies: vacanciesCache,
    generalVacancyCount: generalVacancyCount,
    vacancyTotal: (generalVacancyCountLoaded && dedicatedVacancyCountsLoaded)
      ? generalVacancyCount + vacanciesCache.length + dedicatedVacancyGrandTotal()
      : cachedVacancyTotal,
    employers: employersCache,
    poolCount: poolCandidateCount,
    posterCount: posterTotalCount,
    savedAt: Date.now()
  };
  try {
    await idbSet(DATA_CACHE_KEY, payload);
  } catch(e) {
    // IndexedDB unavailable (private-browsing lockdown, disabled, old
    // browser) — fall back to localStorage so nothing is lost, same as
    // the rest of this file's offline-write functions do.
    try { localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(payload)); } catch(e2) { /* storage full or unavailable — safe to skip */ }
  }
}
async function loadDataCache() {
  var d = null;
  try { d = await idbGet(DATA_CACHE_KEY); } catch(e) { /* IndexedDB unavailable — fall through */ }
  if (!d) {
    // One-time migration: older installs of this app have the cache in
    // localStorage. Pick it up once, move it into IndexedDB, and stop
    // touching localStorage for this key from then on.
    try {
      var raw = localStorage.getItem(DATA_CACHE_KEY);
      if (raw) {
        d = JSON.parse(raw);
        if (d) { idbSet(DATA_CACHE_KEY, d).catch(function(){}); localStorage.removeItem(DATA_CACHE_KEY); }
      }
    } catch(e) {}
  }
  if (!d || !Array.isArray(d.agencies)) return false;
  agenciesCache = d.agencies || [];
  branchesCache = d.branches || [];
  vacanciesCache = d.vacancies || [];
  generalVacancyCount = (typeof d.generalVacancyCount === 'number') ? d.generalVacancyCount : 0;
  cachedVacancyTotal = (typeof d.vacancyTotal === 'number') ? d.vacancyTotal : null;
  employersCache = d.employers || [];
  poolCandidateCount = (typeof d.poolCount === 'number') ? d.poolCount : 0;
  // Restore the cached poster total too, so the Posters stat card paints
  // instantly alongside the others instead of sitting on its placeholder
  // until the (deliberately deferred) live poster fetch resolves.
  if (typeof d.posterCount === 'number') posterTotalCount = d.posterCount;
  lastDataRefreshAt = (typeof d.savedAt === 'number') ? d.savedAt : null;
  return true;
}

var startupDataPromise = null;
async function fetchStartupDataOnce() {
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

function getStartupData() {
  if (startupDataPromise) return startupDataPromise;
  startupDataPromise = fetchStartupDataOnce();
  startupDataPromise.then(function(payload){
    if (!payload) startupDataPromise = null;
  }, function(){ startupDataPromise = null; });
  return startupDataPromise;
}
async function refreshSecondaryStartupData() {
  try {
    var employerRows = await getEmployerVacancies();
    var adzunaAgencyRows = await getAgencyAdzunaVacancies();
    var merged = (vacanciesCache || []).concat(employerRows || [], adzunaAgencyRows || []);
    var seen = {};
    vacanciesCache = sortVacancies(merged.filter(function(v) {
      if (!v || !v.id || seen[v.id]) return false;
      seen[v.id] = true;
      return !isGeneralDirectoryVacancy(v);
    }));
    matchVacanciesToAgencies(vacanciesCache, agenciesCache);
    filterAndRenderCached();
    saveDataCache();
  } catch(e) { console.warn('secondary startup refresh', e); }
  try {
    var liveGeneralCount = await getGeneralVacancyCount();
    if (typeof liveGeneralCount === 'number') {
      generalVacancyCount = liveGeneralCount;
      generalVacancyCountLoaded = true;
      updateStats();
      saveDataCache();
    }
  } catch(e) {}
}

// The Employer entry point on the sign-in gate (openEmployerGateSheet ->
// openEmployerForm) is reachable BEFORE Google sign-in, so
// publicEmployerRegistrationOpen can't wait for the normal loadAll(), which
// only ever runs after auth resolves (see bootAuthenticatedApp). Fetch just
// the public settings independently, immediately at page load — this is
// the same public, edge-cached /api/startup endpoint loadAll() itself uses.
(function loadPreAuthEmployerRegFlag() {
  getStartupData().then(function(startup) {
    if (startup && startup.settings) {
      publicEmployerRegistrationOpen = (startup.settings.public_employer_registration === true || startup.settings.public_employer_registration === 'true');
    }
  }).catch(function(){});
})();

async function loadAll() {
  setConnectionStatus(navigator.onLine ? 'loading' : 'offline', lastDataRefreshAt);
  if (navigator.onLine === false) {
    if (await loadDataCache()) {
      updateStats();
      filterAndRenderCached();
      if (typeof renderRestoredScreenContent === 'function') renderRestoredScreenContent();
    }
    setConnectionStatus('offline', lastDataRefreshAt);
    return;
  }
  // Prefer the edge-cached aggregate. If it is unavailable, preserve the
  // original independent Supabase reads so launch remains resilient.
  var startup = await getStartupData();
  window.__saStartupPayload = startup;
  if (startup && Array.isArray(startup.featured_vacancies)) {
    featuredVacanciesCache = filterExpiredVacancies(startup.featured_vacancies);
  }
  var results = startup ? [
    startup.agencies, startup.branches, startup.vacancies, startup.employers,
    // Prefer the worker's own counts.general (NULL-source rows + non-dedicated-
    // source rows, matching exactly what the General Vacancies tab shows).
    // The old (counts.vacancies - startup.vacancies.length) subtraction
    // assumed startup.vacancies only ever held "matched" rows, but it
    // actually also carries general-pool rows tagged with a scraper
    // source_type (careerjunction/jobmail/graduates24/etc. — anything not in
    // the worker's small "dedicated" list), which get filtered back out
    // downstream by isGeneralDirectoryVacancy(). Once the general pool is
    // mostly made of exactly those rows (as it is here), the subtraction
    // collapses toward zero and the displayed total undercounts by roughly
    // the size of the whole general pool. counts.general is computed
    // directly server-side and isn't subject to that drift. Fall back to the
    // old subtraction only for an older cached worker response that hasn't
    // rolled counts.general out yet.
    typeof startup.counts.general === 'number'
      ? startup.counts.general
      : (typeof startup.counts.vacancies === 'number'
          ? Math.max(0, startup.counts.vacancies - startup.vacancies.length) : null),
    startup.settings.public_vacancy_posting,
    startup.settings.public_employer_registration,
    startup.settings.public_employer_directory,
    typeof startup.counts.candidates === 'number' ? startup.counts.candidates : null,
    startup.counts.dedicated || null
  ] : await Promise.all([
    getAgencies(), getBranches(), getVacancies(), getEmployers(), getGeneralVacancyCount(),
    getAppSetting('public_vacancy_posting', 'false'),
    getAppSetting('public_employer_registration', 'false'),
    getAppSetting('public_employer_directory', 'true'),
    getPoolCandidateCount(),
    getDedicatedVacancyCounts()
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
    results[2] = filterExpiredVacancies(results[2]);
    matchVacanciesToAgencies(results[2], agenciesCache);
    vacanciesCache = sortVacancies(results[2].filter(function(v){
      // General-folder rows are loaded lazily. Do not retain them here or
      // updateStats() would add them a second time to generalVacancyCount.
      return !isGeneralDirectoryVacancy(v);
    }));
  }
  if (results[3].__loadError) { hadLoadError = true; } else { employersCache = results[3]; }
  if (typeof results[4] === 'number') { generalVacancyCount = results[4]; generalVacancyCountLoaded = true; }
  else if (results[4] === null) hadLoadError = true;
  // Not treated as a load error: the dedicated folder count badges are
  // cosmetic (they just label the folder cards), so a miss here shouldn't
  // trigger the retry banner the way a core data fetch failing would.
  if (results[9] && typeof results[9] === 'object') { dedicatedVacancyCounts = results[9]; dedicatedVacancyCountsLoaded = true; }
  if (generalVacancyCountLoaded && dedicatedVacancyCountsLoaded) {
    cachedVacancyTotal = generalVacancyCount + vacanciesCache.length + dedicatedVacancyGrandTotal();
  }
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
  // SECURITY: the old token backfill ("generate a token for every agency
  // without one") was removed. Anonymous browsers can no longer write
  // manage_token values, and public reads never see them — new tokens are
  // generated by the admin console (admin.html → Regenerate ALL tokens),
  // which uses the authenticated admin_set_manager_token RPC.
  rebuildPublicListingSlugs();
  updateStats();
  filterAndRenderCached();
  if (typeof renderRestoredScreenContent === 'function') renderRestoredScreenContent();
  loadFeaturedVacancies();
  if (startup) refreshSecondaryStartupData();
  // Candidate spotlight is non-critical; fetch it after the first useful home render.
  loadCandidateSpotlight();
  // Poster feed and first-party ads are non-critical to the first render.
  if (typeof loadPosterFeed === 'function') loadPosterFeed();
  loadHouseAds();
  saveDataCache();
  updatePostingToggleUI();
  updateEmployerRegUI();
  // If in manager mode, re-render the manager panel with fresh data
  if (managerMode) renderManagerMode();
  if (employerManagerMode) renderEmployerManagerMode();
  restoreTalentPoolMembership();
  if (typeof autoClaimGateRegistration === 'function') autoClaimGateRegistration();
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

function dedicatedVacancyGrandTotal() {
  var c = dedicatedVacancyCounts || {};
  return (c.himalayas||0) + (c.adzuna||0) + (c.government||0) + (c.retail||0) + (c.learnerships||0) + (c.careers_page||0);
}
function updateStats() {
  document.getElementById('stat-agencies').textContent = agenciesCache.length;
  updatePosterStat();
  var vacancyStat = document.getElementById('stat-vacancies');
  if (vacancyStat) {
    if (generalVacancyCountLoaded && dedicatedVacancyCountsLoaded) {
      vacancyStat.textContent = generalVacancyCount + vacanciesCache.length + dedicatedVacancyGrandTotal();
    } else if (typeof cachedVacancyTotal === 'number') {
      vacancyStat.textContent = cachedVacancyTotal;
    }
  }
  var statEmployers = document.getElementById('stat-employers');
  if (statEmployers) statEmployers.textContent = employersCache.length;
  var statPool = document.getElementById('stat-pool');
  if (statPool) statPool.textContent = poolLoaded ? poolCache.filter(function(c){ return (c.status || 'pending') === 'active'; }).length : poolCandidateCount;
  reorderStatCardsByCount();
}

// Keeps the home-screen stat cards (Agencies / Posters / Vacancies /
// Employers / Candidates) sorted so the highest count always leads,
// lowest trails — re-run every time updateStats() refreshes the numbers.
// Uses a lightweight FLIP animation (record position -> reorder the DOM ->
// offset back to the old spot -> animate to zero) so cards visibly glide
// into their new place instead of jumping.
function reorderStatCardsByCount() {
  var container = document.getElementById('home-stats');
  if (!container) return;
  var cards = Array.prototype.slice.call(container.querySelectorAll('.stat-card'));
  if (cards.length < 2) return;

  // FIRST: record where every card sits right now.
  var firstRects = cards.map(function(card) { return card.getBoundingClientRect(); });

  // Sort by count descending; ties keep their current relative order
  // (stable sort) so cards don't jitter on every refresh when unchanged.
  var withCounts = cards.map(function(card, i) {
    var valueEl = card.querySelector('.stat-value');
    var n = valueEl ? parseInt(valueEl.textContent, 10) : NaN;
    return { card: card, count: isNaN(n) ? -1 : n, i: i };
  });
  withCounts.sort(function(a, b) { return b.count - a.count || a.i - b.i; });

  // LAST: apply the new order to the real DOM.
  withCounts.forEach(function(entry) { container.appendChild(entry.card); });

  // INVERT + PLAY: nudge each moved card back to its old screen position
  // with no transition, then release it into a transitioned move to 0 —
  // the browser animates the slide for us.
  withCounts.forEach(function(entry) {
    var card = entry.card;
    var oldRect = firstRects[entry.i];
    var newRect = card.getBoundingClientRect();
    var dx = oldRect.left - newRect.left;
    if (Math.abs(dx) < 1) return; // didn't actually move — nothing to animate
    card.style.transition = 'none';
    card.style.transform = 'translateX(' + dx + 'px)';
    card.offsetWidth; // force a reflow so the browser registers the start position
    requestAnimationFrame(function() {
      card.style.transition = 'transform .45s cubic-bezier(.22,1,.36,1)';
      card.style.transform = '';
    });
    card.addEventListener('transitionend', function cleanup(e) {
      if (e.propertyName !== 'transform') return;
      card.style.transition = '';
      card.removeEventListener('transitionend', cleanup);
    });
  });
}

// ===== Live network stats (pre-paint) =====
// The home stat cards should show real figures as early as possible — the
// Worker's public /api/startup aggregate is fetched before the full data
// pipeline finishes and funnelled into the same cards updateStats() owns,
// so guests and signed-in users alike see live totals (the retired sign-in
// gate used to own this fetch; the open app now does).
function gateVacancyTotal(agencies, vacancies, counts) {
  // Platform-wide total: general pool + agency-attributed +
  // dedicated-source (DPSA/retail/Adzuna/…) rows. counts.vacancies is
  // exactly that, computed server-side; fall back to the general count,
  // then to counting non-general rows locally.
  if (counts && typeof counts.vacancies === 'number') return counts.vacancies;
  if (counts && typeof counts.general === 'number') return counts.general;
  var list = Array.isArray(vacancies) ? vacancies : [];
  var total = 0;
  for (var i = 0; i < list.length; i++) {
    if (typeof isGeneralDirectoryVacancy === 'function' && !isGeneralDirectoryVacancy(list[i])) total++;
  }
  return total;
}


function branchesFor(agencyId) { return branchesCache.filter(function(b){ return b.agency_id === agencyId; }); }
function vacanciesFor(agencyId) {
  // Adzuna rows explicitly assigned to an agency belong in that agency's
  // section as well as the Adzuna folder. Other dedicated feeds remain in
  // their dedicated folders unless explicitly handled by their own section.
  return sortVacancies(vacanciesCache.filter(function(v){
    return v.agency_id === agencyId && (String(v.source_type || '').toLowerCase() === 'adzuna' || !isDedicatedVacancySource(v.source_type));
  }));
}
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
