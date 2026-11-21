// ============================================================
//  SA RECRUITERS — app-guide.js  (Character Guide)
// ============================================================
//  A small (44px) animated helper that lives in one fixed overlay, so it
//  stays on screen across Home, vacancy lists/cards, saved jobs, agencies,
//  Scam Check and every sheet. It never owns app state: it watches the
//  app through delegated DOM events and reacts.
//
//  Layers (top to bottom of this file):
//    1. store      tiny state container (quiet / hidden / bubble / menu ...)
//    2. rig        modular SVG character, drawn from joint angles
//    3. poses      idle, wave, point, run, cheer (clap + jump), think,
//                  sparkle, headsup. Pure functions of time -> joint angles
//    4. engine     rAF loop: spring / linear motion, pose blending, render.
//                  Loop sleeps whenever the character is calmly idle.
//    5. director   public API + priorities + onboarding / roam sequences
//    6. adapter    DOM wiring (scroll, clicks, toasts, empty states, sheets)
//
//  Public API (window.SAGuide), also reachable via a DOM event:
//    document.dispatchEvent(new CustomEvent('sa-guide',
//        { detail: { type: 'applyStep', label: 'Resume uploaded' } }))
//    window/document.dispatchEvent(new CustomEvent('sa-guide:event',
//        { detail: { type: 'new-jobs-loaded' } }))
//
//    onAppOpen()                  wave, pop in, point at Available Vacancies
//    onScroll(direction, velocity, progress)   direction: 1 down / -1 up,
//                                 velocity in px/s, progress 0..1 (optional)
//    onIdleBrowse()               a short jog along the bottom track
//    onApplyStep(stepLabel)       clap + cheer + micro message
//    onSaveVacancy()              nod + sparkle
//    onEmptyResults(kind)         scratch head + quick tip
//    say(text, opts) / setQuiet(bool) / setEnabled(bool) / setTipsOnly(bool)
//    setIntensity('low'|'standard') / resetOnboarding() / show() / hide()
//
//  Rules it keeps: pointer-events are off everywhere except the 44px
//  character when it is resting (and the menu when open); it hides while a
//  text field has focus or a tall sheet is open; bubbles are one line and
//  clamped inside the app column; prefers-reduced-motion gives static poses,
//  no roaming and no scroll-running.
//
//  Classic script (like app-alerts.js): talks to the app only through
//  window globals that the module bridge already exposes, each guarded.
//  Pure helpers are exported for scripts/app-guide.test.mjs.
// ============================================================
(function (root) {
  'use strict';

  var PI = Math.PI;
  var SIZE = 44;
  var KEY_QUIET = 'sa_guide_quiet';
  var KEY_ENABLED = 'sa_guide_enabled';
  var KEY_TIPS_ONLY = 'sa_guide_tips_only';
  var KEY_INTENSITY = 'sa_guide_intensity';
  var KEY_ONBOARDED = 'sa_guide_onboarded';
  var KEY_HIDDEN = 'sa_guide_hidden_until';
  var KEY_SESSION = 'sa_guide_session';
  var DAY = 24 * 60 * 60 * 1000;

  // ---------- copy (one line each, kept short for 320px phones) ----------
  var MSG = {
    onboard: 'Hi, I\u2019m your SA Recruiters guide. Tap me anytime for help.',
    welcome: 'Welcome! Tap me for quick help.',
    opened: ['Nice move! Keep going!', 'Good pick\u2014read the details.', 'Looking good\u2014you\u2019ve got this!'],
    apply: 'Application step complete\u2014you\u2019ve got this!',
    done: 'Step complete\u2014keep going!',
    saved: ['Saved! Find it under Saved.', 'Nice pick\u2014saved for later!'],
    empty: 'No matches\u2014try clearing a filter.',
    emptySearch: 'Try fewer words or a wider area.',
    emptySaved: 'Nothing saved yet\u2014tap the star on a job.',
    quietOn: 'Quiet mode on. Tap me if you need me.',
    quietOff: 'Tips are back on!',
    newJobs: 'New vacancies were added.',
    savedEvent: 'Saved! Find it under Saved.',
    application: 'Tap Apply to continue.',
    profile: 'Your profile needs a little more detail.',
    filters: 'Filters active. Try widening your search.',
    offline: 'You\u2019re offline. I\u2019ll be here when you reconnect.',
    fresh: 'Fresh jobs are ready to explore.'
  };
  var TIPS = [
    { id: 'fee', text: 'Real jobs never charge to apply.' },
    { id: 'verified', text: 'Check the agency is verified first.' },
    { id: 'pin', text: 'Never share your ID or PIN in chat.' },
    { id: 'scam', text: 'Unsure? Run it through Scam Check.', action: 'scam' },
    { id: 'toogood', text: 'Offer too good? Double-check it.' },
    { id: 'official', text: 'Apply through official links only.' }
  ];
  var SCREEN_TIPS = {
    'screen-home': 'Tap Available Vacancies to see new roles.',
    'screen-allvacancies': 'Tap a role to open it, then Apply.',
    'screen-saved': 'Your saved jobs live here.',
    'screen-scamcheck': 'Paste the job ad to check if it is real.',
    'screen-allagencies': 'Look for verified agencies first.'
  };

  // ---------- utils ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function deg(r) { return r * 180 / PI; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function easeOutBack(t) { var c = 1.9; t = clamp(t, 0, 1) - 1; return 1 + (c + 1) * t * t * t + c * t * t; }
  function num(v) { return (Math.round(v * 100) / 100).toString(); }

  // ============================================================
  // 1. STORE
  // ============================================================
  function createStore(initial) {
    var state = {}, subs = [], k;
    for (k in initial) state[k] = initial[k];
    return {
      get: function () { return state; },
      set: function (patch) {
        var next = {}, prev = state, changed = false, key;
        for (key in state) next[key] = state[key];
        for (key in patch) { if (next[key] !== patch[key]) { next[key] = patch[key]; changed = true; } }
        if (!changed) return state;
        state = next;
        subs.slice().forEach(function (fn) { try { fn(state, prev); } catch (e) {} });
        return state;
      },
      subscribe: function (fn) {
        subs.push(fn);
        return function () { subs = subs.filter(function (s) { return s !== fn; }); };
      }
    };
  }

  // ============================================================
  // 2. RIG (side-view pictogram, 48x48 viewBox, hip at 24,28)
  //    Angles are degrees, SVG-clockwise. 0 = limb hanging straight down,
  //    negative = swung forward (toward the way the figure faces).
  // ============================================================
  var NS = 'http://www.w3.org/2000/svg';
  var SH_Y = -10, L1 = 6, L2 = 5.6;      // shoulder height + arm segment lengths (torso space)
  var HIP_Y = 28;

  function svgEl(doc, tag, attrs, parent) {
    var n = doc.createElementNS(NS, tag), k;
    for (k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // Two-bone IK. (tx,ty) is a hand target in torso space. Returns
  // [shoulderAngle, elbowAngle] in degrees. `bend` (+1/-1) picks the elbow side.
  function solveArm(tx, ty, bend) {
    var dx = tx, dy = ty - SH_Y;
    var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var dd = clamp(d, Math.abs(L1 - L2) + 0.3, L1 + L2 - 0.05);
    dx = dx * dd / d; dy = dy * dd / d;
    var base = Math.atan2(-dx, dy);
    var alpha = Math.acos(clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1));
    var t1 = base + (bend || 1) * alpha;
    var ex = -Math.sin(t1) * L1, ey = Math.cos(t1) * L1;
    var t2 = Math.atan2(-(dx - ex), dy - ey);
    var e = deg(t2 - t1);
    while (e > 180) e -= 360;
    while (e < -180) e += 360;
    return [deg(t1), e];
  }

  var STAR_PATH = 'M0,-3.2 L.9,-.9 L3.2,0 L.9,.9 L0,3.2 L-.9,.9 L-3.2,0 L-.9,-.9Z';
  var STAR_SPOTS = [[8.5, 12, 1], [39.5, 15, .85], [6, 30, .7], [42, 29, .9]];

  function buildRig(doc) {
    var svg = svgEl(doc, 'svg', { viewBox: '0 0 48 48', 'class': 'sa-guide__svg', focusable: 'false', 'aria-hidden': 'true' });
    var shadow = svgEl(doc, 'ellipse', { cx: 24, cy: 44.8, rx: 8, ry: 1.6, 'class': 'sg-shadow' }, svg);
    var flip = svgEl(doc, 'g', {}, svg);
    var body = svgEl(doc, 'g', {}, flip);

    function arm(far) {
      var cls = 'sg-limb' + (far ? ' sg-far' : '');
      var g = svgEl(doc, 'g', { 'class': cls }, body);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: L1, 'stroke-width': 3.4 }, g);
      var f = svgEl(doc, 'g', {}, g);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: L2, 'stroke-width': 3.1 }, f);
      svgEl(doc, 'circle', { cx: 0, cy: L2 + 0.3, r: 2.2, 'class': 'sg-hand' }, f);
      return { g: g, f: f };
    }
    function leg(far) {
      var g = svgEl(doc, 'g', { 'class': 'sg-limb' + (far ? ' sg-far' : '') }, body);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: 7.6, 'stroke-width': 3.9 }, g);
      var s = svgEl(doc, 'g', { transform: 'translate(0 7.6)' }, g);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: 7.2, 'stroke-width': 3.6 }, s);
      svgEl(doc, 'line', { x1: 0.4, y1: 7.5, x2: 3.7, y2: 7.5, 'stroke-width': 3 }, s);
      return { g: g, s: s };
    }

    var fA = arm(true);
    var fL = leg(true);
    var torso = svgEl(doc, 'g', { 'class': 'sg-limb' }, body);
    svgEl(doc, 'line', { x1: 0, y1: 1, x2: 0, y2: -10.6, 'stroke-width': 7.2 }, torso);
    svgEl(doc, 'path', { d: 'M-.1,-9.8 L2.7,-9.8 L2.3,-8.3 L3.1,-3.6 L1.2,-1.9 L-.7,-3.6 L.1,-8.3Z', 'class': 'sg-tie' }, body);
    var nL = leg(false);
    var head = svgEl(doc, 'g', {}, body);
    svgEl(doc, 'circle', { cx: 0.8, cy: -6.6, r: 6.3, 'class': 'sg-fill' }, head);
    var eye = svgEl(doc, 'ellipse', { cx: 3.7, cy: -7.4, rx: 1.05, ry: 1.2, 'class': 'sg-eye' }, head);
    var nA = arm(false);

    // effects live outside the mirrored group so the "?" never reads backwards
    var fx = svgEl(doc, 'g', { 'class': 'sg-fx' }, svg);
    var stars = STAR_SPOTS.map(function () { return svgEl(doc, 'path', { d: STAR_PATH, 'class': 'sg-star' }, fx); });
    var q = svgEl(doc, 'g', { 'class': 'sg-q' }, fx);
    svgEl(doc, 'path', { d: 'M-2.1,-2.6 a2.3,2.3 0 1 1 3.6,1.9 c-1.1,.7 -1.4,1.1 -1.4,2.1', fill: 'none', 'stroke-width': 1.7, 'stroke-linecap': 'round' }, q);
    svgEl(doc, 'circle', { cx: 0.1, cy: 4.4, r: 1, 'class': 'sg-qdot' }, q);

    return { svg: svg, shadow: shadow, flip: flip, body: body, head: head, eye: eye, fx: fx, stars: stars, q: q,
      nA: nA.g, nF: nA.f, fA: fA.g, fF: fA.f, nL: nL.g, nS: nL.s, fL: fL.g, fS: fL.s };
  }

  function applyJoints(rig, j, facing, tsec) {
    rig.flip.setAttribute('transform', facing < 0 ? 'translate(48 0) scale(-1 1)' : '');
    rig.body.setAttribute('transform', 'translate(' + num(24 + j.bx) + ' ' + num(HIP_Y + j.by) + ') rotate(' + num(j.lean) + ')');
    rig.head.setAttribute('transform', 'translate(0 -12) rotate(' + num(j.head) + ')');
    rig.nA.setAttribute('transform', 'translate(0 ' + SH_Y + ') rotate(' + num(j.nA) + ')');
    rig.nF.setAttribute('transform', 'translate(0 ' + L1 + ') rotate(' + num(j.nE) + ')');
    rig.fA.setAttribute('transform', 'translate(0 ' + SH_Y + ') rotate(' + num(j.fA) + ')');
    rig.fF.setAttribute('transform', 'translate(0 ' + L1 + ') rotate(' + num(j.fE) + ')');
    rig.nL.setAttribute('transform', 'rotate(' + num(j.nH) + ')');
    rig.nS.setAttribute('transform', 'translate(0 7.6) rotate(' + num(j.nK) + ')');
    rig.fL.setAttribute('transform', 'rotate(' + num(j.fH) + ')');
    rig.fS.setAttribute('transform', 'translate(0 7.6) rotate(' + num(j.fK) + ')');
    rig.eye.setAttribute('ry', num(1.2 * clamp(j.blink, 0.08, 1)));
    var lift = clamp(-j.by / 6, 0, 1);
    rig.shadow.setAttribute('rx', num(8 * (1 - lift * 0.35)));
    rig.shadow.setAttribute('opacity', num(1 - lift * 0.5));
    var fxOn = j.stars > 0.02 || j.q > 0.02;
    rig.fx.setAttribute('visibility', fxOn ? 'visible' : 'hidden');
    for (var i = 0; i < rig.stars.length; i++) {
      var sp = STAR_SPOTS[i];
      var tw = 0.55 + 0.45 * Math.sin(tsec * 9 + i * 1.9);
      var s = j.stars * sp[2] * tw;
      rig.stars[i].setAttribute('transform', 'translate(' + sp[0] + ' ' + sp[1] + ') scale(' + num(Math.max(s, 0.001)) + ') rotate(' + num(tsec * 40 + i * 30) + ')');
    }
    var qx = facing < 0 ? 11 : 37;
    rig.q.setAttribute('transform', 'translate(' + qx + ' ' + num(8 + Math.sin(tsec * 3) * 0.8) + ') scale(' + num(0.5 + 0.5 * j.q) + ')');
    rig.q.setAttribute('opacity', num(j.q));
  }

  // ============================================================
  // 3. POSES (t = seconds into the pose; c = context)
  // ============================================================
  var IDLE = { bx: 0, by: 0, lean: 0, head: 0, nA: 7, nE: -12, fA: -5, fE: -8, nH: 4, nK: 5, fH: -4, fK: 7, blink: 1, stars: 0, q: 0 };
  var KEYS = Object.keys(IDLE);
  var BEND = 1;                                   // elbow side, tuned against rendered frames

  function J(o) {
    var r = {}, k;
    for (k in IDLE) r[k] = IDLE[k];
    for (k in o) r[k] = o[k];
    return r;
  }
  function armTo(x, y, bend) { return solveArm(x, y, bend === undefined ? BEND : bend); }

  var DUR = { wave: 1000, point: 4600, cheer: 2000, think: 3600, sparkle: 1300, headsup: 2600 };
  // Frozen frame used for prefers-reduced-motion (no looping animation)
  var STILL_T = { wave: 0.1, point: 0.3, cheer: 1.5, think: 0.4, sparkle: 0.35, headsup: 0.3 };

  var POSES = {
    idle: function (t, c) { return J({ head: c.look || 0 }); },

    wave: function (t) {
      var w = Math.sin(t * 2 * PI * 2.4);
      var a = armTo(9 + w * 2.2, -16.4 - Math.abs(w) * 0.6);
      return J({ nA: a[0], nE: a[1], lean: -3, head: 4 + w * 2, fA: -9, fE: -10 });
    },

    point: function (t, c) {
      var aim = c.aim || [1, -0.5];
      var n = Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]) || 1;
      var ux = aim[0] / n, uy = aim[1] / n;
      var ext = 11.1 + Math.sin(t * 9) * 0.4;
      var a = armTo(ux * ext, SH_Y + uy * ext);
      var hip = armTo(3.6, -3.4, -BEND);
      return J({ nA: a[0], nE: a[1], fA: hip[0], fE: hip[1], head: clamp(uy * 12, -12, 8), lean: clamp(uy * 4, -4, 3) });
    },

    run: function (t, c) {
      var p = c.phase || 0, s = Math.sin(p), co = Math.cos(p);
      var v = clamp((c.speed || 0) / 900, 0, 1);
      return J({
        lean: 8 + v * 8 + (c.tilt || 0),
        by: -Math.abs(s) * (1.1 + v * 1.3),
        head: -5,
        nH: -42 * s, nK: 22 + 46 * Math.max(0, co),
        fH: 42 * s, fK: 22 + 46 * Math.max(0, -co),
        nA: 38 * s, nE: -78, fA: -38 * s, fE: -78
      });
    },

    // clap (0-1.1s) then a hop with both arms up (1.1-2s)
    cheer: function (t) {
      if (t < 1.1) {
        var th = t * 2 * PI * 3;
        var cx = Math.cos(th);
        var n = armTo(6.3 + 1.9 * cx, -13.2);
        var f = armTo(6.3 - 1.9 * cx, -12.4);
        return J({ nA: n[0], nE: n[1], fA: f[0], fE: f[1], by: -0.9 * Math.abs(Math.sin(th)), head: 2.5 * Math.sin(th), stars: 0.45 });
      }
      var u = clamp((t - 1.1) / 0.8, 0, 1);
      var hop = Math.sin(u * PI);
      var na = armTo(5.4, -21, BEND), fa = armTo(-4, -20.2, -BEND);
      var fade = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
      return J({
        by: -5.5 * hop, head: -8, lean: -2,
        nA: na[0], nE: na[1], fA: fa[0], fE: fa[1],
        nH: -20 * hop, nK: 40 * hop, fH: 12 * hop, fK: 32 * hop,
        stars: fade
      });
    },

    think: function (t) {
      var sc = Math.sin(t * 2 * PI * 4.2);
      var a = armTo(3.4 + sc * 0.9, -19.2 + sc * 0.5);
      return J({ nA: a[0], nE: a[1], head: -5 + Math.sin(t * 2.4) * 6, lean: -2, q: 1 });
    },

    sparkle: function (t) {
      var u = clamp(t / 0.7, 0, 1), nod = Math.sin(u * PI);
      var a = armTo(6.5, -17 - nod * 2);
      var hop = Math.sin(clamp(t / 0.5, 0, 1) * PI);
      return J({ nA: a[0], nE: a[1], head: 15 * nod, by: -2.2 * hop, stars: t < 1 ? 1 : clamp(1.3 - t, 0, 1) });
    },

    // "careful" palm-out gesture used for safety tips
    headsup: function (t) {
      var a = armTo(8.2, -15 + Math.sin(t * 3) * 0.4);
      return J({ nA: a[0], nE: a[1], head: 3, lean: -2 });
    }
  };

  function cadence(speed) { return clamp(1.35 + speed / 330, 1.35, 4.4); }

  // ============================================================
  // Pure helpers used by the adapter (exported for tests)
  // ============================================================
  var EMPTY_LOADING = /loading|fetching|could not|couldn.t|check your connection|try again/i;
  var EMPTY_NOT_SEARCH = /\byet\b|added|submissions|reports|suggestions|branches|employers/i;
  var EMPTY_MATCH = /(no|nothing)\b[^.]*\b(vacanc|role|job|match|result|agenc|listing)/i;

  // -> 'saved' | 'search' | null for an empty-state node's text/dataset
  function classifyEmpty(text, screenData) {
    text = String(text || '');
    if (screenData === 'saved') return 'saved';
    if (screenData) return /^(all|search)$/.test(screenData) ? 'search' : null;
    if (EMPTY_LOADING.test(text)) return null;
    if (/\b(match|matches|results?)\b/i.test(text) && EMPTY_MATCH.test(text)) return 'search';
    if (EMPTY_NOT_SEARCH.test(text)) return null;
    return EMPTY_MATCH.test(text) ? 'search' : null;
  }

  var TOAST_OK = /(application|applied|submitted|sent\b|unlocked|posted|verified|cv (saved|uploaded)|profile (saved|updated))/i;
  var TOAST_BAD = /(could not|couldn.t|failed|error|invalid|please|sign in|unable|try again|removed)/i;
  function toastStep(text) {
    text = String(text || '');
    if (!text || TOAST_BAD.test(text) || !TOAST_OK.test(text)) return null;
    return /application|applied/i.test(text) ? 'Apply tapped' : 'Step complete';
  }

  function stepMessage(label) {
    label = String(label || '');
    if (/^vacancy opened$/i.test(label)) return pick(MSG.opened);
    if (/apply|application|submit|unlock/i.test(label)) return MSG.apply;
    return MSG.done;
  }

  // ============================================================
  // 4-6. ENGINE + DIRECTOR + ADAPTER (needs a window)
  // ============================================================
  function createGuide(win) {
    var doc = win.document;
    var store = createStore({ enabled: true, quiet: false, tipsOnly: false, intensity: 'standard', hidden: false, offscreen: false, away: false, menuOpen: false, started: false, bubble: null, screen: '' });
    var reducedMQ = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = !!(reducedMQ && reducedMQ.matches);
    if (reducedMQ && reducedMQ.addEventListener) reducedMQ.addEventListener('change', function (e) { reduced = e.matches; wake(); });

    function now() { return (win.performance && win.performance.now) ? win.performance.now() : Date.now(); }
    function lsGet(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { if (v === null) win.localStorage.removeItem(k); else win.localStorage.setItem(k, v); } catch (e) {} }
    function ssGet() { try { return JSON.parse(win.sessionStorage.getItem(KEY_SESSION) || '{}') || {}; } catch (e) { return {}; } }
    function ssSet(o) { try { win.sessionStorage.setItem(KEY_SESSION, JSON.stringify(o)); } catch (e) {} }
    function callGlobal(name) { try { if (typeof win[name] === 'function') return win[name](); } catch (e) {} }

    // ---------- DOM ----------
    var ui = {};
    var rig;
    var layout = { ar: { left: 0, right: 360, width: 360 }, navTop: 600, rest: { x: 300, y: 540 }, sheetTop: null, vw: 360, vh: 640 };

    function buildDom() {
      var host = doc.createElement('div');
      host.id = 'sa-guide'; host.className = 'sa-guide';
      host.setAttribute('data-sa-guide', '');

      ui.ring = doc.createElement('div'); ui.ring.className = 'sa-guide__ring'; ui.ring.setAttribute('aria-hidden', 'true');

      ui.bubble = doc.createElement('div'); ui.bubble.className = 'sa-guide__bubble';
      ui.bubble.setAttribute('role', 'status'); ui.bubble.setAttribute('aria-live', 'polite');
      var bin = doc.createElement('span'); bin.className = 'sa-guide__bubble-in';
      ui.icon = doc.createElement('span'); ui.icon.className = 'sa-guide__icon'; ui.icon.setAttribute('aria-hidden', 'true');
      ui.text = doc.createElement('span'); ui.text.className = 'sa-guide__text';
      ui.closeBubble = doc.createElement('button'); ui.closeBubble.type = 'button'; ui.closeBubble.className = 'sa-guide__bubble-close'; ui.closeBubble.textContent = '×'; ui.closeBubble.setAttribute('aria-label', 'Dismiss guide tip');
      bin.appendChild(ui.icon); bin.appendChild(ui.text); bin.appendChild(ui.closeBubble); ui.bubble.appendChild(bin);

      ui.btn = doc.createElement('button');
      ui.btn.type = 'button'; ui.btn.className = 'sa-guide__char';
      ui.btn.setAttribute('aria-label', 'SA Recruiters guide');
      ui.btn.setAttribute('aria-haspopup', 'true'); ui.btn.setAttribute('aria-expanded', 'false');
      rig = buildRig(doc);
      ui.btn.appendChild(rig.svg);

      ui.menu = doc.createElement('div'); ui.menu.className = 'sa-guide__menu';
      ui.menu.setAttribute('role', 'dialog'); ui.menu.setAttribute('aria-label', 'Quick help'); ui.menu.hidden = true;
      ui.menuTip = doc.createElement('p'); ui.menuTip.className = 'sa-guide__tip';
      ui.menu.appendChild(ui.menuTip);
      var chips = doc.createElement('div'); chips.className = 'sa-guide__chips';
      [['Available Vacancies', 'vacancies'], ['Saved Jobs', 'saved'], ['Agencies', 'agencies'], ['Scam Check', 'scam']].forEach(function (c) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'sa-guide__chip'; b.textContent = c[0]; b.setAttribute('data-jump', c[1]);
        chips.appendChild(b);
      });
      ui.menu.appendChild(chips);
      var foot = doc.createElement('div'); foot.className = 'sa-guide__foot';
      ui.quietBtn = doc.createElement('button'); ui.quietBtn.type = 'button'; ui.quietBtn.className = 'sa-guide__toggle';
      ui.quietBtn.setAttribute('data-act', 'quiet');
      ui.hideBtn = doc.createElement('button'); ui.hideBtn.type = 'button'; ui.hideBtn.className = 'sa-guide__toggle'; ui.hideBtn.setAttribute('data-act', 'hide');
      ui.hideBtn.textContent = 'Hide for today';
      foot.appendChild(ui.quietBtn); foot.appendChild(ui.hideBtn); ui.menu.appendChild(foot);
      ui.settings = doc.createElement('div'); ui.settings.className = 'sa-guide__settings';
      ui.enabledBtn = doc.createElement('button'); ui.enabledBtn.type = 'button'; ui.enabledBtn.className = 'sa-guide__toggle'; ui.enabledBtn.setAttribute('data-act', 'enabled');
      ui.tipsBtn = doc.createElement('button'); ui.tipsBtn.type = 'button'; ui.tipsBtn.className = 'sa-guide__toggle'; ui.tipsBtn.setAttribute('data-act', 'tips');
      ui.intensityBtn = doc.createElement('button'); ui.intensityBtn.type = 'button'; ui.intensityBtn.className = 'sa-guide__toggle'; ui.intensityBtn.setAttribute('data-act', 'intensity');
      ui.resetBtn = doc.createElement('button'); ui.resetBtn.type = 'button'; ui.resetBtn.className = 'sa-guide__toggle'; ui.resetBtn.setAttribute('data-act', 'reset'); ui.resetBtn.textContent = 'Reset intro';
      ui.settings.appendChild(ui.enabledBtn); ui.settings.appendChild(ui.quietBtn); ui.settings.appendChild(ui.tipsBtn); ui.settings.appendChild(ui.intensityBtn); ui.settings.appendChild(ui.resetBtn);
      foot.removeChild(ui.quietBtn); foot.removeChild(ui.hideBtn); ui.menu.appendChild(ui.settings); foot.appendChild(ui.hideBtn);

      host.appendChild(ui.ring); host.appendChild(ui.bubble); host.appendChild(ui.btn); host.appendChild(ui.menu);
      doc.body.appendChild(host);
      ui.host = host;
      ui.probe = doc.createElement('div');
      ui.probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';
      host.appendChild(ui.probe);
    }

    // ---------- engine state ----------
    var pos = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
    var goal = null;                 // { x, y, kind: 'spring'|'linear', w, speed, done }
    var facing = -1;
    var cur = J({});                 // blended joints
    var gesture = null;              // { name, start, until, prio, aim, done }
    var mode = 'rest';               // rest | track | lingering | returning | travel
    var trackUntil = 0, returnAt = 0, scrollV = 0, scrollDir = 1, trackTimer = 0;
    var phase = 0, look = 0, lookGoal = 0, blinkUntil = 0;
    var popAt = -1e9, raf = 0, last = 0, seqToken = 0;
    var bubbleTimer = 0, ringTimer = 0, bubbleSide = 'auto', bubbleW = 0, bubbleH = 0, bubbleAction = null;
    var lastStepAt = 0, lastBubbleAt = -1e9, lastActivity = now(), idleDelay = rnd(26000, 38000);
    var lastRoamAt = 0, lastTipAt = 0, startedAt = 0, nextTipGap = rnd(80000, 120000);
    var lastEmptyAt = -1e9, seenEmpty = (typeof WeakSet === 'function') ? new WeakSet() : null;
    var interactive = false;
    var guideObserver = null;

    function st() { return store.get(); }
    function sheetOpen() { return layout.sheetTop !== null; }
    function live() { var s = st(); return s.started && s.enabled && !s.quiet && !s.hidden && !s.offscreen && !s.away && !doc.hidden; }

    // ---------- layout ----------
    function visible(el) { return !!el && el.getClientRects().length > 0 && win.getComputedStyle(el).visibility !== 'hidden'; }

    function measure() {
      var vw = win.innerWidth || 360, vh = win.innerHeight || 640;
      var app = doc.querySelector('.app');
      var ar = app ? app.getBoundingClientRect() : null;
      if (!ar || !ar.width) ar = { left: 0, right: vw, width: vw };
      var safe = ui.probe ? ui.probe.offsetHeight : 0;
      var nav = doc.querySelector('.bottom-nav');
      var navTop = (nav && visible(nav)) ? nav.getBoundingClientRect().top : vh - safe - 4;
      var restY = navTop - SIZE - 8;
      var side = 'right';
      var wa = doc.querySelector('.floating-whatsapp');
      if (wa && visible(wa)) side = 'left';
      var ib = doc.querySelector('.install-banner');
      if (ib && visible(ib)) restY = Math.min(restY, ib.getBoundingClientRect().top - SIZE - 8);
      var sheetTop = null;
      var sh = doc.querySelector('.sheet-scrim.open .sheet');
      if (sh && visible(sh)) { sheetTop = sh.getBoundingClientRect().top; restY = Math.min(restY, sheetTop - SIZE - 6); }
      var mini = st().hidden;
      var restX = side === 'right' ? ar.right - SIZE - 8 : ar.left + 8;
      if (mini) restX += side === 'right' ? 18 : -18;
      layout = { ar: ar, navTop: navTop, rest: { x: restX, y: Math.max(8, restY) }, sheetTop: sheetTop, vw: vw, vh: vh, side: side };
      if (mode === 'rest' && !goal && !gesture) facing = side === 'right' ? -1 : 1;
      var away = (sheetTop !== null && sheetTop < 64) || inputFocused();
      store.set({ away: away });
    }

    function inputFocused() {
      var a = doc.activeElement;
      if (!a || a === doc.body) return false;
      var tag = (a.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag === 'input') return !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test(a.type || 'text');
      return !!a.isContentEditable;
    }

    // ---------- motion ----------
    function snapTo(p) { pos.x = p.x; pos.y = p.y; vel.x = vel.y = 0; goal = null; }
    function moveTo(p, o) {
      o = o || {};
      if (reduced) { snapTo(p); if (o.done) setTimeout(o.done, 0); wake(); return; }
      goal = { x: p.x, y: p.y, kind: o.kind || 'spring', w: o.w || 10, speed: o.speed || 150, done: o.done || null };
      wake();
    }
    function stepMotion(dt) {
      if (!goal) { vel.x *= 0.8; vel.y *= 0.8; return; }
      var dx = goal.x - pos.x, dy = goal.y - pos.y;
      if (goal.kind === 'linear') {
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1.2) { pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0; var d = goal.done; goal = null; if (d) d(); return; }
        var spd = Math.min(goal.speed, dist * 6 + 40), step = Math.min(dist, spd * dt);
        vel.x = dx / dist * spd; vel.y = dy / dist * spd;
        pos.x += dx / dist * step; pos.y += dy / dist * step;
      } else {
        var w = goal.w;
        vel.x += (w * w * dx - 2 * w * vel.x) * dt; vel.y += (w * w * dy - 2 * w * vel.y) * dt;
        pos.x += vel.x * dt; pos.y += vel.y * dt;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(vel.x) < 4 && Math.abs(vel.y) < 4) {
          pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0; var dn = goal.done; goal = null; if (dn) dn();
        }
      }
    }

    // ---------- gestures ----------
    function playGesture(name, o) {
      o = o || {};
      var t = now(), prio = o.prio || 1;
      if (gesture && t < gesture.until && gesture.prio > prio) return false;
      var ms = o.ms || DUR[name] || 1500;
      gesture = { name: name, start: t, until: t + ms, prio: prio, aim: o.aim || null, done: o.done || null };
      if (o.aim && Math.abs(o.aim.dx) > 4) facing = o.aim.dx >= 0 ? 1 : -1;
      if (reduced) setTimeout(wake, ms + 30);
      wake();
      return true;
    }

    // ---------- frame loop ----------
    function wake() { if (raf || !win.requestAnimationFrame) return; last = now(); raf = win.requestAnimationFrame(frame); }

    function frame(ts) {
      raf = 0;
      var t = now();
      var dt = clamp((t - last) / 1000, 0.001, 0.05); last = t;
      var animating = update(dt, t);
      render(t);
      if (animating) raf = win.requestAnimationFrame(frame);
    }

    function update(dt, t) {
      var s = st();
      if (gesture && t >= gesture.until) { var gd = gesture.done; gesture = null; if (gd) gd(); }

      if (mode === 'track' && t > trackUntil) { mode = 'lingering'; returnAt = t + 1800; setTimeout(wake, 1850); }
      if (mode === 'lingering' && t > returnAt) { mode = 'returning'; moveTo(layout.rest, { kind: 'linear', speed: 150, done: function () { mode = 'rest'; } }); }

      if (reduced) { if (goal) snapTo(goal); } else stepMotion(dt);
      var speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (Math.abs(vel.x) > 40 && mode !== 'track') facing = vel.x > 0 ? 1 : -1;

      look += (lookGoal - look) * Math.min(1, dt * 9);

      var name = 'idle', pt = t / 1000, c = { look: look, phase: phase, speed: 0, tilt: 0 };
      var tracking = !reduced && mode === 'track' && t < trackUntil;
      if (gesture) {
        name = gesture.name; pt = (t - gesture.start) / 1000;
        if (reduced) pt = STILL_T[name] === undefined ? 0 : STILL_T[name];
        if (gesture.aim) c.aim = [gesture.aim.dx * facing, gesture.aim.dy];
      } else if (!reduced && (speed > 30 || tracking)) {
        name = 'run';
        c.speed = Math.max(speed, tracking ? scrollV * 0.35 : 0);
        c.tilt = tracking ? scrollDir * 3 : 0;
        phase += cadence(c.speed) * 2 * PI * dt;
        c.phase = phase;
      }

      var target = POSES[name](pt, c);
      if (t < blinkUntil) target.blink = 0.08;
      var alpha = reduced ? 1 : 1 - Math.exp(-dt / 0.055), maxDiff = 0;
      for (var i = 0; i < KEYS.length; i++) {
        var k = KEYS[i], d = target[k] - cur[k];
        cur[k] += d * alpha;
        if (Math.abs(d) > maxDiff) maxDiff = Math.abs(d);
      }

      var popping = t - popAt < 480;
      var settled = name === 'idle' && maxDiff < 0.06 && !popping && !goal && Math.abs(look - lookGoal) < 0.1 && speed < 1 && t >= blinkUntil;
      var wantInteractive = s.started && mode === 'rest' && !goal && speed < 5 && !s.away;
      if (wantInteractive !== interactive) { interactive = wantInteractive; ui.btn.setAttribute('data-live', interactive ? 'true' : 'false'); }
      ui.host.classList.toggle('is-calm', name === 'idle' && !s.quiet);
      return !settled;
    }

    function render(t) {
      var scale = 1, age = t - popAt;
      if (age < 480 && !reduced) scale = 0.25 + 0.75 * easeOutBack(age / 480);
      if (st().hidden) scale *= 0.62;
      ui.btn.style.transform = 'translate3d(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px,0) scale(' + scale.toFixed(3) + ')';
      applyJoints(rig, cur, facing, t / 1000);
      if (st().bubble) placeBubble();
    }

    // ---------- bubble / ring / menu ----------
    var ICONS = {
      shield: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.6 13.4 3.7v4.1c0 3.1-2.2 5.3-5.4 6.6C4.8 13.1 2.6 10.9 2.6 7.8V3.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m5.7 8 1.7 1.7 3-3.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    function say(text, o) {
      o = o || {};
      var s = st();
      if (!s.started || !s.enabled || s.hidden || s.away || (s.quiet && !o.force) || (s.tipsOnly && !(o.tip || o.icon === 'shield'))) return false;
      clearTimeout(bubbleTimer);
      ui.text.textContent = text;
      ui.icon.innerHTML = o.icon && ICONS[o.icon] ? ICONS[o.icon] : '';
      ui.icon.style.display = o.icon && ICONS[o.icon] ? '' : 'none';
      bubbleAction = o.action || null;
      ui.bubble.classList.toggle('is-action', !!bubbleAction);
      bubbleSide = o.side || 'auto';
      ui.bubble.classList.add('is-measure');
      bubbleW = ui.bubble.offsetWidth; bubbleH = ui.bubble.offsetHeight;
      ui.bubble.classList.remove('is-measure');
      lastBubbleAt = now();
      store.set({ bubble: { text: text } });
      ui.bubble.classList.add('is-visible');
      placeBubble();
      var ms = o.ms || clamp(1900 + text.length * 55, 2800, 5200);
      bubbleTimer = setTimeout(hideBubble, ms);
      return true;
    }
    function hideBubble() {
      clearTimeout(bubbleTimer);
      ui.bubble.classList.remove('is-visible', 'is-action');
      bubbleAction = null;
      store.set({ bubble: null });
    }
    function placeBubble() {
      var ar = layout.ar, w = bubbleW, h = bubbleH;
      var side = bubbleSide === 'auto' ? (pos.y > h + 24 ? 'above' : 'below') : bubbleSide;
      var cx = pos.x + SIZE / 2, mid = (ar.left + ar.right) / 2;
      var left = cx > mid ? pos.x + SIZE - w + 6 : pos.x - 6;
      left = clamp(left, ar.left + 8, Math.max(ar.left + 8, ar.right - 8 - w));
      var top = side === 'above' ? pos.y - h - 9 : pos.y + SIZE + 8;
      top = clamp(top, 6, layout.vh - h - 6);
      ui.bubble.style.transform = 'translate3d(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px,0)';
      ui.bubble.setAttribute('data-side', side);
      ui.bubble.style.setProperty('--sg-tail', clamp(cx - left, 14, Math.max(14, w - 14)).toFixed(1) + 'px');
    }

    function showRing(el, ms) {
      var r = el.getBoundingClientRect();
      var br = '';
      try { br = win.getComputedStyle(el).borderRadius; } catch (e) {}
      ui.ring.style.cssText = 'left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px;border-radius:' + (br && br !== '0px' ? br : '18px');
      ui.ring.classList.add('is-on');
      clearTimeout(ringTimer);
      ringTimer = setTimeout(hideRing, ms || 4200);
    }
    function hideRing() { clearTimeout(ringTimer); ui.ring.classList.remove('is-on'); }

    function currentScreenId() { var a = doc.querySelector('.screen.active'); return a ? a.id : ''; }

    function openMenu() {
      var s = st();
      if (s.hidden) { restore(); return; }
      if (!s.started || s.away) return;
      cancelSeq(); hideBubble();
      ui.menuTip.textContent = SCREEN_TIPS[currentScreenId()] || 'Need a hand? Jump to a section.';
      refreshSettingsLabels();
      ui.menu.hidden = false;
      ui.menu.classList.add('is-measure');
      var w = ui.menu.offsetWidth, h = ui.menu.offsetHeight;
      ui.menu.classList.remove('is-measure');
      var ar = layout.ar;
      var left = clamp(pos.x + SIZE - w, ar.left + 8, Math.max(ar.left + 8, ar.right - 8 - w));
      var top = pos.y - h - 10 >= 8 ? pos.y - h - 10 : pos.y + SIZE + 10;
      top = clamp(top, 8, layout.vh - h - 8);
      ui.menu.style.transform = 'translate3d(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px,0)';
      ui.menu.classList.add('is-open');
      ui.btn.setAttribute('aria-expanded', 'true');
      store.set({ menuOpen: true });
      playGesture('wave', { ms: 700, prio: 1 });
    }
    function closeMenu() {
      if (!st().menuOpen) return;
      ui.menu.classList.remove('is-open'); ui.menu.hidden = true;
      ui.btn.setAttribute('aria-expanded', 'false');
      store.set({ menuOpen: false });
    }

    function jump(where) {
      closeMenu();
      if (where === 'vacancies') callGlobal('showAllVacancies');
      else if (where === 'agencies') callGlobal('showAllAgencies');
      else if (where === 'scam') callGlobal('showScamCheck');
      else if (where === 'saved') { var b = doc.querySelector('.navbtn[data-tab="saved"]'); if (b) b.click(); }
    }

    // ---------- sequences ----------
    function cancelSeq() { seqToken++; hideRing(); if (gesture && gesture.name === 'point') gesture = null; if (mode === 'travel') { mode = 'returning'; moveTo(layout.rest, { kind: 'linear', speed: 160, done: function () { mode = 'rest'; } }); } }
    function toRest(done) { mode = 'returning'; moveTo(layout.rest, { kind: 'linear', speed: 150, done: function () { mode = 'rest'; if (done) done(); } }); }

    function firstPriorityTarget() {
      var el = doc.querySelector('#screen-home.active .stat-card-vacancies') || doc.querySelector('.stat-card-vacancies');
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return (r.width > 8 && r.height > 8) ? el : null;
    }
    function bringIntoView(el) {
      var strip = el.parentElement, ar = layout.ar, r = el.getBoundingClientRect();
      if (strip && (r.left < ar.left + 4 || r.right > ar.right - 4) && strip.scrollTo) {
        strip.scrollTo({ left: Math.max(0, el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2), behavior: reduced ? 'auto' : 'smooth' });
        return true;
      }
      return false;
    }

    function startOnboarding() {
      if (lsGet(KEY_ONBOARDED) === '1') return;
      lsSet(KEY_ONBOARDED, '1');
      var token = ++seqToken;
      var el = firstPriorityTarget();
      if (!el) { say(MSG.onboard, { ms: 4400 }); return; }
      var scrolled = bringIntoView(el);
      setTimeout(function () {
        if (token !== seqToken || !live()) return;
        measure();
        var r = el.getBoundingClientRect();
        var tcx = r.left + r.width / 2, tcy = r.top + r.height / 2;
        var ar = layout.ar;
        var spot = { x: clamp(tcx - SIZE / 2, ar.left + 8, ar.right - SIZE - 8), y: r.bottom + 14 };
        var roomBelow = spot.y + SIZE < layout.navTop - 10 && !sheetOpen();
        if (!roomBelow) spot = { x: layout.rest.x, y: layout.rest.y };
        function arrive() {
          if (token !== seqToken || !live()) return;
          var aim = { dx: tcx - (pos.x + SIZE / 2), dy: tcy - (pos.y + SIZE * 0.42) };
          mode = 'travel';
          showRing(el, 4600);
          playGesture('point', { ms: 4600, prio: 3, aim: aim, done: function () { if (token === seqToken) { hideRing(); toRest(); } } });
          say(MSG.onboard, { ms: 4400, side: roomBelow ? 'below' : 'above' });
        }
        var far = Math.abs(spot.x - pos.x) + Math.abs(spot.y - pos.y) > 24;
        if (reduced || !far) { if (reduced) snapTo(spot); arrive(); }
        else { mode = 'travel'; moveTo(spot, { kind: 'linear', speed: 190, done: arrive }); }
      }, scrolled && !reduced ? 480 : 40);
    }

    function startRoam() {
      var token = ++seqToken;
      var ar = layout.ar, rest = layout.rest;
      var dir = layout.side === 'right' ? -1 : 1;
      var run = Math.min(ar.width * 0.55, rnd(150, 250));
      var far = { x: clamp(rest.x + dir * run, ar.left + 10, ar.right - SIZE - 10), y: rest.y };
      mode = 'travel';
      moveTo(far, { kind: 'linear', speed: rnd(105, 140), done: function () {
        if (token !== seqToken) return;
        lookGoal = rnd(10, 14) * (Math.random() < 0.5 ? 1 : -1);
        setTimeout(function () { lookGoal = -lookGoal; }, 650);
        setTimeout(function () {
          if (token !== seqToken) return;
          lookGoal = 0;
          toRest();
        }, 1500);
      } });
    }

    // ---------- timers: idle roam, tips, blink / look-around ----------
    function noteActivity() { lastActivity = now(); }
    function canIdle() {
      var s = st();
      return live() && !s.menuOpen && mode === 'rest' && !gesture && !goal && !sheetOpen() && !s.bubble;
    }
    function tick() {
      if (doc.hidden) return;
      var t = now(), s = st();
      if (!s.started || s.quiet || s.hidden) return;
      // idle blink + glance (only while calmly idle; each wakes the loop briefly)
      if (canIdle() && t > blinkUntil + 2600 + rnd(0, 2400)) { blinkUntil = t + 130; wake(); }
      if (canIdle() && !lookGoal && Math.random() < 0.08) {
        lookGoal = rnd(8, 13) * (Math.random() < 0.5 ? 1 : -1); wake();
        setTimeout(function () { lookGoal = 0; wake(); }, 1100);
      }
      var sess = ssGet();
      if (canIdle() && t - lastActivity > idleDelay && t - lastRoamAt > 90000 && (sess.roams || 0) < 4 && !reduced) {
        lastRoamAt = t; idleDelay = rnd(26000, 40000);
        sess.roams = (sess.roams || 0) + 1; ssSet(sess);
        api.onIdleBrowse();
        return;
      }
      if (canIdle() && t - startedAt > 75000 && t - lastTipAt > nextTipGap && t - lastActivity > 4000 && (sess.tips || 0) < 4) {
        lastTipAt = t; nextTipGap = rnd(150000, 240000);
        sess.tips = (sess.tips || 0) + 1; ssSet(sess);
        showTip(sess.tips - 1);
      }
    }
    function showTip(i) {
      var tip = TIPS[i % TIPS.length];
      playGesture('headsup', { ms: 2800, prio: 1 });
      say(tip.text, { icon: 'shield', action: tip.action || null, ms: 4800 });
    }

    // ---------- public API ----------
    var api = {
      onAppOpen: function () {
        if (st().started) return;
        measure(); snapTo(layout.rest);
        facing = layout.side === 'right' ? -1 : 1;
        var hiddenUntil = parseInt(lsGet(KEY_HIDDEN) || '0', 10);
        var quiet = lsGet(KEY_QUIET) === '1';
        var enabled = lsGet(KEY_ENABLED) !== '0';
        var tipsOnly = lsGet(KEY_TIPS_ONLY) === '1';
        var intensity = lsGet(KEY_INTENSITY) === 'low' ? 'low' : 'standard';
        startedAt = now();
        store.set({ started: true, enabled: enabled, quiet: quiet, tipsOnly: tipsOnly, intensity: intensity, hidden: hiddenUntil > Date.now() });
        measure();
        snapTo(layout.rest);
        ui.host.classList.add('is-on');
        ui.host.classList.toggle('is-quiet', quiet);
        ui.host.classList.toggle('is-mini', st().hidden);
        refreshQuietLabel();
        popAt = now();
        wake();
        if (!enabled || quiet || st().hidden) return;
        playGesture('wave', { ms: 1000, prio: 3 });
        if (doc.querySelector('#screen-home.active')) setTimeout(function () { if (live()) startOnboarding(); }, 950);
        else say(MSG.welcome, { ms: 3200 });
      },

      onScroll: function (direction, velocity, progress, el) {
        noteActivity();
        var s = st();
        if (s.menuOpen) closeMenu();
        if (!live() || reduced || sheetOpen()) return;
        if (mode === 'travel') cancelSeq();
        scrollV = velocity || 0; scrollDir = direction >= 0 ? 1 : -1;
        mode = 'track'; trackUntil = now() + 850;
        clearTimeout(trackTimer); trackTimer = setTimeout(wake, 900);
        var laneTop = 120;
        if (el && el.getBoundingClientRect) laneTop = Math.max(64, el.getBoundingClientRect().top + 12);
        laneTop = Math.min(laneTop, layout.rest.y - 48);
        var p = progress === undefined ? 0.5 : clamp(progress, 0, 1);
        moveTo({ x: layout.rest.x, y: lerp(laneTop, layout.rest.y, p) }, { kind: 'spring', w: 8 });
      },

      onIdleBrowse: function () { if (canIdle() && !reduced) startRoam(); },

      onApplyStep: function (label) {
        noteActivity();
        if (!live()) return;
        var t = now();
        if (t - lastStepAt < 900) return;
        lastStepAt = t;
        closeMenu(); cancelSeq();
        playGesture('cheer', { ms: DUR.cheer, prio: 3 });
        say(stepMessage(label), { ms: 3200 });
        if (/apply/i.test(label || '') && !(ssGet().payTip)) {
          setTimeout(function () {
            if (!canIdle()) return;
            var sess = ssGet(); sess.payTip = 1; ssSet(sess);
            showTip(0);
          }, 6500);
        }
      },

      onSaveVacancy: function () {
        noteActivity();
        if (!live()) return;
        closeMenu();
        playGesture('sparkle', { ms: DUR.sparkle, prio: 2 });
        say(pick(MSG.saved), { ms: 2600 });
      },

      onRecruitmentEvent: function (type, detail) {
        detail = detail || {};
        if (!live()) return false;
        if (type === 'new-jobs-loaded') { playGesture('wave', { ms: 1000, prio: 3 }); say(MSG.newJobs, { ms: 3200 }); }
        else if (type === 'job-saved') { playGesture('sparkle', { ms: DUR.sparkle, prio: 2 }); say(MSG.savedEvent, { ms: 3000 }); }
        else if (type === 'application-opened') { playGesture('point', { ms: 2500, prio: 3, aim: { dx: 1, dy: 0 } }); say(MSG.application, { ms: 3000 }); }
        else if (type === 'profile-incomplete') { playGesture('think', { ms: DUR.think, prio: 2 }); say(detail.message || MSG.profile, { tip: true, ms: 4200 }); }
        else if (type === 'filters-active') { playGesture('headsup', { ms: 2400, prio: 2 }); say(detail.message || MSG.filters, { tip: true, ms: 4200 }); }
        else if (type === 'offline') { playGesture('think', { ms: DUR.think, prio: 3 }); say(detail.message || MSG.offline, { force: true, ms: 4200 }); }
        else if (type === 'fresh-jobs') { playGesture('wave', { ms: 1200, prio: 3 }); say(detail.message || MSG.fresh, { ms: 3200 }); }
        else return false;
        return true;
      },

      onEmptyResults: function (kind) {
        if (!live()) return;
        var t = now();
        if (t - lastEmptyAt < 8000) return;
        lastEmptyAt = t;
        closeMenu();
        var msg = kind === 'saved' ? MSG.emptySaved : MSG.empty;
        if (kind !== 'saved') {
          var q = doc.querySelector('#screen-home.active #home-search, .screen.active input[type="search"]');
          if (q && q.value) msg = MSG.emptySearch;
        }
        playGesture('think', { ms: DUR.think, prio: 2 });
        say(msg, { ms: 4600 });
      },

      say: function (text, o) { return say(text, o); },
      setQuiet: function (on) { setQuiet(!!on, true); },
      setEnabled: function (on) { setEnabled(!!on); },
      setTipsOnly: function (on) { setTipsOnly(!!on); },
      setIntensity: function (value) { setIntensity(value); },
      resetOnboarding: function () { lsSet(KEY_ONBOARDED, null); hideBubble(); },
      show: function () { restore(); },
      hide: function () { hideForDay(); },
      state: function () { return store.get(); },
      subscribe: function (fn) { return store.subscribe(fn); },
      _debug: function () { return { pos: { x: pos.x, y: pos.y }, mode: mode, gesture: gesture && gesture.name, facing: facing, joints: cur, layout: layout }; }
    };

    function refreshQuietLabel() {
      ui.quietBtn.textContent = st().quiet ? 'Turn tips on' : 'Quiet mode';
      ui.quietBtn.setAttribute('aria-pressed', st().quiet ? 'true' : 'false');
    }
    function refreshSettingsLabels() {
      var s = st();
      ui.enabledBtn.textContent = s.enabled ? 'Guide: On' : 'Guide: Off';
      ui.enabledBtn.setAttribute('aria-pressed', s.enabled ? 'true' : 'false');
      ui.tipsBtn.textContent = s.tipsOnly ? 'Tips only: On' : 'Tips only: Off';
      ui.tipsBtn.setAttribute('aria-pressed', s.tipsOnly ? 'true' : 'false');
      ui.intensityBtn.textContent = 'Animation: ' + (s.intensity === 'low' ? 'Low' : 'Standard');
      ui.intensityBtn.setAttribute('aria-pressed', s.intensity === 'low' ? 'true' : 'false');
      refreshQuietLabel();
    }
    function setEnabled(on) {
      lsSet(KEY_ENABLED, on ? '1' : '0'); store.set({ enabled: on }); refreshSettingsLabels();
      if (!on) { closeMenu(); hideBubble(); hideRing(); gesture = null; mode = 'rest'; }
      ui.host.classList.toggle('is-disabled', !on); measure(); wake();
    }
    function setTipsOnly(on) { lsSet(KEY_TIPS_ONLY, on ? '1' : '0'); store.set({ tipsOnly: on }); refreshSettingsLabels(); }
    function setIntensity(value) { var low = value === 'low'; lsSet(KEY_INTENSITY, low ? 'low' : 'standard'); store.set({ intensity: low ? 'low' : 'standard' }); refreshSettingsLabels(); wake(); }
    function setQuiet(on, announce) {
      lsSet(KEY_QUIET, on ? '1' : null);
      store.set({ quiet: on });
      ui.host.classList.toggle('is-quiet', on);
      refreshSettingsLabels();
      closeMenu();
      if (on) {
        seqToken++; hideRing(); hideBubble(); gesture = null; mode = 'rest'; look = lookGoal = 0;
        snapTo(layout.rest); wake();
        if (announce) say(MSG.quietOn, { ms: 2600, force: true });
      } else {
        popAt = now(); wake();
        if (announce) say(MSG.quietOff, { ms: 2400 });
      }
    }
    function hideForDay() {
      closeMenu(); seqToken++; hideRing(); hideBubble(); gesture = null; mode = 'rest';
      lsSet(KEY_HIDDEN, String(Date.now() + DAY));
      store.set({ hidden: true });
      ui.host.classList.add('is-mini');
      measure(); snapTo(layout.rest); wake();
    }
    function restore() {
      lsSet(KEY_HIDDEN, null);
      store.set({ hidden: false });
      ui.host.classList.remove('is-mini');
      measure(); snapTo(layout.rest); popAt = now(); wake();
      if (!st().quiet) { playGesture('wave', { ms: 1000, prio: 3 }); }
    }

    function dispatch(d) {
      if (!d) return;
      switch (d.type) {
        case 'appOpen': api.onAppOpen(); break;
        case 'scroll': api.onScroll(d.direction, d.velocity, d.progress); break;
        case 'idle': api.onIdleBrowse(); break;
        case 'applyStep': api.onApplyStep(d.label); break;
        case 'save': api.onSaveVacancy(); break;
        case 'empty': api.onEmptyResults(d.kind); break;
        default: api.onRecruitmentEvent(d.type, d); break;
      }
    }

    // ============================================================
    // 6. ADAPTER (wires the app's DOM to the API above)
    // ============================================================
    var lastTop = (typeof WeakMap === 'function') ? new WeakMap() : null, lastT = lastTop && new WeakMap();
    var smoothV = 0, scanTimer = 0, lastScreen = '';

    function onAnyScroll(e) {
      var t = e.target, el = (t === doc || t === doc.documentElement || t === doc.body) ? (doc.scrollingElement || doc.documentElement) : t;
      if (!el || el.nodeType !== 1 || ui.host.contains(el) || !lastTop) return;
      var top = el.scrollTop, prev = lastTop.get(el);
      lastTop.set(el, top);
      if (prev === undefined) return;
      var d = top - prev;
      if (Math.abs(d) < 1) return;
      var tm = now(), pt = lastT.get(el) || tm - 16;
      lastT.set(el, tm);
      var v = Math.abs(d) / Math.max(8, tm - pt) * 1000;
      smoothV = smoothV * 0.6 + v * 0.4;
      var max = el.scrollHeight - el.clientHeight;
      if (max < 120) return;
      api.onScroll(d > 0 ? 1 : -1, smoothV, top / max, el);
    }

    function onDocClick(e) {
      var t = e.target;
      if (!t || !t.closest || ui.host.contains(t)) return;
      noteActivity();
      var head = t.closest('.vx-head');
      if (head) {
        var was = head.getAttribute('aria-expanded');
        setTimeout(function () { if (head.getAttribute('aria-expanded') === 'true' && was !== 'true') api.onApplyStep('Vacancy opened'); }, 40);
        return;
      }
      var save = t.closest('.vac-save');
      if (save) {
        var had = save.classList.contains('saved');
        setTimeout(function () { if (!had && save.classList.contains('saved')) api.onSaveVacancy(); }, 40);
        return;
      }
      var a = t.closest('a[href]');
      if (a && a.closest('.vac-card, [data-vacancy-id]') && /^\s*(apply|email to apply|contact (employer|agency))/i.test(a.textContent || '')) {
        api.onApplyStep('Apply tapped'); return;
      }
      var step = t.closest('[data-guide-step]');
      if (step) api.onApplyStep(step.getAttribute('data-guide-step') || 'Step complete');
    }

    function scan() {
      scanTimer = 0;
      measure();
      var id = currentScreenId();
      if (id !== lastScreen) {
        lastScreen = id; store.set({ screen: id });
        smoothV = 0;
        if (st().menuOpen) closeMenu();
        if (mode === 'travel' && id !== 'screen-home') cancelSeq();
      }
      if (mode === 'rest' && !goal && !gesture && (Math.abs(pos.x - layout.rest.x) > 0.6 || Math.abs(pos.y - layout.rest.y) > 0.6)) { moveTo(layout.rest, { kind: 'spring', w: 10 }); }
      if (!live()) return;
      var scr = doc.querySelector('.screen.active');
      if (!scr) return;
      var nodes = scr.querySelectorAll('.empty-state, .screen-state[data-vacancy-state="empty"]');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (seenEmpty && seenEmpty.has(n)) continue;
        if (!visible(n)) continue;
        var kind = classifyEmpty(n.textContent, n.getAttribute('data-screen'));
        if (!kind) continue;
        if (seenEmpty) seenEmpty.add(n);
        api.onEmptyResults(kind);
        break;
      }
    }
    function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(scan, 160); }

    function wireApp() {
      doc.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
      doc.addEventListener('click', onDocClick, true);
      ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) { doc.addEventListener(ev, noteActivity, { capture: true, passive: true }); });
      doc.addEventListener('focusin', function () { measure(); wake(); });
      doc.addEventListener('focusout', function () { setTimeout(function () { measure(); wake(); }, 160); });
      doc.addEventListener('transitionend', function (e) { if (e.target && e.target.classList && (e.target.classList.contains('sheet') || e.target.classList.contains('sheet-scrim'))) scheduleScan(); }, true);
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { measure(); wake(); } });
      doc.addEventListener('sa-guide', function (e) { dispatch(e.detail); });
      doc.addEventListener('sa-guide:event', function (e) { dispatch(e.detail); });
      win.addEventListener('sa-guide:event', function (e) { dispatch(e.detail); });
      win.addEventListener('resize', function () { scheduleScan(); });
      win.addEventListener('orientationchange', function () { setTimeout(scan, 250); });
      if (win.visualViewport) win.visualViewport.addEventListener('resize', scheduleScan);

      if (win.MutationObserver) {
        new win.MutationObserver(function (list) {
          for (var i = 0; i < list.length; i++) { if (!ui.host.contains(list[i].target)) { scheduleScan(); return; } }
        }).observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-expanded'] });
        var toast = doc.getElementById('toast');
        if (toast) new win.MutationObserver(function () {
          var step = toastStep(toast.textContent);
          if (step) api.onApplyStep(step);
        }).observe(toast, { childList: true, characterData: true, subtree: true });
      }
      if (win.IntersectionObserver) {
        guideObserver = new win.IntersectionObserver(function (entries) {
          var visibleNow = entries.length ? entries[entries.length - 1].isIntersecting : true;
          store.set({ offscreen: !visibleNow });
          if (visibleNow) wake();
        }, { threshold: 0.01 });
        guideObserver.observe(ui.btn);
      }
      setInterval(tick, 1000);
    }

    function wireUi() {
      ui.btn.addEventListener('click', function () { st().menuOpen ? closeMenu() : openMenu(); });
      ui.btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); st().menuOpen ? closeMenu() : openMenu(); } });
      ui.closeBubble.addEventListener('click', function (e) { e.stopPropagation(); hideBubble(); });
      ui.bubble.addEventListener('click', function () {
        var a = bubbleAction; hideBubble();
        if (a === 'scam') callGlobal('showScamCheck');
      });
      ui.menu.addEventListener('click', function (e) {
        var j = e.target.closest && e.target.closest('[data-jump]');
        if (j) { jump(j.getAttribute('data-jump')); return; }
        var act = e.target.closest && e.target.closest('[data-act]');
        if (!act) return;
        if (act.getAttribute('data-act') === 'quiet') setQuiet(!st().quiet, true);
        else if (act.getAttribute('data-act') === 'enabled') setEnabled(!st().enabled);
        else if (act.getAttribute('data-act') === 'tips') setTipsOnly(!st().tipsOnly);
        else if (act.getAttribute('data-act') === 'intensity') setIntensity(st().intensity === 'low' ? 'standard' : 'low');
        else if (act.getAttribute('data-act') === 'reset') { api.resetOnboarding(); say(MSG.onboard, { force: true, ms: 4400 }); }
        else hideForDay();
      });
      doc.addEventListener('pointerdown', function (e) { if (st().menuOpen && !ui.host.contains(e.target)) closeMenu(); }, true);
      doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st().menuOpen) { closeMenu(); ui.btn.focus(); } });
    }

    function boot() {
      buildDom(); wireUi(); measure(); snapTo(layout.rest);
      store.subscribe(function (n, prev) {
        if (n.away !== prev.away) {
          ui.host.classList.toggle('is-away', n.away);
          if (n.away) { closeMenu(); hideBubble(); }
        }
      });
      render(now());
      wireApp();
      lastScreen = currentScreenId();
      function go() { measure(); api.onAppOpen(); }
      if (doc.body.classList.contains('app-ready')) setTimeout(go, 600);
      else {
        var fired = false;
        function once() { if (fired) return; fired = true; setTimeout(go, 700); }
        if (win.MutationObserver) {
          var mo = new win.MutationObserver(function () { if (doc.body.classList.contains('app-ready')) { mo.disconnect(); once(); } });
          mo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
        }
        setTimeout(once, 5000);
      }
    }

    return { api: api, boot: boot, store: store, _ui: ui, _measure: measure };
  }

  // ---------- exports + auto start ----------
  var exported = { createGuide: createGuide, createStore: createStore, solveArm: solveArm, POSES: POSES, IDLE: IDLE, KEYS: KEYS,
    buildRig: buildRig, applyJoints: applyJoints, classifyEmpty: classifyEmpty, toastStep: toastStep, stepMessage: stepMessage,
    cadence: cadence, DUR: DUR, MSG: MSG, TIPS: TIPS, J: J };
  if (typeof module === 'object' && module.exports) { module.exports = exported; return; }

  if (root.SAGuide) return;
  function start() {
    if (root.SAGuide) return;
    var g = createGuide(root);
    root.SAGuide = g.api;
    g.boot();
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : this);
