/*
 * SA Recruiters -- app.js split 8/8: app-manager-employer.js
 * Employer self-service Manager Mode, alert unsubscribe, URL manager-token detection, idle refresh, PWA shortcut handling
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

// ===== EMPLOYER MANAGER MODE (employer self-service, vacancies only) =====
// Mirrors the agency manager mode above, but scoped to a single employer's
// vacancies via ?manage_employer=TOKEN. Employers can add vacancies for
// themselves here; everything else (contact details, verification) stays
// admin-controlled. Once saved, a vacancy is read-only from this screen.
var employerManagerTokenRetries = 0;
var EMPLOYER_MANAGER_TOKEN_MAX_RETRIES = 2;
async function enterEmployerManagerMode(token) {
  if (!employerManagerMode) showManagerStatus('loading', 'Loading your manager link…', 'We\'re connecting to SA Recruiters. This usually takes a moment.');
  // Fast path: an already-resolved session for this token.
  if (managerSession.employerId && managerSession.employerToken === token) {
    var cachedEmployer = employersCache.find(function(e){ return e.id === managerSession.employerId; }) ||
      { id: managerSession.employerId, name: managerSession.employerName || 'Company', location: managerSession.employerLocation || '', verified: false };
    return openEmployerManagerScreen(cachedEmployer, token);
  }
  // Server-side verification only — see the note in app-manager.js.
  var record = await verifyManagerTokenServer('employer', token);
  if (!record) {
    if (employerManagerTokenRetries < EMPLOYER_MANAGER_TOKEN_MAX_RETRIES) {
      employerManagerTokenRetries++;
      employerManagerPendingToken = token;
      managerTokenKind = 'employer';
      var backoff = 1500 + employerManagerTokenRetries * 800;
      bumpManagerWatchdog(backoff + 8000);
      setTimeout(function(){
        if (employerManagerPendingToken) {
          employerManagerPendingToken = null;
          enterEmployerManagerMode(token);
        }
      }, backoff);
      return false;
    }
    employerManagerTokenRetries = 0;
    employerManagerPendingToken = null;
    managerTokenKind = null;
    showManagerStatus('error',
      'This management link is invalid or expired',
      'We couldn\'t find a company for this link. It may have expired or been replaced. Please request a new link from SA Recruiters, or try again in case the connection was interrupted.');
    return false;
  }
  managerSession.employerId = record.id;
  managerSession.employerToken = token;
  managerSession.employerName = record.name;
  managerSession.employerLocation = record.location;
  employerManagerTokenRetries = 0;
  employerManagerPendingToken = null;
  managerTokenKind = null;
  clearTimeout(managerStatusWatchdog);
  var employer = employersCache.find(function(e){ return e.id === record.id; }) ||
    { id: record.id, name: record.name || 'Company', location: record.location || '', verified: !!record.verified };
  return openEmployerManagerScreen(employer, token);
}
function openEmployerManagerScreen(employer, token) {
  employerManagerMode = true;
  managerEmployer = employer;
  // Keep the token on the in-memory record so writes authorize server-side.
  managerEmployer.manage_token = token;
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
  managerSession.employerId = null;
  managerSession.employerToken = null;
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

// Fast-path token resolution is now server-side: enterManagerMode /
// enterEmployerManagerMode call verifyManagerTokenServer() directly, so there
// is nothing useful to pre-fetch here. Kept as a no-op for compatibility with
// older retry timers that may still reference it.
async function fastResolveManagerToken() { /* resolution is server-side now */ }

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
    // Resolution is server-side and independent of loadAll(): verify the
    // token against the Worker immediately, in parallel with the directory
    // load below (whose tail also re-enters manager mode if the token is
    // still pending — that path is idempotent).
    if (token) enterManagerMode(token);
    if (empToken) enterEmployerManagerMode(empToken);
  }
})();

// Paint immediately from whatever was cached on the last successful load
// (if any), then loadAll() below fetches fresh data in the background and
// silently re-renders once it lands — so repeat visits never show a blank
// screen while waiting on the network. loadDataCache() reads from
// IndexedDB (async, off the main thread) rather than localStorage, but an
// IndexedDB read is on the order of a few ms — far faster than the
// loadAll() network round-trip kicked off right after it — so this still
// reliably wins the race and paints before live data arrives.
(async function() {
  if (await loadDataCache()) {
    updateStats();
    filterAndRenderCached();
    markAppDataReady();
  }
})();

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
