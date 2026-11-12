/* SA Recruiters public SEO-page house ads. */
(function () {
  'use strict';
  /* @house-ad-docs:start */
  function houseAdEsc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function houseAdKind(ad, imageUrl) {
    if (/\.html?$/i.test(String(imageUrl || '').split(/[?#]/)[0])) return 'html5';
    if (ad && ad.ad_format === 'card') return 'card';
    return 'image';
  }

  function houseAdHost(url) {
    var m = String(url || '').match(/^https?:\/\/(?:www\.)?([^\/?#:]+)/i);
    return m ? m[1] : '';
  }

  // ---- Curtain cycle (shared by every ad kind and every section) ----
  // Black curtains slide open at the start of a cycle and slide shut again at the end. They are pure
  // CSS (position:fixed, so they work over any creative) and loop with the cycle length `cycle` (s).
  function houseAdCurtain(cycle) {
    var c = Math.max(4, Number(cycle) || 11).toFixed(2) + 's';
    var ease = 'cubic-bezier(.7,0,.2,1)';
    var css = '.hc{position:fixed;top:0;bottom:0;width:51%;background:#000;z-index:2147483647;pointer-events:none}' +
      '.hcl{left:0;animation:hcL ' + c + ' ' + ease + ' infinite}.hcr{right:0;animation:hcR ' + c + ' ' + ease + ' infinite}' +
      '@keyframes hcL{0%,2%{transform:none}9%,86%{transform:translateX(-101%)}94%,100%{transform:none}}' +
      '@keyframes hcR{0%,2%{transform:none}9%,86%{transform:translateX(101%)}94%,100%{transform:none}}' +
      '@media (prefers-reduced-motion:reduce){.hc{display:none}}';
    return { css: css, html: '<span class="hc hcl"></span><span class="hc hcr"></span>' };
  }

  // Add the curtain cycle to a finished ad document (a generated card or a hand-built HTML5 file).
  // The ad.cycle meta tells houseAdLoop how often to replay the document.
  function houseAdWithCurtain(html, cycle) {
    var cur = houseAdCurtain(cycle);
    var head = '<meta name="ad.cycle" content="' + Math.max(4, Number(cycle) || 11).toFixed(2) + '"><style>' + cur.css + '</style>';
    var s = String(html || '');
    s = /<\/head>/i.test(s) ? s.replace(/<\/head>/i, function () { return head + '</head>'; }) : head + s;
    return /<\/body>/i.test(s) ? s.replace(/<\/body>/i, function () { return cur.html + '</body>'; }) : s + cur.html;
  }

  // Replay a one-shot ad document every cycle (the curtains are shut at that moment, so the swap is
  // invisible). Documents without the ad.cycle meta (picture ads) loop themselves in CSS.
  function houseAdLoop(frame, html) {
    var m = String(html || '').match(/name="ad\.cycle" content="([\d.]+)"/);
    var ms = m ? Math.round(parseFloat(m[1]) * 1000) : 0;
    if (!frame || ms < 4000) return;
    var n = 0;
    (function tick() {
      setTimeout(function () {
        if (!frame.isConnected) return;
        if (!document.hidden) frame.srcdoc = html + '<!--' + (++n) + '-->';
        tick();
      }, ms);
    })();
  }

  // Contact details: one per line in ad.ad_details (max 4). With none, the link's own host is shown.
  function houseAdDetails(ad) {
    var lines = String((ad && ad.ad_details) || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 4);
    if (!lines.length) { var host = houseAdHost(ad && ad.target_url); if (host) lines = [host]; }
    return lines.map(function (text) {
      var kind = /@/.test(text) ? 'mail'
        : /^(https?:\/\/|www\.)|\.(co\.za|com|org|net|africa|za)(\/|$)/i.test(text) ? 'web'
        : /^[+()\d][\d\s()+-]{6,}$/.test(text) ? 'tel' : 'pin';
      return { kind: kind, text: text.replace(/^https?:\/\//i, '').replace(/\/$/, '') };
    });
  }

  var HOUSE_AD_ICONS = {
    tel: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    pin: '<path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'
  };

  // Layout sizes for the two stage shapes (wide banner 1200x400, box 300x250).
  function houseAdSizes(box) {
    return box
      ? { w: 300, h: 250, pad: '10px 16px', gap: 7, logo: 46, brand: 10, head: 21, tag: 11, chip: 11, chipPad: '4px 8px', cta: 13, ctaPad: '6px 16px', col: true, ring: 14 }
      : { w: 1200, h: 400, pad: '34px 70px 34px 60px', gap: 54, logo: 250, brand: 24, head: 62, tag: 28, chip: 25, chipPad: '10px 20px', cta: 30, ctaPad: '12px 36px', col: false, ring: 44 };
  }

  // opts: { w, h } stage size (300x250 = box layout), { tile:false } for a logo that is already
  // white-on-transparent, { highlight:'FREE' } to mark a word, { cta:'Apply now' }, { arches:true }.
  function buildHouseAdCardDocument(ad, logoUrl, opts) {
    opts = opts || {};
    var box = opts.w === 300;
    var z = houseAdSizes(box);
    var brandText = String((ad && ad.advertiser_name) || '');
    var headlineText = String((ad && (ad.title || ad.advertiser_name)) || '');
    var tagLine = String((ad && ad.message) || '').split(/\r?\n/)[0].trim();
    var cta = String((ad && ad.cta_text) || opts.cta || 'Learn more');
    var details = houseAdDetails(ad);
    var hl = String(opts.highlight || '').toLowerCase();
    var t = 0.25;                                   // running delay, seconds
    function d(step) { var v = t; t += step; return v.toFixed(2) + 's'; }

    var logoHtml, initial = houseAdEsc((brandText || headlineText || '?').charAt(0).toUpperCase());
    var tileClass = opts.tile === false ? ' plain' : '';
    if (logoUrl) {
      logoHtml = '<img class="logo' + tileClass + '" src="' + houseAdEsc(logoUrl) + '" alt="" data-i="' + initial + '" onerror="var m=document.createElement(\'div\');m.className=\'logo mono\';m.textContent=this.dataset.i;this.replaceWith(m)">';
    } else {
      logoHtml = '<div class="logo mono">' + initial + '</div>';
    }
    var logoDelay = d(0.55);

    var brandHtml = '';
    if (brandText) {
      var chars = brandText.toUpperCase().split('');
      brandHtml = '<div class="brand">' + chars.map(function (c, i) {
        return '<span style="animation-delay:' + (t + i * 0.028).toFixed(2) + 's">' + (c === ' ' ? '&nbsp;' : houseAdEsc(c)) + '</span>';
      }).join('') + '</div>';
      t += chars.length * 0.028 + 0.1;
    }

    var words = headlineText.split(/\s+/).filter(Boolean);
    var headHtml = '<h1 class="head' + (headlineText.length > 30 ? ' long' : '') + '">' + words.map(function (w) {
      var clean = w.replace(/[^\w]/g, '').toLowerCase();
      return '<span class="w' + (hl && clean === hl ? ' hl' : '') + '" style="animation-delay:' + d(0.13) + '">' + houseAdEsc(w) + '</span>';
    }).join(' ') + '</h1>';

    t += 0.12;
    var tagHtml = tagLine ? '<p class="tag" style="animation-delay:' + d(0.5) + '">' + houseAdEsc(tagLine) + '</p>' : '';

    var chipsHtml = details.length ? '<div class="chips">' + details.map(function (c, i) {
      return '<span class="chip ' + (i % 2 ? 'fromL' : 'fromR') + '" style="animation-delay:' + d(0.42) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + HOUSE_AD_ICONS[c.kind] + '</svg>' + houseAdEsc(c.text) + '</span>';
    }).join('') + '</div>' : '';

    var ctaHtml = '<span class="cta" style="animation-delay:' + d(0.2) + '"><b>' + houseAdEsc(cta) + '</b><i aria-hidden="true">&rarr;</i></span>';
    var idleAt = (t + 0.9).toFixed(2) + 's';

    var css =
      '*{margin:0;padding:0;box-sizing:border-box}' +
      'html,body{width:100%;height:100%;overflow:hidden;background:#050505}' +
      'body{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:#fff}' +
      '#ad{position:absolute;left:0;top:0;width:' + z.w + 'px;height:' + z.h + 'px;transform-origin:0 0;overflow:hidden;background:radial-gradient(120% 140% at 8% 0%,#1d1d1d 0%,#070707 55%,#000 100%)}' +
      '.orb{position:absolute;border-radius:50%;background:rgba(255,255,255,.16);filter:blur(' + (box ? 18 : 42) + 'px);animation:orb 9s ease-in-out infinite alternate}' +
      '.o1{width:' + (box ? 150 : 380) + 'px;height:' + (box ? 150 : 380) + 'px;left:' + (box ? -50 : -110) + 'px;top:' + (box ? -60 : -150) + 'px}' +
      '.o2{width:' + (box ? 130 : 300) + 'px;height:' + (box ? 130 : 300) + 'px;right:' + (box ? -40 : -70) + 'px;bottom:' + (box ? -60 : -140) + 'px;animation-delay:-4s}' +
      '@keyframes orb{to{transform:translate(' + (box ? 24 : 70) + 'px,' + (box ? 16 : 44) + 'px) scale(1.25)}}' +
      '.grid{position:absolute;inset:0;opacity:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:' + (box ? 20 : 40) + 'px ' + (box ? 20 : 40) + 'px;animation:fadein 1.2s .1s ease-out forwards}' +
      '.sweep{position:absolute;top:0;bottom:0;width:30%;left:-45%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent);transform:skewX(-18deg);animation:sweep 1.3s .1s ease-out forwards}' +
      '@keyframes sweep{to{left:135%}}' +
      '.bar{position:absolute;left:0;top:0;width:' + (box ? 5 : 12) + 'px;height:100%;background:#fff;transform:scaleY(0);transform-origin:top;animation:bar .9s .05s ease-out forwards}' +
      '@keyframes bar{to{transform:scaleY(1)}}' +
      (opts.arches ? '.arch{position:absolute;top:-' + (box ? 40 : 150) + 'px;width:' + (box ? 130 : 520) + 'px;height:' + (box ? 300 : 860) + 'px;border-radius:' + (box ? 65 : 260) + 'px ' + (box ? 65 : 260) + 'px 0 0;background:rgba(255,255,255,.06)}.arch.l{left:-' + (box ? 40 : 160) + 'px}.arch.r{right:-' + (box ? 40 : 160) + 'px}' : '') +
      '.wrap{position:absolute;inset:0;display:flex;align-items:center;padding:' + z.pad + ';gap:' + z.gap + 'px;flex-direction:' + (z.col ? 'column' : 'row') + (z.col ? ';justify-content:center;align-items:flex-start' : '') + '}' +
      '.top{display:flex;align-items:center;gap:' + (box ? 12 : 0) + 'px}' +
      '.logoBox{position:relative;flex:0 0 ' + z.logo + 'px;width:' + z.logo + 'px;height:' + z.logo + 'px;display:flex;align-items:center;justify-content:center;animation:drop .95s cubic-bezier(.2,.9,.25,1.15) ' + logoDelay + ' both}' +
      '.logoBox .in{width:100%;height:100%;display:flex;align-items:center;justify-content:center;animation:float 4.2s ease-in-out ' + idleAt + ' infinite}' +
      '.ring{position:absolute;inset:0;border-radius:' + z.ring + 'px;border:2px solid rgba(255,255,255,.6);opacity:0;animation:ring 2.6s ' + idleAt + ' ease-out infinite}' +
      '.logo{width:100%;height:100%;object-fit:contain;border-radius:' + z.ring + 'px;background:#fff;padding:' + (box ? 8 : 26) + 'px;display:block}' +
      '.logo.plain{background:none;padding:0;border-radius:0}' +
      '.logo.mono{display:flex;align-items:center;justify-content:center;color:#000;font-weight:800;font-size:' + (box ? 34 : 130) + 'px}' +
      '@keyframes drop{0%{opacity:0;transform:translateY(-140%) rotate(-22deg) scale(.6)}55%{opacity:1;transform:translateY(7%) rotate(5deg) scale(1.06)}78%{transform:translateY(-3%) rotate(-2deg) scale(.99)}100%{opacity:1;transform:none}}' +
      '@keyframes float{50%{transform:translateY(' + (box ? -3 : -9) + 'px)}}' +
      '@keyframes ring{0%{opacity:.75;transform:scale(1)}100%{opacity:0;transform:scale(' + (box ? 1.25 : 1.32) + ')}}' +
      '.txt{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}' +
      '.brand{font-size:' + z.brand + 'px;font-weight:800;letter-spacing:' + (box ? 2 : 4) + 'px;color:#a9a9a9;margin-bottom:' + (box ? 4 : 12) + 'px;white-space:nowrap;overflow:hidden}' +
      '.brand span{display:inline-block;opacity:0;animation:type .35s ease-out both}' +
      '@keyframes type{from{opacity:0;transform:translateY(60%) scale(.6)}to{opacity:1;transform:none}}' +
      '.head{font-size:' + z.head + 'px;line-height:1.04;font-weight:800;letter-spacing:' + (box ? -.5 : -1.5) + 'px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.head.long{font-size:' + Math.round(z.head * 0.82) + 'px}' +
      '.w{display:inline-block;opacity:0;animation:rise .7s cubic-bezier(.2,.8,.2,1) both}' +
      '.w.hl{background:#fff;color:#000;padding:0 .12em;border-radius:.12em}' +
      '@keyframes rise{from{opacity:0;transform:translateY(' + (box ? 26 : 70) + 'px) skewY(9deg);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}' +
      '.tag{font-size:' + z.tag + 'px;line-height:1.25;color:#cfcfcf;margin-top:' + (box ? 5 : 14) + 'px;opacity:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;animation:fadeup .7s ease-out both}' +
      '@keyframes fadeup{from{opacity:0;transform:translateY(' + (box ? 8 : 18) + 'px)}to{opacity:1;transform:none}}' +
      '@keyframes fadein{to{opacity:1}}' +
      '.chips{display:flex;flex-wrap:wrap;gap:' + (box ? 6 : 12) + 'px;margin-top:' + (box ? 8 : 20) + 'px}' +
      '.chip{display:inline-flex;align-items:center;gap:' + (box ? 6 : 10) + 'px;font-size:' + z.chip + 'px;font-weight:700;padding:' + z.chipPad + ';border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.28);white-space:nowrap;opacity:0}' +
      '.chip svg{width:' + Math.round(z.chip * 1.0) + 'px;height:' + Math.round(z.chip * 1.0) + 'px;flex:0 0 auto}' +
      '.fromR{animation:fromR .75s cubic-bezier(.2,.9,.25,1.2) both}.fromL{animation:fromL .75s cubic-bezier(.2,.9,.25,1.2) both}' +
      '@keyframes fromR{from{opacity:0;transform:translateX(' + (box ? 90 : 300) + 'px) rotate(7deg)}to{opacity:1;transform:none}}' +
      '@keyframes fromL{from{opacity:0;transform:translateX(' + (box ? -90 : -300) + 'px) rotate(-7deg)}to{opacity:1;transform:none}}' +
      '.cta{position:relative;overflow:hidden;align-self:flex-start;display:inline-flex;align-items:center;gap:' + (box ? 7 : 14) + 'px;margin-top:' + (box ? 9 : 22) + 'px;padding:' + z.ctaPad + ';border-radius:999px;background:#fff;color:#000;font-size:' + z.cta + 'px;opacity:0;animation:pop .7s cubic-bezier(.2,1.4,.3,1) both,pulse 1.8s ease-in-out ' + idleAt + ' infinite}' +
      '.cta b{font-weight:800}.cta i{font-style:normal;font-weight:800;display:inline-block;animation:nudge 1.2s ease-in-out ' + idleAt + ' infinite}' +
      '.cta:after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(0,0,0,.18),transparent);transform:skewX(-20deg);animation:shimmer 2.8s ' + idleAt + ' ease-in-out infinite}' +
      '@keyframes pop{0%{opacity:0;transform:scale(0) rotate(-8deg)}70%{opacity:1;transform:scale(1.14) rotate(2deg)}100%{opacity:1;transform:none}}' +
      '@keyframes pulse{50%{transform:scale(1.06)}}' +
      '@keyframes nudge{50%{transform:translateX(' + (box ? 3 : 7) + 'px)}}' +
      '@keyframes shimmer{0%{left:-60%}60%,100%{left:140%}}' +
      '@media (prefers-reduced-motion:reduce){*{animation:none!important}.grid{opacity:1}.sweep,.ring{display:none}.logoBox,.brand span,.w,.tag,.chip,.cta{opacity:1}}';

    var logoBlock = '<div class="logoBox"><span class="ring"></span><div class="in">' + logoHtml + '</div></div>';
    var textBlock = '<div class="txt">' + (box ? '' : brandHtml) + headHtml + tagHtml + chipsHtml + ctaHtml + '</div>';
    var inner = '<div id="ad"><span class="orb o1"></span><span class="orb o2"></span><span class="grid"></span>' +
      (opts.arches ? '<span class="arch l"></span><span class="arch r"></span>' : '') +
      '<span class="sweep"></span><span class="bar"></span><div class="wrap">' +
      (box ? '<div class="top">' + logoBlock + '<div class="txt" style="flex:1">' + brandHtml + '</div></div>' + textBlock.replace('<div class="txt">', '<div class="txt" style="flex:0 0 auto;width:100%">') : logoBlock + textBlock) +
      '</div></div>';
    // Standalone files (not played through the app) carry their own click-through link.
    var body = opts.href ? '<a href="' + houseAdEsc(opts.href) + '" target="_blank" rel="sponsored noopener" aria-label="' + houseAdEsc(headlineText) + '" style="display:block;position:absolute;left:0;top:0;width:100%;height:100%;color:inherit;text-decoration:none">' + inner + '</a>' : inner;
    var script = '(function(){var ad=document.getElementById("ad");function fit(){var s=Math.min(innerWidth/' + z.w + ',innerHeight/' + z.h + ');ad.style.transform=Math.abs(s-1)<.001?"none":"scale("+s+")"}fit();addEventListener("resize",fit)})();';
    var doc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="ad.size" content="width=' + z.w + ',height=' + z.h + '"><style>' + css + '</style></head><body>' + body + '<script>' + script + '<\/script></body></html>';
    if (opts.curtain === false) return doc;
    // Content is on screen from `t` (last item in) for about 3s before the curtains close (86% of the cycle).
    return houseAdWithCurtain(doc, Math.max(9, (t + 3) / 0.86));
  }

  // A picture, animated: black curtains open, the picture settles in and drifts, a light sweeps
  // across, then the curtains close and the cycle repeats. The picture is never cropped: a blurred
  // copy fills the box behind it. A button appears only when the ad has its own cta_text; there is
  // no automatic "Visit <site>" button.
  function buildHouseAdImageDocument(imageUrl, ad) {
    var src = houseAdEsc(imageUrl);
    var label = String((ad && ad.cta_text) || '').trim();
    var cta = label ? '<span class="cta"><b>' + houseAdEsc(label) + '</b><i aria-hidden="true">&rarr;</i></span>' : '';
    var C = 11, c = C + 's';
    var cur = houseAdCurtain(C);
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="ad.size" content="width=1200,height=400"><style>' +
      'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}' +
      'img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}' +
      '.bg{object-fit:cover;filter:blur(22px) brightness(.55);transform:scale(1.15)}' +
      '.fg{object-fit:contain;opacity:0;animation:settle ' + c + ' cubic-bezier(.2,.8,.2,1) infinite}' +
      cur.css +
      '.shine{position:absolute;top:0;bottom:0;width:34%;left:-50%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.34),transparent);transform:skewX(-18deg);z-index:2;animation:shine ' + c + ' ease-in-out infinite}' +
      '.cta{position:absolute;right:3.2%;bottom:7%;z-index:4;display:inline-flex;align-items:center;gap:.5em;background:#fff;color:#000;font:800 max(11px,2.6vw)/1 "Trebuchet MS","Segoe UI",Arial,sans-serif;padding:.62em 1.1em;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.45);opacity:0;animation:pop ' + c + ' cubic-bezier(.2,1.4,.3,1) infinite}' +
      '.cta i{font-style:normal}' +
      '@keyframes settle{0%,3%{opacity:0;transform:scale(1.14)}12%{opacity:1;transform:none}86%,100%{opacity:1;transform:scale(1.025)}}' +
      '@keyframes shine{0%,14%{left:-50%}26%,100%{left:130%}}' +
      '@keyframes pop{0%,24%{opacity:0;transform:scale(0) rotate(-8deg)}30%{opacity:1;transform:scale(1.14) rotate(2deg)}34%,88%{opacity:1;transform:none}100%{opacity:1;transform:none}}' +
      '@media (prefers-reduced-motion:reduce){*{animation:none!important}.fg{opacity:1}.hc,.shine{display:none}.cta{opacity:1}}' +
      '</style></head><body>' +
      '<img class="bg" src="' + src + '" alt="" aria-hidden="true">' +
      '<img class="fg" src="' + src + '" alt="" onerror="parent.postMessage({houseAdError:1},\'*\')">' +
      '<span class="shine"></span>' + cur.html + cta + '</body></html>';
  }
  /* @house-ad-docs:end */
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
  function render(slot, ad) {
    var image = safeUrl(ad && ad.image_url), target = safeUrl(ad && ad.target_url);
    if (!ad || !image || !target) { slot.hidden = true; return; }
    var kind = houseAdKind(ad, image), w = 1200, h = 400;
    if (kind === 'html5') { var m = image.match(/(\d{2,4})x(\d{2,4})\.html?(?:[?#]|$)/i); if (m) { w = +m[1]; h = +m[2]; } }
    var alt = imageEscape(ad.title || ad.advertiser_name || 'Promotion');
    slot.hidden = false;
    slot.innerHTML = '<a class="public-house-ad" href="' + imageEscape(target) + '" target="_blank" rel="sponsored noopener noreferrer" aria-label="' + alt + '">'
      + '<span style="display:block;position:relative;width:100%;aspect-ratio:' + w + ' / ' + h + ';background:#000;overflow:hidden;border-radius:18px">'
      + '<iframe title="' + alt + '" loading="lazy" tabindex="-1" scrolling="no" sandbox="allow-scripts" referrerpolicy="no-referrer" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none"></iframe></span></a>';
    var htmlFrame = slot.querySelector('iframe');
    function directCreative() {
      htmlFrame.removeAttribute('srcdoc');
      htmlFrame.src = image;
      slot.hidden = false;
    }
    if (kind === 'html5') {
      fetch(image, { credentials: 'omit', cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('ad ' + res.status);
        return res.text();
      }).then(function (html) {
        if (html.indexOf('name="ad.size"') === -1) throw new Error('not an ad');
        var doc = houseAdWithCurtain(html, 12); // same open/close curtain cycle as every other ad
        htmlFrame.srcdoc = doc;
        houseAdLoop(htmlFrame, doc);
      }).catch(directCreative);
    } else {
      var adDoc = kind === 'card' ? buildHouseAdCardDocument(ad, image) : buildHouseAdImageDocument(image, ad);
      htmlFrame.srcdoc = adDoc;
      houseAdLoop(htmlFrame, adDoc); // card ads replay each cycle; picture ads loop themselves in CSS
      window.addEventListener('message', function onMessage(event) {
        if (!htmlFrame.isConnected) { window.removeEventListener('message', onMessage); return; }
        if (event.source === htmlFrame.contentWindow && event.data && event.data.houseAdError) { window.removeEventListener('message', onMessage); hide(); }
      });
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
      var pool = ads.filter(function (item) { return (item.ad_slot || 'top') === placement; });
      var ad = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null; // several ads take turns per page view
      render(slot, ad);
    });
  }).catch(function () { slots.forEach(function (slot) { slot.hidden = true; }); });
}());
