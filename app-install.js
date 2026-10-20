/* PWA install flow. Permission is never requested automatically; the browser
 * prompt only opens when the user taps an Install button. */
(function () {
  'use strict';
  var deferredPrompt = null;
  function track(name, metadata) { try { if (typeof trackEvent === 'function') trackEvent(name, 'pwa', null, metadata || {}); } catch (e) {} }
  function isInstalled() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function isIOS() { var ua = navigator.userAgent || ''; return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }

  // Install buttons stay visible until the app is installed, so they also work
  // on browsers that never fire beforeinstallprompt (iOS Safari, Firefox, etc.).
  function refreshInstallUI() {
    var show = !isInstalled();
    var card = document.getElementById('install-app-card');
    var btn = document.getElementById('header-install-btn');
    if (card) card.hidden = !show;
    if (btn) btn.hidden = !show;
  }

  function closeInstallHelp() { var el = document.getElementById('install-help'); if (el) el.remove(); }
  function showInstallHelp() {
    closeInstallHelp();
    var steps;
    if (isIOS()) {
      steps = ['Open this page in <strong>Safari</strong>.', 'Tap the <strong>Share</strong> button (square with an arrow).', 'Scroll down and tap <strong>Add to Home Screen</strong>.', 'Tap <strong>Add</strong>. SA Recruiters now opens like an app.'];
    } else if (isAndroid()) {
      steps = ['Tap the browser menu (<strong>&#8942;</strong>) at the top right.', 'Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.', 'Confirm. SA Recruiters now opens like an app.'];
    } else {
      steps = ['Look for the <strong>install icon</strong> at the right end of the address bar, or open the browser menu.', 'Choose <strong>Install SA Recruiters</strong> (or <strong>Add to Home screen</strong>).', 'Confirm to add the app.'];
    }
    var wrap = document.createElement('div');
    wrap.id = 'install-help';
    wrap.className = 'install-help';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Install SA Recruiters');
    wrap.innerHTML = '<div class="install-help-card"><h3>Install SA Recruiters</h3><ol>' +
      steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
      '</ol><button type="button" class="account-primary-btn" id="install-help-close">Got it</button></div>';
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeInstallHelp(); });
    document.body.appendChild(wrap);
    var closeBtn = document.getElementById('install-help-close');
    if (closeBtn) { closeBtn.addEventListener('click', closeInstallHelp); closeBtn.focus(); }
    track('install_help_shown', { platform: isIOS() ? 'ios' : (isAndroid() ? 'android' : 'desktop') });
  }

  window.installSaRecruiters = async function () {
    if (isInstalled()) { if (typeof showToast === 'function') showToast('SA Recruiters is already installed'); return; }
    if (!deferredPrompt) { showInstallHelp(); return; }
    track('install_prompt_accepted');
    try {
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      track(choice.outcome === 'accepted' ? 'install_prompt_completed' : 'install_prompt_dismissed', { outcome: choice.outcome });
    } catch (e) { showInstallHelp(); }
    deferredPrompt = null;
    refreshInstallUI();
  };

  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); deferredPrompt = event; refreshInstallUI(); track('install_prompt_shown'); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; closeInstallHelp(); refreshInstallUI(); track('app_installed'); });
  window.addEventListener('load', function () { refreshInstallUI(); track('pwa_launch', { installed: isInstalled(), online: navigator.onLine !== false }); });
  if (document.readyState !== 'loading') refreshInstallUI(); else document.addEventListener('DOMContentLoaded', refreshInstallUI);
})();
