/* Saved-search email alerts, "applied" tracking and alert unsubscribe. Loaded after app-vacancy-v2.js. */
(function () {
  'use strict';
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function toast(m) { if (typeof showToast === 'function') showToast(m); }

  async function saveSearch() {
    if (!saAuthUser || !supabaseClient) { toast('Sign in with Google (free) to get job alerts'); return; }
    var row = { user_id: saAuthUser.id, email: saAuthUser.email, query: val('allvacancies-search'), location: val('allvacancies-location'),
      remote: val('allvacancies-remote'), experience: val('allvacancies-exp') };
    if (!row.query && !row.location && !row.remote && !row.experience) { toast('Enter a search or pick a filter first'); return; }
    var res = await supabaseClient.from('saved_searches').insert(row);
    if (res.error) { toast(res.error.code === '23505' ? 'You already have this alert' : 'Could not save alert — try again'); return; }
    toast('Alert saved — we\u2019ll email new matches');
  }

  function addAlertButton() {
    var list = document.getElementById('allvacancies-list');
    if (!list || document.getElementById('sa-alert-btn')) return;
    var b = document.createElement('button');
    b.id = 'sa-alert-btn'; b.type = 'button'; b.className = 'vx-more';
    b.style.margin = '8px 0'; b.textContent = '\uD83D\uDD14 Email me new jobs matching this search';
    b.addEventListener('click', saveSearch);
    list.insertAdjacentElement('beforebegin', b);
  }

  // Apply clicks: track + mark as applied for signed-in users (never overwrites a later status).
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || !/^\s*apply/i.test(a.textContent)) return;
    var card = a.closest('[data-vacancy-id]'); if (!card) return;
    var id = card.getAttribute('data-vacancy-id');
    try { if (typeof trackEvent === 'function') trackEvent('vacancy_apply_click', 'vacancy', id, {}); } catch (err) {}
    if (saAuthUser && supabaseClient) {
      supabaseClient.from('vacancy_applications')
        .upsert({ user_id: saAuthUser.id, vacancy_id: id, status: 'applied' }, { onConflict: 'user_id,vacancy_id', ignoreDuplicates: true })
        .then(function (r) { if (!r.error) toast('Marked as applied'); }, function () {});
    }
  }, true);

  async function handleUnsubscribe() {
    var p = new URLSearchParams(location.search), t = p.get('unsub_search');
    if (!t || !supabaseClient) return;
    var r = await supabaseClient.rpc('unsubscribe_saved_search', { p_token: t });
    toast(r && r.data ? 'Job alert stopped' : 'Could not stop that alert');
    p.delete('unsub_search'); history.replaceState({}, document.title, location.pathname + (p.toString() ? '?' + p : ''));
  }

  function init() { addAlertButton(); handleUnsubscribe(); new MutationObserver(addAlertButton).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
