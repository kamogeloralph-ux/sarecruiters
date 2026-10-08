/* SA Recruiters alert experience: saved searches, alert management and Web Push opt-in. */
(function () {
  'use strict';
  var VAPID_PUBLIC_KEY = 'BBSEiWTe7QXBPImjQtJpgz7WthmSz_DQi0PZXPcLCK6U3sTSTViI2XZHOPnXIacB7K_3bfLPtI6yYu5QX1_N99M';
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function toast(m) { if (typeof showToast === 'function') showToast(m); }
  function esc(v) { return typeof escapeHtml === 'function' ? escapeHtml(v == null ? '' : String(v)) : String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function canUseAccount() { return !!(window.saAuthUser && window.supabaseClient); }
  function searchRow() { return { user_id: saAuthUser.id, email: saAuthUser.email, query: val('allvacancies-search'), location: val('allvacancies-location'), remote: val('allvacancies-remote'), experience: val('allvacancies-exp') }; }
  async function saveSearch() {
    if (!canUseAccount()) { toast('Sign in with Google (free) to get job alerts'); return; }
    var row = searchRow();
    if (!row.query && !row.location && !row.remote && !row.experience) { toast('Enter a search or pick a filter first'); return; }
    var res = await supabaseClient.from('saved_searches').insert(row);
    if (res.error) { toast(res.error.code === '23505' ? 'You already have this alert' : 'Could not save alert — try again'); return; }
    toast('Alert saved — we’ll email new matches'); renderAlertManager();
    if (typeof trackEvent === 'function') trackEvent('saved_search_created', 'saved_search', null, { channel: 'email' });
  }
  function addAlertButton() {
    var list = document.getElementById('allvacancies-list');
    if (!list || document.getElementById('sa-alert-btn')) return;
    var b = document.createElement('button'); b.id = 'sa-alert-btn'; b.type = 'button'; b.className = 'sa-alert-cta'; b.setAttribute('aria-label', 'Email me new jobs matching this search');
    b.innerHTML = '<span class="sa-alert-cta-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></span><span class="sa-alert-cta-body"><span class="sa-alert-cta-title">Email me new jobs</span><span class="sa-alert-cta-sub">Get an alert when roles match this search</span></span><span class="sa-alert-cta-go" aria-hidden="true">→</span>';
    b.addEventListener('click', saveSearch); list.appendChild(b);
  }
  function label(row) { return [row.query, row.location, row.remote, row.experience].filter(Boolean).join(' · ') || 'All new vacancies'; }
  async function renderAlertManager() {
    var host = document.getElementById('saved-alerts-panel'); if (!host) return;
    if (!canUseAccount()) { host.innerHTML = '<div class="saved-alerts-empty"><strong>Job alerts</strong><span>Sign in to save searches and receive new vacancy alerts.</span><button type="button" class="account-primary-btn" onclick="signInWithGoogle()">Sign in with Google</button></div>'; return; }
    host.innerHTML = '<div class="saved-alerts-loading">Loading your alerts…</div>';
    var r = await supabaseClient.from('saved_searches').select('id,query,location,remote,experience,active,created_at,last_checked_at').eq('user_id', saAuthUser.id).order('created_at', { ascending: false });
    if (r.error) { host.innerHTML = '<div class="saved-alerts-empty">Alerts are temporarily unavailable. Please try again later.</div>'; return; }
    var rows = r.data || [];
    var html = '<div class="saved-alerts-head"><div><span class="saved-alerts-kicker">VACANCY ALERTS</span><h3>Saved searches</h3><p>Choose how you want to hear about matching jobs.</p></div><span class="saved-alerts-count">' + rows.length + '</span></div><div class="saved-alerts-list">';
    if (!rows.length) html += '<div class="saved-alerts-empty">No saved searches yet. Save a search from Vacancies and we’ll keep watch for new matches.</div>';
    rows.forEach(function(row) { html += '<article class="saved-alert-row" data-alert-id="' + esc(row.id) + '"><div class="saved-alert-copy"><strong>' + esc(label(row)) + '</strong><small>' + (row.active ? 'Active' : 'Paused') + (row.last_checked_at ? ' · checked ' + esc(new Date(row.last_checked_at).toLocaleDateString()) : '') + '</small></div><div class="saved-alert-actions"><button type="button" onclick="toggleSavedSearch(\'' + esc(row.id) + '\',' + (!row.active) + ')">' + (row.active ? 'Pause' : 'Resume') + '</button><button type="button" class="saved-alert-delete" onclick="deleteSavedSearch(\'' + esc(row.id) + '\')">Delete</button></div></article>'; });
    html += '</div><div class="push-alert-card"><div><strong>Browser notifications</strong><span id="push-alert-status">Get a quiet notification when a matching vacancy is found. You choose when to enable this.</span></div><button type="button" class="account-primary-btn" onclick="enablePushForAlerts()">Enable push</button></div>';
    host.innerHTML = html; updatePushStatus();
  }
  window.renderSavedAlerts = renderAlertManager;
  window.toggleSavedSearch = async function(id, active) { if (!canUseAccount()) return; var r = await supabaseClient.from('saved_searches').update({ active: !!active }).eq('id', id).eq('user_id', saAuthUser.id); if (r.error) toast('Could not update this alert'); else { toast(active ? 'Alert resumed' : 'Alert paused'); renderAlertManager(); if (typeof trackEvent === 'function') trackEvent(active ? 'saved_search_resumed' : 'saved_search_paused', 'saved_search', id); } };
  window.deleteSavedSearch = async function(id) { if (!canUseAccount()) return; var r = await supabaseClient.from('saved_searches').delete().eq('id', id).eq('user_id', saAuthUser.id); if (r.error) toast('Could not delete this alert'); else { toast('Alert deleted'); renderAlertManager(); if (typeof trackEvent === 'function') trackEvent('saved_search_deleted', 'saved_search', id); } };
  function urlBase64ToUint8Array(s) { var padding = '='.repeat((4 - s.length % 4) % 4), base64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/'), raw = atob(base64); return Uint8Array.from([].map.call(raw, function(c){ return c.charCodeAt(0); })); }
  async function getPushSubscription() { return (await navigator.serviceWorker.ready).pushManager.getSubscription(); }
  async function updatePushStatus() { var el = document.getElementById('push-alert-status'); if (!el) return; if (!('PushManager' in window) || !('Notification' in window)) { el.textContent = 'Push notifications are not supported by this browser. Email alerts remain active.'; return; } var sub = null; try { sub = await getPushSubscription(); } catch(e) {} el.textContent = sub ? 'Push notifications are enabled for this browser.' : (Notification.permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Get a quiet notification when a matching vacancy is found. You choose when to enable this.'); }
  window.enablePushForAlerts = async function() {
    if (!canUseAccount()) { toast('Sign in with Google first'); return; }
    if (!('PushManager' in window) || !('Notification' in window)) { toast('Push notifications are not supported here'); return; }
    if (VAPID_PUBLIC_KEY.indexOf('REPLACE_') === 0) { toast('Push notifications are being prepared — email alerts are active now'); return; }
    try {
      var permission = await Notification.requestPermission();
      if (typeof trackEvent === 'function') trackEvent(permission === 'granted' ? 'push_permission_granted' : 'push_permission_denied', 'notification', null);
      if (permission !== 'granted') { updatePushStatus(); return; }
      var reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }), json = sub.toJSON();
      var row = { user_id: saAuthUser.id, endpoint: json.endpoint, p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth, user_agent: navigator.userAgent.slice(0, 240), updated_at: new Date().toISOString() };
      var saved = await supabaseClient.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' }); if (saved.error) throw saved.error;
      if (typeof trackEvent === 'function') trackEvent('push_subscription_created', 'notification', null); toast('Push alerts enabled'); updatePushStatus();
    } catch (e) { console.warn('[SA Recruiters] push opt-in failed', e); toast('Could not enable push alerts — email alerts are still active'); }
  };
  async function handleUnsubscribe() { var p = new URLSearchParams(location.search), t = p.get('unsub_search'); if (!t || !supabaseClient) return; var r = await supabaseClient.rpc('unsubscribe_saved_search', { p_token: t }); toast(r && r.data ? 'Job alert stopped' : 'Could not stop that alert'); p.delete('unsub_search'); history.replaceState({}, document.title, location.pathname + (p.toString() ? '?' + p : '')); }
  document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (!a || !/^\s*apply/i.test(a.textContent)) return; var card = a.closest('[data-vacancy-id]'); if (!card) return; var id = card.getAttribute('data-vacancy-id'); try { if (typeof trackEvent === 'function') trackEvent('vacancy_apply_click', 'vacancy', id, {}); } catch (err) {} if (saAuthUser && supabaseClient) supabaseClient.from('vacancy_applications').upsert({ user_id: saAuthUser.id, vacancy_id: id, status: 'applied' }, { onConflict: 'user_id,vacancy_id', ignoreDuplicates: true }).then(function (r) { if (!r.error) toast('Marked as applied'); }); }, true);
  document.addEventListener('sa-auth-change', renderAlertManager);
  function init() { addAlertButton(); handleUnsubscribe(); renderAlertManager(); new MutationObserver(addAlertButton).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
