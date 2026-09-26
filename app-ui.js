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
var SA_ACTIVE_SCREEN_KEY = 'sa_active_screen_v1';
var SA_RESTORABLE_SCREENS = {
  home: true, account: true, saved: true, menu: true,
  allagencies: true, allbranches: true, allvacancies: true,
  allemployers: true, allposters: true, pool: true
};
function isRestorableScreen(name) {
  return !!SA_RESTORABLE_SCREENS[name];
}
function persistActiveScreen(name) {
  if (!isRestorableScreen(name)) return;
  try { sessionStorage.setItem(SA_ACTIVE_SCREEN_KEY, name); } catch(e) {}
}
function restoredScreenName() {
  try {
    var name = sessionStorage.getItem(SA_ACTIVE_SCREEN_KEY);
    return isRestorableScreen(name) ? name : 'home';
  } catch(e) { return 'home'; }
}
function restoreActiveScreenBeforeReveal() {
  // Manager links, PWA actions and promoted section links are URL-owned entry
  // points; never let an old consumer section override those destinations.
  var params = new URLSearchParams(window.location.search);
  if (params.has('manage') || params.has('manage_employer') || params.has('action') || params.has('tab') || params.has('section')) return;
  var name = restoredScreenName();
  var target = document.getElementById('screen-' + name);
  if (!target) return;
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  target.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  window.__saRestoredScreen = name;
}
restoreActiveScreenBeforeReveal();

// Public section links are intentionally query-based so Cloudflare Pages can
// serve the normal PWA shell while the link remains stable and easy to share:
// /?section=vacancies, /?section=agencies, /?section=candidates,
// /?section=posters and /?section=employers.
var SA_SECTION_LINKS = {
  vacancies: { label: 'Vacancies', title: 'SA Recruiters — Vacancies' },
  agencies: { label: 'Recruitment agencies', title: 'SA Recruiters — Recruitment Agencies' },
  candidates: { label: 'Join the Talent Pool', title: 'SA Recruiters — Join the Talent Pool', shareKey: 'talent-pool' },
  posters: { label: 'Vacancy posters', title: 'SA Recruiters — Vacancy Posters' },
  employers: { label: 'Employers', title: 'SA Recruiters — Employers' }
};
function getSectionLink(section) {
  if (!SA_SECTION_LINKS[section]) return '';
  var key = SA_SECTION_LINKS[section].shareKey || section;
  return window.location.origin + '/?section=' + encodeURIComponent(key);
}
function shareSectionLink(section) {
  var meta = SA_SECTION_LINKS[section];
  var link = getSectionLink(section);
  if (!meta || !link) return;
  var shareLabel = section === 'candidates' ? 'Join the Talent Pool' : meta.label;
  var text = (section === 'candidates' ? shareLabel : 'Explore ' + shareLabel.toLowerCase()) + ' on SA Recruiters: ' + link;
  if (navigator.share) {
    navigator.share({ title: meta.title, text: text, url: link }).catch(function() {});
  } else {
    copyText(link, null);
    showToast(meta.label + ' link copied');
  }
}
function openDeepLinkedSection() {
  var section = new URLSearchParams(window.location.search).get('section');
  if (section === 'talent-pool') section = 'candidates';
  if (!SA_SECTION_LINKS[section]) return;
  // Treat a promoted URL like a restored screen. loadAll() calls
  // renderRestoredScreenContent() after IndexedDB/live data hydration, which
  // prevents the destination from staying on an early loading/count state.
  var screenBySection = {
    vacancies: 'allvacancies', agencies: 'allagencies', candidates: 'pool',
    posters: 'allposters', employers: 'allemployers'
  };
  window.__saRestoredScreen = screenBySection[section];
  if (section === 'vacancies') showAllVacancies('home');
  else if (section === 'agencies') showAllAgencies('home');
  else if (section === 'candidates') goPool('home');
  else if (section === 'posters') showVacancyPosters('home');
  else if (section === 'employers') showAllEmployers('home');
}
// Wait until the normal boot has painted the shell; the destination functions
// then render from IndexedDB immediately and refresh from the network normally.

// All navigation paths in this app eventually toggle a screen's `active`
// class. Observing that single state change keeps refresh restoration in sync
// without relying on every individual menu/card handler remembering to call a
// second persistence helper.
if (window.MutationObserver) {
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') return;
      var el = m.target;
      if (!el.classList.contains('screen') || !el.classList.contains('active')) return;
      persistActiveScreen(el.id.replace(/^screen-/, ''));
    });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
function openSiteMenu() {
  var drawer = document.getElementById('site-menu-drawer');
  var backdrop = document.getElementById('site-menu-backdrop');
  var trigger = document.getElementById('site-menu-trigger');
  if (!drawer || !backdrop) return;
  drawer.classList.add('is-open');
  backdrop.classList.add('is-visible');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.setAttribute('aria-hidden', 'false');
  document.querySelectorAll('.site-menu-trigger').forEach(function(btn) { btn.setAttribute('aria-expanded', 'true'); });
  document.body.classList.add('site-menu-open');
}
function closeSiteMenu() {
  var drawer = document.getElementById('site-menu-drawer');
  var backdrop = document.getElementById('site-menu-backdrop');
  var trigger = document.getElementById('site-menu-trigger');
  if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
  if (backdrop) { backdrop.classList.remove('is-visible'); backdrop.setAttribute('aria-hidden', 'true'); }
  // The trigger exists in every screen's header (the iOS-style site menu update);
  // return focus to the one on the screen the user is actually viewing.
  var activeTrigger = document.querySelector('.screen.active .site-menu-trigger') || trigger;
  document.querySelectorAll('.site-menu-trigger').forEach(function(btn) { btn.setAttribute('aria-expanded', 'false'); });
  if (activeTrigger) activeTrigger.focus();
  document.body.classList.remove('site-menu-open');
}
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeSiteMenu();
});

document.querySelectorAll('.navbtn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!btn.dataset.tab) return; // action buttons (e.g. Feedback) handle their own click
    document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById('screen-' + btn.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0 });
    if (btn.dataset.tab === 'saved') renderSaved();
    if (btn.dataset.tab === 'account') renderAccountDetails();
  });
});

function renderRestoredScreenContent() {
  var name = window.__saRestoredScreen;
  if (!name) return;
  if (name === 'account' && typeof renderAccountDetails === 'function') renderAccountDetails();
  else if (name === 'saved' && typeof renderSaved === 'function') renderSaved();
  else if (name === 'allagencies' && typeof renderAllAgenciesList === 'function') renderAllAgenciesList();
  else if (name === 'allbranches' && typeof renderAllBranchesList === 'function') renderAllBranchesList();
  else if (name === 'allemployers' && typeof renderAllEmployersList === 'function') renderAllEmployersList();
  else if (name === 'allvacancies' && typeof renderAllVacanciesList === 'function') renderAllVacanciesList();
  else if (name === 'allposters') {
    if (typeof renderPosterFeed === 'function') renderPosterFeed(postersCache);
    if (typeof loadPosterFeed === 'function') loadPosterFeed();
  } else if (name === 'pool' && typeof loadPoolCandidates === 'function') {
    loadPoolCandidates();
  }
}
window.renderRestoredScreenContent = renderRestoredScreenContent;

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
  var targetId = poolReturnScreen === 'profile' ? 'screen-account' : 'screen-home';
  var target = document.getElementById(targetId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === (poolReturnScreen === 'profile' ? 'account' : 'home')); });
  resetActiveScreenScroll(targetId);
}
window.closeTalentPool = closeTalentPool;
function goBackFromPool() {
  closeTalentPool();
}
function goBackToProfile() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-account').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'account'); });
  resetActiveScreenScroll('screen-account');
}

// ===== MY ACCOUNT (general signed-in profile) =====
// A general account view — Google identity, preferences and activity — that is
// deliberately separate from the Talent Pool product. The Talent Pool listing
// stays a scoped section inside it ("Your listing"), not the account itself.
var accountReturnScreen = 'profile';

function openAccountScreen() {
  var active = document.querySelector('.screen.active');
  accountReturnScreen = active && active.id !== 'screen-account' ? active.id.replace(/^screen-/, '') : accountReturnScreen || 'profile';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-account').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'account'); });
  resetActiveScreenScroll('screen-account');
  renderAccountDetails();
}
window.openAccountScreen = openAccountScreen;

// Keyboard activation for the drawer's account card (role="button" div):
// Enter/Space opens the account screen, other keys are ignored. Clicks are
// handled by the card's own onclick.
function activateAccountFromMenu(e) {
  if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  closeSiteMenu();
  openAccountScreen();
}
window.activateAccountFromMenu = activateAccountFromMenu;

// Composite cards are retained for the mobile visual design, but they must
// behave like native controls for keyboard and switch-device users.
document.addEventListener('keydown', function(e) {
  var el = e.target;
  if (!el || !el.classList) return;
  if ((el.classList.contains('stat-card') || el.classList.contains('vac-card')) &&
      (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    el.click();
  }
});

function goBackFromAccount() {
  var targetId = 'screen-' + (accountReturnScreen || 'profile');
  if (!document.getElementById(targetId)) targetId = 'screen-account';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById(targetId).classList.add('active');
  var tab = targetId.replace(/^screen-/, '');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === tab); });
  resetActiveScreenScroll(targetId);
}
window.goBackFromAccount = goBackFromAccount;

// Mirrors the identity (renderAuthUser) into the account hero card and
// switches the screen between guest mode (sign-in card + daily quota) and
// signed-in mode (Google identity + sign-out group).
function renderAccountIdentity(user) {
  var name = user && (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user.email) || 'Guest';
  var avatar = user && user.user_metadata && (user.user_metadata.profile_photo || user.user_metadata.avatar_url);
  var nameEl = document.getElementById('account-name');
  var emailEl = document.getElementById('account-email');
  var avatarEl = document.getElementById('account-avatar');
  var providerEl = document.getElementById('account-provider');
  if (nameEl) nameEl.textContent = user ? name : 'Guest';
  if (emailEl) emailEl.textContent = user ? (user.email || '—') : 'Browsing as a guest';
  if (avatarEl) {
    avatarEl.innerHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" alt="" referrerpolicy="no-referrer">' : '<span>' + escapeHtml((name || 'A').charAt(0).toUpperCase()) + '</span>';
  }
  if (providerEl) providerEl.style.display = user ? 'inline-flex' : 'none';
  // Guest chrome: sign-in card + quota meter. Signed-in chrome: sign-out.
  var signinCard = document.getElementById('account-signin-card');
  if (signinCard) signinCard.style.display = user ? 'none' : 'block';
  var quotaCard = document.getElementById('account-quota-card');
  if (quotaCard) quotaCard.style.display = user ? 'none' : 'block';
  var signoutGroup = document.getElementById('account-signout-group');
  if (signoutGroup) signoutGroup.style.display = user ? 'block' : 'none';
  var guestTeaser = document.getElementById('guest-teaser');
  if (guestTeaser) guestTeaser.style.display = user ? 'none' : 'flex';
  var meta = document.getElementById('account-meta');
  if (meta) {
    var joined = user && user.created_at ? new Date(user.created_at) : null;
    meta.textContent = joined && !isNaN(joined) ? 'Member since ' + joined.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) : '';
  }
  renderAccountQuota();
}

// Daily free-view meter shown to guests on the account screen.
function renderAccountQuota() {
  var countEl = document.getElementById('account-quota-count');
  var fillEl = document.getElementById('account-quota-fill');
  var noteEl = document.getElementById('account-quota-note');
  if (saAuthUser) return; // signed-in users are unmetered; card is hidden
  if (typeof guestQuotaState !== 'function') return;
  var q = guestQuotaState();
  var left = Math.max(0, q.limit - q.used);
  if (countEl) countEl.textContent = left + ' of ' + q.limit + ' left';
  if (fillEl) {
    var pct = Math.round((left / q.limit) * 100);
    fillEl.style.width = pct + '%';
    fillEl.classList.toggle('low', left <= 1);
  }
  if (noteEl) noteEl.textContent = left > 0
    ? left + (left === 1 ? ' free view left today.' : ' free views left today — full access is unlocked with a free account.')
    : 'Free views used — create an account for unlimited access.';
}

// "Your listing" status: reflects whether the signed-in user currently has a
// pool_candidates row linked, so the account view stays honest about the fact
// that the Talent Pool is a product scoped to pool_candidates — not the
// account itself.
async function renderAccountPoolStatus() {
  var el = document.getElementById('account-pool-status');
  if (!el) return;
  if (!saAuthUser || !supabaseClient) { el.textContent = 'Join free — available after you create an account'; return; }
  try {
    var res = await supabaseClient.from('pool_candidates').select('id').eq('user_id', saAuthUser.id).limit(1).maybeSingle();
    if (el) el.textContent = (res && res.data) ? 'Listed — tap to edit your Mini-CV' : 'Not listed yet — join free';
  } catch(e) { /* keep default copy on failure */ }
}

function renderAccountDetails() {
  renderAccountIdentity(saAuthUser);
  renderAccountPoolStatus();
  renderProfileSettingsVisibility();
}
window.renderAccountDetails = renderAccountDetails;

// ===== PROFILE SETTINGS (edit name, photo, delete account) =====
// Available to signed-in users only. The name is stored on the Supabase auth
// user (user_metadata.full_name) and the photo is uploaded through the
// Worker's media endpoint (candidate-photos bucket, same pipeline as Talent
// Pool photos) with the URL kept in user_metadata.profile_photo.
function renderProfileSettingsVisibility() {
  var group = document.getElementById('account-settings-group');
  if (group) group.style.display = saAuthUser ? 'block' : 'none';
}
window.renderProfileSettingsVisibility = renderProfileSettingsVisibility;

function setProfileSettingsStatus(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || '';
}

function profilePhotoUrl() {
  return saAuthUser && saAuthUser.user_metadata && saAuthUser.user_metadata.profile_photo || null;
}

function openEditProfileSheet() {
  if (!saAuthUser) { showToast('Create your free account first — open sign-in below.'); return; }
  var nameEl = document.getElementById('ep-name');
  var emailEl = document.getElementById('ep-email');
  if (nameEl) nameEl.value = (saAuthUser.user_metadata && (saAuthUser.user_metadata.full_name || saAuthUser.user_metadata.name)) || '';
  if (emailEl) emailEl.value = saAuthUser.email || '';
  setProfileSettingsStatus('edit-profile-status', '');
  var overlay = document.getElementById('edit-profile-overlay');
  if (overlay) overlay.classList.add('open');
}
window.openEditProfileSheet = openEditProfileSheet;

async function saveProfileEdits() {
  var nameEl = document.getElementById('ep-name');
  var btn = document.getElementById('edit-profile-save-btn');
  var name = (nameEl && nameEl.value || '').trim();
  if (!name) { setProfileSettingsStatus('edit-profile-status', 'Please enter a display name.'); return; }
  if (!supabaseClient || !saAuthUser) { setProfileSettingsStatus('edit-profile-status', 'You need to be signed in.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  setProfileSettingsStatus('edit-profile-status', '');
  var meta = Object.assign({}, saAuthUser.user_metadata, { full_name: name });
  var res = await supabaseClient.auth.updateUser({ data: meta });
  if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
  if (res && res.error) {
    setProfileSettingsStatus('edit-profile-status', 'Could not save — ' + res.error.message);
    return;
  }
  saAuthUser = res && res.user ? res.user : saAuthUser;
  renderAuthUser(saAuthUser);
  renderAccountDetails();
  closeSheet('edit-profile-overlay');
  showToast('Profile updated');
}
window.saveProfileEdits = saveProfileEdits;

function openProfilePhotoSheet() {
  if (!saAuthUser) { showToast('Create your free account first — open sign-in below.'); return; }
  var url = profilePhotoUrl();
  var preview = document.getElementById('pp-preview');
  var fallback = document.getElementById('pp-fallback');
  var removeBtn = document.getElementById('profile-photo-remove-btn');
  window.pendingProfilePhotoBlob = null;
  if (preview) {
    if (url) { preview.src = url; preview.style.display = 'block'; if (fallback) fallback.style.display = 'none'; }
    else { preview.style.display = 'none'; if (fallback) fallback.style.display = 'flex'; }
  }
  if (removeBtn) removeBtn.style.display = url ? 'block' : 'none';
  setProfileSettingsStatus('profile-photo-status', '');
  var overlay = document.getElementById('profile-photo-overlay');
  if (overlay) overlay.classList.add('open');
}
window.openProfilePhotoSheet = openProfilePhotoSheet;

// Reuses the Talent Pool photo pipeline: centre-crop to a 512x512 square and
// keep the blob locally until Save, so nothing uploads until the user commits.
function handleProfilePhoto(evt) {
  var file = evt.target.files && evt.target.files[0];
  if (!file) return;
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
        window.pendingProfilePhotoBlob = blob;
        var preview = document.getElementById('pp-preview');
        var fallback = document.getElementById('pp-fallback');
        var url = URL.createObjectURL(blob);
        if (preview) { preview.src = url; preview.style.display = 'block'; }
        if (fallback) fallback.style.display = 'none';
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
window.handleProfilePhoto = handleProfilePhoto;

async function saveProfilePhoto() {
  var btn = document.getElementById('profile-photo-save-btn');
  if (!supabaseClient || !saAuthUser) { setProfileSettingsStatus('profile-photo-status', 'You need to be signed in.'); return; }
  var meta = Object.assign({}, saAuthUser.user_metadata);
  var existing = meta.profile_photo || null;
  if (window.pendingProfilePhotoBlob) {
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
    setProfileSettingsStatus('profile-photo-status', 'Uploading photo…');
    try {
      var res = await fetch(R2_WORKER_URL + '/api/upload/candidate-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: window.pendingProfilePhotoBlob
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok || !data.url) throw new Error((data && data.error) || 'Upload failed');
      meta.profile_photo = data.url;
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save photo'; }
      setProfileSettingsStatus('profile-photo-status', 'Photo upload failed — please try again.');
      return;
    }
  } else if (!existing) {
    setProfileSettingsStatus('profile-photo-status', 'Choose a photo first.');
    return;
  }
  var upd = await supabaseClient.auth.updateUser({ data: meta });
  if (btn) { btn.disabled = false; btn.textContent = 'Save photo'; }
  if (upd && upd.error) {
    setProfileSettingsStatus('profile-photo-status', 'Could not save — ' + upd.error.message);
    return;
  }
  saAuthUser = upd && upd.user ? upd.user : saAuthUser;
  window.pendingProfilePhotoBlob = null;
  renderAuthUser(saAuthUser);
  renderAccountDetails();
  closeSheet('profile-photo-overlay');
  showToast('Profile photo saved');
}
window.saveProfilePhoto = saveProfilePhoto;

async function removeProfilePhoto() {
  if (!supabaseClient || !saAuthUser) return;
  var meta = Object.assign({}, saAuthUser.user_metadata);
  delete meta.profile_photo;
  var btn = document.getElementById('profile-photo-remove-btn');
  if (btn) { btn.disabled = true; }
  var upd = await supabaseClient.auth.updateUser({ data: meta });
  if (btn) { btn.disabled = false; }
  if (upd && upd.error) {
    setProfileSettingsStatus('profile-photo-status', 'Could not remove the photo — please try again.');
    return;
  }
  saAuthUser = upd && upd.user ? upd.user : saAuthUser;
  window.pendingProfilePhotoBlob = null;
  renderAuthUser(saAuthUser);
  renderAccountDetails();
  var preview = document.getElementById('pp-preview');
  var fallback = document.getElementById('pp-fallback');
  var removeBtn = document.getElementById('profile-photo-remove-btn');
  if (preview) preview.style.display = 'none';
  if (fallback) fallback.style.display = 'flex';
  if (removeBtn) removeBtn.style.display = 'none';
  showToast('Profile photo removed');
}
window.removeProfilePhoto = removeProfilePhoto;

function openDeleteAccountSheet() {
  if (!saAuthUser) { showToast('You are browsing as a guest — nothing to delete.'); return; }
  var confirmEl = document.getElementById('da-confirm');
  if (confirmEl) confirmEl.value = '';
  setProfileSettingsStatus('delete-account-status', '');
  var overlay = document.getElementById('delete-account-overlay');
  if (overlay) overlay.classList.add('open');
}
window.openDeleteAccountSheet = openDeleteAccountSheet;

async function confirmDeleteAccount() {
  var confirmEl = document.getElementById('da-confirm');
  var btn = document.getElementById('delete-account-btn');
  if (!confirmEl || (confirmEl.value || '').trim().toUpperCase() !== 'DELETE') {
    setProfileSettingsStatus('delete-account-status', 'Type DELETE to confirm.');
    return;
  }
  if (!supabaseClient || !saAuthUser) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  setProfileSettingsStatus('delete-account-status', '');
  var authToken = null;
  try {
    var sessionResult = await supabaseClient.auth.getSession();
    authToken = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
  } catch(e) {}
  if (!authToken) {
    if (btn) { btn.disabled = false; btn.textContent = 'Delete my account permanently'; }
    setProfileSettingsStatus('delete-account-status', 'Could not verify your session — please sign in again.');
    return;
  }
  var ok = false;
  try {
    var res = await fetch(R2_WORKER_URL + '/api/account/delete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    var data = await res.json().catch(function(){ return {}; });
    ok = res.ok && data && data.ok;
    if (!ok) console.error('account delete', data && data.error);
  } catch(e) { console.error('account delete', e); }
  if (btn) { btn.disabled = false; btn.textContent = 'Delete my account permanently'; }
  if (!ok) {
    setProfileSettingsStatus('delete-account-status', 'Could not delete right now — please try again or contact support.');
    return;
  }
  closeSheet('delete-account-overlay');
  await signOutSaRecruiters();
  showToast('Your account has been deleted.');
}
window.confirmDeleteAccount = confirmDeleteAccount;

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
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allagencies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllAgenciesList();
}

function showAllBranches() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allbranches').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllBranchesList();
}

function showAllVacancies() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allvacancies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  allVacanciesFolder = null;
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}

// Vacancy posters live on their own screen, separate from All Vacancies.
function showVacancyPosters() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allposters').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  var search = document.getElementById('allposters-search');
  if (search) search.value = '';
  renderPosterFeed(postersCache);
  if (typeof loadPosterFeed === 'function') loadPosterFeed();
  resetActiveScreenScroll('screen-allposters');
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
  var middleAt = Math.max(1, Math.ceil(list.length / 2));
  el.innerHTML = list.map(function(item, index){ return (index === middleAt ? '<div id="house-ad-agencies-middle" class="house-ad-slot" hidden></div>' : '') + hubCard(item); }).join('');
  renderHouseAdSlots();
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
function handleVacanciesBack() {
  if (allVacanciesFolder) closeVacancyFolder();
  else goBackFromDirectory();
}
function updateVacanciesBackButton() {
  var btn = document.getElementById('allvacancies-back');
  if (!btn) return;
  btn.setAttribute('aria-label', allVacanciesFolder ? 'Back to vacancy categories' : 'Back to home menu');
  btn.title = allVacanciesFolder ? 'Back to vacancy categories' : 'Back to home menu';
}
function openVacancyFolder(type) {
  allVacanciesFolder = type;
  vacancyFolderDisplayLimit = 30;
  vacancyFolderDisplayKey = '';
  if (type === 'general') {
    generalVacancyQueryKey = '__open__';
    generalVacancyHasMore = true;
  } else if (DEDICATED_VACANCY_FOLDER_SOURCES[type]) {
    // Switching to a different dedicated folder (or opening one fresh)
    // always needs a new fetch — force loadDedicatedVacancies() to reset.
    dedicatedVacancyFolder = type;
    dedicatedVacancyQueryKey = '__open__';
    dedicatedVacancyHasMore = true;
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
  if (generalVacancyError) {
    el.dataset.state = 'error';
    el.innerHTML = '<div class="empty-state"><h3>Could not load vacancies</h3><p>Check your connection and try again.</p><button class="vac-load-more" onclick="loadGeneralVacancies(true)">Try again</button></div>';
  } else if (generalVacancyLoading && !generalVacancyRows.length) {
    el.dataset.state = 'loading';
    el.innerHTML = '<div class="empty-state"><h3>Loading vacancies…</h3><p>Fetching the latest opportunities.</p></div>';
  } else if (!generalVacancyRows.length) {
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, !!generalVacancyQueryKey);
  } else {
    el.dataset.state = 'ready';
    var cards = generalVacancyRows.map(function(v){
      var agency = v.agency_id && v.agency_id !== 'general' ? (agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {}) : {};
      return vacancyCard(v, agency, { hideBadges: true });
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
    generalVacancyError = false;
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
    generalVacancyError = false;
    var visiblePage = filterExpiredVacancies(page);
    matchVacanciesToAgencies(visiblePage, agenciesCache);
    visiblePage.forEach(function(v){
      if (v.agency_id && v.agency_id !== 'general' && !vacanciesCache.some(function(x){ return x.id === v.id; })) vacanciesCache.push(v);
    });
    // A matched record belongs in its agency section, not General Vacancies.
    generalVacancyRows = generalVacancyRows.concat(visiblePage.filter(isGeneralDirectoryVacancy));
    generalVacancyHasMore = page.length === generalVacancyPageSize;
    generalVacancyPage += 1;
    renderGeneralVacancyCards(true);
  } catch(e) {
    if (requestId !== generalVacancyRequestId) return;
    generalVacancyError = true;
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
  else if (DEDICATED_VACANCY_FOLDER_SOURCES[allVacanciesFolder]) loadDedicatedVacancies(false);
  else {
    vacancyFolderDisplayLimit += 30;
    renderAllVacanciesList();
  }
}
// Mirrors renderGeneralVacancyCards()/loadGeneralVacancies() above for the
// 5 dedicated-source folders (Himalayas/Adzuna/Government/Retail/
// Learnerships). One shared state machine since only one folder is open at
// a time — see dedicatedVacancy* globals in app-core.js.
var DEDICATED_VACANCY_FOLDER_LABELS = { himalayas: 'Himalayas Remote', adzuna: 'Adzuna Vacancies', government: 'Government Vacancies', retail: 'Retail Vacancies', learnerships: 'Learnerships', careers_page: 'Cruise careers' };
function renderDedicatedVacancyCards(append) {
  var el = document.getElementById('allvacancies-list');
  var loadMore = document.getElementById('allvacancies-loadmore');
  var countLabel = document.getElementById('allvacancies-result-count');
  if (!el) return;
  var folderLabel = DEDICATED_VACANCY_FOLDER_LABELS[dedicatedVacancyFolder] || 'Vacancies';
  var folderCount = (dedicatedVacancyCounts && dedicatedVacancyCounts[dedicatedVacancyFolder]) || 0;
  if (dedicatedVacancyError) {
    el.dataset.state = 'error';
    el.innerHTML = '<div class="empty-state"><h3>Could not load vacancies</h3><p>Check your connection and try again.</p><button class="vac-load-more" onclick="loadDedicatedVacancies(true)">Try again</button></div>';
  } else if (dedicatedVacancyLoading && !dedicatedVacancyRows.length) {
    el.dataset.state = 'loading';
    el.innerHTML = '<div class="empty-state"><h3>Loading vacancies…</h3><p>Fetching the latest opportunities.</p></div>';
  } else if (!dedicatedVacancyRows.length) {
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, !!dedicatedVacancyQueryKey && dedicatedVacancyQueryKey !== '__open__');
  } else {
    el.dataset.state = 'ready';
    var cards = dedicatedVacancyRows.map(function(v){ return vacancyCard(v, {}, { hideBadges: true }); }).join('');
    el.innerHTML = '<div class="pgroup-label">' + escapeHtml(folderLabel) + '</div>' + cards;
  }
  if (countLabel) countLabel.textContent = folderCount ? dedicatedVacancyRows.length + ' of ' + folderCount + ' loaded' : dedicatedVacancyRows.length + ' loaded';
  if (loadMore) {
    loadMore.style.display = dedicatedVacancyHasMore ? 'block' : 'none';
    loadMore.disabled = dedicatedVacancyLoading;
    loadMore.textContent = dedicatedVacancyLoading ? 'Loading vacancies…' : 'Load more vacancies';
  }
}
async function loadDedicatedVacancies(reset) {
  var folder = allVacanciesFolder;
  if (!DEDICATED_VACANCY_FOLDER_SOURCES[folder]) return;
  var state = generalVacancyQueryState();
  var key = folder + '|' + generalVacancyQueryKeyFor(state);
  var queryChanged = reset || folder !== dedicatedVacancyFolder || key !== dedicatedVacancyQueryKey;
  if (queryChanged) {
    dedicatedVacancyRequestId++;
    dedicatedVacancyFolder = folder;
    dedicatedVacancyQueryKey = key;
    dedicatedVacancyPage = 0;
    dedicatedVacancyRows = [];
    dedicatedVacancyHasMore = true;
    dedicatedVacancyLoading = false;
    dedicatedVacancyError = false;
  }
  if (dedicatedVacancyLoading || !dedicatedVacancyHasMore) { renderDedicatedVacancyCards(false); return; }
  var requestId = ++dedicatedVacancyRequestId;
  dedicatedVacancyLoading = true;
  renderDedicatedVacancyCards(false);
  try {
    var page = await fetchDedicatedVacancyPage(folder, state, dedicatedVacancyPage);
    if (requestId !== dedicatedVacancyRequestId) return;
    dedicatedVacancyError = false;
    dedicatedVacancyRows = dedicatedVacancyRows.concat(filterExpiredVacancies(page));
    dedicatedVacancyHasMore = page.length === dedicatedVacancyPageSize;
    dedicatedVacancyPage += 1;
    renderDedicatedVacancyCards(true);
  } catch(e) {
    if (requestId !== dedicatedVacancyRequestId) return;
    dedicatedVacancyError = true;
    dedicatedVacancyHasMore = true;
  } finally {
    if (requestId === dedicatedVacancyRequestId) {
      dedicatedVacancyLoading = false;
      renderDedicatedVacancyCards(false);
    }
  }
}
function renderAllVacanciesList() {
  updateVacanciesBackButton();

  if (allVacanciesFolder === 'general') {
    loadGeneralVacancies(false);
    return;
  }
  if (DEDICATED_VACANCY_FOLDER_SOURCES[allVacanciesFolder]) {
    loadDedicatedVacancies(false);
    return;
  }

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
  var isGovernmentVacancy = function(v){ return ['government','dpsa'].indexOf(String(v.source_type || '').toLowerCase()) !== -1 || /^(government|dpsa)-/i.test(String(v.id || '')); };
  var isRetailVacancy = function(v){ return ['retail','shoprite','picknpay','woolworths','truworths','spar'].indexOf(String(v.source_type || '').toLowerCase()) !== -1 || /^(retail|shoprite|picknpay|woolworths|truworths|spar)-/i.test(String(v.id || '')); };
  var isLearnershipVacancy = function(v){ return v.source_type === 'learnerships' || String(v.id || '').indexOf('graduates24-') === 0; };
  var isCareersPageVacancy = function(v){ return v.source_type === 'careers_page' || String(v.id || '').indexOf('careers-page-') === 0; };
  var isExternalVacancy = function(v){ return isHimalayasVacancy(v) || isAdzunaVacancy(v) || isGovernmentVacancy(v) || isRetailVacancy(v) || isLearnershipVacancy(v) || isCareersPageVacancy(v); };

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
                : allVacanciesFolder === 'government'
                  ? visible.filter(isGovernmentVacancy)
                  : allVacanciesFolder === 'retail'
                    ? visible.filter(isRetailVacancy)
                    : allVacanciesFolder === 'learnerships'
                      ? visible.filter(isLearnershipVacancy)
                      : allVacanciesFolder === 'careers_page'
                        ? visible.filter(isCareersPageVacancy)
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
    var overviewLoadMore = document.getElementById('allvacancies-loadmore');
    if (overviewLoadMore) overviewLoadMore.style.display = 'none';
    var agencyCount = list.filter(hasAssignedAgency).length;
    var generalCount = generalVacancyCount;
    // These 5 folders no longer keep their rows in vacanciesCache (see
    // worker.js loadStartupData), so their counts come from the server-side
    // aggregate the same way generalCount does just above, rather than a
    // client-side filter that would now always read zero.
    var himalayasCount = dedicatedVacancyCounts.himalayas || 0;
    var adzunaCount = dedicatedVacancyCounts.adzuna || 0;
    var governmentCount = dedicatedVacancyCounts.government || 0;
    var retailCount = dedicatedVacancyCounts.retail || 0;
    var learnershipsCount = dedicatedVacancyCounts.learnerships || 0;
    var careersPageCount = dedicatedVacancyCounts.careers_page || 0;
    var folderCountLabel = function(count) {
      if (!generalVacancyCountLoaded || !dedicatedVacancyCountsLoaded) return 'Loading…';
      return count + ' vacanc' + (count === 1 ? 'y' : 'ies');
    };
    var featured = (featuredVacanciesCache || []).filter(function(v){
      return v && v.is_featured && (!v.featured_until || new Date(v.featured_until).getTime() >= Date.now()) && !isVacancyExpired(v);
    }).sort(function(a,b){
      return (Number(a.featured_order)||0) - (Number(b.featured_order)||0) || new Date(b.created_at||0) - new Date(a.created_at||0);
    }).slice(0, 6);
    var featuredMarkup =
      '<section class="featured-vacancies-section" aria-labelledby="featured-vacancies-title">' +
        '<div class="featured-vacancies-heading"><div><h2 id="featured-vacancies-title">Featured vacancies</h2></div></div>' +
        (featured.length ?
          '<div class="featured-vacancies-grid">' + featured.map(function(v){
            var agency = v.agency_id && v.agency_id !== 'general' ? (agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {}) : {};
            return vacancyCard(v, agency, { featured: true });
          }).join('') + '</div>' :
          '<div class="featured-vacancies-empty">No featured vacancies are live right now. Check back soon for priority opportunities.</div>') +
      '</section>';
    var sourceCards = [
      { type:'general', label:'General Vacancies', short:'General', count:generalCount, icon:'⌕' },
      { type:'agency', label:'Agency Vacancies', short:'Agency', count:agencyCount, icon:'▦' },
      { type:'government', label:'Government Vacancies', short:'Government', count:governmentCount, icon:'⌂' },
      { type:'retail', label:'Retail Vacancies', short:'Retail', count:retailCount, icon:'▤' },
      { type:'learnerships', label:'Learnerships', short:'Learnerships', count:learnershipsCount, icon:'✦' },
      { type:'himalayas', label:'Himalayas Remote', short:'Himalayas', count:himalayasCount, icon:'↗' },
      { type:'adzuna', label:'Adzuna Vacancies', short:'Adzuna', count:adzunaCount, icon:'A' },
      { type:'careers_page', label:'Cruise Careers', short:'Cruise', count:careersPageCount, icon:'⚓' }
    ];
    var sourceTile = function(item, index) {
      return '<button class="vacancy-source-card vacancy-source-card-' + index + '" data-ripple onclick="openVacancyFolder(\'' + item.type + '\')" aria-label="Open ' + escapeHtml(item.label) + '">' +
        '<span class="vacancy-source-icon" aria-hidden="true">' + item.icon + '</span>' +
        '<strong>' + escapeHtml(item.label) + '</strong>' +
        '<span class="vacancy-source-count" aria-label="' + escapeHtml(folderCountLabel(item.count)) + '">' + folderCountLabel(item.count) + '</span>' +
      '</button>';
    };
    var sourceRail =
      '<div class="vacancy-source-rail" aria-label="Vacancy sources">' +
        sourceCards.map(sourceTile).join('') +
      '</div>';
    el.innerHTML = featuredMarkup +
      '<div class="vacancy-browse-heading"><h2>Browse Vacancies</h2></div>' +
      sourceRail;
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
    if (allVacanciesFolder !== 'agency' && isGovernmentVacancy(v)) {
      var governmentKey = 'government';
      if (!groups[governmentKey]) groups[governmentKey] = { name:'Government vacancies', type:'Government', agency:null, items:[] };
      groups[governmentKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isRetailVacancy(v)) {
      var retailKey = 'retail';
      if (!groups[retailKey]) groups[retailKey] = { name:'Retail vacancies', type:'Retail', agency:null, items:[] };
      groups[retailKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isLearnershipVacancy(v)) {
      var learnershipsKey = 'learnerships';
      if (!groups[learnershipsKey]) groups[learnershipsKey] = { name:'Learnerships', type:'Learnerships', agency:null, items:[] };
      groups[learnershipsKey].items.push(v);
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
  var sectionTitle = allVacanciesFolder === 'agency' ? 'Agency Vacancies' : allVacanciesFolder === 'general' ? 'General Vacancies' : allVacanciesFolder === 'himalayas' ? 'Himalayas Remote Vacancies' : allVacanciesFolder === 'adzuna' ? 'Adzuna Vacancies' : allVacanciesFolder === 'government' ? 'Government Vacancies' : allVacanciesFolder === 'retail' ? 'Retail Vacancies' : allVacanciesFolder === 'careers_page' ? 'Cruise Careers' : 'Learnerships';
  el.innerHTML = '<div class="pgroup-label">' + sectionTitle + '</div>' + keys.map(function(key){
    var group = groups[key];
    group.items = sortVacancies(group.items);
    var agency = group.agency || {};
    // Plain cards only, no wrapping <section> — matches the flat General
    // Vacancies list exactly, so every folder's cards render identically
    // regardless of source.
    return group.items.map(function(v){ return vacancyCard(v, agency, { hideBadges: true }); }).join('');
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
  var previousStatus = item.status;
  var newStatus = (item.status === 'resolved' || item.status === 'closed') ? 'open' : 'resolved';

  // Optimistic UI: apply and paint the change immediately rather than
  // waiting on the network, then reconcile with Supabase in the
  // background. If the write actually fails, revert the local state and
  // re-render so the toggle never silently drifts out of sync with the DB.
  item.status = newStatus;
  updateSubBadges();
  renderSubmissionsList();
  showToast(newStatus === 'resolved' ? 'Marked as resolved' : 'Reopened');

  // Only update Supabase if this is a real DB row (has numeric/uuid id, not _localId)
  if (item.id && !String(id).startsWith('local_')) {
    try {
      var res = await supabaseClient.from(table).update({ status: newStatus }).eq('id', id);
      if (res && res.error) throw res.error;
    } catch(e) {
      console.error('update status', e);
      item.status = previousStatus;
      updateSubBadges();
      renderSubmissionsList();
      showToast('Could not save — reverted');
    }
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
