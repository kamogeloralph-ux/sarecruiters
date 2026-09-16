/*
 * SA Recruiters -- app.js split 6/8: app-ui.js
 * Admin stubs, bottom nav, toast, force-update, retry banner, version badge, ripple, submissions + all-list views, vacancy folder rendering
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

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
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-profile').classList.contains('active') ? 'profile' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allagencies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllAgenciesList();
}

function showAllBranches() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-profile').classList.contains('active') ? 'profile' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allbranches').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllBranchesList();
}

function showAllVacancies() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-profile').classList.contains('active') ? 'profile' : 'home');
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

// Combined overview: null shows source folders; a folder value shows that
// source's complete filtered list.
var allVacanciesFolder = null;
var vacancyFolderDisplayLimit = 30;
var vacancyFolderDisplayKey = '';
function openVacancyFolder(type) {
  allVacanciesFolder = type;
  vacancyFolderDisplayLimit = 30;
  vacancyFolderDisplayKey = '';
  if (type === 'general') {
    generalVacancyQueryKey = '__open__';
    generalVacancyHasMore = true;
  }
  // Filters are shared by the folder picker and its listing view, so a user
  // can narrow the category before opening it and keep that context.
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}
function closeVacancyFolder() {
  allVacanciesFolder = null;
  vacancyFolderDisplayLimit = 30;
  vacancyFolderDisplayKey = '';
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}
function renderGeneralVacancyCards(append) {
  var el = document.getElementById('allvacancies-list');
  var loadMore = document.getElementById('allvacancies-loadmore');
  var countLabel = document.getElementById('allvacancies-result-count');
  if (!el) return;
  if (generalVacancyLoading && !generalVacancyRows.length) {
    el.dataset.state = 'loading';
    el.innerHTML = '<div class="empty-state"><h3>Loading vacancies…</h3><p>Fetching the latest opportunities.</p></div>';
  } else if (!generalVacancyRows.length) {
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, !!generalVacancyQueryKey);
  } else {
    el.dataset.state = 'ready';
    var cards = generalVacancyRows.map(function(v){
      var agency = v.agency_id && v.agency_id !== 'general' ? (agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {}) : {};
      return vacancyCard(v, agency);
    }).join('');
    el.innerHTML = '<div class="pgroup-label">General Vacancies</div>' + cards;
  }
  if (countLabel) countLabel.textContent = generalVacancyCount ? generalVacancyRows.length + ' of ' + generalVacancyCount + ' loaded' : generalVacancyRows.length + ' loaded';
  if (loadMore) {
    loadMore.style.display = generalVacancyHasMore ? 'block' : 'none';
    loadMore.disabled = generalVacancyLoading;
    loadMore.textContent = generalVacancyLoading ? 'Loading vacancies…' : 'Load more vacancies';
  }
}
async function loadGeneralVacancies(reset) {
  var state = generalVacancyQueryState();
  var key = generalVacancyQueryKeyFor(state);
  var queryChanged = reset || key !== generalVacancyQueryKey;
  if (queryChanged) {
    generalVacancyRequestId++;
    generalVacancyQueryKey = key;
    generalVacancyPage = 0;
    generalVacancyRows = [];
    generalVacancyHasMore = true;
    generalVacancyLoading = false;
    var industrySel = document.getElementById('allvacancies-industry');
    if (industrySel) industrySel.style.display = 'none';
  }
  if (generalVacancyLoading || !generalVacancyHasMore) { renderGeneralVacancyCards(false); return; }
  var requestId = ++generalVacancyRequestId;
  generalVacancyLoading = true;
  renderGeneralVacancyCards(false);
  try {
    var page = await fetchGeneralVacancyPage(state, generalVacancyPage);
    if (requestId !== generalVacancyRequestId) return;
    matchVacanciesToAgencies(page, agenciesCache);
    page.forEach(function(v){
      if (v.agency_id && v.agency_id !== 'general' && !vacanciesCache.some(function(x){ return x.id === v.id; })) vacanciesCache.push(v);
    });
    // A matched record belongs in its agency section, not General Vacancies.
    generalVacancyRows = generalVacancyRows.concat(page.filter(isGeneralDirectoryVacancy)).filter(function(v){ return !isVacancyExpired(v); });
    generalVacancyHasMore = page.length === generalVacancyPageSize;
    generalVacancyPage += 1;
    renderGeneralVacancyCards(true);
  } catch(e) {
    if (requestId !== generalVacancyRequestId) return;
    var el = document.getElementById('allvacancies-list');
    if (el) el.innerHTML = '<div class="empty-state"><h3>Could not load vacancies</h3><p>Check your connection and try again.</p><button class="vac-load-more" onclick="loadGeneralVacancies(true)">Try again</button></div>';
    generalVacancyHasMore = true;
  } finally {
    if (requestId === generalVacancyRequestId) {
      generalVacancyLoading = false;
      renderGeneralVacancyCards(false);
    }
  }
}
function loadMoreGeneralVacancies() {
  if (allVacanciesFolder === 'general') loadGeneralVacancies(false);
  else {
    vacancyFolderDisplayLimit += 30;
    renderAllVacanciesList();
  }
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

  if (allVacanciesFolder === 'general') {
    loadGeneralVacancies(false);
    return;
  }
  var generalIndustrySel = document.getElementById('allvacancies-industry');
  if (generalIndustrySel) generalIndustrySel.style.display = '';

  var el = document.getElementById('allvacancies-list');
  if (el) el.dataset.state = 'ready';
  // Employer-posted vacancies are exclusive to their employer's own hub card
  // (see employerHubVacancies) and are gated behind Talent Pool verification
  // there — they never appear in this general/public vacancies list.
  // Source folders are independent views: a vacancy may also belong to its
  // matched agency or employer. Keep source rows visible in Adzuna/Retail
  // even after they have been assigned to an organization.
  var visible = vacanciesCache.slice();
  var isHimalayasVacancy = function(v){ return v.source_type === 'himalayas' || String(v.id || '').indexOf('himalayas-') === 0; };
  var isAdzunaVacancy = function(v){ return v.source_type === 'adzuna' || String(v.id || '').indexOf('adzuna-') === 0; };
  var isDpsaVacancy = function(v){ return v.source_type === 'dpsa' || String(v.id || '').indexOf('dpsa-') === 0; };
  var isRetailVacancy = function(v){ return ['retail','shoprite','picknpay','woolworths','truworths','spar'].indexOf(String(v.source_type || '').toLowerCase()) !== -1 || /^(retail|shoprite|picknpay|woolworths|truworths|spar)-/i.test(String(v.id || '')); };
  var isExternalVacancy = function(v){ return isHimalayasVacancy(v) || isAdzunaVacancy(v) || isDpsaVacancy(v) || isRetailVacancy(v); };

  var q = ((document.getElementById('allvacancies-search')||{}).value || '').trim().toLowerCase();
  var remoteFilter = ((document.getElementById('allvacancies-remote')||{}).value || '');
  var expFilter = ((document.getElementById('allvacancies-exp')||{}).value || '');
  var industryFilter = ((document.getElementById('allvacancies-industry')||{}).value || '');
  var displayKey = [allVacanciesFolder || 'overview', q, remoteFilter, expFilter, industryFilter].join('|').toLowerCase();
  if (displayKey !== vacancyFolderDisplayKey) {
    vacancyFolderDisplayKey = displayKey;
    vacancyFolderDisplayLimit = 30;
  }
  var list = allVacanciesFolder === 'agency'
    ? visible.filter(hasAssignedAgency)
    : allVacanciesFolder === 'general'
      ? visible.filter(isGeneralDirectoryVacancy)
      : allVacanciesFolder === 'himalayas'
        ? visible.filter(isHimalayasVacancy)
        : allVacanciesFolder === 'adzuna'
          ? visible.filter(isAdzunaVacancy)
                : allVacanciesFolder === 'dpsa'
                  ? visible.filter(isDpsaVacancy)
                  : allVacanciesFolder === 'retail'
                    ? visible.filter(isRetailVacancy)
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
    var agencyCount = list.filter(hasAssignedAgency).length;
    var generalCount = generalVacancyCount;
    var himalayasCount = list.filter(isHimalayasVacancy).length;
    var adzunaCount = list.filter(isAdzunaVacancy).length;
    var dpsaCount = list.filter(isDpsaVacancy).length;
    var retailCount = list.filter(isRetailVacancy).length;
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
        '<button class="vac-folder-card vac-folder-card-himalayas" data-ripple onclick="openVacancyFolder(\'himalayas\')" aria-label="Open Himalayas remote vacancies">' +
          '<span class="vac-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z"/></svg></span>' +
          '<span class="vac-folder-copy"><span class="vac-folder-title">Himalayas Remote</span><span class="vac-folder-count">' + folderCountLabel(himalayasCount) + '</span></span>' +
          '<span class="vac-folder-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
        '</button>' +
        '<button class="vac-folder-card vac-folder-card-adzuna" data-ripple onclick="openVacancyFolder(\'adzuna\')" aria-label="Open Adzuna vacancies">' +
          '<span class="vac-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19 10.5 5h3L20 19M7 14h10"/></svg></span>' +
          '<span class="vac-folder-copy"><span class="vac-folder-title">Adzuna Vacancies</span><span class="vac-folder-count">' + folderCountLabel(adzunaCount) + '</span></span>' +
          '<span class="vac-folder-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
        '</button>' +
        '<button class="vac-folder-card vac-folder-card-dpsa" data-ripple onclick="openVacancyFolder(\'dpsa\')" aria-label="Open DPSA circular archive">' +
          '<span class="vac-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg></span>' +
          '<span class="vac-folder-copy"><span class="vac-folder-title">DPSA Circular Archive</span><span class="vac-folder-count">' + folderCountLabel(dpsaCount) + '</span></span>' +
          '<span class="vac-folder-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
        '</button>' +
        '<button class="vac-folder-card vac-folder-card-retail" data-ripple onclick="openVacancyFolder(\'retail\')" aria-label="Open retail vacancies">' +
          '<span class="vac-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16M6 10v9h12v-9M5 10l1-5h12l1 5M9 19v-5h6v5"/><path d="M8 5V3h8v2"/></svg></span>' +
          '<span class="vac-folder-copy"><span class="vac-folder-title">Retail Vacancies</span><span class="vac-folder-count">' + folderCountLabel(retailCount) + '</span></span>' +
          '<span class="vac-folder-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
        '</button>' +
      '</div>';
    return;
  }
  if (!list.length) {
    var hasFilters = !!(q || remoteFilter || expFilter || industryFilter);
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, hasFilters);
    var emptyLoadMore = document.getElementById('allvacancies-loadmore');
    if (emptyLoadMore) emptyLoadMore.style.display = 'none';
    return;
  }

  var totalFolderRows = list.length;
  var displayList = list.slice(0, vacancyFolderDisplayLimit);
  var resultCount = document.getElementById('allvacancies-result-count');
  if (resultCount) resultCount.textContent = displayList.length + ' of ' + totalFolderRows + ' loaded';
  var folderLoadMore = document.getElementById('allvacancies-loadmore');
  if (folderLoadMore) {
    folderLoadMore.style.display = displayList.length < totalFolderRows ? 'block' : 'none';
    folderLoadMore.disabled = false;
    folderLoadMore.textContent = 'Load more vacancies';
  }

  var groups = {};
  displayList.forEach(function(v){
    if (allVacanciesFolder !== 'agency' && isHimalayasVacancy(v)) {
      var himalayasKey = 'himalayas';
      if (!groups[himalayasKey]) groups[himalayasKey] = { name:'Himalayas remote vacancies', type:'Himalayas Remote', agency:null, items:[] };
      groups[himalayasKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isAdzunaVacancy(v)) {
      var adzunaKey = 'adzuna';
      if (!groups[adzunaKey]) groups[adzunaKey] = { name:'Adzuna vacancies', type:'Adzuna', agency:null, items:[] };
      groups[adzunaKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isDpsaVacancy(v)) {
      var dpsaKey = 'dpsa';
      if (!groups[dpsaKey]) groups[dpsaKey] = { name:'DPSA circular archive', type:'Government circulars', agency:null, items:[] };
      groups[dpsaKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isRetailVacancy(v)) {
      var retailKey = 'retail';
      if (!groups[retailKey]) groups[retailKey] = { name:'Retail vacancies', type:'Retail', agency:null, items:[] };
      groups[retailKey].items.push(v);
      return;
    }
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
  var sectionTitle = allVacanciesFolder === 'agency' ? 'Agency Vacancies' : allVacanciesFolder === 'general' ? 'General Vacancies' : allVacanciesFolder === 'himalayas' ? 'Himalayas Remote Vacancies' : allVacanciesFolder === 'adzuna' ? 'Adzuna Vacancies' : allVacanciesFolder === 'dpsa' ? 'DPSA Circular Archive' : 'Retail Vacancies';
  el.innerHTML = '<div class="pgroup-label">' + sectionTitle + '</div>' + keys.map(function(key){
    var group = groups[key];
    group.items = sortVacancies(group.items);
    var agency = group.agency || {};
    var cards = group.items.map(function(v){ return vacancyCard(v, agency); }).join('');
    var groupVerified = group.type === 'Agency' && group.agency && group.agency.verified;
    var groupVerifiedCheck = groupVerified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
    var groupHead = allVacanciesFolder === 'agency'
      ? '<div class="directory-group-head"><div><div class="directory-group-title">' + groupVerifiedCheck + escapeHtml(group.name) + '</div></div></div>'
      : '';
    return '<section class="directory-group vacancy-directory-group" aria-label="' + escapeHtml(group.name) + '">' + groupHead + cards + '</section>';
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

