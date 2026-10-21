/*
 * SA Recruiters -- app.js split 2/8: app-data.js
 * Data layer: agencies, employers, branches, vacancies, app settings, daily track, local cache, loadAll()
 *
 * Part of the original monolithic app.js. Now an ES module: it imports what it
 * uses from the other app-*.js files and exports its top-level declarations.
 * A window bridge at the bottom keeps inline onclick="" handlers and the
 * classic scripts (app-vacancy-v2.js, app-alerts.js, content*.js) working.
 * Bundled by Vite via app-entry.js (see scripts/bundle-app.js).
 */

import { R2_WORKER_URL, STARTUP_DATA_URL, STATIC_DATA_URL, agenciesCache, branchesCache, dedicatedVacancyCounts, dedicatedVacancyCountsLoaded, dedicatedVacancyNextCursor, dedicatedVacancyPageSize, employerManagerMode, employerManagerPendingToken, employersCache, escapeHtml, generalVacancyCount, generalVacancyCountLoaded, generalVacancyNextCursor, generalVacancyPageSize, initials, isAdmin, managerMode, managerPendingToken, publicVacancyPostingOpen, rebuildPublicListingSlugs, set_agenciesCache, set_branchesCache, set_dedicatedVacancyCounts, set_dedicatedVacancyCountsLoaded, set_dedicatedVacancyNextCursor, set_employerDirectoryOpen, set_employerManagerPendingToken, set_employersCache, set_generalVacancyCount, set_generalVacancyCountLoaded, set_generalVacancyNextCursor, set_managerPendingToken, set_publicEmployerRegistrationOpen, set_publicVacancyPostingOpen, set_staticVacanciesCache, set_vacanciesCache, staticDataEnabled, staticVacanciesCache, supabaseClient, trackEvent, vacanciesCache } from './app-core.js';
import { autoClaimGateRegistration, filterAndRenderCached, loadPosterFeed, restoreTalentPoolMembership, verifiedBadge } from './app-cards.js';
import { getPoolCandidateCount, openPostJobSheet, poolCache, poolCandidateCount, poolLoaded, set_poolCandidateCount } from './app-sheets.js';
import { renderRestoredScreenContent, setRetryBanner, showToast, vacancyOverviewExtraRows } from './app-ui.js';
import { enterManagerMode, renderManagerMode, renderSmartManager } from './app-manager.js';
import { enterEmployerManagerMode, renderEmployerManagerMode } from './app-manager-employer.js';


// ===== Data: AGENCIES (live Supabase table that works) =====
// SECURITY NOTE: manage_token is intentionally NOT selected here. The column
// is revoked from the anon role (see
// supabase/migrations/20260918_lock_down_manager_tokens.sql) so public reads
// can never leak Smart Manager links. Token resolution happens server-side
// via the Worker's /api/verify-manager endpoint (see app-manager.js).
export async function getAgencies() {
  var startup = await getStartupData();
  if (startup && Array.isArray(startup.agencies)) return startup.agencies;
  return markLoadError([]);
}
// Persist a SMART MANAGER token so any device can resolve it (not just the
// browser that generated it). Token writes are privileged: signed-in admins
// go through the admin_set_manager_token RPC; the legacy direct update is
// kept as a fallback for deployments where the authenticated role still has
// the column grant. Anonymous visitors can no longer write tokens at all —
// that is the point of the lockdown migration.
export async function saveManagerTokenToSupabase(agencyId, token) {
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
export var D1_WRITE_THROUGH_COLUMNS = {
  agencies: ['id','name','website','contact','email','location','address','cvpref','photo','companies','trades','verified','created_at'],
  branches: ['id','agency_id','name','location','phone','email'],
  vacancies: ['id','agency_id','employer_id','title','company','company_photo','location','closing_date','notes','link','email','phone','remote','experience_level','employment_type','contract_type','work_schedule','hours','salary','start_date','created_at','updated_at','source_type','is_featured','featured_until','featured_order'],
  employers: ['id','name','industry','website','contact','email','location','address','photo','verified','created_at'],
  app_settings: ['key','value'],
  employer_posters: ['id','employer_id','agency_id','image_url','caption','vacancy_id','created_at','expires_at'],
  pool_candidates: ['id','full_name','position','sector','location','experience_years','about_you','photo_url','verified','status','created_at']
};
export async function writeThroughD1Mirror(table, value, operation) {
  if (!isAdmin || !supabaseClient || !R2_WORKER_URL) return false;
  try {
    var sessionResult = await supabaseClient.auth.getSession();
    var token = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
    if (!token) return false;
    var requests = [];
    if (operation === 'delete') {
      var ids = Array.isArray(value) ? value : [value];
      for (var i = 0; i < ids.length; i += 200) requests.push({ operation: 'delete', table: table, ids: ids.slice(i, i + 200) });
    } else {
      var sourceRows = Array.isArray(value) ? value : [value];
      var allowed = D1_WRITE_THROUGH_COLUMNS[table] || [];
      var rows = sourceRows.map(function(row) {
        var safe = {};
        if (row && typeof row === 'object') allowed.forEach(function(column) {
          if (Object.prototype.hasOwnProperty.call(row, column)) safe[column] = row[column];
        });
        return safe;
      });
      for (var j = 0; j < rows.length; j += 100) requests.push({ operation: 'upsert', table: table, rows: rows.slice(j, j + 100) });
    }
    var lastVersion = null;
    for (var k = 0; k < requests.length; k++) {
      var response = await fetch(R2_WORKER_URL + '/api/admin/d1/write-through', {
        method: 'POST', cache: 'no-store',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(requests[k])
      });
      var result = await response.json().catch(function(){ return null; });
      if (!response.ok || !result || result.ok !== true) {
        console.warn('D1 write-through failed after Supabase save', table, result && result.error || response.status);
        if (typeof showToast === 'function') showToast('Saved, but live public data could not be refreshed yet.');
        return false;
      }
      if (typeof result.data_version === 'number') lastVersion = result.data_version;
    }
    window.__saLastD1DataVersion = lastVersion;
    startupDataPromise = null;
    startupDataSource = '';
    startupDataResolved = false;
    window.__saStartupPayload = null;
    window.__saStaticData = null;
    publicPoolStartupPromise = null;
    candidateSpotlightLoaded = false;
    return requests.length > 0;
  } catch (error) { console.warn('D1 write-through unavailable after Supabase save', table, error); return false; }
}

export async function upsertAgency(a) {
  var safe = Object.assign({}, a);
  var mutation = supabaseClient.from('agencies').upsert(safe);
  var result = isAdmin ? await mutation.select('*').single() : await mutation;
  if (!result.error) {
    if (isAdmin) await writeThroughD1Mirror('agencies', Object.assign({}, safe, result.data || {}));
    return;
  }
  var msg = (result.error.message || '') + ' ' + (result.error.hint || '') + ' ' + JSON.stringify(result.error.details || '');
  if (/trades/i.test(msg)) {
    var safeNoTrades = Object.assign({}, a); delete safeNoTrades.trades;
    var retryMutation = supabaseClient.from('agencies').upsert(safeNoTrades);
    var retry = isAdmin ? await retryMutation.select('*').single() : await retryMutation;
    if (retry.error) { console.error('agency save', retry.error); alert('Could not save. Check your Supabase setup.'); }
    else {
      if (isAdmin) await writeThroughD1Mirror('agencies', Object.assign({}, safeNoTrades, retry.data || {}));
      console.warn('Saved agency, but the `trades` column is missing — run ADD_TRADES_COLUMN.sql so trades persist.');
    }
    return;
  }
  console.error('agency save', result.error); alert('Could not save. Check your Supabase setup.');
}
export async function removeAgency(id) {
  var { error } = await supabaseClient.from('agencies').delete().eq('id', id);
  if (error) { console.error('agency delete', error); alert('Could not delete. Check your Supabase setup.'); return; }
  if (isAdmin) await writeThroughD1Mirror('agencies', id, 'delete');
}
/* ── Data: EMPLOYERS ──────────────────────────────────
   Companies that register directly and post their own vacancies (separate
   from the recruitment-agency directory). Same try-Supabase-then-fall-back
   pattern as branches/vacancies, so this works immediately even before the
   `employers` table + `employer_id` vacancies column are created — run
   CREATE_EMPLOYERS_TABLE.sql in the Supabase SQL Editor to make it live. */
export async function getEmployers() {
  var startup = await getStartupData();
  if (startup && Array.isArray(startup.employers)) return startup.employers;
  return markLoadError([]);
}
// ===== First-party house ads =====
export var houseAdsCache = [];
export function safeHouseAdUrl(value) {
  try {
    var url = new URL(String(value || ''), window.location.href);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch(e) { return ''; }
}
export function houseAdPlacementMatches(ad, placement, slot) {
  var targets = Array.isArray(ad && ad.target_screens) ? ad.target_screens : null;
  var screenMatch = targets && targets.length ? targets.indexOf(placement) !== -1 : (ad && (ad.placement === placement || ad.placement === 'directories'));
  return !!ad && screenMatch && (ad.ad_slot || 'top') === slot;
}
export function renderHouseAdSlot(targetId, placement, slot) {
  var target = document.getElementById(targetId);
  if (!target) return;
  var ad = (houseAdsCache || []).filter(function(item){ return houseAdPlacementMatches(item, placement, slot || 'top'); })[0];
  var imageUrl = ad && safeHouseAdUrl(ad.image_url);
  var targetUrl = ad && safeHouseAdUrl(ad.target_url);
  if (!ad || !imageUrl || !targetUrl) { target.hidden = true; target.innerHTML = ''; return; }
  target.hidden = false;
  var isRolazAd = /rolaz/i.test(String(ad.advertiser_name || '') + ' ' + String(ad.title || ''));
  var motionOverlay = isRolazAd ? '<span class="house-ad-bulb-glow" aria-hidden="true"></span><span class="house-ad-bulb-core" aria-hidden="true"></span><span class="house-ad-spark" aria-hidden="true"></span><span class="house-ad-tester-flicker" aria-hidden="true"></span>' : '';
  target.innerHTML = '<a class="house-ad-card" href="' + escapeHtml(targetUrl) + '" target="_blank" rel="noopener sponsored" onclick="trackHouseAdEvent(\'' + escapeHtml(ad.id) + '\',\'click\')">' +
    '<div class="house-ad-heading"><strong>' + escapeHtml(ad.title || ad.advertiser_name || '') + '</strong></div>' +
    '<div class="house-ad-creative">' +
      '<img loading="lazy" decoding="async" width="1200" height="400" src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(ad.title || ad.advertiser_name || 'Sponsored promotion') + '" onerror="this.closest(\'.house-ad-slot\').hidden=true">' +
      motionOverlay +
    '</div>' +
    '<div class="house-ad-message"><small><span class="house-ad-message-copy">' + escapeHtml(ad.message || ((ad.title || ad.advertiser_name || '').toLowerCase().includes('rolaz') ? 'Keeping your home brighter' : '')) + '</span><span class="house-ad-sponsored">Sponsored</span></small></div>' +
  '</a>';
  trackHouseAdEvent(ad.id, 'impression');
}
export function renderHouseAdSlots() {
  renderHouseAdSlot('house-ad-home-middle', 'home', 'middle');
  renderHouseAdSlot('house-ad-home-bottom', 'home', 'bottom');
  renderHouseAdSlot('house-ad-agencies-top', 'agencies', 'top');
  renderHouseAdSlot('house-ad-agencies-middle', 'agencies', 'middle');
  renderHouseAdSlot('house-ad-agencies-bottom', 'agencies', 'bottom');
  renderHouseAdSlot('house-ad-employers-top', 'employers', 'top');
  renderHouseAdSlot('house-ad-employers-middle', 'employers', 'middle');
  renderHouseAdSlot('house-ad-employers-bottom', 'employers', 'bottom');
  renderHouseAdSlot('house-ad-candidates-top', 'candidates', 'top');
  renderHouseAdSlot('house-ad-candidates-middle', 'candidates', 'middle');
  renderHouseAdSlot('house-ad-candidates-bottom', 'candidates', 'bottom');
  renderHouseAdSlot('house-ad-posters-top', 'posters', 'top');
  renderHouseAdSlot('house-ad-posters-middle', 'posters', 'middle');
  renderHouseAdSlot('house-ad-posters-bottom', 'posters', 'bottom');
}
export async function loadHouseAds() {
  // Served by the Cloudflare Worker (edge-cached), never a direct browser
  // read of Supabase. Failures leave the slots hidden.
  try {
    var response = await fetch(R2_WORKER_URL + '/api/house-ads', { headers: { Accept: 'application/json' } });
    var data = response.ok ? await response.json() : null;
    houseAdsCache = data && Array.isArray(data.ads) ? data.ads : [];
  } catch (e) {
    houseAdsCache = [];
  }
  renderHouseAdSlots();
}
export function trackHouseAdEvent(id, eventName) {
  if (!id || ['impression','click'].indexOf(eventName) === -1) return;
  var key = 'sa_house_ad_' + eventName + '_' + id;
  if (eventName === 'impression') {
    try { if (sessionStorage.getItem(key) === '1') return; sessionStorage.setItem(key, '1'); } catch(e) {}
  }
  try {
    fetch(R2_WORKER_URL + '/api/house-ads/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, event: eventName }), keepalive: true
    }).catch(function(){});
  } catch(e) {}
}

export async function getManagedPosters() {
  // Managed campaign posters are not part of the D1 mirror yet. Keep this
  // public bundle Cloudflare-only rather than issuing a Supabase fallback.
  return [];
}
export function renderManagedPoster(poster, targetId) {
  var target = document.getElementById(targetId);
  if (!target) return;
  if (!poster || !poster.image_url) { target.hidden = true; target.innerHTML = ''; return; }
  target.hidden = false;
  target.innerHTML = '<img loading="lazy" decoding="async" src="'+escapeHtml(poster.image_url)+'" alt="'+escapeHtml(poster.title || '')+'" onerror="this.closest(\'.managed-poster\').hidden=true">' +
    ((poster.title || poster.subtitle) ? '<div class="managed-poster-copy">'+(poster.title?'<strong>'+escapeHtml(poster.title)+'</strong>':'')+(poster.subtitle?'<span>'+escapeHtml(poster.subtitle)+'</span>':'')+'</div>' : '');
}
export function renderManagedPosters(posters) {
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
  target.innerHTML = '<article class="managed-poster poster-page-card"><img loading="lazy" decoding="async" src="'+escapeHtml(p.image_url)+'" alt="'+escapeHtml(p.title || label+' campaign poster')+'" onerror="this.closest(\'.poster-page-card\').remove()">'+
    '<div class="managed-poster-copy"><strong>'+escapeHtml(p.title || label)+'</strong>'+(p.subtitle?'<span>'+escapeHtml(p.subtitle)+'</span>':'')+'</div></article>';
}

// ===== HOME SCREEN CANDIDATE SPOTLIGHT =====
// Advertises real Talent Pool candidates on the home CTA carousel: their
// square profile photo, name, and position/experience heading. Pulled
// straight from pool_candidates (no separate admin upload needed) —
// tapping a card sends the visitor to the full Talent Pool for the
// complete Mini-CV. RLS only ever returns status = 'active' rows to
// anonymous visitors, but the status filter below is defense-in-depth.
export var publicPoolStartupPromise = null;
export async function getPublicPoolCandidatesFromWorker() {
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
export var candidateSpotlightLoaded = false;
export var candidateSpotlightList = [];
export async function loadCandidateSpotlight() {
  var menuTarget = document.getElementById('candidate-spotlight-deck');
  var homeTarget = document.getElementById('home-candidate-spotlight-deck');
  if (!menuTarget && !homeTarget) return;
  if (candidateSpotlightLoaded) {
    renderCandidateSpotlight(candidateSpotlightList, menuTarget, homeTarget);
    return;
  }
  var list = [];
  try {
    var startup = await getPublicPoolCandidatesFromWorker();
    if (startup && Array.isArray(startup.pool_candidates)) {
      list = startup.pool_candidates.filter(function(c){ return (c.status || 'pending') === 'active'; }).slice(0, 12);
    }
  } catch (e) { console.warn('candidate spotlight load', e); list = []; }
  // Keep photo profiles ahead of no-photo profiles. Within those groups, keep
  // complete profiles ahead of partial profiles. A profile is considered
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
    var aPhoto = String(a.photo_url || '').trim() ? 1 : 0;
    var bPhoto = String(b.photo_url || '').trim() ? 1 : 0;
    if (aPhoto !== bPhoto) return bPhoto - aPhoto;
    var aScore = spotlightCompleteness(a), bScore = spotlightCompleteness(b);
    var aComplete = aScore === 6, bComplete = bScore === 6;
    if (aComplete !== bComplete) return aComplete ? -1 : 1;
    if (aScore !== bScore) return bScore - aScore;
    if ((b.verified?1:0) !== (a.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
  candidateSpotlightList = list.slice(0, 10);
  candidateSpotlightLoaded = true;
  renderCandidateSpotlight(candidateSpotlightList, menuTarget, homeTarget);
}
export function renderCandidateSpotlight(list, menuTarget, homeTarget) {
  var targets = [menuTarget || document.getElementById('candidate-spotlight-deck'), homeTarget || document.getElementById('home-candidate-spotlight-deck')].filter(Boolean);
  if (!targets.length) return;
  if (!list.length) {
    targets.forEach(function(target) { target.innerHTML = '<div class="poster-empty">Candidates will appear here as people join the Talent Pool.</div>'; });
    return;
  }
  var markup = list.map(function(c) {
    var expText = (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '')
      ? (c.experience_years >= 10 ? '10+ yrs exp' : c.experience_years + ' yrs exp')
      : '';
    var role = c.position || 'Open to opportunities';
    var location = c.location || 'South Africa';
    var expText = (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '')
      ? (c.experience_years >= 10 ? '10+ yrs experience' : c.experience_years + ' yrs experience')
      : '';
    return '<button type="button" class="spotlight-card" data-ripple onclick="goPool(\'profile\',\''+escapeHtml(c.id)+'\')">' +
      (c.photo_url ? '<span class="spotlight-photo"><img loading="lazy" decoding="async" src="'+escapeHtml(c.photo_url)+'" alt="'+escapeHtml(c.full_name||'Candidate')+'"></span>' : '<span class="spotlight-photo spotlight-initials">'+initials(c.full_name)+'</span>') +
      '<span class="spotlight-copy"><strong>'+escapeHtml(c.full_name||'Candidate')+(c.verified?' ' + verifiedBadge('Screened &amp; Verified') + '':'')+'</strong>' +
      '<span class="spotlight-role">'+escapeHtml(role)+'</span><span class="spotlight-location">'+escapeHtml(location)+'</span>' +
      '<span class="spotlight-view">View profile <span aria-hidden="true">→</span></span></span></button>';
  }).join('') + '<button type="button" class="spotlight-card spotlight-more" data-ripple onclick="goPool(\'profile\')"><span class="spotlight-more-copy">View full<br>Talent Pool</span></button>';
  targets.forEach(function(target) { target.innerHTML = markup; });
}

export async function upsertEmployer(e) {
  try {
    var mutation = supabaseClient.from('employers').upsert(e);
    var result = isAdmin ? await mutation.select('*').single() : await mutation;
    if (!result.error) {
      if (isAdmin) await writeThroughD1Mirror('employers', Object.assign({}, e, result.data || {}));
      return true;
    }
  } catch(err){}
  var arr = readLocal('employers');
  var i = arr.findIndex(function(x){ return x.id === e.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], e); else arr.push(e);
  writeLocal('employers', arr);
  return false;
}
export async function removeEmployer(id) {
  try {
    var result = await supabaseClient.from('employers').delete().eq('id', id);
    if (!result.error && isAdmin) await writeThroughD1Mirror('employers', id, 'delete');
  } catch(err){}
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
export function localKey(kind) { return 'sa_' + kind + '_local'; }
export function readLocal(kind) {
  try { return JSON.parse(localStorage.getItem(localKey(kind)) || '[]'); } catch(e){ return []; }
}
export function writeLocal(kind, arr) {
  try { localStorage.setItem(localKey(kind), JSON.stringify(arr)); } catch(e){ console.warn('storage full', e); }
}

// ----- Branches -----
export async function getBranches() {
  var startup = await getStartupData();
  if (startup && Array.isArray(startup.branches)) return startup.branches;
  return markLoadError([]);
}
export async function upsertBranch(b) {
  try {
    var mutation = supabaseClient.from('branches').upsert(b);
    var result = isAdmin ? await mutation.select('*').single() : await mutation;
    if (!result.error) {
      if (isAdmin) await writeThroughD1Mirror('branches', Object.assign({}, b, result.data || {}));
      return true;
    }
  } catch(e){}
  var arr = readLocal('branches');
  var i = arr.findIndex(function(x){ return x.id === b.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], b); else arr.push(b);
  writeLocal('branches', arr);
  return false;
}
export async function removeBranch(id) {
  try {
    var result = await supabaseClient.from('branches').delete().eq('id', id);
    if (!result.error && isAdmin) await writeThroughD1Mirror('branches', id, 'delete');
  } catch(e){}
  var arr = readLocal('branches').filter(function(x){ return x.id !== id; });
  writeLocal('branches', arr);
}
// ----- App settings (admin-controlled, e.g. public vacancy posting toggle) -----
export async function getAppSetting(key, fallback) {
  try {
    var startup = await getStartupData();
    var settings = startup && startup.settings;
    return settings && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
  } catch(e) { return fallback; }
}
export async function setAppSetting(key, value) {
  try {
    var mutation = supabaseClient.from('app_settings').upsert({ key: key, value: value, updated_at: new Date().toISOString() });
    var result = isAdmin ? await mutation.select('key,value').single() : await mutation;
    if (result.error) return false;
    if (isAdmin) await writeThroughD1Mirror('app_settings', Object.assign({ key: key, value: value }, result.data || {}));
    return true;
  } catch(e) { return false; }
}
export async function loadPostingSetting() {
  var v = await getAppSetting('public_vacancy_posting', 'false');
  set_publicVacancyPostingOpen( (v === true || v === 'true'));
  updatePostingToggleUI();
}
export function updatePostingToggleUI() {
  var input = document.getElementById('posting-toggle-input');
  if (input) input.checked = !!publicVacancyPostingOpen;
  var sub = document.getElementById('posting-toggle-sub');
  if (sub) sub.textContent = publicVacancyPostingOpen ? 'Open — anyone can post right now' : 'Closed — spam protected';
}
export async function loadEmployerRegSetting() {
  var v = await getAppSetting('public_employer_registration', 'false');
  set_publicEmployerRegistrationOpen( (v === true || v === 'true'));
}

/* ===== Home Media ===== */
export var DEFAULT_MEDIA_YOUTUBE_URL = 'https://youtu.be/HV64XG91tE4';
export var mediaYoutubeUrl = DEFAULT_MEDIA_YOUTUBE_URL;

export function youtubeEmbedUrl(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  try {
    var url = new URL(raw);
    var id = '';
    if (url.hostname === 'youtu.be') id = url.pathname.replace(/^\//, '').split('/')[0];
    else if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com' || url.hostname === 'm.youtube.com') {
      id = url.searchParams.get('v') || (url.pathname.indexOf('/shorts/') === 0 ? url.pathname.split('/')[2] : '');
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id || '')) return '';
    return 'https://www.youtube.com/embed/' + id + '?rel=0';
  } catch (e) { return ''; }
}

export function renderHomeMediaSection() {
  var section = document.getElementById('home-media-section');
  var frame = document.getElementById('home-media-video');
  if (!section || !frame) return;
  var embed = youtubeEmbedUrl(mediaYoutubeUrl);
  if (!embed) {
    section.hidden = true;
    frame.removeAttribute('src');
    return;
  }
  section.hidden = false;
  if (frame.getAttribute('src') !== embed) frame.setAttribute('src', embed);
}

export async function loadMediaSetting() {
  var value = await getAppSetting('media_youtube_url', DEFAULT_MEDIA_YOUTUBE_URL);
  mediaYoutubeUrl = youtubeEmbedUrl(value) ? String(value).trim() : DEFAULT_MEDIA_YOUTUBE_URL;
  renderHomeMediaSection();
}

/* ===== Track of the Day =====
   Reads the newest track published within the seven-day retention window from
   the `daily_tracks` table (Supabase). This keeps an uploaded track available
   to visitors for at least seven days instead of showing it only on its upload
   date. The audio file is served from the `daily-tracks` storage bucket. */
export var TRACKS_PUBLIC_BASE_URL = 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev';
export var todayTrack = null;       // {id,title,artist,track_date,file_url,spotify_url}
export var trackAudio = null;       // <audio> element
export var trackIsPlaying = false;

export function todayISO() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export async function loadTodayTrack() {
  try {
    var today = todayISO();
    var cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 7);
    var cutoffISO = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    var { data, error } = await supabaseClient
      .from('daily_tracks')
      .select('id,title,artist,track_date,file_url,file_path,spotify_url')
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

export function renderTrackEmpty() {
  var card = document.getElementById('track-card');
  var info = document.getElementById('track-info');
  var btn = document.getElementById('track-play');
  var homeBtn = document.getElementById('home-media-track-play');
  var spotifyBtn = document.getElementById('track-spotify');
  var homeSpotifyBtn = document.getElementById('home-media-track-spotify');
  if (card) card.classList.remove('has-track', 'playing');
  if (info) info.classList.add('track-empty');
  var t = document.getElementById('track-title');
  var a = document.getElementById('track-artist');
  if (t) t.textContent = 'No track today';
  if (a) a.textContent = 'Check back tomorrow for a fresh pick';
  if (btn) btn.disabled = true;
  var homeTitle = document.getElementById('home-media-track-title');
  var homeArtist = document.getElementById('home-media-track-artist');
  if (homeTitle) homeTitle.textContent = 'No track today';
  if (homeArtist) homeArtist.textContent = 'Check back tomorrow for a fresh pick';
  if (homeBtn) { homeBtn.disabled = true; homeBtn.setAttribute('aria-label', 'Play Track of the Day'); }
  if (spotifyBtn) spotifyBtn.hidden = true;
  if (homeSpotifyBtn) homeSpotifyBtn.hidden = true;
  var prog = document.getElementById('track-progress');
  if (prog) prog.style.display = 'none';
}

export function renderTrackReady() {
  if (!todayTrack) { renderTrackEmpty(); return; }
  var card = document.getElementById('track-card');
  var info = document.getElementById('track-info');
  var btn = document.getElementById('track-play');
  var homeBtn = document.getElementById('home-media-track-play');
  var spotifyBtn = document.getElementById('track-spotify');
  var homeSpotifyBtn = document.getElementById('home-media-track-spotify');
  if (card) card.classList.add('has-track');
  if (info) info.classList.remove('track-empty');
  var t = document.getElementById('track-title');
  var a = document.getElementById('track-artist');
  if (t) t.textContent = todayTrack.title || 'Today\'s track';
  if (a) a.textContent = todayTrack.artist || '';
  if (btn) btn.disabled = false;
  var homeTitle = document.getElementById('home-media-track-title');
  var homeArtist = document.getElementById('home-media-track-artist');
  if (homeTitle) homeTitle.textContent = todayTrack.title || 'Today\'s track';
  if (homeArtist) homeArtist.textContent = todayTrack.artist || '';
  if (homeBtn) homeBtn.disabled = !todayTrack.file_url;
  if (spotifyBtn) { spotifyBtn.hidden = !todayTrack.spotify_url; if (todayTrack.spotify_url) spotifyBtn.href = todayTrack.spotify_url; }
  if (homeSpotifyBtn) { homeSpotifyBtn.hidden = !todayTrack.spotify_url; if (todayTrack.spotify_url) homeSpotifyBtn.href = todayTrack.spotify_url; }
  // Keep the media element source-free until explicit play intent. Assigning
  // src plus load() here eagerly downloads multi-megabyte audio on startup.
  trackAudio = document.getElementById('track-audio');
}

export function toggleTrackPlay() {
  if (!todayTrack || !trackAudio || !todayTrack.file_url) return;
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

export function updateTrackPlayButtons() {
  var iconPath = trackIsPlaying ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M8 5v14l11-7z';
  var label = trackIsPlaying ? 'Pause Track of the Day' : 'Play Track of the Day';
  ['track-play', 'home-media-track-play'].forEach(function(id) {
    var button = document.getElementById(id);
    if (!button) return;
    button.setAttribute('aria-label', label);
    var svg = button.querySelector('svg');
    if (svg) svg.innerHTML = '<path d="' + iconPath + '"/>';
  });
}

export function onTrackLoaded() {
  // metadata loaded — nothing needed yet
}

export function updateTrackProgress() {
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

export function onTrackEnded() {
  trackIsPlaying = false;
  var card = document.getElementById('track-card');
  var icon = document.getElementById('track-play-icon');
  if (card) card.classList.remove('playing');
  if (icon) icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  updateTrackPlayButtons();
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
    updateTrackPlayButtons();
  }
}, true);
document.addEventListener('pause', function(e){
  if (e.target && e.target.id === 'track-audio') {
    trackIsPlaying = false;
    var card = document.getElementById('track-card');
    var icon = document.getElementById('track-play-icon');
    if (card) card.classList.remove('playing');
    if (icon) icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    updateTrackPlayButtons();
  }
}, true);
export async function togglePublicPosting(checked) {
  var ok = await setAppSetting('public_vacancy_posting', checked ? 'true' : 'false');
  if (ok) {
    set_publicVacancyPostingOpen( checked);
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
export function openVacancyLockedSheet() { openPostJobSheet(); }
export function openEmployerLockedSheet() { openPostJobSheet(); }

// ----- Employer posters (swipeable poster feed) -----
export var posterTotalCount = null;
export function updatePosterStat() {
  var el = document.getElementById('stat-posters');
  if (el && posterTotalCount !== null) el.textContent = posterTotalCount;
}
export async function getEmployerPosters() {
  try {
    var response = await fetch(R2_WORKER_URL + '/api/posters', {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Poster Worker request failed');
    var payload = await response.json();
    var data = Array.isArray(payload.posters) ? payload.posters : [];
    // Real total (not capped by the 50-row feed limit) for the home stat card.
    posterTotalCount = typeof payload.count === 'number' ? payload.count : data.length;
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
    return data;
  } catch(e) { console.error('getEmployerPosters', e); return []; }
}

// ----- Vacancies -----
export function parseVacancyClosingDate(value) {
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
export function isVacancyExpired(v) {
  var closing = parseVacancyClosingDate(v && v.closing_date);
  if (!closing || isNaN(closing.getTime())) return false;
  var today = new Date();
  var todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return closing.getTime() < todayUtc;
}
export function filterExpiredVacancies(rows) {
  return (rows || []).filter(function(v) { return !isVacancyExpired(v); });
}
export async function getVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order';
  var pageSize = 1000;
  var rows = [];
  // Public vacancy reads are served by the Cloudflare Worker (D1/R2). Never
  // fall back to an unbounded browser-side PostgREST scan if that path is
  // unavailable; authenticated manager/admin writes remain below unchanged.
  return filterExpiredVacancies(markLoadError(readLocal('vacancies')));
}
export async function getEmployerVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type';
  var pageSize = 1000;
  // Employer vacancy browsing is public and must stay on the bounded Worker
  // API; do not reintroduce a direct PostgREST table scan here.
  return [];
}
export async function getAgencyAdzunaVacancies() {
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type';
  // Public source pages use fetchVacancyPageFromWorker() below.
  return [];
}
export async function getGeneralVacancyCount() {
  // Counts come from /api/startup, backed by D1. A failed Worker request must
  // not turn into a public PostgREST count request.
  return null;
}
// Fallback for when /api/startup is unreachable and loadAll() falls back to
// direct Supabase reads — mirrors the worker's per-folder counts (see
// DEDICATED_FOLDERS in Cloudflare-worker/worker.js) with 5 small indexed
// count queries instead of one big row fetch.
export async function getDedicatedVacancyCounts() {
  var folders = { himalayas: ['himalayas'], adzuna: ['adzuna'], government: ['government','dpsa'], retail: ['retail','shoprite','picknpay','woolworths','truworths','spar'], learnerships: ['learnerships'], careers_page: ['careers_page'] };
  var out = { himalayas: 0, adzuna: 0, government: 0, retail: 0, learnerships: 0, careers_page: 0 };
  return null;
}
export function isDedicatedVacancySource(sourceType) {
  return ['himalayas', 'adzuna', 'government', 'dpsa', 'retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar', 'career_board', 'learnerships', 'careers_page'].indexOf(String(sourceType || '').toLowerCase()) !== -1;
}
export function isGeneralDirectoryVacancy(v) {
  return !!v && !v.employer_id && (!v.agency_id || v.agency_id === 'general') && !isDedicatedVacancySource(v.source_type);
}
export function hasAssignedAgency(v) {
  // Dedicated external sources (Himalayas, Adzuna, DPSA, retail feeds) must
  // only ever appear in their own folder, never counted or listed as an
  // agency vacancy, even if agency_id was ever set on the row.
  return !!v && !!v.agency_id && v.agency_id !== 'general' && !isDedicatedVacancySource(v.source_type);
}
export function normalizeAgencyMatchText(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function matchVacanciesToAgencies(rows, agencies) {
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
export function generalVacancyQueryState() {
  return {
    q: ((document.getElementById('allvacancies-search')||{}).value || '').trim(),
    remote: ((document.getElementById('allvacancies-remote')||{}).value || ''),
    exp: ((document.getElementById('allvacancies-exp')||{}).value || '')
  };
}
export function generalVacancyQueryKeyFor(state) {
  return [state.q, state.remote, state.exp].join('|').toLowerCase();
}
export async function fetchVacancyPageFromWorker(params) {
  if (R2_WORKER_URL) {
    try {
      var url = new URL(R2_WORKER_URL + '/api/vacancies');
      Object.keys(params || {}).forEach(function(key) {
        var value = params[key];
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      });
      var response = await fetch(url.toString(), { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.ok) {
        var payload = await response.json();
        if (payload && Array.isArray(payload.vacancies)) return payload;
      }
    } catch(e) {}
  }
  if (window.__saStaticData) {
    var sourceNames = params && params.source ? String(params.source).split(',') : null;
    var rows = (staticVacanciesCache || []).filter(function(v) {
      if (sourceNames && sourceNames.length && sourceNames.indexOf(String(v.source_type || '')) === -1) return false;
      if (params.scope === 'general' && !isGeneralDirectoryVacancy(v)) return false;
      if (params.location && String(v.location || '').toLowerCase().indexOf(String(params.location).toLowerCase()) === -1) return false;
      if (params.remote && String(v.remote || '') !== String(params.remote)) return false;
      if (params.experience && String(v.experience_level || '') !== String(params.experience)) return false;
      if (params.q && [v.title, v.company, v.location, v.notes].join(' ').toLowerCase().indexOf(String(params.q).toLowerCase()) === -1) return false;
      return !isVacancyExpired(v);
    });
    rows.sort(function(a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0) || String(b.id).localeCompare(String(a.id)); });
    var limit = Number(params.limit) || 30;
    var offset = Number(params.cursor) || 0;
    return { vacancies: rows.slice(offset * limit, (offset + 1) * limit), next_cursor: (offset + 1) * limit < rows.length ? String(offset + 1) : null, total: rows.length };
  }
  return null;
}
export async function fetchGeneralVacancyPage(state, page) {
  var workerPage = await fetchVacancyPageFromWorker({
    scope: 'general', q: state.q, remote: state.remote, experience: state.exp,
    limit: generalVacancyPageSize, cursor: page > 0 ? generalVacancyNextCursor : ''
  });
  if (workerPage) {
    set_generalVacancyNextCursor( workerPage.next_cursor || null);
    return workerPage.vacancies;
  }
  var from = page * generalVacancyPageSize;
  // The Worker owns public vacancy serving and caps each response. Do not
  // fall back to a direct PostgREST page when it is unavailable.
  return [];
}
// Source-type groupings for the 5 dedicated-source folders, mirroring the
// classifier functions in renderAllVacanciesList() (isHimalayasVacancy etc.)
// and DEDICATED_FOLDERS in Cloudflare-worker/worker.js.
export var DEDICATED_VACANCY_FOLDER_SOURCES = {
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
export async function fetchDedicatedVacancyPage(folder, state, page) {
  var sources = DEDICATED_VACANCY_FOLDER_SOURCES[folder];
  if (!sources) return [];
  var workerPage = await fetchVacancyPageFromWorker({
    source: sources.join(','), q: state.q, remote: state.remote, experience: state.exp,
    limit: dedicatedVacancyPageSize, cursor: page > 0 ? dedicatedVacancyNextCursor : ''
  });
  if (workerPage) {
    set_dedicatedVacancyNextCursor( workerPage.next_cursor || null);
    return workerPage.vacancies;
  }
  return [];
}
export async function upsertVacancy(v) {
  try {
    var mutation = supabaseClient.from('vacancies').upsert(v);
    var result = isAdmin ? await mutation.select('*').single() : await mutation;
    if (!result.error) {
      if (isAdmin) await writeThroughD1Mirror('vacancies', Object.assign({}, v, result.data || {}));
      return true;
    }
    console.error('vacancy upsert', result.error);
    if (result.error.message && result.error.message.indexOf('column') > -1) {
      var safe = { id:v.id, agency_id:v.agency_id||'general', title:v.title||'', company:v.company||'', location:v.location||'', closing_date:v.closing_date||'', notes:v.notes||'', link:v.link||'', email:v.email||'', phone:v.phone||'' };
      var retryMutation = supabaseClient.from('vacancies').upsert(safe);
      var retry = isAdmin ? await retryMutation.select('*').single() : await retryMutation;
      if (!retry.error) {
        if (isAdmin) await writeThroughD1Mirror('vacancies', Object.assign({}, safe, retry.data || {}));
        return true;
      }
    }
  } catch(e) { console.error('vacancy upsert', e); }
  var arr = readLocal('vacancies');
  var i = arr.findIndex(function(x){ return x.id === v.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], v); else arr.push(v);
  writeLocal('vacancies', arr);
  return false;
}
export async function removeVacancy(id) {
  try {
    var result = await supabaseClient.from('vacancies').delete().eq('id', id);
    if (!result.error && isAdmin) await writeThroughD1Mirror('vacancies', id, 'delete');
  } catch(e){}
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
export function readLocalReports() {
  try { return JSON.parse(localStorage.getItem('sa_reports_local') || '[]'); } catch(e){ return []; }
}
export function writeLocalReports(arr) {
  try { localStorage.setItem('sa_reports_local', JSON.stringify(arr)); } catch(e){}
}
export async function submitReportToSupabase(payload) {
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
export function markLoadError(arr) { try { arr.__loadError = true; } catch(e) {} return arr; }

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
export var DATA_CACHE_DB = 'sa_data_cache_db';
export var DATA_CACHE_STORE = 'kv';
export var DATA_CACHE_KEY = 'sa_data_cache_v1';
export var lastDataRefreshAt = null;
export var cachedVacancyTotal = null;

export function openDataCacheDB() {
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
export async function idbGet(key) {
  var db = await openDataCacheDB();
  return new Promise(function(resolve, reject) {
    var req = db.transaction(DATA_CACHE_STORE, 'readonly').objectStore(DATA_CACHE_STORE).get(key);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}
export async function idbSet(key, value) {
  var db = await openDataCacheDB();
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(DATA_CACHE_STORE, 'readwrite');
    tx.objectStore(DATA_CACHE_STORE).put(value, key);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
  });
}

export function formatDataAge(timestamp) {
  if (!timestamp) return '';
  var age = Math.max(0, Date.now() - timestamp);
  if (age < 60000) return 'just now';
  var minutes = Math.floor(age / 60000);
  if (minutes < 60) return minutes + ' min ago';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' hr ago';
  return Math.floor(hours / 24) + ' days ago';
}
export function vacancyScreenStateMarkup(screen, hasRows, hasQuery) {
  if (hasRows) return '';
  var message = 'New listings will appear here once they are posted.';
  if (screen === 'search') message = hasQuery ? 'Try a different agency name, trade, role, or location.' : 'Find agencies, vacancies, trades, or locations.';
  else if (screen === 'saved') message = 'Use the star on a vacancy card to keep it here for later.';
  else if (screen === 'employer') message = 'New employer listings will appear here after they are saved.';
  else if (screen === 'manager') message = 'No vacancies added yet.';
  else if (screen === 'all') message = hasQuery ? 'Try a different search or adjust your filters.' : message;
  return '<div class="screen-state" data-screen="' + screen + '" data-vacancy-state="empty">' + message + '</div>';
}

export function connectionStatusLabel(state, timestamp, isOnline) {
  var isOffline = state === 'offline' || !isOnline;
  if (state === 'loading') return 'Updating listings…';
  if (isOffline) return timestamp ? 'Offline · showing saved listings from ' + formatDataAge(timestamp) : 'Offline · saved listings only';
  if (state === 'cached') return timestamp ? 'Saved listings · last checked ' + formatDataAge(timestamp) : 'Saved listings · waiting for connection';
  if (state === 'error') return timestamp ? 'Could not refresh · showing listings from ' + formatDataAge(timestamp) : 'Could not refresh the latest listings';
  if (state === 'live') return 'Live listings · updated ' + formatDataAge(timestamp || Date.now());
  return '';
}
export function setConnectionStatus(state, timestamp) {
  var el = document.getElementById('connection-status');
  if (!el) return;
  var isOffline = state === 'offline' || !navigator.onLine;
  var label = connectionStatusLabel(state, timestamp, navigator.onLine);
  el.textContent = label;
  el.dataset.state = state;
  el.classList.toggle('show', !!label);
  el.title = timestamp ? 'Last successful listing refresh: ' + new Date(timestamp).toLocaleString() : '';
}

export function initConnectionStatus() {
  window.addEventListener('offline', function() { setConnectionStatus('offline', lastDataRefreshAt); try { trackEvent('offline_detected', 'pwa', null); } catch(e) {} });
  window.addEventListener('online', function() {
    setConnectionStatus('loading', lastDataRefreshAt);
    loadAll();
  });
  setConnectionStatus(navigator.onLine ? (lastDataRefreshAt ? 'cached' : 'loading') : 'offline', lastDataRefreshAt);
}
export async function saveDataCache() {
  var payload = {
    agencies: agenciesCache,
    branches: branchesCache,
    vacancies: vacanciesCache,
    allVacancies: staticVacanciesCache.length ? staticVacanciesCache : vacanciesCache,
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
export async function loadDataCache() {
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
  set_agenciesCache( d.agencies || []);
  set_branchesCache( d.branches || []);
  set_vacanciesCache( d.vacancies || []);
  set_staticVacanciesCache( d.allVacancies || d.vacancies || []);
  set_generalVacancyCount( (typeof d.generalVacancyCount === 'number') ? d.generalVacancyCount : 0);
  cachedVacancyTotal = (typeof d.vacancyTotal === 'number') ? d.vacancyTotal : null;
  set_employersCache( d.employers || []);
  set_poolCandidateCount( (typeof d.poolCount === 'number') ? d.poolCount : 0);
  // Restore the cached poster total too, so the Posters stat card paints
  // instantly alongside the others instead of sitting on its placeholder
  // until the (deliberately deferred) live poster fetch resolves.
  if (typeof d.posterCount === 'number') posterTotalCount = d.posterCount;
  lastDataRefreshAt = (typeof d.savedAt === 'number') ? d.savedAt : null;
  return true;
}

export var startupDataPromise = null;
export var startupDataSource = '';
export var startupDataResolved = false;
export async function fetchStartupDataOnce() {
  startupDataSource = '';
  var earlyStartup = window.__saStartupEarly;
  window.__saStartupEarly = null;
  function validStartup(payload) {
    return !!(payload && Array.isArray(payload.agencies) && Array.isArray(payload.branches) && Array.isArray(payload.vacancies) && Array.isArray(payload.employers) && payload.counts && payload.settings);
  }
  var workerPayload = null;
  if (earlyStartup) {
    var earlyTimer = null;
    try {
      var timeoutPromise = new Promise(function(resolve){ earlyTimer = setTimeout(function(){ resolve(null); }, 7000); });
      workerPayload = await Promise.race([earlyStartup, timeoutPromise]);
    } catch(e) { workerPayload = null; }
    if (earlyTimer) clearTimeout(earlyTimer);
  }
  if (!validStartup(workerPayload)) {
    try {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timeout = controller ? setTimeout(function(){ controller.abort(); }, 7000) : null;
      var response = await fetch(STARTUP_DATA_URL, { method:'GET', cache:'no-store', headers:{ Accept:'application/json' }, signal:controller ? controller.signal : undefined });
      if (timeout) clearTimeout(timeout);
      if (response.ok) workerPayload = await response.json();
    } catch(e) { console.warn('Worker startup data load', e); }
  }
  if (validStartup(workerPayload)) { startupDataSource = 'worker'; return workerPayload; }
  if (staticDataEnabled) {
    try {
      var staticUrl = STATIC_DATA_URL + (STATIC_DATA_URL.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
      var staticResponse = await fetch(staticUrl, { method:'GET', cache:'no-store', headers:{ Accept:'application/json' } });
      var staticPayload = staticResponse.ok ? await staticResponse.json() : null;
      if (validStartup(staticPayload)) { startupDataSource = 'static'; return staticPayload; }
    } catch(e) { console.warn('static data load', e); }
  }
  return null;
}
// ----- Deferred job descriptions -----
// data/startup.json ships vacancies WITHOUT their `notes` (about half of its bytes) so the first
// screen can render sooner. The descriptions live in data/vacancy-notes.json ({ id: notes }); we
// fetch that at idle after first render and merge it into every in-memory vacancy list.
export var deferredNotesStarted = false;
export function applyDeferredVacancyNotes(map) {
  var payload = window.__saStartupPayload;
  var lists = [
    payload && payload.vacancies,
    typeof staticVacanciesCache !== 'undefined' ? staticVacanciesCache : null,
    typeof vacanciesCache !== 'undefined' ? vacanciesCache : null,
    typeof vacancyOverviewExtraRows !== 'undefined' ? vacancyOverviewExtraRows : null
  ];
  lists.forEach(function(list) {
    (list || []).forEach(function(v) {
      if (v && v.id != null && !v.notes && map[v.id]) v.notes = map[v.id];
    });
  });
}
export function scheduleDeferredVacancyNotes(startup) {
  if (!startup || !startup.notes_url || deferredNotesStarted) return;
  deferredNotesStarted = true;
  var refresh = function(attempt) {
    // Re-rendering the vacancy list would collapse a card the user is reading, so wait for it to close.
    var openCard = document.querySelector('#screen-allvacancies .vac-card.open');
    if (openCard && attempt < 6) { setTimeout(function() { refresh(attempt + 1); }, 2000); return; }
    if (typeof filterAndRenderCached === 'function') filterAndRenderCached();
    var screen = document.getElementById('screen-allvacancies');
    if (screen && screen.classList.contains('active') && !openCard && typeof window.renderAllVacanciesList === 'function') window.renderAllVacanciesList();
  };
  var run = function() {
    fetch(startup.notes_url, { method: 'GET', cache: 'no-cache', headers: { Accept: 'application/json' } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(map) {
        if (!map || typeof map !== 'object') { deferredNotesStarted = false; return; }
        applyDeferredVacancyNotes(map);
        window.__saVacancyNotesReady = true;
        refresh(0);
        if (typeof saveDataCache === 'function') saveDataCache();
      })
      .catch(function() { deferredNotesStarted = false; });
  };
  setTimeout(function() {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
    else run();
  }, 300);
}

export function getStartupData(forceFresh) {
  if (forceFresh) {
    startupDataPromise = null;
    startupDataSource = '';
    startupDataResolved = false;
  }
  if (startupDataPromise) return startupDataPromise;
  startupDataResolved = false;
  startupDataPromise = fetchStartupDataOnce();
  startupDataPromise.then(function(payload){
    startupDataResolved = true;
    if (!payload) startupDataPromise = null;
  }, function(){ startupDataResolved = true; startupDataPromise = null; });
  return startupDataPromise;
}
export async function refreshSecondaryStartupData() {
  try {
    var employerRows = await getEmployerVacancies();
    var adzunaAgencyRows = await getAgencyAdzunaVacancies();
    var merged = (vacanciesCache || []).concat(employerRows || [], adzunaAgencyRows || []);
    var seen = {};
    set_vacanciesCache( sortVacancies(merged.filter(function(v) {
      if (!v || !v.id || seen[v.id]) return false;
      seen[v.id] = true;
      return !isGeneralDirectoryVacancy(v);
    })));
    matchVacanciesToAgencies(vacanciesCache, agenciesCache);
    filterAndRenderCached();
    saveDataCache();
  } catch(e) { console.warn('secondary startup refresh', e); }
  try {
    var liveGeneralCount = await getGeneralVacancyCount();
    if (typeof liveGeneralCount === 'number') {
      set_generalVacancyCount( liveGeneralCount);
      set_generalVacancyCountLoaded( true);
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
// the same public, version-aware /api/startup endpoint loadAll() itself uses.
(function loadPreAuthEmployerRegFlag() {
  getStartupData().then(function(startup) {
    if (startup && startup.settings) {
      set_publicEmployerRegistrationOpen( (startup.settings.public_employer_registration === true || startup.settings.public_employer_registration === 'true'));
    }
  }).catch(function(){});
})();

export var loadAllRequestId = 0;
export async function loadAll(options) {
  var requestId = ++loadAllRequestId;
  var forceFresh = !!(options && options.fresh);
  setConnectionStatus(navigator.onLine ? 'loading' : 'offline', lastDataRefreshAt);
  if (navigator.onLine === false) {
    try { trackEvent('offline_launch', 'pwa', null); } catch(e) {}
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
  var startup = await getStartupData(forceFresh);
  window.__saStartupPayload = startup;
  window.__saStaticData = (startup && startup.schema === 1 && Array.isArray(startup.vacancies)) ? startup : null;
  if (window.__saStaticData) set_staticVacanciesCache( filterExpiredVacancies(startup.vacancies || []));
  var authoritativeStartupVacancyTotal = startup && startup.counts && typeof startup.counts.vacancies === 'number'
    ? startup.counts.vacancies : null;
  if (authoritativeStartupVacancyTotal !== null) cachedVacancyTotal = authoritativeStartupVacancyTotal;
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
  if (results[0].__loadError) { hadLoadError = true; } else { set_agenciesCache( results[0]); }
  if (results[1].__loadError) { hadLoadError = true; } else { set_branchesCache( results[1]); }
  if (results[2].__loadError) { hadLoadError = true; } else {
    // Resolve imported/general records against the agency directory before
    // splitting the startup cache from the lazy General Vacancies feed.
    results[2] = filterExpiredVacancies(results[2]);
    matchVacanciesToAgencies(results[2], agenciesCache);
    set_vacanciesCache( sortVacancies((window.__saStaticData ? results[2] : results[2].filter(function(v){
      // General-folder rows are loaded lazily. Do not retain them here or
      // updateStats() would add them a second time to generalVacancyCount.
      return !isGeneralDirectoryVacancy(v);
    }))));
  }
  if (results[3].__loadError) { hadLoadError = true; } else { set_employersCache( results[3]); }
  if (typeof results[4] === 'number') { set_generalVacancyCount( results[4]); set_generalVacancyCountLoaded( true); }
  else if (results[4] === null) hadLoadError = true;
  // Not treated as a load error: the dedicated folder count badges are
  // cosmetic (they just label the folder cards), so a miss here shouldn't
  // trigger the retry banner the way a core data fetch failing would.
  if (results[9] && typeof results[9] === 'object') { set_dedicatedVacancyCounts( results[9]); set_dedicatedVacancyCountsLoaded( true); }
  if (authoritativeStartupVacancyTotal === null && generalVacancyCountLoaded && dedicatedVacancyCountsLoaded) {
    cachedVacancyTotal = generalVacancyCount + vacanciesCache.length + dedicatedVacancyGrandTotal();
  }
  setRetryBanner(hadLoadError);
  if (hadLoadError) { try { trackEvent('data_refresh_failed', 'data', null, { online: navigator.onLine !== false }); } catch(e) {} }
  if (!hadLoadError) lastDataRefreshAt = Date.now();
  setConnectionStatus(!navigator.onLine ? 'offline' : (hadLoadError ? 'error' : 'live'), lastDataRefreshAt);
  set_publicVacancyPostingOpen( (results[5] === true || results[5] === 'true'));
  set_publicEmployerRegistrationOpen( (results[6] === true || results[6] === 'true'));
  set_employerDirectoryOpen( (results[7] === true || results[7] === 'true'));
  // Only overwrite the count if the query succeeded — a failed count fetch
  // should leave the last-known number on screen rather than dropping to 0.
  if (typeof results[8] === 'number') set_poolCandidateCount( results[8]);
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
  loadMediaSetting();
  // The committed static snapshot (data/startup.json) historically omitted the
  // Talent Pool rows and hard-coded counts.candidates = 0, so the home
  // "Talent Pool Candidates" card sat at 0 until the visitor opened the Talent
  // Pool screen (which fetches the live count). When the snapshot doesn't carry
  // its own pool_candidates, backfill the real number from the Worker so the
  // card is correct on first paint. Once the snapshot ships pool_candidates
  // (see scripts/export-static-data.mjs) this is a no-op. Reuses the same
  // Worker fetch loadCandidateSpotlight() already makes, so there's no extra
  // request.
  if (window.__saStaticData && !Array.isArray(startup.pool_candidates)) {
    getPoolCandidateCount().then(function (n) {
      if (typeof n === 'number') { set_poolCandidateCount( n); updateStats(); }
    }).catch(function () {});
  }
  filterAndRenderCached();
  if (typeof renderRestoredScreenContent === 'function') renderRestoredScreenContent();
  if (startup && !window.__saStaticData) refreshSecondaryStartupData();
  // Candidate spotlight is loaded on demand when the Menu is opened.
  // Poster feed and first-party ads are non-critical to the first render.
  if (typeof loadPosterFeed === 'function') loadPosterFeed();
  loadHouseAds();
  saveDataCache();
  scheduleDeferredVacancyNotes(startup);
  updatePostingToggleUI();
  // updateEmployerRegUI() lives in admin.html, not this public bundle. Calling
  // it unguarded threw "ReferenceError: updateEmployerRegUI is not defined" on
  // every public loadAll() and aborted the rest of this function (manager-mode
  // re-render, restoreTalentPoolMembership(), autoClaimGateRegistration(),
  // pending manager-token handling). Guard it like the other cross-file calls
  // above so the public app continues past this point.
  if (typeof updateEmployerRegUI === 'function') updateEmployerRegUI();
  // If in manager mode, re-render the manager panel with fresh data
  if (managerMode) renderManagerMode();
  if (employerManagerMode) renderEmployerManagerMode();
  restoreTalentPoolMembership();
  if (typeof autoClaimGateRegistration === 'function') autoClaimGateRegistration();
  // If a pending manager token was detected before agencies loaded, enter manager mode now
  if (managerPendingToken) {
    var tok = managerPendingToken;
    set_managerPendingToken( null);
    enterManagerMode(tok);
  }
  if (employerManagerPendingToken) {
    var etok = employerManagerPendingToken;
    set_employerManagerPendingToken( null);
    enterEmployerManagerMode(etok);
  }
  // If admin is viewing SMART MANAGER section, re-render it
  if (typeof renderSmartManager === 'function' && document.getElementById('screen-smartmanager') && document.getElementById('screen-smartmanager').classList.contains('active')) {
    renderSmartManager();
  }
}

export function dedicatedVacancyGrandTotal() {
  var c = dedicatedVacancyCounts || {};
  return (c.himalayas||0) + (c.adzuna||0) + (c.government||0) + (c.retail||0) + (c.learnerships||0) + (c.careers_page||0);
}
// Compact display for big totals: 16861 -> "16k", 1530 -> "1.5k". Rounds DOWN so the label never
// overstates the real total. (To round to the nearest thousand instead, change Math.floor to Math.round.)
export function formatCompactCount(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.floor(n / 100) / 10) + 'k';
  return Math.floor(n / 1000) + 'k';
}
window.formatCompactCount = formatCompactCount;

export function setVacancyStat(el, total) {
  el.textContent = formatCompactCount(total);
  el.setAttribute('data-count', total);          // exact number kept for card sorting
  el.title = Number(total).toLocaleString() + ' vacancies';
}

export function updateStats() {
  document.getElementById('stat-agencies').textContent = agenciesCache.length;
  updatePosterStat();
  var vacancyStat = document.getElementById('stat-vacancies');
  if (vacancyStat) {
    if (window.__saStaticData && window.__saStaticData.counts && typeof window.__saStaticData.counts.vacancies === 'number') {
      setVacancyStat(vacancyStat, window.__saStaticData.counts.vacancies);
    } else if (typeof cachedVacancyTotal === 'number') {
      setVacancyStat(vacancyStat, cachedVacancyTotal);
    } else if (generalVacancyCountLoaded && dedicatedVacancyCountsLoaded) {
      setVacancyStat(vacancyStat, generalVacancyCount + vacanciesCache.length + dedicatedVacancyGrandTotal());
    }
  }
  var statEmployers = document.getElementById('stat-employers');
  if (statEmployers) statEmployers.textContent = employersCache.length;
  var statPool = document.getElementById('stat-pool');
  if (statPool) statPool.textContent = poolLoaded ? poolCache.filter(function(c){ return (c.status || 'pending') === 'active'; }).length : poolCandidateCount;
  var provinceCounts = window.__saStartupPayload && window.__saStartupPayload.counts && window.__saStartupPayload.counts.provinces;
  document.querySelectorAll('[data-province-count]').forEach(function (node) {
    var key = node.getAttribute('data-province-count');
    var count = provinceCounts && typeof provinceCounts[key] === 'number' ? provinceCounts[key] : null;
    if (count !== null) node.textContent = count.toLocaleString();
  });
  reorderStatCardsByCount();
}

// Keeps the home-screen stat cards (Agencies / Posters / Vacancies /
// Employers / Candidates) sorted so the highest count always leads,
// lowest trails — re-run every time updateStats() refreshes the numbers.
// Uses a lightweight FLIP animation (record position -> reorder the DOM ->
// offset back to the old spot -> animate to zero) so cards visibly glide
// into their new place instead of jumping.
export function reorderStatCardsByCount() {
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
    var n = valueEl ? parseInt(valueEl.getAttribute('data-count') || valueEl.textContent, 10) : NaN;
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
export function gateVacancyTotal(agencies, vacancies, counts) {
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


export function branchesFor(agencyId) { return branchesCache.filter(function(b){ return b.agency_id === agencyId; }); }
export function vacanciesFor(agencyId) {
  // Adzuna rows explicitly assigned to an agency belong in that agency's
  // section as well as the Adzuna folder. Other dedicated feeds remain in
  // their dedicated folders unless explicitly handled by their own section.
  return sortVacancies(vacanciesCache.filter(function(v){
    return v.agency_id === agencyId && (String(v.source_type || '').toLowerCase() === 'adzuna' || !isDedicatedVacancySource(v.source_type));
  }));
}
export function vacanciesForEmployer(employerId) { return sortVacancies(vacanciesCache.filter(function(v){ return v.employer_id === employerId; })); }

// Best-effort parse of the free-text closing_date field (e.g. "26 August
// 2026", "2026-08-26") into a timestamp. Returns null when it can't be
// parsed (blank, "ASAP", etc.) so callers can push those to the end
// instead of mis-sorting them.
export function parseClosingDate(str) {
  if (!str) return null;
  var t = Date.parse(str);
  return isNaN(t) ? null : t;
}

// Newest posting first (most recently added), then — for vacancies added
// in the same batch/moment, where created_at ties — soonest closing date
// first, so deadlines run in order rather than appearing scrambled.
// Vacancies with no parseable closing date sort after ones that have one.
export function sortVacancies(list) {
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


// ===== window bridge (generated by the ES-module migration) =====
// Inline onclick=""/oninput="" handlers in index.html, string-built handlers in the
// templates above, and the classic scripts (app-vacancy-v2.js, app-alerts.js,
// content*.js) look these names up on window, exactly like they did when every
// file shared one global scope. Remove an entry only after checking nothing
// outside the module graph reads it.
Object.assign(window, {
  getAgencies,
  saveManagerTokenToSupabase,
  writeThroughD1Mirror,
  upsertAgency,
  removeAgency,
  getEmployers,
  safeHouseAdUrl,
  houseAdPlacementMatches,
  renderHouseAdSlot,
  renderHouseAdSlots,
  loadHouseAds,
  trackHouseAdEvent,
  getManagedPosters,
  renderManagedPoster,
  renderManagedPosters,
  getPublicPoolCandidatesFromWorker,
  loadCandidateSpotlight,
  renderCandidateSpotlight,
  upsertEmployer,
  removeEmployer,
  localKey,
  readLocal,
  writeLocal,
  getBranches,
  upsertBranch,
  removeBranch,
  getAppSetting,
  setAppSetting,
  loadPostingSetting,
  updatePostingToggleUI,
  loadEmployerRegSetting,
  youtubeEmbedUrl,
  renderHomeMediaSection,
  loadMediaSetting,
  todayISO,
  loadTodayTrack,
  renderTrackEmpty,
  renderTrackReady,
  toggleTrackPlay,
  updateTrackPlayButtons,
  onTrackLoaded,
  updateTrackProgress,
  onTrackEnded,
  togglePublicPosting,
  openVacancyLockedSheet,
  openEmployerLockedSheet,
  updatePosterStat,
  getEmployerPosters,
  parseVacancyClosingDate,
  isVacancyExpired,
  filterExpiredVacancies,
  getVacancies,
  getEmployerVacancies,
  getAgencyAdzunaVacancies,
  getGeneralVacancyCount,
  getDedicatedVacancyCounts,
  isDedicatedVacancySource,
  isGeneralDirectoryVacancy,
  hasAssignedAgency,
  normalizeAgencyMatchText,
  matchVacanciesToAgencies,
  generalVacancyQueryState,
  generalVacancyQueryKeyFor,
  fetchVacancyPageFromWorker,
  fetchGeneralVacancyPage,
  fetchDedicatedVacancyPage,
  upsertVacancy,
  removeVacancy,
  readLocalReports,
  writeLocalReports,
  submitReportToSupabase,
  markLoadError,
  openDataCacheDB,
  idbGet,
  idbSet,
  formatDataAge,
  vacancyScreenStateMarkup,
  connectionStatusLabel,
  setConnectionStatus,
  initConnectionStatus,
  saveDataCache,
  loadDataCache,
  fetchStartupDataOnce,
  applyDeferredVacancyNotes,
  scheduleDeferredVacancyNotes,
  getStartupData,
  refreshSecondaryStartupData,
  loadAll,
  dedicatedVacancyGrandTotal,
  formatCompactCount,
  setVacancyStat,
  updateStats,
  reorderStatCardsByCount,
  gateVacancyTotal,
  branchesFor,
  vacanciesFor,
  vacanciesForEmployer,
  parseClosingDate,
  sortVacancies,
});
Object.defineProperties(window, {
  D1_WRITE_THROUGH_COLUMNS: { get: () => D1_WRITE_THROUGH_COLUMNS, set: (v) => { D1_WRITE_THROUGH_COLUMNS = v; }, configurable: true, enumerable: true },
  houseAdsCache: { get: () => houseAdsCache, set: (v) => { houseAdsCache = v; }, configurable: true, enumerable: true },
  publicPoolStartupPromise: { get: () => publicPoolStartupPromise, set: (v) => { publicPoolStartupPromise = v; }, configurable: true, enumerable: true },
  candidateSpotlightLoaded: { get: () => candidateSpotlightLoaded, set: (v) => { candidateSpotlightLoaded = v; }, configurable: true, enumerable: true },
  candidateSpotlightList: { get: () => candidateSpotlightList, set: (v) => { candidateSpotlightList = v; }, configurable: true, enumerable: true },
  DEFAULT_MEDIA_YOUTUBE_URL: { get: () => DEFAULT_MEDIA_YOUTUBE_URL, set: (v) => { DEFAULT_MEDIA_YOUTUBE_URL = v; }, configurable: true, enumerable: true },
  mediaYoutubeUrl: { get: () => mediaYoutubeUrl, set: (v) => { mediaYoutubeUrl = v; }, configurable: true, enumerable: true },
  TRACKS_PUBLIC_BASE_URL: { get: () => TRACKS_PUBLIC_BASE_URL, set: (v) => { TRACKS_PUBLIC_BASE_URL = v; }, configurable: true, enumerable: true },
  todayTrack: { get: () => todayTrack, set: (v) => { todayTrack = v; }, configurable: true, enumerable: true },
  trackAudio: { get: () => trackAudio, set: (v) => { trackAudio = v; }, configurable: true, enumerable: true },
  trackIsPlaying: { get: () => trackIsPlaying, set: (v) => { trackIsPlaying = v; }, configurable: true, enumerable: true },
  posterTotalCount: { get: () => posterTotalCount, set: (v) => { posterTotalCount = v; }, configurable: true, enumerable: true },
  DEDICATED_VACANCY_FOLDER_SOURCES: { get: () => DEDICATED_VACANCY_FOLDER_SOURCES, set: (v) => { DEDICATED_VACANCY_FOLDER_SOURCES = v; }, configurable: true, enumerable: true },
  DATA_CACHE_DB: { get: () => DATA_CACHE_DB, set: (v) => { DATA_CACHE_DB = v; }, configurable: true, enumerable: true },
  DATA_CACHE_STORE: { get: () => DATA_CACHE_STORE, set: (v) => { DATA_CACHE_STORE = v; }, configurable: true, enumerable: true },
  DATA_CACHE_KEY: { get: () => DATA_CACHE_KEY, set: (v) => { DATA_CACHE_KEY = v; }, configurable: true, enumerable: true },
  lastDataRefreshAt: { get: () => lastDataRefreshAt, set: (v) => { lastDataRefreshAt = v; }, configurable: true, enumerable: true },
  cachedVacancyTotal: { get: () => cachedVacancyTotal, set: (v) => { cachedVacancyTotal = v; }, configurable: true, enumerable: true },
  startupDataPromise: { get: () => startupDataPromise, set: (v) => { startupDataPromise = v; }, configurable: true, enumerable: true },
  startupDataSource: { get: () => startupDataSource, set: (v) => { startupDataSource = v; }, configurable: true, enumerable: true },
  startupDataResolved: { get: () => startupDataResolved, set: (v) => { startupDataResolved = v; }, configurable: true, enumerable: true },
  deferredNotesStarted: { get: () => deferredNotesStarted, set: (v) => { deferredNotesStarted = v; }, configurable: true, enumerable: true },
  loadAllRequestId: { get: () => loadAllRequestId, set: (v) => { loadAllRequestId = v; }, configurable: true, enumerable: true },
});
