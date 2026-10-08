/* SA Recruiters public SEO-page house ads. */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';
  var slots = Array.prototype.slice.call(document.querySelectorAll('[data-public-ad-slot]'));
  if (!slots.length) return;
  var select = 'id,advertiser_name,title,message,image_url,target_url,ad_slot,sort_order';
  var now = new Date().toISOString();
  var endpoint = SUPABASE_URL + '/rest/v1/house_ads?select=' + encodeURIComponent(select)
    + '&target_screens=cs.%7Bpublic%7D&is_active=eq.true&starts_at=lte.' + encodeURIComponent(now)
    + '&or=' + encodeURIComponent('(ends_at.is.null,ends_at.gt.' + now + ')')
    + '&order=sort_order.asc,created_at.desc&limit=20';
  var headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  function safeUrl(value) {
    try {
      var url = new URL(String(value || ''), window.location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (e) { return ''; }
  }
  function track(id, eventName, slot) {
    if (!id || (eventName !== 'impression' && eventName !== 'click')) return;
    var key = 'sa_public_ad_' + eventName + '_' + id + '_' + slot + '_' + window.location.pathname;
    if (eventName === 'impression') {
      try { if (sessionStorage.getItem(key) === '1') return; sessionStorage.setItem(key, '1'); } catch (e) {}
    }
    fetch(SUPABASE_URL + '/rest/v1/rpc/record_house_ad_event', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ p_ad_id: id, p_event: eventName }), keepalive: true
    }).catch(function () {});
  }
  function render(slot, ad) {
    var image = safeUrl(ad && ad.image_url), target = safeUrl(ad && ad.target_url);
    if (!ad || !image || !target) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = '<a class="public-house-ad" href="' + imageEscape(target) + '" target="_blank" rel="sponsored noopener noreferrer">'
      + '<span class="public-house-ad-label">Sponsored</span>'
      + '<img loading="lazy" decoding="async" width="1200" height="400" src="' + imageEscape(image) + '" alt="' + imageEscape(ad.title || ad.advertiser_name || 'Sponsored promotion') + '">'
      + (ad.message ? '<span class="public-house-ad-message">' + imageEscape(ad.message) + '</span>' : '')
      + '</a>';
    slot.querySelector('a').addEventListener('click', function () { track(ad.id, 'click', slot.getAttribute('data-public-ad-slot')); });
    track(ad.id, 'impression', slot.getAttribute('data-public-ad-slot'));
  }
  function imageEscape(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  fetch(endpoint, { headers: headers, cache: 'no-store' }).then(function (response) {
    return response.ok ? response.json() : [];
  }).then(function (ads) {
    ads = Array.isArray(ads) ? ads : [];
    slots.forEach(function (slot) {
      var placement = slot.getAttribute('data-public-ad-slot') || 'top';
      var ad = ads.filter(function (item) { return (item.ad_slot || 'top') === placement; })[0];
      render(slot, ad);
    });
  }).catch(function () { slots.forEach(function (slot) { slot.hidden = true; }); });
}());
