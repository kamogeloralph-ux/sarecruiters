/*
 * SA Recruiters -- app.js split 7/8: app-manager.js
 * Smart Manager admin section + agency self-service Manager Mode
 *
 * Part of the original monolithic app.js. Now an ES module: it imports what it
 * uses from the other app-*.js files and exports its top-level declarations.
 * A window bridge at the bottom keeps inline onclick="" handlers and the
 * classic scripts (app-vacancy-v2.js, app-alerts.js, content*.js) working.
 * Bundled by Vite via app-entry.js (see scripts/bundle-app.js).
 */

import { R2_WORKER_URL, agenciesCache, buildManagerLink, employerManagerPendingToken, escapeHtml, getManagerToken, initials, isAdmin, managerAgency, managerMode, managerPendingToken, publicAgencySlug, publicVacancySlug, set_managerAgency, set_managerMode, set_managerPendingToken, trackEvent, vacanciesCache } from './app-core.js';
import { branchesFor, vacanciesFor, vacancyScreenStateMarkup } from './app-data.js';
import { ICON_LINK, IS, cvPicsCache, verifiedBadge } from './app-cards.js';
import { openBranchSheet, set_pendingVacancyAgency } from './app-forms.js';
import { copyText } from './app-sheets.js';
import { goBackToHome, showToast } from './app-ui.js';
import { bumpManagerWatchdog, enterEmployerManagerMode } from './app-manager-employer.js';


// ===== SMART MANAGER (admin section) =====
export function goSmartManager() {
  if (!isAdmin) return; // admin-only — managed via admin.html now
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-smartmanager').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderSmartManager();
}
export function renderSmartManager() {
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
export function filterSmartManager() {
  renderSmartManager();
}
export function copyManagerLink(agencyId) {
  var token = getManagerToken(agencyId);
  if (!token) { showToast('Link not ready'); return; }
  var link = buildManagerLink(token);
  copyText(link, document.getElementById('sm-link-' + agencyId));
}
export function shareManagerLink(agencyId) {
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
export function shareAgency(agencyId) {
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
export function shareVacancy(vacancyId) {
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
/* Share a CV picture. Preferred: the picture itself through the OS share
   sheet (instant, looks right in WhatsApp) with a link to the CV Pictures
   screen in the text. Falls back to link-only share, then copy-link.
   There is deliberately no per-person public web page: a CV carries personal
   contact details, so it only lives inside the app. */
export async function shareCvPic(cvPicId) {
  var p = (typeof cvPicsCache !== 'undefined' ? cvPicsCache : []).find(function(x){ return String(x.id) === String(cvPicId); });
  if (!p) { showToast('CV picture not found'); return; }
  var link = window.location.origin + '/?section=cv-pictures';
  var title = (p.caption || 'CV picture') + ' — SA Recruiters';
  var text = (p.caption || 'CV picture') + ' — see it on SA Recruiters: ' + link;
  trackEvent('cvpic_share', 'cvpic', cvPicId);
  if (navigator.share) {
    try {
      var res = await fetch(p.image_url);
      var blob = await res.blob();
      var file = new File([blob], 'cv-picture.jpg', { type: blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: title, text: text, files: [file] });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the share sheet
    }
    navigator.share({ title: title, text: text, url: link }).catch(function(){});
  } else {
    copyText(link, null);
    showToast('Link copied — paste it into a message');
  }
}
export function openManagerLink(agencyId) {
  var token = getManagerToken(agencyId);
  if (!token) { showToast('Link not ready'); return; }
  window.open(buildManagerLink(token), '_blank');
}

// ===== MANAGER MODE (agency self-service, add-only) =====
export var managerTokenRetries = 0;
export var MANAGER_TOKEN_MAX_RETRIES = 12;   // ~30s of patient retries while data loads
export var managerTokenKind = null;          // 'agency' | 'employer' (for the status screen)
export var managerStatusWatchdog = null;     // safety timeout that flips loading -> error
// Resolved manager-link identities are cached for the session so repeated
// renders don't re-hit the verify endpoint.
export var managerSession = { agencyId: null, employerId: null, agencyAnalytics: null, employerAnalytics: null, agencyMarketingPreference: null };

// SECURITY: verify a manager token SERVER-SIDE via the Cloudflare Worker,
// which calls the verify_manager_token Postgres RPC. Tokens are no longer
// comparable against public data in the browser (they are revoked from the
// anon role), so this is the only reliable resolution path.
export async function verifyManagerTokenServer(kind, token) {
  var endpoint = kind === 'employer' ? '/api/verify-employer-manager' : '/api/verify-manager';
  try {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = controller ? setTimeout(function(){ controller.abort(); }, 10000) : null;
    var res = await fetch(R2_WORKER_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
      signal: controller ? controller.signal : undefined
    });
    if (timeout) clearTimeout(timeout);
    if (!res.ok) return null;
    var data = await res.json();
    if (!data || !data.valid) return null;
    var record = kind === 'employer' ? data.employer : data.agency;
    if (!record) return null;
    return Object.assign({}, record, {
      vacancy_analytics: Array.isArray(data.vacancy_analytics) ? data.vacancy_analytics : null,
      marketing_preference: kind === 'employer' ? null : (data.marketing_preference || null)
    });
  } catch (e) {
    return null;
  }
}

// Show the dedicated manager-link status screen so a token URL never silently
// drops the visitor onto the normal home screen while it is still resolving.
var managerStatusIsError = false;
export function isManagerStatusError() { return managerStatusIsError; }
export function showManagerStatus(state, heading, body) {
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
  // A final error state must not be overwritten by the loading watchdog.
  managerStatusIsError = (state === 'error');
  if (state === 'error') clearTimeout(managerStatusWatchdog);
  if (spinner) spinner.style.display = (state === 'loading') ? '' : 'none';
  if (h) h.textContent = heading || '';
  if (p) p.textContent = body || '';
  if (ctx) ctx.textContent = (state === 'loading') ? 'Please wait' : 'Link problem';
  if (retry) retry.style.display = (state === 'error') ? '' : 'none';
  if (home) home.style.display = (state === 'error') ? '' : 'none';
}
export function retryManagerTokenFromStatus() {
  // Re-trigger resolution for whichever token kind is pending.
  if (managerPendingToken) { enterManagerMode(managerPendingToken); return; }
  if (employerManagerPendingToken) { enterEmployerManagerMode(employerManagerPendingToken); return; }
  // Neither flag is set once a resolution attempt has finished or failed, so
  // fall back to the token still sitting in the URL instead of dumping the
  // visitor on the home screen.
  var qs = new URLSearchParams(window.location.search);
  var urlToken = qs.get('manage');
  var urlEmpToken = qs.get('manage_employer');
  if (urlToken || urlEmpToken) {
    showManagerStatus('loading', 'Loading your manager link…', 'We\'re connecting to SA Recruiters. This usually takes a moment.');
    bumpManagerWatchdog(20000);
    if (urlToken) enterManagerMode(urlToken);
    if (urlEmpToken) enterEmployerManagerMode(urlEmpToken);
    return;
  }
  goBackToHome();
}
export async function enterManagerMode(token) {
  // Always surface the status screen first so the visitor sees that their
  // manager link is being opened, not the generic directory home screen.
  if (!managerMode) showManagerStatus('loading', 'Loading your manager link…', 'We\'re connecting to SA Recruiters. This usually takes a moment.');
  // 1) Fast path: an already-resolved session for this token.
  if (managerSession.agencyId && managerSession.agencyToken === token) {
    var cachedAgency = agenciesCache.find(function(a){ return a.id === managerSession.agencyId; }) ||
      { id: managerSession.agencyId, name: managerSession.agencyName || 'Agency', location: managerSession.agencyLocation || '', verified: false };
    return openManagerScreen(cachedAgency, token);
  }
  // 2) Server-side verification. Token comparisons against public data are
  //    no longer possible (manage_token is revoked from the anon role), so
  //    retrying a table scan is pointless — but a cold Worker (rare) or a
  //    flaky connection deserves a couple of patient retries.
  var record = await verifyManagerTokenServer('agency', token);
  if (!record) {
    if (managerTokenRetries < 2) {
      managerTokenRetries++;
      set_managerPendingToken( token);
      managerTokenKind = 'agency';
      var backoff = 1500 + managerTokenRetries * 800;
      bumpManagerWatchdog(backoff + 8000);
      setTimeout(function(){
        if (managerPendingToken) {
          set_managerPendingToken( null);
          enterManagerMode(token);
        }
      }, backoff);
      return false;
    }
    managerTokenRetries = 0;
    set_managerPendingToken( null);
    managerTokenKind = null;
    showManagerStatus('error',
      'This management link is invalid or expired',
      'We couldn\'t find an agency for this link. It may have expired or been replaced. Please request a new link from SA Recruiters, or try again in case the connection was interrupted.');
    return false;
  }
  managerSession.agencyId = record.id;
  managerSession.agencyToken = token;
  managerSession.agencyName = record.name;
  managerSession.agencyLocation = record.location;
  managerSession.agencyAnalytics = Array.isArray(record.vacancy_analytics) ? record.vacancy_analytics : null;
  managerSession.agencyMarketingPreference = record.marketing_preference && typeof record.marketing_preference === 'object' ? record.marketing_preference : null;
  managerTokenRetries = 0;
  set_managerPendingToken( null);
  managerTokenKind = null;
  clearTimeout(managerStatusWatchdog);
  var agency = agenciesCache.find(function(a){ return a.id === record.id; }) ||
    { id: record.id, name: record.name || 'Agency', location: record.location || '', verified: !!record.verified };
  return openManagerScreen(agency, token);
}
export function openManagerScreen(agency, token) {
  set_managerMode( true);
  set_managerAgency( agency);
  // Keep the token on the in-memory record so vacancy/branch writes can
  // authorize themselves server-side (workerManagerAddBranch etc).
  managerAgency.manage_token = token;
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
export function exitManagerMode() {
  set_managerMode( false);
  set_managerAgency( null);
  set_managerPendingToken( null);
  managerSession.agencyId = null;
  managerSession.agencyToken = null;
  managerSession.agencyAnalytics = null;
  managerSession.agencyMarketingPreference = null;
  managerCvBox = { open: false, token: '', loaded: false, loading: false, partner: false, items: [], total: 0, offset: 0, pageSize: 20, q: '', actionsLeft: null, error: '', revealed: {}, requested: false, searchTimer: null };
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
export function renderManagerMode() {
  if (!managerMode || !managerAgency) return;
  renderManagerAgencyProfile();
  renderAgencyMonthlyConsent();
  renderManagerCvBox();
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
        managerVacancyMetricsMarkup(v.id, managerSession.agencyAnalytics) +
      '</div>';
    });
  } else {
    vHtml = vacancyScreenStateMarkup('manager', false, false);
  }
  document.getElementById('manager-vacancy-list').innerHTML = vHtml;
}

export function renderAgencyMonthlyConsent() {
  var host = document.getElementById('manager-marketing-consent');
  if (!host || !managerAgency) return;
  var preference = managerSession.agencyMarketingPreference;
  var email = String(preference && preference.email || managerAgency.email || '').trim();
  var available = !!preference && !!email;
  var optedIn = !!(preference && preference.opted_in === true);
  host.innerHTML =
    '<section class="manager-consent-card" aria-labelledby="manager-consent-title">' +
      '<div class="manager-consent-heading"><span class="manager-consent-icon" aria-hidden="true">✉</span><div><h2 id="manager-consent-title">Monthly free-listing reminder</h2><p>One email per month about listing your agency vacancies for free.</p></div></div>' +
      '<div class="manager-consent-email">Agency email: <strong>' + escapeHtml(email || 'No email on file') + '</strong></div>' +
      (available ?
        '<label class="manager-consent-choice"><input id="manager-agency-email-optin" type="checkbox" ' + (optedIn ? 'checked ' : '') + 'aria-describedby="manager-consent-copy">' +
          '<span id="manager-consent-copy">I want to receive one monthly email from SA Recruiters about listing my agency’s vacancies for free. I can unsubscribe at any time.</span></label>' +
        '<div class="manager-consent-actions"><button class="manager-consent-save" type="button" onclick="saveAgencyMonthlyEmailPreference()">Save preference</button><span id="manager-consent-status" role="status">' + (optedIn ? 'You are opted in. Uncheck and save to stop monthly emails.' : 'You are not opted in.') + '</span></div>' :
        '<p class="manager-consent-unavailable" role="status">Monthly email preferences are temporarily unavailable. No new opt-in has been recorded.</p>') +
    '</section>';
}

export async function saveAgencyMonthlyEmailPreference() {
  if (!managerAgency || !managerAgency.manage_token) return;
  var checkbox = document.getElementById('manager-agency-email-optin');
  var button = document.querySelector('#manager-marketing-consent .manager-consent-save');
  var status = document.getElementById('manager-consent-status');
  if (!checkbox || !button) return;
  var optedIn = checkbox.checked;
  checkbox.disabled = true;
  button.disabled = true;
  if (status) status.textContent = 'Saving preference…';
  try {
    var res = await fetch(R2_WORKER_URL + '/api/manager/email-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: managerAgency.manage_token, opted_in: optedIn })
    });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok || !data.ok || !data.preference) throw new Error(data.error || 'Preference could not be saved. Please try again.');
    managerSession.agencyMarketingPreference = data.preference;
    renderAgencyMonthlyConsent();
    showToast(data.preference.opted_in ? 'Monthly email opt-in saved' : 'Monthly emails turned off');
  } catch (error) {
    if (status) status.textContent = error && error.message || 'Preference could not be saved. Please try again.';
    checkbox.disabled = false;
    button.disabled = false;
  }
}

// ===== CV BOX FOR PARTNER AGENCIES (from the private Manager Link) =====
// The manager token only identifies the agency. The Worker returns candidates only when an admin has
// switched this agency to "CV Box partner"; contact details and CV files are fetched one candidate at
// a time and logged server-side (see 20261117_cv_box_partner_access.sql).
export var managerCvBox = { open: false, token: '', loaded: false, loading: false, partner: false, items: [], total: 0, offset: 0, pageSize: 20, q: '', actionsLeft: null, error: '', revealed: {}, requested: false, searchTimer: null };

function cvBoxSubmitLink() { return window.location.origin + '/?section=candidates&cvbox=submit'; }
function cvBoxSafeId(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, ''); }
function cvBoxWaHref(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.charAt(0) === '0') digits = '27' + digits.slice(1);
  return digits.length >= 9 ? 'https://wa.me/' + digits : '';
}
async function cvBoxPost(path, payload) {
  var res = await fetch(R2_WORKER_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token: managerAgency && managerAgency.manage_token }, payload || {})) });
  return res;
}

export async function managerCvBoxLoad(append) {
  if (!managerAgency || !managerAgency.manage_token) return;
  var st = managerCvBox;
  if (st.loading) return;
  st.loading = true; st.error = '';
  if (!append) { st.offset = 0; }
  renderManagerCvBox();
  try {
    var res = await cvBoxPost('/api/manager/cv-box', { q: st.q, offset: st.offset });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw new Error(data.error || 'The CV Box could not be loaded. Please try again.');
    st.loaded = true; st.token = managerAgency.manage_token; st.partner = data.partner === true;
    if (st.partner) {
      st.items = append ? st.items.concat(data.items || []) : (data.items || []);
      st.total = data.total || st.items.length; st.pageSize = data.page_size || 20; st.actionsLeft = data.actions_left;
    }
  } catch (e) { st.error = e && e.message || 'The CV Box could not be loaded. Please try again.'; }
  st.loading = false;
  renderManagerCvBox();
}

export function renderManagerCvBox() {
  var host = document.getElementById('manager-cvbox');
  if (!host || !managerAgency) return;
  var st = managerCvBox;
  if (st.open && !st.loaded && !st.loading && !st.error && st.token !== managerAgency.manage_token) { managerCvBoxLoad(false); }
  var link = cvBoxSubmitLink();
  var shareBlock =
    '<div class="mcb-share"><div class="mcb-share-title">Send your candidates to the CV Box</div>' +
    '<p>Partner agencies send their candidates, and anyone who asks about work, to add their CV here. Share this link in your email signature, WhatsApp replies and job adverts.</p>' +
    '<div class="mcb-link">' + escapeHtml(link) + '</div>' +
    '<div class="mcb-actions"><button type="button" class="mcb-btn" onclick="managerCvBoxCopyLink()">Copy link</button>' +
    '<button type="button" class="mcb-btn mcb-btn-alt" onclick="managerCvBoxShareLink()">Share on WhatsApp</button></div></div>';
  var body = '';
  if (st.loading && !st.loaded) {
    body = '<p class="mcb-note">Checking your CV Box access…</p>';
  } else if (st.error && !st.loaded) {
    body = '<p class="mcb-note mcb-error" role="alert">' + escapeHtml(st.error) + '</p><div class="mcb-actions"><button type="button" class="mcb-btn" onclick="managerCvBoxLoad(false)">Try again</button></div>';
  } else if (!st.partner) {
    body = '<p class="mcb-note">Partner agencies get access to every CV collected in the CV Box. To become a partner, start sending your candidates to the CV Box, then ask for access.</p>' +
      shareBlock +
      '<div class="mcb-actions"><button type="button" class="mcb-btn" id="mcb-request-btn" onclick="managerCvBoxRequest()"' + (st.requested ? ' disabled' : '') + '>' + (st.requested ? 'Request sent' : 'Request partner access') + '</button></div>' +
      '<p class="mcb-note" id="mcb-request-status" role="status">' + (st.requested ? 'Thank you. We will review your request and message you.' : '') + '</p>';
  } else {
    body = '<div class="mcb-badge">Partner access active</div>' +
      '<input id="mcb-search" class="mcb-search" type="search" placeholder="Search a profession, sector, name or town" value="' + escapeHtml(st.q) + '" oninput="managerCvBoxSearchInput(this.value)" aria-label="Search CV Box">' +
      '<div class="mcb-count" id="mcb-count"></div><div id="mcb-list"></div><div id="mcb-more"></div>' +
      '<p class="mcb-note">Candidate details are for recruitment purposes only. Every contact view and CV download is logged' + (st.actionsLeft != null ? ' (' + st.actionsLeft + ' left today)' : '') + '. Do not share or resell them.</p>' + shareBlock;
  }
  var hadSearch = document.getElementById('mcb-search');
  var focus = hadSearch && document.activeElement === hadSearch;
  host.innerHTML =
    '<section class="manager-consent-card mcb-card' + (st.open ? ' is-open' : '') + '" aria-labelledby="mcb-title">' +
      '<button type="button" class="mcb-toggle" onclick="managerCvBoxToggle()" aria-expanded="' + (st.open ? 'true' : 'false') + '" aria-controls="mcb-body">' +
        '<span class="manager-consent-icon" aria-hidden="true">CV</span>' +
        '<span class="mcb-toggle-text"><span class="mcb-toggle-title" id="mcb-title">CV Box</span><span class="mcb-toggle-sub">' + (st.open ? 'Tap to close' : 'Tap to open') + '</span></span>' +
        '<span class="mcb-chevron" aria-hidden="true">' + (st.open ? '−' : '+') + '</span>' +
      '</button>' +
      (st.open ? '<div id="mcb-body">' + body + '</div>' : '') + '</section>';
  if (st.open && st.loaded && st.partner) {
    renderManagerCvBoxList();
    if (focus) { var el = document.getElementById('mcb-search'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} } }
  }
}

function renderManagerCvBoxList() {
  var st = managerCvBox, list = document.getElementById('mcb-list');
  if (!list) return;
  var count = document.getElementById('mcb-count');
  if (count) count.textContent = st.total ? st.total + (st.total === 1 ? ' candidate' : ' candidates') : '';
  if (!st.items.length) { list.innerHTML = '<p class="mcb-note">' + (st.loading ? 'Searching…' : (st.q ? 'No candidates match your search.' : 'No candidates in the CV Box yet.')) + '</p>'; }
  else list.innerHTML = st.items.map(function(c) {
    var id = cvBoxSafeId(c.id), rev = st.revealed[id];
    var meta = [c.location, c.experience_years ? c.experience_years + ' yrs experience' : '', c.sector].filter(Boolean).map(escapeHtml).join(' · ');
    var contact = '';
    if (rev) {
      var wa = cvBoxWaHref(rev.phone);
      contact = '<div class="mcb-contact">' +
        (rev.phone ? '<a href="tel:' + escapeHtml(rev.phone.replace(/[^\d+]/g, '')) + '">' + escapeHtml(rev.phone) + '</a>' + (wa ? ' · <a href="' + escapeHtml(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') : '') +
        (rev.email ? '<div><a href="mailto:' + escapeHtml(rev.email) + '">' + escapeHtml(rev.email) + '</a></div>' : '') +
        (!rev.phone && !rev.email ? '<span class="mcb-note">No separate contact details on file. Check the CV.</span>' : '') + '</div>';
    }
    return '<div class="mcb-item"><div class="mcb-item-head"><div><div class="mcb-name">' + escapeHtml(c.full_name || 'Candidate') + (c.verified ? ' <span class="mcb-ok" title="Verified">✓</span>' : '') + '</div>' +
      '<div class="mcb-role">' + escapeHtml(c.position || '') + '</div></div>' +
      (c.availability ? '<span class="mcb-chip' + (c.availability_expired ? ' mcb-chip-old' : '') + '">' + escapeHtml(c.availability_expired ? 'Availability to confirm' : c.availability) + '</span>' : '') + '</div>' +
      (meta ? '<div class="mcb-meta">' + meta + '</div>' : '') +
      (c.about_you ? '<div class="mcb-about">' + escapeHtml(c.about_you) + '</div>' : '') + contact +
      '<div class="mcb-actions">' +
        (rev ? '' : '<button type="button" class="mcb-btn" onclick="managerCvBoxReveal(\'' + id + '\', this)"' + (c.has_contact ? '' : ' disabled title="No contact details on file"') + '>Show contact</button>') +
        '<button type="button" class="mcb-btn mcb-btn-alt" onclick="managerCvBoxDownload(\'' + id + '\', this)"' + (c.has_cv ? '' : ' disabled title="No CV file on file"') + '>Download CV</button>' +
      '</div></div>';
  }).join('');
  var more = document.getElementById('mcb-more');
  if (more) more.innerHTML = (st.items.length < st.total) ? '<div class="mcb-actions"><button type="button" class="mcb-btn mcb-btn-alt" onclick="managerCvBoxMore()"' + (st.loading ? ' disabled' : '') + '>Load more</button></div>' : '';
}

export function managerCvBoxToggle() { managerCvBox.open = !managerCvBox.open; renderManagerCvBox(); }
export function managerCvBoxSearchInput(value) {
  var st = managerCvBox; st.q = String(value || '').slice(0, 60);
  clearTimeout(st.searchTimer);
  st.searchTimer = setTimeout(function() { managerCvBoxLoad(false); }, 350);
}
export function managerCvBoxMore() { managerCvBox.offset = managerCvBox.items.length; managerCvBoxLoad(true); }

export async function managerCvBoxReveal(id, btn) {
  id = cvBoxSafeId(id); if (!id) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    var res = await cvBoxPost('/api/manager/cv-box/candidate', { id: id });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw new Error(data.error || 'Could not load the contact details.');
    managerCvBox.revealed[id] = { phone: data.phone || '', email: data.email || '' };
    if (managerCvBox.actionsLeft != null) managerCvBox.actionsLeft = Math.max(0, managerCvBox.actionsLeft - 1);
    renderManagerCvBox();
  } catch (e) {
    showToast(e && e.message || 'Could not load the contact details.');
    if (btn) { btn.disabled = false; btn.textContent = 'Show contact'; }
  }
}

export async function managerCvBoxDownload(id, btn) {
  id = cvBoxSafeId(id); if (!id) return;
  var label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    var res = await cvBoxPost('/api/manager/cv-box/download', { id: id });
    if (!res.ok) { var err = await res.json().catch(function(){ return {}; }); throw new Error(err.error || 'Could not download this CV.'); }
    var blob = await res.blob();
    var cd = res.headers.get('Content-Disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = m ? m[1] : 'SA-Recruiters-CV.pdf'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    if (managerCvBox.actionsLeft != null) managerCvBox.actionsLeft = Math.max(0, managerCvBox.actionsLeft - 1);
    showToast('CV downloaded');
  } catch (e) { showToast(e && e.message || 'Could not download this CV.'); }
  if (btn) { btn.disabled = false; btn.textContent = label || 'Download CV'; }
}

export async function managerCvBoxRequest() {
  var btn = document.getElementById('mcb-request-btn'), status = document.getElementById('mcb-request-status');
  if (btn) btn.disabled = true;
  try {
    var res = await cvBoxPost('/api/manager/cv-box/request', {});
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send your request. Please try again.');
    managerCvBox.requested = true; renderManagerCvBox();
  } catch (e) {
    if (btn) btn.disabled = false;
    if (status) status.textContent = e && e.message || 'Could not send your request. Please try again.';
  }
}
export function managerCvBoxCopyLink() { copyText(cvBoxSubmitLink()); showToast('CV Box link copied'); }
export function managerCvBoxShareLink() {
  var text = 'Looking for work? Add your CV free to the SA Recruiters CV Box: ' + cvBoxSubmitLink();
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

export function managerVacancyMetricsMarkup(vacancyId, analytics) {
  if (!Array.isArray(analytics)) {
    return '<div class="manager-metrics-unavailable">Activity totals are temporarily unavailable.</div>';
  }
  var row = analytics.find(function(item) { return String(item.vacancy_id) === String(vacancyId); }) || {};
  var clicks = Math.max(0, Math.floor(Number(row.apply_clicks) || 0));
  var applications = Math.max(0, Math.floor(Number(row.self_reported_applications) || 0));
  return '<div class="manager-metrics" role="group" aria-label="Tracked activity in the last 30 days">' +
    '<div class="manager-metrics-period">Last 30 days</div>' +
    '<div class="manager-metrics-counts"><span><strong>' + clicks.toLocaleString('en-ZA') + '</strong> apply-link clicks</span>' +
    '<span><strong>' + applications.toLocaleString('en-ZA') + '</strong> self-reported applications</span></div>' +
    '<div class="manager-metrics-note">Application reports are voluntary and not independently verified.</div>' +
  '</div>';
}

// Small profile card shown at the top of the agency self-service screen so
// the agency can confirm who they're managing — mirrors the admin card's
// photo + contact details (read-only here; edits go through the admin).
export function renderManagerAgencyProfile() {
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
      '<div class="sm-card-avatar">' + (a.photo ? '<img loading="lazy" decoding="async" src="' + a.photo + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : initials(a.name)) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="sm-card-name">' + escapeHtml(a.name || 'Agency') + (a.verified ? ' ' + verifiedBadge('Verified') : '') + '</div>' +
      '</div>' +
    '</div>' +
    (rows || '<div class="manager-item-sub">No contact details on file yet.</div>');
}
export function managerAddBranch() {
  if (!managerAgency) return;
  // Use openBranchSheet in "add" mode (no branchId) so the title and
  // pendingBranchId stay consistent with the edit-aware branch sheet.
  openBranchSheet(managerAgency.id, null);
}
export function managerAddVacancy() {
  if (!managerAgency) return;
  set_pendingVacancyAgency( managerAgency.id);
  document.getElementById('v-title').value = '';
  document.getElementById('v-location').value = '';
  document.getElementById('v-closing').value = '';
  document.getElementById('v-notes').value = '';
  document.getElementById('v-link').value = '';
  document.getElementById('vacancy-overlay').classList.add('open');
}



// ===== window bridge (generated by the ES-module migration) =====
// Inline onclick=""/oninput="" handlers in index.html, string-built handlers in the
// templates above, and the classic scripts (app-vacancy-v2.js, app-alerts.js,
// content*.js) look these names up on window, exactly like they did when every
// file shared one global scope. Remove an entry only after checking nothing
// outside the module graph reads it.
export function set_managerTokenKind(v) { managerTokenKind = v; return v; }
export function set_managerStatusWatchdog(v) { managerStatusWatchdog = v; return v; }
Object.assign(window, {
  goSmartManager,
  renderSmartManager,
  filterSmartManager,
  copyManagerLink,
  shareManagerLink,
  shareAgency,
  shareVacancy,
  shareCvPic,
  openManagerLink,
  verifyManagerTokenServer,
  showManagerStatus,
  retryManagerTokenFromStatus,
  enterManagerMode,
  openManagerScreen,
  exitManagerMode,
  renderManagerMode,
  renderManagerAgencyProfile,
  renderAgencyMonthlyConsent,
  saveAgencyMonthlyEmailPreference,
  renderManagerCvBox,
  managerCvBoxToggle,
  managerCvBoxLoad,
  managerCvBoxSearchInput,
  managerCvBoxMore,
  managerCvBoxReveal,
  managerCvBoxDownload,
  managerCvBoxRequest,
  managerCvBoxCopyLink,
  managerCvBoxShareLink,
  managerAddBranch,
  managerAddVacancy,
});
Object.defineProperties(window, {
  managerTokenRetries: { get: () => managerTokenRetries, set: (v) => { managerTokenRetries = v; }, configurable: true, enumerable: true },
  MANAGER_TOKEN_MAX_RETRIES: { get: () => MANAGER_TOKEN_MAX_RETRIES, set: (v) => { MANAGER_TOKEN_MAX_RETRIES = v; }, configurable: true, enumerable: true },
  managerTokenKind: { get: () => managerTokenKind, set: (v) => { managerTokenKind = v; }, configurable: true, enumerable: true },
  managerStatusWatchdog: { get: () => managerStatusWatchdog, set: (v) => { managerStatusWatchdog = v; }, configurable: true, enumerable: true },
  managerSession: { get: () => managerSession, set: (v) => { managerSession = v; }, configurable: true, enumerable: true },
});
