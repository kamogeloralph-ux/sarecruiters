/*
 * SA Recruiters -- app.js split 7/8: app-manager.js
 * Smart Manager admin section + agency self-service Manager Mode
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

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
// Resolved manager-link identities are cached for the session so repeated
// renders don't re-hit the verify endpoint.
var managerSession = { agencyId: null, employerId: null };

// SECURITY: verify a manager token SERVER-SIDE via the Cloudflare Worker,
// which calls the verify_manager_token Postgres RPC. Tokens are no longer
// comparable against public data in the browser (they are revoked from the
// anon role), so this is the only reliable resolution path.
async function verifyManagerTokenServer(kind, token) {
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
    return kind === 'employer' ? data.employer : data.agency;
  } catch (e) {
    return null;
  }
}

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
async function enterManagerMode(token) {
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
      managerPendingToken = token;
      managerTokenKind = 'agency';
      var backoff = 1500 + managerTokenRetries * 800;
      bumpManagerWatchdog(backoff + 8000);
      setTimeout(function(){
        if (managerPendingToken) {
          managerPendingToken = null;
          enterManagerMode(token);
        }
      }, backoff);
      return false;
    }
    managerTokenRetries = 0;
    managerPendingToken = null;
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
  managerTokenRetries = 0;
  managerPendingToken = null;
  managerTokenKind = null;
  clearTimeout(managerStatusWatchdog);
  var agency = agenciesCache.find(function(a){ return a.id === record.id; }) ||
    { id: record.id, name: record.name || 'Agency', location: record.location || '', verified: !!record.verified };
  return openManagerScreen(agency, token);
}
function openManagerScreen(agency, token) {
  managerMode = true;
  managerAgency = agency;
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
function exitManagerMode() {
  managerMode = false;
  managerAgency = null;
  managerPendingToken = null;
  managerSession.agencyId = null;
  managerSession.agencyToken = null;
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

