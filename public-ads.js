/* SA Recruiters public SEO-page house ads. */
(function () {
  'use strict';
  var WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
  var slots = Array.prototype.slice.call(document.querySelectorAll('[data-public-ad-slot]'));
  if (!slots.length) return;
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
    fetch(WORKER_URL + '/api/house-ads/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, event: eventName }), keepalive: true
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
  fetch(WORKER_URL + '/api/house-ads', { headers: { Accept: 'application/json' } }).then(function (response) {
    return response.ok ? response.json() : {};
  }).then(function (data) {
    var ads = data && Array.isArray(data.ads) ? data.ads : [];
    ads = ads.filter(function (item) { return Array.isArray(item.target_screens) && item.target_screens.indexOf('public') !== -1; });
    slots.forEach(function (slot) {
      var placement = slot.getAttribute('data-public-ad-slot') || 'top';
      var ad = ads.filter(function (item) { return (item.ad_slot || 'top') === placement; })[0];
      render(slot, ad);
    });
  }).catch(function () { slots.forEach(function (slot) { slot.hidden = true; }); });
}());
