/* SA Recruiters public SEO-page house ads. */
(function () {
  'use strict';
  var WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
  var slots = Array.prototype.slice.call(document.querySelectorAll('[data-public-ad-slot]'));
  if (!slots.length) return;
  // Crawlers and automated browsers render these pages by the thousand. They never
  // see or click the ads, so don't spend Worker requests (ad list + impression
  // event) on them -- just keep the empty slots hidden.
  var isBot = !!navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|bingpreview/i.test(navigator.userAgent || '');
  if (isBot) { slots.forEach(function (slot) { slot.hidden = true; }); return; }
  function safeUrl(value) {
    try {
      var url = new URL(String(value || ''), window.location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (e) { return ''; }
  }
  function track(id, eventName, slot) {
    if (!id || (eventName !== 'impression' && eventName !== 'click')) return;
    var key = 'sa_public_ad_' + eventName + '_' + id + '_' + slot;
    if (eventName === 'impression') {
      try { if (sessionStorage.getItem(key) === '1') return; sessionStorage.setItem(key, '1'); } catch (e) {}
    }
    fetch(WORKER_URL + '/api/house-ads/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, event: eventName }), keepalive: true
    }).catch(function () {});
  }
  function creativeMarkup(image, ad) {
    var alt = imageEscape(ad.title || ad.advertiser_name || 'Sponsored promotion');
    var isHtml = false, w = 1200, h = 400;
    try { isHtml = /\.html?$/i.test(new URL(image).pathname); } catch (e) {}
    if (isHtml) {
      var m = image.match(/(\d{2,4})x(\d{2,4})\.html?(?:[?#]|$)/i);
      if (m) { w = +m[1]; h = +m[2]; }
      return '<span style="display:block;position:relative;width:100%;aspect-ratio:' + w + ' / ' + h + ';background:#000;overflow:hidden">'
        + '<iframe title="' + alt + '" loading="lazy" tabindex="-1" scrolling="no" sandbox="allow-scripts" referrerpolicy="no-referrer" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none"></iframe></span>';
    }
    return '<img loading="lazy" decoding="async" width="1200" height="400" src="' + imageEscape(image) + '" alt="' + alt + '">';
  }
  function render(slot, ad) {
    var image = safeUrl(ad && ad.image_url), target = safeUrl(ad && ad.target_url);
    if (!ad || !image || !target) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = '<a class="public-house-ad" href="' + imageEscape(target) + '" target="_blank" rel="sponsored noopener noreferrer">'
      + '<span class="public-house-ad-label">Sponsored</span>'
      + creativeMarkup(image, ad)
      + (ad.message ? '<span class="public-house-ad-message">' + imageEscape(ad.message) + '</span>' : '')
      + '</a>';
    var htmlFrame = slot.querySelector('iframe');
    if (htmlFrame) {
      fetch(image, { credentials: 'omit', cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('ad ' + res.status);
        return res.text();
      }).then(function (html) {
        if (html.indexOf('name="ad.size"') === -1) throw new Error('not an ad');
        htmlFrame.srcdoc = html;
      }).catch(function () { slot.hidden = true; slot.innerHTML = ''; });
    }
    slot.querySelector('a').addEventListener('click', function () { track(ad.id, 'click', slot.getAttribute('data-public-ad-slot')); });
    var slotName = slot.getAttribute('data-public-ad-slot');
    if ('IntersectionObserver' in window) {
      var seen = new IntersectionObserver(function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting; })) {
          seen.disconnect();
          track(ad.id, 'impression', slotName);
        }
      }, { threshold: 0.5 });
      seen.observe(slot);
    } else {
      track(ad.id, 'impression', slotName);
    }
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
