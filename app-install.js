/* PWA install conversion flow. Permission is never requested automatically. */
(function () {
  'use strict';
  var deferredPrompt = null;
  function track(name, metadata) { try { if (typeof trackEvent === 'function') trackEvent(name, 'pwa', null, metadata || {}); } catch (e) {} }
  function isInstalled() { return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  function refreshInstallCard() { var card = document.getElementById('install-app-card'); if (card) card.hidden = !deferredPrompt || isInstalled(); }
  window.installSaRecruiters = async function () { if (!deferredPrompt) { if (isInstalled()) { if (typeof showToast === 'function') showToast('SA Recruiters is already installed'); } return; } track('install_prompt_accepted'); deferredPrompt.prompt(); var choice = await deferredPrompt.userChoice; track(choice.outcome === 'accepted' ? 'install_prompt_completed' : 'install_prompt_dismissed', { outcome: choice.outcome }); deferredPrompt = null; refreshInstallCard(); };
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); deferredPrompt = event; refreshInstallCard(); track('install_prompt_shown'); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; refreshInstallCard(); track('app_installed'); });
  window.addEventListener('load', function () { refreshInstallCard(); track('pwa_launch', { installed: isInstalled(), online: navigator.onLine !== false }); });
})();
