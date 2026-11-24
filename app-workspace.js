/*
 * SA Recruiters workspace shell.
 * Presentation/navigation only: all destinations call the existing production
 * screen transitions, data loaders, authentication, and persistence paths.
 */
(function () {
  'use strict';

  var DESTINATIONS = {
    home: { screen: 'screen-home', label: 'Overview' },
    allvacancies: { screen: 'screen-allvacancies', label: 'Find vacancies' },
    allagencies: { screen: 'screen-allagencies', label: 'Agencies' },
    pool: { screen: 'screen-pool', label: 'CV Box talent' },
    allemployers: { screen: 'screen-allemployers', label: 'Employers' },
    saved: { screen: 'screen-saved', label: 'Saved roles' }
  };

  function byId(id) { return document.getElementById(id); }

  function activeDestination() {
    var active = document.querySelector('.screen.active');
    if (!active) return 'home';
    return Object.keys(DESTINATIONS).find(function (key) {
      return DESTINATIONS[key].screen === active.id;
    }) || 'home';
  }

  function setBottomNav(destination) {
    document.querySelectorAll('.navbtn[data-tab]').forEach(function (button) {
      var tab = button.dataset.tab;
      var active = destination === tab || (destination === 'home' && tab === 'home');
      button.classList.toggle('active', active);
    });
  }

  function syncActiveDestination() {
    var destination = activeDestination();
    document.querySelectorAll('[data-workspace-screen]').forEach(function (button) {
      var active = button.dataset.workspaceScreen === destination;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    var title = byId('workspace-context-title');
    if (title) title.textContent = DESTINATIONS[destination] ? DESTINATIONS[destination].label : 'Workspace';
  }

  function renderSavedScreen() {
    if (typeof window.renderSaved === 'function') window.renderSaved();
  }

  function navigate(destination) {
    var target = DESTINATIONS[destination] ? destination : 'home';
    if (target === 'home' && typeof window.goBackHome === 'function') window.goBackHome();
    else if (target === 'allvacancies' && typeof window.showAllVacancies === 'function') window.showAllVacancies('home');
    else if (target === 'allagencies' && typeof window.showAllAgencies === 'function') window.showAllAgencies('home');
    else if (target === 'pool' && typeof window.goPool === 'function') window.goPool('home');
    else if (target === 'allemployers' && typeof window.showAllEmployers === 'function') window.showAllEmployers('home');
    else if (target === 'saved') {
      document.querySelectorAll('.screen').forEach(function (screen) { screen.classList.remove('active'); });
      var saved = byId('screen-saved');
      if (saved) saved.classList.add('active');
      setBottomNav('saved');
      renderSavedScreen();
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
    syncActiveDestination();
  }

  function setMetric(id, value) {
    var target = byId(id);
    if (target && value !== null && value !== undefined && String(value) !== '') target.textContent = value;
  }

  function syncMetrics() {
    var vacancyCount = byId('stat-vacancies') && byId('stat-vacancies').textContent.trim();
    var agencyCount = byId('stat-agencies') && byId('stat-agencies').textContent.trim();
    var talentCount = byId('stat-pool') && byId('stat-pool').textContent.trim();
    var employerCount = byId('stat-employers') && byId('stat-employers').textContent.trim();
    setMetric('workspace-metric-vacancies', vacancyCount || '…');
    setMetric('workspace-metric-agencies', agencyCount || '…');
    setMetric('workspace-metric-talent', talentCount || '…');
    setMetric('workspace-metric-employers', employerCount || '…');
    setMetric('workspace-live-role-count', vacancyCount && vacancyCount !== '…' ? vacancyCount : 'Loading roles…');
  }

  function savedCount(detail) {
    if (detail && Number.isFinite(Number(detail.count))) return String(Number(detail.count));
    if (window.savedSet && typeof window.savedSet.size === 'number') return String(window.savedSet.size);
    try { return String(JSON.parse(localStorage.getItem('savedVacancies') || '[]').length); } catch (error) { return '0'; }
  }

  function syncSavedIndicators(detail) {
    var count = savedCount(detail);
    ['workspace-saved-count', 'workspace-topbar-saved-count'].forEach(function (id) {
      var node = byId(id);
      if (node) node.textContent = count;
    });
  }

  function syncAuth(detail) {
    var user = detail && detail.user;
    var name = user && user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user && user.email || 'Guest';
    var status = user ? 'Signed in with Google' : 'Browsing as a guest';
    var nameNode = byId('workspace-account-name');
    var statusNode = byId('workspace-account-status');
    var avatar = byId('workspace-account-avatar');
    if (nameNode) nameNode.textContent = name;
    if (statusNode) statusNode.textContent = status;
    if (avatar) {
      var photo = user && user.user_metadata && (user.user_metadata.profile_photo || user.user_metadata.avatar_url);
      avatar.textContent = photo ? '' : String(name).charAt(0).toUpperCase();
      if (photo) {
        avatar.innerHTML = '<img src="' + String(photo).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }) + '" alt="" decoding="async" referrerpolicy="no-referrer">';
      }
    }
  }

  function forwardGlobalSearch(value) {
    var input = byId('allvacancies-search');
    if (!input) return;
    if (!byId('screen-allvacancies').classList.contains('active') && typeof window.showAllVacancies === 'function') window.showAllVacancies('home');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof window.renderAllVacanciesList === 'function') window.renderAllVacanciesList();
  }

  function init() {
    var search = byId('workspace-global-search-input');
    if (search) search.addEventListener('input', function () { forwardGlobalSearch(search.value); });
    document.addEventListener('sa-saved-change', function (event) {
      syncSavedIndicators(event.detail || null);
      syncMetrics();
    });
    document.addEventListener('sa-auth-change', function (event) { syncAuth(event.detail || null); });
    var statObserver = typeof MutationObserver === 'function' ? new MutationObserver(syncMetrics) : null;
    if (statObserver) ['stat-vacancies', 'stat-agencies', 'stat-pool', 'stat-employers'].forEach(function (id) {
      var node = byId(id);
      if (node) statObserver.observe(node, { childList: true, characterData: true, subtree: true });
    });
    var screenObserver = typeof MutationObserver === 'function' ? new MutationObserver(syncActiveDestination) : null;
    var app = byId('app');
    if (screenObserver && app) screenObserver.observe(app, { subtree: true, attributes: true, attributeFilter: ['class'] });
    syncSavedIndicators();
    syncAuth(null);
    syncMetrics();
    syncActiveDestination();
  }

  window.saWorkspaceNavigate = navigate;
  window.saWorkspaceSync = function () {
    syncSavedIndicators();
    syncMetrics();
    syncActiveDestination();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());

// ===== window bridge
// The module exposes its public navigation entry point above so the shell's
// inline handlers and the existing app modules can use the same global path.
