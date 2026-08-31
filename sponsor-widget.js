/*!
 * SA Recruiters — Sponsor Slot widget
 * -----------------------------------------------------------------
 * A restyle + integration of the original self-hosted ad rotator so it:
 *   1. Looks native to the app — uses the same CSS variables as
 *      vacancy-card / hub-card / badge / pill (styles.css), respects
 *      light/dark theme automatically, matches the borderless-shadow
 *      card + pill-badge language you're moving the UI toward.
 *   2. Is named to avoid ad-blocker heuristics. "ad", "ads", "ad-slot"
 *      etc. are common blocklist trigger strings — this file, its
 *      classes, and its globals avoid that vocabulary entirely
 *      (SponsorWidget / .sponsor-slot / .sponsor-card).
 *   3. Optionally logs impressions/clicks to Supabase instead of
 *      localStorage, so you get real aggregate numbers across
 *      visitors instead of per-browser counts. Falls back to
 *      localStorage automatically if no client is supplied, so it
 *      still works standalone.
 *
 * HOW TO USE
 * -----------------------------------------------------------------
 * 1. Upload this file to your site (e.g. /sponsor-widget.js) and add
 *    it to sw.js CORE_ASSETS if you want it precached like your other
 *    core files.
 * 2. Add a slot wherever a sponsored card should appear:
 *      <div class="sponsor-slot"></div>
 * 3. Include the script after supabase-js and your own app.js has
 *    created its client, then configure:
 *      <script src="/sponsor-widget.js"></script>
 *      <script>
 *        SponsorWidget.init({
 *          rotateSeconds: 8,
 *          // Optional — pass your existing Supabase client to log
 *          // events server-side. Omit to fall back to localStorage.
 *          supabaseClient: window.sb,       // whatever you named it
 *          supabaseTable: 'sponsor_events',  // id uuid, ad_id text,
 *                                             // event_type text, created_at timestamptz default now()
 *          items: [
 *            {
 *              id: "plumbing-promo",
 *              image: "https://yoursite.com/ads/plumbing.jpg",
 *              link: "https://yoursite.com/services/plumbing",
 *              title: "Verified plumbers near you",
 *              subtext: "Featured agency · Johannesburg",
 *              weight: 2
 *            }
 *          ]
 *        });
 *      </script>
 *
 * Check stats any time from the browser console:
 *   SponsorWidget.getStats()   // only meaningful for the localStorage fallback;
 *                               // Supabase-backed stats live in your table.
 */
(function (window, document) {
  "use strict";

  var STORAGE_KEY = "sponsorWidgetStats_v1";
  var DEFAULTS = {
    rotateSeconds: 8,
    items: [],
    slotSelector: ".sponsor-slot",
    label: "Sponsored",
    supabaseClient: null,
    supabaseTable: "sponsor_events"
  };

  var config = null;
  var timers = [];
  var stylesInjected = false;

  /* ---------- stats: Supabase if provided, else localStorage ---------- */

  function loadLocalStats() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveLocalStats(stats) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (e) {
      /* localStorage unavailable (private mode, etc) — fail silently */
    }
  }

  function recordEvent(itemId, type) {
    if (config.supabaseClient) {
      config.supabaseClient
        .from(config.supabaseTable)
        .insert({ ad_id: itemId, event_type: type })
        .then(function (res) {
          if (res && res.error) {
            console.warn("SponsorWidget: Supabase insert failed, falling back to local log:", res.error.message);
            recordEventLocal(itemId, type);
          }
        });
      return;
    }
    recordEventLocal(itemId, type);
  }

  function recordEventLocal(itemId, type) {
    var stats = loadLocalStats();
    if (!stats[itemId]) stats[itemId] = { impressions: 0, clicks: 0 };
    stats[itemId][type] = (stats[itemId][type] || 0) + 1;
    saveLocalStats(stats);
  }

  /* ---------- selection ---------- */

  function pickWeighted(items) {
    var total = items.reduce(function (sum, item) {
      return sum + (item.weight || 1);
    }, 0);
    var r = Math.random() * total;
    var acc = 0;
    for (var i = 0; i < items.length; i++) {
      acc += items[i].weight || 1;
      if (r <= acc) return items[i];
    }
    return items[items.length - 1];
  }

  /* ---------- styling — pulls straight from the app's CSS variables ---------- */

  function injectStyles() {
    if (stylesInjected || document.getElementById("sponsor-widget-styles")) return;
    var style = document.createElement("style");
    style.id = "sponsor-widget-styles";
    style.textContent = [
      /* Card shell — same recipe as .vacancy-card / .hub-card: */
      /* var(--card) fill, var(--radius) corners, var(--border) hairline, var(--shadow-sm) lift */
      ".sponsor-card{position:relative;display:block;overflow:hidden;",
      "background:var(--card);border:1px solid var(--border);border-radius:var(--radius);",
      "box-shadow:var(--shadow-sm);margin-bottom:12px;transition:box-shadow .2s,border-color .2s var(--ease);}",
      ".sponsor-card:hover{border-color:var(--accent-soft);}",
      ".sponsor-card:active{transform:scale(.98);}",

      ".sponsor-media{position:relative;width:100%;aspect-ratio:16/9;background:var(--card-2);overflow:hidden;}",
      ".sponsor-media img{display:block;width:100%;height:100%;object-fit:cover;}",

      /* Pill badge, identical construction to .badge in styles.css */
      ".sponsor-tag{position:absolute;top:10px;left:10px;display:inline-flex;align-items:center;gap:3px;",
      "background:var(--badge-bg);color:var(--badge-text);font-size:10px;font-weight:600;",
      "padding:3px 9px;border-radius:var(--radius-pill);line-height:1.4;",
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}",

      /* Thin progress bar showing rotation timing, accent-colored, pill-capped */
      ".sponsor-progress{position:absolute;bottom:0;left:0;height:2px;width:100%;",
      "background:rgba(0,0,0,.12);overflow:hidden;}",
      ".sponsor-progress-bar{height:100%;width:0%;background:var(--accent);border-radius:var(--radius-pill);}",
      ".sponsor-progress-bar.animate{transition:width linear;}",

      ".sponsor-body{padding:14px 16px;}",
      ".sponsor-title{font-size:14px;font-weight:700;letter-spacing:-0.01em;line-height:1.3;color:var(--text);",
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".sponsor-subtext{font-size:11.5px;color:var(--text-2);margin-top:3px;",
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
    ].join("");
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /* ---------- render ---------- */

  function renderItem(slotEl, item, rotateSeconds) {
    slotEl.innerHTML = "";

    var a = document.createElement("a");
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noopener sponsored";
    a.className = "sponsor-card";

    var media = document.createElement("div");
    media.className = "sponsor-media";

    var img = document.createElement("img");
    img.src = item.image;
    img.alt = item.title || "";
    img.loading = "lazy";
    media.appendChild(img);

    var tag = document.createElement("span");
    tag.className = "sponsor-tag";
    tag.textContent = config.label;
    media.appendChild(tag);

    if (rotateSeconds > 0) {
      var progress = document.createElement("div");
      progress.className = "sponsor-progress";
      var bar = document.createElement("div");
      bar.className = "sponsor-progress-bar";
      progress.appendChild(bar);
      media.appendChild(progress);
      // Kick the transition on the next frame so it animates from 0 -> 100%.
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          bar.classList.add("animate");
          bar.style.transitionDuration = rotateSeconds + "s";
          bar.style.width = "100%";
        });
      });
    }

    var body = document.createElement("div");
    body.className = "sponsor-body";

    if (item.title) {
      var title = document.createElement("div");
      title.className = "sponsor-title";
      title.textContent = item.title;
      body.appendChild(title);
    }
    if (item.subtext) {
      var sub = document.createElement("div");
      sub.className = "sponsor-subtext";
      sub.textContent = item.subtext;
      body.appendChild(sub);
    }

    a.appendChild(media);
    if (item.title || item.subtext) a.appendChild(body);

    a.addEventListener("click", function () {
      recordEvent(item.id, "clicks");
    });

    slotEl.appendChild(a);
    recordEvent(item.id, "impressions");
  }

  function startSlot(slotEl) {
    if (!config.items.length) return;

    function showNext() {
      var item = pickWeighted(config.items);
      renderItem(slotEl, item, config.rotateSeconds);
    }

    showNext();

    if (config.rotateSeconds > 0) {
      var t = window.setInterval(showNext, config.rotateSeconds * 1000);
      timers.push(t);
    }
  }

  /* ---------- public API ---------- */

  function init(userConfig) {
    config = Object.assign({}, DEFAULTS, userConfig || {});
    if (!config.items || !config.items.length) {
      console.warn("SponsorWidget: no items configured — nothing to show.");
      return;
    }

    injectStyles();

    timers.forEach(function (t) { window.clearInterval(t); });
    timers = [];

    var slots = document.querySelectorAll(config.slotSelector);
    slots.forEach(startSlot);
  }

  function getStats() {
    if (config && config.supabaseClient) {
      console.log("SponsorWidget: stats are logged to Supabase table '" + config.supabaseTable + "' — query it directly for aggregate numbers.");
      return null;
    }
    var stats = loadLocalStats();
    var rows = Object.keys(stats).map(function (id) {
      var s = stats[id];
      var ctr = s.impressions ? ((s.clicks / s.impressions) * 100).toFixed(2) : "0.00";
      return { id: id, impressions: s.impressions || 0, clicks: s.clicks || 0, ctr: ctr + "%" };
    });
    console.table(rows);
    return stats;
  }

  function resetStats() {
    saveLocalStats({});
    console.log("SponsorWidget: local stats cleared. (Supabase-logged stats are unaffected.)");
  }

  window.SponsorWidget = {
    init: init,
    getStats: getStats,
    resetStats: resetStats
  };
})(window, document);

/*
 * SUPABASE TABLE (optional, recommended)
 * -----------------------------------------------------------------
 * create table sponsor_events (
 *   id uuid primary key default gen_random_uuid(),
 *   ad_id text not null,
 *   event_type text not null check (event_type in ('impressions','clicks')),
 *   created_at timestamptz not null default now()
 * );
 * -- Enable RLS and add an insert-only policy for anon if this runs
 * -- client-side, so visitors can log events but can't read others' rows.
 *
 * SERVICE WORKER
 * -----------------------------------------------------------------
 * If item images are same-origin, sw.js's stale-while-revalidate
 * runtime cache will pick them up automatically — no change needed.
 * If they're hosted elsewhere and you want rotation to always reflect
 * the latest creative rather than a cached copy, add their origin to
 * a short-lived cache policy, or set cache-control headers on the
 * image host to a low max-age.
 */
