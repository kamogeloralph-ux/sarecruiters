// ===== Animated HTML5 house-ad documents =====
// Every in-house ad is played as HTML5 inside a sandboxed iframe (sandbox="allow-scripts", no
// same-origin). There are three kinds, picked by houseAdKind():
//   'html5' - a hand-built .html creative (fetched and played as-is)
//   'card'  - ad_format = 'card': a logo + headline + tagline card built here (3 animated frames)
//   'image' - any picture URL: wrapped here in an animated HTML5 document (slide-in, slow drift, shine)
// NOTE: public-ads.js (static pages) carries a copy of these two builders. Keep them in sync;
// scripts/house-ad-html5-parity.test.mjs fails if they drift apart.

/* @house-ad-docs:start */
export function houseAdEsc(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function houseAdKind(ad, imageUrl) {
  if (/\.html?$/i.test(String(imageUrl || '').split(/[?#]/)[0])) return 'html5';
  if (ad && ad.ad_format === 'card') return 'card';
  return 'image';
}

// A picture, animated. The picture is never cropped: a blurred copy fills the box behind it.
export function buildHouseAdImageDocument(imageUrl) {
  var src = houseAdEsc(imageUrl);
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="ad.size" content="width=1200,height=400"><style>' +
    'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}' +
    'img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}' +
    '.bg{object-fit:cover;filter:blur(22px) brightness(.55);transform:scale(1.15)}' +
    '.fg{object-fit:contain;opacity:0;animation:in .9s .1s ease-out forwards,drift 9s 1s ease-in-out forwards}' +
    '.shine{position:absolute;top:0;bottom:0;width:34%;left:-50%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.3),transparent);transform:skewX(-18deg);animation:sweep 1.1s 1.5s ease-in-out forwards}' +
    '@keyframes in{from{opacity:0;transform:scale(1.06) translateX(-18px)}to{opacity:1;transform:none}}' +
    '@keyframes drift{to{transform:scale(1.025)}}' +
    '@keyframes sweep{to{left:130%}}' +
    '@media (prefers-reduced-motion:reduce){.fg{animation:none;opacity:1}.shine{display:none}}' +
    '</style></head><body>' +
    '<img class="bg" src="' + src + '" alt="" aria-hidden="true">' +
    '<img class="fg" src="' + src + '" alt="" onerror="parent.postMessage({houseAdError:1},\'*\')">' +
    '<span class="shine"></span></body></html>';
}

// Logo + text card, built from the ad's own fields:
//   image_url = logo, title = headline, message = tagline (optional), advertiser_name = small brand line.
export function buildHouseAdCardDocument(ad, logoUrl) {
  var headline = houseAdEsc((ad && (ad.title || ad.advertiser_name)) || '');
  var brand = houseAdEsc((ad && ad.advertiser_name) || '');
  var tagline = houseAdEsc((ad && ad.message) || '');
  var logo = houseAdEsc(logoUrl);
  var f2 = tagline ? 3.2 : 0;                 // F2 only exists when there is a tagline
  var f3At = tagline ? 6.6 : 3.4;
  var css =
    ':root{--bg:#000;--accent:#fff;--text:#fff;--muted:#a6a6a6;--btn-text:#000}' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{width:100%;height:100%;overflow:hidden;background:var(--bg)}' +
    'body{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:var(--text)}' +
    '#ad{position:absolute;left:0;top:0;width:1200px;height:400px;transform-origin:0 0;background:var(--bg);overflow:hidden}' +
    '.bar{position:absolute;left:0;top:0;width:14px;height:100%;background:var(--accent);transform:scaleY(0);transform-origin:top;animation:bar 1s .1s ease-out forwards}' +
    '@keyframes bar{to{transform:scaleY(1)}}' +
    '.frame{position:absolute;inset:0;padding:40px 90px;opacity:0;display:flex;flex-direction:column;justify-content:center}' +
    'h1{font-size:84px;line-height:1.08;font-weight:800;letter-spacing:-2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
    'p{font-size:38px;line-height:1.3;color:var(--muted);margin-top:22px}' +
    '.small{font-size:28px;font-weight:800;letter-spacing:3px;color:var(--muted);text-transform:uppercase;margin-bottom:16px}' +
    '#f1{animation:out 3.4s ease forwards}' +
    (tagline ? '#f2{animation:out 3.4s ' + f2 + 's ease forwards}' : '') +
    '#f3{flex-direction:row;align-items:center;gap:64px;padding-right:60px;animation:inn .6s ' + f3At + 's ease forwards}' +
    '@keyframes out{0%{opacity:0;transform:translateX(-24px)}15%,80%{opacity:1;transform:none}100%{opacity:0;transform:translateX(24px)}}' +
    '@keyframes inn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}' +
    '.logo{flex:0 0 250px;width:250px;height:250px;border-radius:36px;background:#fff;padding:22px;object-fit:contain}' +
    '.txt{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '#f3 h1{font-size:64px;letter-spacing:-1.5px}' +
    '.cta{align-self:flex-start;margin-top:26px;padding:12px 38px;border-radius:999px;background:var(--accent);color:var(--btn-text);font-weight:800;font-size:38px;animation:pulse 1.6s ' + (f3At + 1) + 's ease-in-out 3}' +
    '@keyframes pulse{50%{transform:scale(1.07)}}' +
    '@media (prefers-reduced-motion:reduce){#f1,#f2{display:none}#f3{animation:none;opacity:1}.cta,.bar{animation:none}.bar{transform:none}}';
  var body =
    '<div id="ad"><span class="bar"></span>' +
    '<div class="frame" id="f1">' + (brand ? '<div class="small">' + brand + '</div>' : '') + '<h1>' + headline + '</h1></div>' +
    (tagline ? '<div class="frame" id="f2"><h1>' + headline + '</h1><p>' + tagline + '</p></div>' : '') +
    '<div class="frame" id="f3"><img class="logo" src="' + logo + '" alt="" onerror="parent.postMessage({houseAdError:1},\'*\')">' +
    '<div class="txt">' + (brand ? '<div class="small">' + brand + '</div>' : '') + '<h1>' + headline + '</h1><span class="cta">Learn more</span></div></div></div>';
  var script = '(function(){var ad=document.getElementById("ad");function fit(){var s=Math.min(innerWidth/1200,innerHeight/400);ad.style.transform=Math.abs(s-1)<.001?"none":"scale("+s+")"}fit();addEventListener("resize",fit)})();';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="ad.size" content="width=1200,height=400"><style>' + css + '</style></head><body>' + body + '<script>' + script + '<\/script></body></html>';
}

/* @house-ad-docs:end */

// Hide the slot if a generated document reports that its picture failed to load.
export function watchHouseAdFrame(frame, slot) {
  function onMessage(event) {
    if (!frame.isConnected) { window.removeEventListener('message', onMessage); return; }
    if (event.source === frame.contentWindow && event.data && event.data.houseAdError) {
      window.removeEventListener('message', onMessage);
      if (slot) { slot.hidden = true; slot.innerHTML = ''; }
    }
  }
  window.addEventListener('message', onMessage);
}
