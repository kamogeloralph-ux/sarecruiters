/* SA Recruiters guide integration: app events + accessible preference controls. */
(function (win, doc) {
  'use strict';

  var KEY = 'sa_guide_settings_v1';
  var defaults = { enabled: true, quietMode: false, tipsOnly: false, animationIntensity: 'standard' };
  var pending = [];

  function read() {
    var saved = {};
    try { saved = JSON.parse(win.localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    var intensity = saved.animationIntensity === 'low' ? 'low' : 'standard';
    return {
      enabled: saved.enabled !== false,
      quietMode: saved.quietMode === true,
      tipsOnly: saved.tipsOnly === true,
      animationIntensity: intensity
    };
  }
  var settings = read();

  function save() {
    try { win.localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function emitSettings() {
    var detail = getSettings();
    try { win.dispatchEvent(new CustomEvent('sa-guide:settings-changed', { detail: detail })); } catch (e) {}
    updateControls(detail);
  }
  function getSettings() { return Object.assign({}, settings); }
  function setSettings(partial) {
    partial = partial || {};
    if (typeof partial.enabled === 'boolean') settings.enabled = partial.enabled;
    if (typeof partial.quietMode === 'boolean') settings.quietMode = partial.quietMode;
    if (typeof partial.tipsOnly === 'boolean') settings.tipsOnly = partial.tipsOnly;
    if (partial.animationIntensity === 'low' || partial.animationIntensity === 'standard') settings.animationIntensity = partial.animationIntensity;
    save();
    applySettings();
    emitSettings();
    return getSettings();
  }
  function resetOnboarding() {
    try { win.sessionStorage.removeItem('sa_guide_session'); } catch (e) {}
    try { win.localStorage.removeItem('sa_guide_hidden_until'); } catch (e) {}
    if (win.SAGuide && typeof win.SAGuide.show === 'function') win.SAGuide.show();
    try { win.dispatchEvent(new CustomEvent('sa-guide:onboarding-reset')); } catch (e) {}
    return true;
  }
  function applySettings() {
    var api = win.SAGuide;
    if (api) {
      if (typeof api.setSettings === 'function') api.setSettings({
        enabled: settings.enabled,
        quiet: settings.quietMode,
        tipsOnly: settings.tipsOnly,
        intensity: settings.animationIntensity
      });
      if (settings.enabled) {
        if (typeof api.show === 'function') api.show();
        if (typeof api.setQuiet === 'function' && !!(api.state && api.state().quiet) !== settings.quietMode) api.setQuiet(settings.quietMode);
      } else if (typeof api.hide === 'function') api.hide();
    }
    if (doc.documentElement) {
      doc.documentElement.classList.toggle('sa-guide-disabled', !settings.enabled);
      doc.documentElement.classList.toggle('sa-guide-low-motion', settings.animationIntensity === 'low');
    }
  }
  function updateControls(s) {
    var fields = {
      'sa-guide-enabled': s.enabled,
      'sa-guide-quiet': s.quietMode,
      'sa-guide-tips-only': s.tipsOnly
    };
    Object.keys(fields).forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) { el.checked = fields[id]; el.setAttribute('aria-checked', fields[id] ? 'true' : 'false'); }
    });
    var intensity = doc.getElementById('sa-guide-intensity');
    if (intensity) intensity.value = s.animationIntensity;
  }
  function openSettings() {
    var overlay = doc.getElementById('sa-guide-settings-overlay');
    if (!overlay) return;
    updateControls(getSettings());
    overlay.classList.add('open');
    var first = overlay.querySelector('input, select, button');
    if (first) first.focus();
  }
  function closeSettings() {
    var overlay = doc.getElementById('sa-guide-settings-overlay');
    if (overlay) overlay.classList.remove('open');
  }
  function dispatch(type, detail) {
    var payload = Object.assign({ type: type }, detail || {});
    try { win.dispatchEvent(new CustomEvent('sa-guide:event', { detail: payload })); } catch (e) {}
    var api = win.SAGuide;
    if (!api) pending.push(payload);
  }
  function flush(api) {
    var item;
    while (pending.length) {
      item = pending.shift();
      if (settings.tipsOnly && (item.type === 'job-saved' || item.type === 'fresh-jobs')) continue;
      if (item.type === 'job-saved' && typeof api.onSaveVacancy === 'function') api.onSaveVacancy();
      else if (item.type === 'application-opened' && typeof api.onApplyStep === 'function') api.onApplyStep('Apply tapped');
      else if (item.type === 'empty-results' && typeof api.onEmptyResults === 'function') api.onEmptyResults(item.kind || 'search');
      else if (item.type === 'new-jobs-loaded' && typeof api.say === 'function') api.say('New vacancies are live.', { ms: 2800 });
      else if (item.type === 'fresh-jobs' && typeof api.onApplyStep === 'function') api.onApplyStep('Fresh jobs available');
      else if (item.type === 'offline' && typeof api.say === 'function') api.say('You are offline. Showing saved listings.', { ms: 3600, force: true });
      else if (item.type === 'profile-incomplete' && typeof api.say === 'function') api.say('Your profile is incomplete.', { ms: 3200 });
      else if (item.type === 'filters-active' && typeof api.say === 'function') api.say('Filters active. Showing matching jobs.', { ms: 2600 });
    }
  }
  win.SARecruitersGuide = { getSettings: getSettings, setSettings: setSettings, resetOnboarding: resetOnboarding, openSettings: openSettings, closeSettings: closeSettings, dispatch: dispatch };
  win.saGuideEvent = dispatch;
  win.addEventListener('sa-guide:settings-changed', applySettings);
  win.addEventListener('sa-guide:ready', function () { applySettings(); flush(win.SAGuide); });
  var guideWait = win.setInterval(function () {
    if (!win.SAGuide) return;
    applySettings(); flush(win.SAGuide); win.clearInterval(guideWait);
    try { win.dispatchEvent(new CustomEvent('sa-guide:ready')); } catch (e) {}
  }, 100);

  doc.addEventListener('change', function (e) {
    var id = e.target && e.target.id;
    if (id === 'sa-guide-enabled') setSettings({ enabled: e.target.checked });
    else if (id === 'sa-guide-quiet') setSettings({ quietMode: e.target.checked });
    else if (id === 'sa-guide-tips-only') setSettings({ tipsOnly: e.target.checked });
    else if (id === 'sa-guide-intensity') setSettings({ animationIntensity: e.target.value });
  });
  doc.addEventListener('click', function (e) {
    var apply = e.target.closest && e.target.closest('.vac-apply, .home-vacancy-apply');
    if (apply && typeof win.saGuideEvent === 'function') {
      var card = apply.closest('[data-vacancy-id]');
      win.saGuideEvent('application-opened', { vacancyId: card && card.getAttribute('data-vacancy-id') || null });
    }
    var reset = e.target.closest && e.target.closest('[data-sa-guide-reset]');
    if (reset) { resetOnboarding(); closeSettings(); }
    var close = e.target.closest && e.target.closest('[data-sa-guide-close]');
    if (close) closeSettings();
  });
  // Keep these explicit `window` exports: index.html invokes them from inline
  // handlers and the production bundle verifier checks those public names.
  window.openSaGuideSettings = openSettings;
  window.closeSaGuideSettings = closeSettings;
  applySettings();
  updateControls(settings);

  // ===== window bridge
  Object.assign(window, {
    openSaGuideSettings,
    closeSaGuideSettings
  });
})(window, document);
