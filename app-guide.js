// ============================================================
//  SA RECRUITERS — app-guide.js  (Character Guide v2: "Thando")
// ============================================================
//  Thando is a calm, practical job-search guide: a 44px pictogram that
//  shows up when it can help, says one short useful thing, and goes back
//  to a quiet idle. Signature gestures: a small wave, pointing at the
//  next thing to tap, and a gold-tie thumbs-up style celebration. Gold
//  (the tie) is the one accent colour.
//
//  Layers:
//    1. store      small state container (settings, away, bubble, menu ...)
//    2. rig        modular SVG character + held props, drawn from joints
//    3. poses      idle, wave, point, walk, cheer, think, headsup, hold,
//                  greet, worry, sleep  (pure functions of time)
//    4. engine     ONE rAF loop; sleeps when calmly idle, tab hidden,
//                  off-screen (IntersectionObserver), away or switched off
//    5. director   public API, priorities, settings, safe-slot positioning
//    6. adapter    DOM wiring + the Guide card injected into Menu
//
//  Recruitment moments: vacancy opened (points at Apply, flags "closes
//  today"), job saved (holds a bookmark, says how many are saved), filters
//  on (holds a filter icon, offers Clear), empty results (moves into the
//  empty card), offline / back online (worried pose + badge), fresh jobs
//  (energetic entrance), guest on Profile, safety tips.
//
//  Public API (window.SAGuide) - also via a DOM event:
//    document.dispatchEvent(new CustomEvent('sa-guide',
//        { detail: { type: 'profile', percent: 80, hint: 'Add your CV' } }))
//
//    onAppOpen()   onScroll(direction, velocity, progress)   onIdleBrowse()
//    onApplyStep(label)   onVacancyOpened(cardEl)   onSaveVacancy()
//    onEmptyResults(kind)   onFiltersActive(count)   onNewJobs()
//    onOffline() / onOnline()   onProfileIncomplete(percent, hint)
//    say(text, opts)   settings(patch)   openSettings()
//
//  Safety rules: pointer-events are off everywhere except the 44px
//  character at rest, bubble buttons, and the open menu. It never moves
//  onto Apply/close/input/nav/ad/toast areas (it samples what is under each
//  candidate slot), hides while typing or when a tall sheet is open, never
//  animates while the user types, and everything it says is also text.
//
//  Classic script (like app-alerts.js); only talks to the app through
//  window globals the module bridge exposes, each guarded.
//  Pure helpers are exported for scripts/app-guide.test.mjs.
// ============================================================
(function (root) {
  'use strict';

  var PI = Math.PI;
  var SIZE = 44;
  var NAME = 'Thando';
  var KEY_SETTINGS = 'sa_guide_settings_v2';
  var KEY_LEGACY_QUIET = 'sa_guide_quiet';
  var KEY_LASTCOUNT = 'sa_guide_last_count';
  var KEY_SESSION = 'sa_guide_session';

  // ---------- copy: short, actionable, max two lines ----------
  var MSG = {
    intro: 'Hi, I\u2019m ' + NAME + ', your SA Recruiters guide. Tap me anytime for help.',
    opened: 'Tap Apply to continue.',
    closesToday: 'This job closes today. Tap Apply to continue.',
    closesTodayNoBtn: 'This job closes today.',
    apply: 'Application step complete\u2014you\u2019ve got this!',
    done: 'Step complete\u2014keep going!',
    saved: 'Saved for later.',
    savedCount: function (n) { return n === 1 ? 'Saved. You have 1 saved job.' : 'Saved. You have ' + n + ' saved jobs.'; },
    savedScreen: function (n) { return n === 1 ? 'You have 1 saved job.' : 'You have ' + n + ' saved jobs.'; },
    empty: 'No matches. Try widening your search.',
    emptySearch: 'Try fewer words or a wider area.',
    emptySaved: 'Nothing saved yet. Tap the star on a job.',
    filters: 'Filters are on. Too few jobs? Clear them.',
    newJobs: 'New vacancies were added.',
    offline: 'You\u2019re offline. Saved jobs still work.',
    online: 'Back online. Updating jobs\u2026',
    guest: 'Sign in free to sync your saved jobs.',
    profile: function (p) { return 'Your profile is ' + p + '% complete.'; },
    guideOff: 'Guide turned off. Turn it back on in Menu.',
    quietOn: 'Quiet mode on. Tap me if you need me.'
  };
  var TIPS = [
    { id: 'fee', text: 'Real jobs never charge to apply.' },
    { id: 'verified', text: 'Check the agency is verified first.' },
    { id: 'pin', text: 'Never share your ID or PIN in chat.' },
    { id: 'scam', text: 'Unsure about a job? Run it through Scam Check.', action: 'scam', actionLabel: 'Check' },
    { id: 'toogood', text: 'Offer too good to be true? Double-check it.' },
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
  function easeOutBack(t) { var c = 1.9; t = clamp(t, 0, 1) - 1; return 1 + (c + 1) * t * t * t + c * t * t; }
  function num(v) { return (Math.round(v * 100) / 100).toString(); }

  // ============================================================
  // Settings model (pure)
  // ============================================================
  //  enabled    Guide on / off
  //  mode       'full'  reactions + tips
  //             'tips'  speech tips only, no celebration animations
  //             'quiet' asleep: no speech, no reactions, tap still opens help
  //  intensity  'standard' | 'low' (low = no scroll-walk, no hops, no walking)
  var DEFAULT_SETTINGS = { enabled: true, mode: 'full', intensity: 'standard', introSeen: false };
  function normalizeSettings(o) {
    o = o || {};
    return {
      enabled: o.enabled !== false,
      mode: (o.mode === 'tips' || o.mode === 'quiet') ? o.mode : 'full',
      intensity: o.intensity === 'low' ? 'low' : 'standard',
      introSeen: !!o.introSeen
    };
  }
  // kind: 'celebrate' (applause, save feedback) | 'tip' (helpful context)
  function modeAllows(mode, kind) {
    if (mode === 'quiet') return false;
    if (mode === 'tips') return kind === 'tip';
    return true;
  }

  function parseCount(text) {
    var m = /([\d][\d\s,.]*)\s*([kKmM])?/.exec(String(text || ''));
    if (!m) return null;
    var n = parseFloat(m[1].replace(/[\s,]/g, ''));
    if (!isFinite(n)) return null;
    return n * (/k/i.test(m[2] || '') ? 1000 : /m/i.test(m[2] || '') ? 1000000 : 1);
  }
  function isClosesToday(text) { return /closes?\s+today|closing\s+today|last\s+day/i.test(String(text || '')); }

  var EMPTY_LOADING = /loading|fetching|could not|couldn.t|check your connection|try again/i;
  var EMPTY_NOT_SEARCH = /\byet\b|added|submissions|reports|suggestions|branches|employers/i;
  var EMPTY_MATCH = /(no|nothing)\b[^.]*\b(vacanc|role|job|match|result|agenc|listing)/i;
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
    if (/apply|application|submit|unlock/i.test(label)) return MSG.apply;
    return MSG.done;
  }

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
  // 2. RIG - bold side-view pictogram on a soft disc (readable at 32px)
  //    Angles in degrees, SVG-clockwise. 0 = limb hanging down, negative =
  //    swung forward. Hip at (24,28); the figure group is scaled to sit in
  //    the disc.
  // ============================================================
  var NS = 'http://www.w3.org/2000/svg';
  var SH_Y = -10, L1 = 6, L2 = 5.6;
  var HIP_Y = 28;
  var FIG = 'translate(24 25) scale(.84) translate(-24 -25)';

  function svgEl(doc, tag, attrs, parent) {
    var n = doc.createElementNS(NS, tag), k;
    for (k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // Two-bone IK in torso space -> [shoulderAngle, elbowAngle]
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

  // Where the near hand is in rig space (for held props)
  function handPos(j, facing) {
    var a = j.nA * PI / 180, b = (j.nA + j.nE) * PI / 180;
    var x = -Math.sin(a) * L1 - Math.sin(b) * (L2 + 0.3);
    var y = SH_Y + Math.cos(a) * L1 + Math.cos(b) * (L2 + 0.3);
    var l = j.lean * PI / 180;
    var rx = x * Math.cos(l) - y * Math.sin(l), ry = x * Math.sin(l) + y * Math.cos(l);
    var hx = 24 + j.bx + rx, hy = HIP_Y + j.by + ry;
    return { x: facing < 0 ? 48 - hx : hx, y: hy };
  }

  var STAR_PATH = 'M0,-3.4 L1,-1 L3.4,0 L1,1 L0,3.4 L-1,1 L-3.4,0 L-1,-1Z';
  var STAR_SPOTS = [[8, 12, 1], [40, 15, .85], [5.5, 30, .7], [42.5, 29, .9]];

  function buildRig(doc) {
    var svg = svgEl(doc, 'svg', { viewBox: '0 0 48 48', 'class': 'sa-guide__svg', focusable: 'false', 'aria-hidden': 'true' });
    svgEl(doc, 'circle', { cx: 24, cy: 24, r: 22.5, 'class': 'sg-disc' }, svg);
    var fig = svgEl(doc, 'g', { transform: FIG }, svg);
    var shadow = svgEl(doc, 'ellipse', { cx: 24, cy: 44.9, rx: 8, ry: 1.5, 'class': 'sg-shadow' }, fig);
    var flip = svgEl(doc, 'g', {}, fig);
    var body = svgEl(doc, 'g', {}, flip);

    function arm(far) {
      var g = svgEl(doc, 'g', { 'class': 'sg-limb' + (far ? ' sg-far' : '') }, body);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: L1, 'stroke-width': 4.4 }, g);
      var f = svgEl(doc, 'g', {}, g);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: L2, 'stroke-width': 4 }, f);
      svgEl(doc, 'circle', { cx: 0, cy: L2 + 0.3, r: 2.9, 'class': 'sg-hand' }, f);
      return { g: g, f: f };
    }
    function leg(far) {
      var g = svgEl(doc, 'g', { 'class': 'sg-limb' + (far ? ' sg-far' : '') }, body);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: 7.6, 'stroke-width': 4.8 }, g);
      var s = svgEl(doc, 'g', { transform: 'translate(0 7.6)' }, g);
      svgEl(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: 7.2, 'stroke-width': 4.4 }, s);
      svgEl(doc, 'line', { x1: 0.6, y1: 7.6, x2: 3.6, y2: 7.6, 'stroke-width': 3.8 }, s);
      return { g: g, s: s };
    }

    var fA = arm(true);
    var fL = leg(true);
    var torso = svgEl(doc, 'g', { 'class': 'sg-limb' }, body);
    svgEl(doc, 'line', { x1: 0, y1: 1, x2: 0, y2: -10.6, 'stroke-width': 8.4 }, torso);
    svgEl(doc, 'path', { d: 'M-.4,-9.9 L3,-9.9 L2.6,-8.2 L3.6,-3.4 L1.3,-1.6 L-1,-3.4 L0,-8.2Z', 'class': 'sg-tie' }, body);
    var nL = leg(false);
    var head = svgEl(doc, 'g', {}, body);
    svgEl(doc, 'circle', { cx: 0.8, cy: -7.2, r: 7.4, 'class': 'sg-fill' }, head);
    var eye = svgEl(doc, 'ellipse', { cx: 4.1, cy: -7.8, rx: 1.35, ry: 1.5, 'class': 'sg-eye' }, head);
    var nA = arm(false);

    // held prop (never mirrored) - drawn on a white badge so it reads at 32px
    var prop = svgEl(doc, 'g', { 'class': 'sg-prop', visibility: 'hidden' }, fig);
    var props = {};
    var pb = svgEl(doc, 'g', { visibility: 'hidden' }, prop);
    svgEl(doc, 'circle', { r: 7.2, 'class': 'sg-badge' }, pb);
    svgEl(doc, 'path', { d: 'M-3,-4.6 h6 v9.4 l-3,-2.6 l-3,2.6z', 'class': 'sg-bookmark' }, pb);
    props.bookmark = pb;
    var pf = svgEl(doc, 'g', { visibility: 'hidden' }, prop);
    svgEl(doc, 'circle', { r: 7.2, 'class': 'sg-badge' }, pf);
    svgEl(doc, 'path', { d: 'M-4.4,-3.8 h8.8 l-3.4,4.2 v3.8 l-2,1.1 v-4.9z', 'class': 'sg-funnel' }, pf);
    props.filter = pf;
    var pw = svgEl(doc, 'g', { visibility: 'hidden' }, prop);
    svgEl(doc, 'circle', { r: 7.2, 'class': 'sg-badge' }, pw);
    svgEl(doc, 'path', { d: 'M-4.6,-1.4 a6.6,6.6 0 0 1 9.2,0 M-2.4,1.1 a3.3,3.3 0 0 1 4.8,0', 'class': 'sg-wifi' }, pw);
    svgEl(doc, 'circle', { cx: 0, cy: 3.6, r: 1, 'class': 'sg-wifidot' }, pw);
    svgEl(doc, 'path', { d: 'M-4.6,-4.8 L4.6,4.8', 'class': 'sg-slash' }, pw);
    props.offline = pw;

    // effects live outside the mirrored group so glyphs never read backwards
    var fx = svgEl(doc, 'g', { 'class': 'sg-fx' }, fig);
    var stars = STAR_SPOTS.map(function () { return svgEl(doc, 'path', { d: STAR_PATH, 'class': 'sg-star' }, fx); });
    var q = svgEl(doc, 'g', { 'class': 'sg-q' }, fx);
    svgEl(doc, 'path', { d: 'M-2.1,-2.6 a2.3,2.3 0 1 1 3.6,1.9 c-1.1,.7 -1.4,1.1 -1.4,2.1', fill: 'none', 'stroke-width': 1.9, 'stroke-linecap': 'round' }, q);
    svgEl(doc, 'circle', { cx: 0.1, cy: 4.4, r: 1.1, 'class': 'sg-qdot' }, q);
    var zz = svgEl(doc, 'g', { 'class': 'sg-zz' }, fx);
    svgEl(doc, 'path', { d: 'M-2.4,-2.6 h4.8 l-4.8,5.2 h4.8', fill: 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, zz);

    return { svg: svg, fig: fig, shadow: shadow, flip: flip, body: body, head: head, eye: eye, fx: fx, stars: stars, q: q, zz: zz,
      prop: prop, props: props,
      nA: nA.g, nF: nA.f, fA: fA.g, fF: fA.f, nL: nL.g, nS: nL.s, fL: fL.g, fS: fL.s };
  }

  // prop: { name, k } k = 0..1 fade/scale
  function applyJoints(rig, j, facing, tsec, prop) {
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
    rig.eye.setAttribute('ry', num(1.5 * clamp(j.blink, 0.08, 1)));
    var lift = clamp(-j.by / 6, 0, 1);
    rig.shadow.setAttribute('rx', num(8 * (1 - lift * 0.35)));
    rig.shadow.setAttribute('opacity', num(1 - lift * 0.5));

    var fxOn = j.stars > 0.02 || j.q > 0.02 || j.zz > 0.02;
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
    var zx = facing < 0 ? 12 : 36;
    rig.zz.setAttribute('transform', 'translate(' + zx + ' ' + num(9 - Math.sin(tsec * 1.2) * 1.2) + ') scale(' + num(0.55 + 0.25 * Math.sin(tsec * 1.2 + 1)) + ')');
    rig.zz.setAttribute('opacity', num(j.zz * 0.9));

    var on = prop && prop.name && rig.props[prop.name] && prop.k > 0.02;
    rig.prop.setAttribute('visibility', on ? 'visible' : 'hidden');
    for (var n in rig.props) rig.props[n].setAttribute('visibility', on && n === prop.name ? 'visible' : 'hidden');
    if (on) {
      var h = handPos(j, facing);
      rig.prop.setAttribute('transform', 'translate(' + num(h.x) + ' ' + num(h.y - 8.5) + ') scale(' + num(prop.k) + ')');
    }
  }

  // ============================================================
  // 3. POSES (t = seconds into the pose; c = context)
  // ============================================================
  var IDLE = { bx: 0, by: 0, lean: 0, head: 0, nA: 7, nE: -12, fA: -5, fE: -8, nH: 4, nK: 5, fH: -4, fK: 7, blink: 1, stars: 0, q: 0, zz: 0 };
  var KEYS = Object.keys(IDLE);
  var BEND = 1;

  function J(o) {
    var r = {}, k;
    for (k in IDLE) r[k] = IDLE[k];
    for (k in o) r[k] = o[k];
    return r;
  }
  function armTo(x, y, bend) { return solveArm(x, y, bend === undefined ? BEND : bend); }

  // Short, deliberate gestures (ms). "low" intensity trims the cheer hop.
  var DUR = { wave: 1000, point: 3200, cheer: 2000, cheerLow: 1000, think: 3200, headsup: 2400, hold: 2200, greet: 1700, worry: 3400 };
  var STILL_T = { wave: 0.1, point: 0.3, cheer: 1.5, think: 0.4, headsup: 0.3, hold: 0.35, greet: 0.5, worry: 0.4 };

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
      var ext = 11.1 + Math.sin(t * 8) * 0.3;
      var a = armTo(ux * ext, SH_Y + uy * ext);
      var hip = armTo(3.6, -3.4, -BEND);
      return J({ nA: a[0], nE: a[1], fA: hip[0], fE: hip[1], head: clamp(uy * 12, -12, 8), lean: clamp(uy * 4, -4, 3) });
    },

    // walk: only used to relocate to a free slot, or a gentle in-place step while scrolling
    run: function (t, c) {
      var p = c.phase || 0, s = Math.sin(p), co = Math.cos(p);
      var v = clamp((c.speed || 0) / 700, 0, 1), amp = c.amp || 1;
      return J({
        lean: 5 + v * 5 + (c.tilt || 0),
        by: -Math.abs(s) * (0.6 + v * 0.8) * amp,
        head: -3,
        nH: -36 * s * amp, nK: 16 + 38 * amp * Math.max(0, co),
        fH: 36 * s * amp, fK: 16 + 38 * amp * Math.max(0, -co),
        nA: 30 * s * amp, nE: -70, fA: -30 * s * amp, fE: -70
      });
    },

    // clap (0-1.1s) then one small hop with both arms up (1.1-2s)
    cheer: function (t) {
      if (t < 1.1) {
        var th = t * 2 * PI * 3, cx = Math.cos(th);
        var n = armTo(6.3 + 1.9 * cx, -13.2);
        var f = armTo(6.3 - 1.9 * cx, -12.4);
        return J({ nA: n[0], nE: n[1], fA: f[0], fE: f[1], by: -0.7 * Math.abs(Math.sin(th)), head: 2.5 * Math.sin(th), stars: 0.45 });
      }
      var u = clamp((t - 1.1) / 0.8, 0, 1), hop = Math.sin(u * PI);
      var na = armTo(5.4, -21, BEND), fa = armTo(-4, -20.2, -BEND);
      var fade = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
      return J({ by: -4.6 * hop, head: -8, lean: -2, nA: na[0], nE: na[1], fA: fa[0], fE: fa[1],
        nH: -18 * hop, nK: 36 * hop, fH: 10 * hop, fK: 28 * hop, stars: fade });
    },

    think: function (t) {
      var sc = Math.sin(t * 2 * PI * 3.6);
      var a = armTo(3.4 + sc * 0.8, -19.2 + sc * 0.4);
      return J({ nA: a[0], nE: a[1], head: -5 + Math.sin(t * 2.4) * 5, lean: -2, q: 1 });
    },

    // palm-out "heads up" used for safety and helpful notices
    headsup: function (t) {
      var a = armTo(8.2, -15 + Math.sin(t * 3) * 0.35);
      return J({ nA: a[0], nE: a[1], head: 3, lean: -2 });
    },

    // holds a prop up (bookmark / filter); optional nod on first beat
    hold: function (t, c) {
      var a = armTo(8.2, -15.2 + Math.sin(t * 2.6) * 0.3);
      var nod = c.nod ? 11 * Math.sin(clamp(t / 0.7, 0, 1) * PI) : 0;
      return J({ nA: a[0], nE: a[1], head: 2 + nod, lean: -2, stars: c.sparkle ? (t < 0.9 ? 0.8 : clamp(1.4 - t, 0, 1) * 0.8) : 0 });
    },

    // energetic entrance for fresh jobs: one hop + wave
    greet: function (t) {
      var hop = Math.sin(clamp(t / 0.5, 0, 1) * PI), w = Math.sin(t * 2 * PI * 2.8);
      var a = armTo(9 + w * 2.2, -16.4 - Math.abs(w) * 0.6);
      return J({ by: -4 * hop, nA: a[0], nE: a[1], lean: -3, head: 4 + w * 2,
        nH: -14 * hop, nK: 30 * hop, fH: 9 * hop, fK: 22 * hop, stars: t < 1.3 ? 0.75 : clamp(1.7 - t, 0, 1) });
    },

    // offline: hands together, head down
    worry: function (t) {
      var s = Math.sin(t * 2 * PI * 1.6);
      var n = armTo(5.2 + s * 0.4, -12.6), f = armTo(4.6, -12.2);
      return J({ nA: n[0], nE: n[1], fA: f[0], fE: f[1], head: 11, lean: 2 });
    },

    // quiet mode: head down, eyes closed, a small z
    sleep: function (t) {
      return J({ head: 16, lean: 3, blink: 0.08, zz: 1, by: 0.25 * Math.sin(t * 1.4), nA: 5, nE: -6 });
    }
  };

  function cadence(speed) { return clamp(1.2 + speed / 400, 1.2, 2.6); }

  // ============================================================
  // Safe-slot geometry (pure, unit-tested)
  // ============================================================
  // Candidate rest slots around the bottom of the app column, in priority order.
  function restSlots(ar, rowY, side) {
    var right = ar.right - SIZE - 8, left = ar.left + 8, hi = rowY - SIZE - 10;
    var order = side === 'left' ? [['left', left, rowY], ['right', right, rowY], ['left-high', left, hi], ['right-high', right, hi]]
      : [['right', right, rowY], ['left', left, rowY], ['right-high', right, hi], ['left-high', left, hi]];
    return order.map(function (s) { return { name: s[0], x: s[1], y: s[2] }; });
  }
  function rectsOverlap(a, b, pad) {
    pad = pad || 0;
    return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
  }

  // ============================================================
  // 4-6. ENGINE + DIRECTOR + ADAPTER (needs a window)
  // ============================================================
  var PROTECTED = '.vx-btn,.vac-save,.vx-tool,.vx-pill,.vx-chip,.screen-close-btn,.sheet-close-btn,[aria-label*="Close" i],input,textarea,select,.navbtn,.home-filter-chip,.stat-card,.stats-scroll-btn,.gsi-material-button,.site-menu-trigger,.header-install-btn,.public-house-ad,.house-ad-slot,.install-banner,.floating-whatsapp,.update-banner,.retry-banner';
  var OBSTACLE_RECTS = ['.toast.show', '.install-banner', '.retry-banner', '.update-banner', '.floating-whatsapp', '.house-ad-slot', '.public-house-ad'];

  function createGuide(win) {
    var doc = win.document;
    var settings = normalizeSettings(DEFAULT_SETTINGS);
    var store = createStore({ enabled: true, mode: 'full', intensity: 'standard', away: false, sheet: false, menuOpen: false, started: false, bubble: null, screen: '', offline: false });
    var reducedMQ = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = !!(reducedMQ && reducedMQ.matches);
    if (reducedMQ && reducedMQ.addEventListener) reducedMQ.addEventListener('change', function (e) { reduced = e.matches; applyMotionAttr(); wake(); });

    function now() { return (win.performance && win.performance.now) ? win.performance.now() : Date.now(); }
    function lsGet(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { if (v === null) win.localStorage.removeItem(k); else win.localStorage.setItem(k, v); } catch (e) {} }
    function ssGet() { try { return JSON.parse(win.sessionStorage.getItem(KEY_SESSION) || '{}') || {}; } catch (e) { return {}; } }
    function ssSet(o) { try { win.sessionStorage.setItem(KEY_SESSION, JSON.stringify(o)); } catch (e) {} }
    function callGlobal(name, a) { try { if (typeof win[name] === 'function') return win[name](a); } catch (e) {} }
    function sess(key, inc) { var s = ssGet(); if (inc) { s[key] = (s[key] || 0) + inc; ssSet(s); } return s[key] || 0; }

    // ---------- settings ----------
    function loadSettings() {
      var raw = null;
      try { raw = JSON.parse(lsGet(KEY_SETTINGS) || 'null'); } catch (e) {}
      if (!raw && lsGet(KEY_LEGACY_QUIET) === '1') raw = { mode: 'quiet', introSeen: true };
      settings = normalizeSettings(raw);
      store.set({ enabled: settings.enabled, mode: settings.mode, intensity: settings.intensity });
    }
    function saveSettings(patch) {
      var next = {}, k;
      for (k in settings) next[k] = settings[k];
      for (k in patch) next[k] = patch[k];
      settings = normalizeSettings(next);
      lsSet(KEY_SETTINGS, JSON.stringify(settings));
      store.set({ enabled: settings.enabled, mode: settings.mode, intensity: settings.intensity });
    }

    // ---------- DOM ----------
    var ui = {};
    var rig;
    var layout = { ar: { left: 0, right: 360, width: 360 }, navTop: 600, rest: { x: 300, y: 540 }, slot: 'right', sheetTop: null, vw: 360, vh: 640, side: 'right' };

    function svgIcon(path) { return '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' + path + '</svg>'; }
    var ICONS = {
      shield: svgIcon('<path d="M8 1.6 13.4 3.7v4.1c0 3.1-2.2 5.3-5.4 6.6C4.8 13.1 2.6 10.9 2.6 7.8V3.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m5.7 8 1.7 1.7 3-3.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
      info: svgIcon('<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v3.6M8 5.1v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
      wifi: svgIcon('<path d="M2 6.2a8 8 0 0 1 12 0M4.4 8.9a4.6 4.6 0 0 1 7.2 0M2 2l12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>')
    };

    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }

    function buildDom() {
      var host = el('div', 'sa-guide'); host.id = 'sa-guide'; host.setAttribute('data-sa-guide', '');

      ui.ring = el('div', 'sa-guide__ring'); ui.ring.setAttribute('aria-hidden', 'true');

      ui.bubble = el('div', 'sa-guide__bubble');
      ui.bubble.setAttribute('role', 'status'); ui.bubble.setAttribute('aria-live', 'polite');
      var bin = el('div', 'sa-guide__bubble-in');
      ui.icon = el('span', 'sa-guide__icon'); ui.icon.setAttribute('aria-hidden', 'true');
      ui.text = el('span', 'sa-guide__text');
      ui.act = el('button', 'sa-guide__act'); ui.act.type = 'button'; ui.act.hidden = true;
      ui.x = el('button', 'sa-guide__x', '\u00d7'); ui.x.type = 'button'; ui.x.setAttribute('aria-label', 'Dismiss tip');
      bin.appendChild(ui.icon); bin.appendChild(ui.text); bin.appendChild(ui.act); bin.appendChild(ui.x);
      ui.bubble.appendChild(bin);

      ui.btn = el('button', 'sa-guide__char');
      ui.btn.type = 'button';
      ui.btn.setAttribute('aria-label', 'SA Recruiters guide');
      ui.btn.setAttribute('aria-haspopup', 'dialog'); ui.btn.setAttribute('aria-expanded', 'false');
      ui.btn.setAttribute('data-live', 'false');
      rig = buildRig(doc);
      ui.btn.appendChild(rig.svg);
      ui.badge = el('span', 'sa-guide__badge'); ui.badge.hidden = true; ui.badge.innerHTML = ICONS.wifi;
      ui.badge.setAttribute('aria-hidden', 'true');
      ui.btn.appendChild(ui.badge);

      ui.menu = el('div', 'sa-guide__menu');
      ui.menu.setAttribute('role', 'dialog'); ui.menu.setAttribute('aria-label', 'SA Recruiters guide help'); ui.menu.hidden = true;
      ui.menuTitle = el('p', 'sa-guide__who', NAME + ' \u00b7 your job-search guide');
      ui.menuTip = el('p', 'sa-guide__tip');
      ui.menu.appendChild(ui.menuTitle); ui.menu.appendChild(ui.menuTip);
      var chips = el('div', 'sa-guide__chips');
      [['Available Vacancies', 'vacancies'], ['Saved Jobs', 'saved'], ['Agencies', 'agencies'], ['Scam Check', 'scam']].forEach(function (c) {
        var b = el('button', 'sa-guide__chip', c[0]); b.type = 'button'; b.setAttribute('data-jump', c[1]); chips.appendChild(b);
      });
      ui.menu.appendChild(chips);
      var foot = el('div', 'sa-guide__foot');
      ui.quietBtn = el('button', 'sa-guide__toggle'); ui.quietBtn.type = 'button'; ui.quietBtn.setAttribute('data-act', 'quiet');
      ui.offBtn = el('button', 'sa-guide__toggle', 'Turn off guide'); ui.offBtn.type = 'button'; ui.offBtn.setAttribute('data-act', 'off');
      foot.appendChild(ui.quietBtn); foot.appendChild(ui.offBtn); ui.menu.appendChild(foot);
      ui.settingsLink = el('button', 'sa-guide__link', 'Guide settings'); ui.settingsLink.type = 'button'; ui.settingsLink.setAttribute('data-act', 'settings');
      ui.menu.appendChild(ui.settingsLink);

      ui.probe = el('div', 'sa-guide__probe');
      ui.probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';

      host.appendChild(ui.ring); host.appendChild(ui.bubble); host.appendChild(ui.btn); host.appendChild(ui.menu); host.appendChild(ui.probe);
      doc.body.appendChild(host);
      ui.host = host;
      applyMotionAttr();
    }
    function applyMotionAttr() { if (ui.host) ui.host.setAttribute('data-motion', reduced ? 'reduced' : 'full'); }

    // ---------- engine state ----------
    var pos = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
    var goal = null;
    var facing = -1;
    var cur = J({});
    var gesture = null;              // { name, start, until, prio, kind, aim, prop, nod, sparkle, done }
    var mode = 'rest';               // rest | travel
    var walkUntil = 0, scrollV = 0, scrollDir = 1, scrollSince = 0, lastScrollAt = 0;
    var phase = 0, look = 0, lookGoal = 0, blinkUntil = 0;
    var popAt = -1e9, raf = 0, last = 0, seqToken = 0, inView = true;
    var bubbleTimer = 0, ringTimer = 0, bubbleSide = 'auto', bubbleW = 0, bubbleH = 0, bubbleAction = null, bubbleKind = 'tip';
    var lastStepAt = 0, lastActivity = now(), lastKey = -1e9, idleDelay = rnd(40000, 60000);
    var lastTipAt = 0, startedAt = 0, nextTipGap = rnd(120000, 180000);
    var lastEmptyAt = -1e9, lastFilterAt = -1e9, lastSavedAt = -1e9, lastOpenedAt = -1e9, lastLookAt = 0;
    var seenEmpty = (typeof WeakSet === 'function') ? new WeakSet() : null;
    var openedCards = {};
    var interactive = false;

    function st() { return store.get(); }
    function sheetOpen() { return layout.sheetTop !== null; }
    function typing() { return inputFocused() || (now() - lastKey < 1500); }
    function enabled() { return st().started && st().enabled; }
    function live() { var s = st(); return s.started && s.enabled && s.mode !== 'quiet' && !s.away && !doc.hidden; }
    function allow(kind) { return live() && modeAllows(st().mode, kind) && !typing(); }
    function low() { return st().intensity === 'low'; }

    // ---------- layout + safe slots ----------
    function visible(e) { return !!e && e.getClientRects().length > 0 && win.getComputedStyle(e).visibility !== 'hidden'; }
    function inputFocused() {
      var a = doc.activeElement;
      if (!a || a === doc.body) return false;
      var tag = (a.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag === 'input') return !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test(a.type || 'text');
      return !!a.isContentEditable;
    }
    function rectOf(e) { return e.getBoundingClientRect(); }

    // Anything the user could tap, or that carries information, under this rect?
    function slotBlocked(x, y) {
      var box = { left: x, top: y, right: x + SIZE, bottom: y + SIZE }, i, e, list;
      for (i = 0; i < OBSTACLE_RECTS.length; i++) {
        list = doc.querySelectorAll(OBSTACLE_RECTS[i]);
        for (var j = 0; j < list.length; j++) { e = list[j]; if (visible(e) && rectsOverlap(box, rectOf(e), 6)) return true; }
      }
      if (!doc.elementsFromPoint) return false;
      var xs = [x - 4, x + SIZE / 2, x + SIZE + 4], ys = [y - 4, y + SIZE / 2, y + SIZE + 4];
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
        var px = clamp(xs[i], 1, layout.vw - 1), py = clamp(ys[j], 1, layout.vh - 1);
        var hits = doc.elementsFromPoint(px, py);
        for (var k = 0; k < hits.length; k++) {
          if (ui.host.contains(hits[k])) continue;
          if (hits[k].closest && hits[k].closest(PROTECTED)) return true;
        }
      }
      return false;
    }

    function measure() {
      var vw = win.innerWidth || 360, vh = win.innerHeight || 640;
      var app = doc.querySelector('.app');
      var ar = app ? app.getBoundingClientRect() : null;
      if (!ar || !ar.width) ar = { left: 0, right: vw, width: vw };
      var safe = ui.probe ? ui.probe.offsetHeight : 0;
      var nav = doc.querySelector('.bottom-nav');
      var navTop = (nav && visible(nav)) ? nav.getBoundingClientRect().top : vh - safe - 4;
      var rowY = navTop - SIZE - 8;
      var wa = doc.querySelector('.floating-whatsapp');
      var side = (wa && visible(wa)) ? 'left' : 'right';
      var ib = doc.querySelector('.install-banner');
      if (ib && visible(ib)) rowY = Math.min(rowY, ib.getBoundingClientRect().top - SIZE - 8);
      var sheetTop = null;
      var sh = doc.querySelector('.sheet-scrim.open .sheet');
      if (sh && visible(sh)) { sheetTop = sh.getBoundingClientRect().top; rowY = Math.min(rowY, sheetTop - SIZE - 6); }
      layout.ar = ar; layout.navTop = navTop; layout.sheetTop = sheetTop; layout.vw = vw; layout.vh = vh; layout.side = side;
      rowY = Math.max(8, rowY);

      var chosen = null;
      if (sheetTop !== null) chosen = { name: 'sheet', x: ar.right - SIZE - 8, y: rowY };
      else {
        var slots = restSlots(ar, rowY, side), i;
        var current = null;
        for (i = 0; i < slots.length; i++) if (slots[i].name === layout.slot) current = slots[i];
        if (current && !slotBlocked(current.x, current.y)) chosen = current;     // hysteresis: stay put if still free
        if (!chosen) for (i = 0; i < slots.length; i++) { if (!slotBlocked(slots[i].x, slots[i].y)) { chosen = slots[i]; break; } }
        if (!chosen) chosen = slots[0];
      }
      layout.slot = chosen.name; layout.rest = { x: chosen.x, y: chosen.y };
      if (mode === 'rest' && !goal && !gesture) facing = chosen.name.indexOf('left') === 0 ? 1 : -1;

      var toast = doc.querySelector('.toast.show');
      var toastHit = !!(toast && visible(toast) && rectsOverlap({ left: layout.rest.x, top: layout.rest.y, right: layout.rest.x + SIZE, bottom: layout.rest.y + SIZE }, rectOf(toast), 4));
      store.set({ away: (sheetTop !== null && sheetTop < 64) || inputFocused() || toastHit, sheet: sheetTop !== null });
    }

    // A contextual slot (inside an empty card, beside a button); null unless it is free and inside the app column.
    function contextSlot(kind, target) {
      if (!target || sheetOpen()) return null;
      var r = rectOf(target), ar = layout.ar, p = null;
      if (kind === 'inside') {
        if (r.height >= SIZE + 36 && r.width >= SIZE + 24) p = { x: r.right - SIZE - 10, y: r.bottom - SIZE - 10 };
      } else if (kind === 'beside') {
        p = { x: r.left - SIZE - 8, y: r.top + (r.height - SIZE) / 2 };
        if (p.x < ar.left + 6) p = { x: r.left, y: r.top - SIZE - 8 };
      } else if (kind === 'header') {
        p = { x: ar.right - SIZE - 10, y: r.bottom + 6 };
      }
      if (!p || p.x < ar.left + 4 || p.x + SIZE > ar.right - 4 || p.y < 56 || p.y + SIZE > layout.navTop - 6) return null;
      return slotBlocked(p.x, p.y) ? null : p;
    }

    // ---------- motion ----------
    function snapTo(p) { pos.x = p.x; pos.y = p.y; vel.x = vel.y = 0; goal = null; }
    function moveTo(p, o) {
      o = o || {};
      if (reduced || low()) { snapTo(p); if (o.done) setTimeout(o.done, 0); wake(); return; }
      goal = { x: p.x, y: p.y, kind: o.kind || 'spring', w: o.w || 10, speed: o.speed || 120, done: o.done || null };
      wake();
    }
    function stepMotion(dt) {
      if (!goal) { vel.x *= 0.8; vel.y *= 0.8; return; }
      var dx = goal.x - pos.x, dy = goal.y - pos.y, dn;
      if (goal.kind === 'linear') {
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1.2) { pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0; dn = goal.done; goal = null; if (dn) dn(); return; }
        var spd = Math.min(goal.speed, dist * 5 + 36), step = Math.min(dist, spd * dt);
        vel.x = dx / dist * spd; vel.y = dy / dist * spd;
        pos.x += dx / dist * step; pos.y += dy / dist * step;
      } else {
        var w = goal.w;
        vel.x += (w * w * dx - 2 * w * vel.x) * dt; vel.y += (w * w * dy - 2 * w * vel.y) * dt;
        pos.x += vel.x * dt; pos.y += vel.y * dt;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(vel.x) < 4 && Math.abs(vel.y) < 4) {
          pos.x = goal.x; pos.y = goal.y; vel.x = vel.y = 0; dn = goal.done; goal = null; if (dn) dn();
        }
      }
    }
    function goHome(done) {
      var needs = Math.abs(pos.x - layout.rest.x) > 0.6 || Math.abs(pos.y - layout.rest.y) > 0.6;
      if (!needs) { mode = 'rest'; if (done) done(); return; }
      mode = 'travel';
      moveTo(layout.rest, { kind: 'linear', speed: 110, done: function () { mode = 'rest'; if (done) done(); } });
    }

    // ---------- gestures ----------
    function gestureMs(name) { return name === 'cheer' && low() ? DUR.cheerLow : (DUR[name] || 1500); }
    function playGesture(name, o) {
      o = o || {};
      if (typing()) return false;
      var t = now(), prio = o.prio || 1;
      if (gesture && t < gesture.until && gesture.prio > prio) return false;
      var ms = o.ms || gestureMs(name);
      gesture = { name: name, start: t, until: t + ms, prio: prio, aim: o.aim || null, prop: o.prop || null, nod: !!o.nod, sparkle: !!o.sparkle, done: o.done || null };
      if (o.aim && Math.abs(o.aim.dx) > 4) facing = o.aim.dx >= 0 ? 1 : -1;
      if (reduced) setTimeout(wake, ms + 30);
      wake();
      return true;
    }

    // ---------- the one frame loop ----------
    function canRun() { return !doc.hidden && inView && st().enabled && st().started && !st().away; }
    function wake() { if (raf || !win.requestAnimationFrame) return; if (!canRun()) { if (st().started) renderOnce(); return; } last = now(); raf = win.requestAnimationFrame(frame); }
    function renderOnce() { update(0.016, now()); render(now()); }

    function frame(ts) {
      raf = 0;
      if (!canRun()) { return; }
      var t = now();
      var dt = clamp((t - last) / 1000, 0.001, 0.05); last = t;
      var animating = update(dt, t);
      render(t);
      if (animating) raf = win.requestAnimationFrame(frame);
    }

    function update(dt, t) {
      var s = st();
      if (gesture && t >= gesture.until) { var gd = gesture.done; gesture = null; if (gd) gd(); }
      if (gesture && typing()) gesture = null;

      if (reduced) { if (goal) { var gdn = goal.done; snapTo(goal); if (gdn) gdn(); } } else stepMotion(dt);
      var speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (Math.abs(vel.x) > 40) facing = vel.x > 0 ? 1 : -1;

      look += (lookGoal - look) * Math.min(1, dt * 9);

      var name = 'idle', pt = t / 1000, c = { look: look, phase: phase, speed: 0, tilt: 0, amp: 1 };
      var scrolling = !reduced && !low() && t < walkUntil && !typing();
      if (s.mode === 'quiet') { name = 'sleep'; }
      else if (gesture) {
        name = gesture.name; pt = (t - gesture.start) / 1000;
        if (reduced) pt = STILL_T[name] === undefined ? 0 : STILL_T[name];
        if (gesture.aim) c.aim = [gesture.aim.dx * facing, gesture.aim.dy];
        c.nod = gesture.nod; c.sparkle = gesture.sparkle;
      } else if (!reduced && !low() && (speed > 30 || scrolling)) {
        name = 'run';
        c.speed = speed > 30 ? speed : 140;
        c.amp = speed > 30 ? clamp(speed / 260, 0.6, 1) : 0.55;
        c.tilt = scrolling ? scrollDir * 2 : 0;
        phase += cadence(c.speed) * 2 * PI * dt;
        c.phase = phase;
      }

      var target = POSES[name](pt, c);
      if (t < blinkUntil) target.blink = 0.08;
      var alpha = reduced ? 1 : 1 - Math.exp(-dt / 0.06), maxDiff = 0;
      for (var i = 0; i < KEYS.length; i++) {
        var k = KEYS[i], d = target[k] - cur[k];
        cur[k] += d * alpha;
        if (Math.abs(d) > maxDiff) maxDiff = Math.abs(d);
      }

      var popping = t - popAt < 480;
      var settled = (name === 'idle' || name === 'sleep') && maxDiff < 0.06 && !popping && !goal && Math.abs(look - lookGoal) < 0.1 && speed < 1 && t >= blinkUntil && !(t < walkUntil);
      var wantInteractive = s.started && s.enabled && mode === 'rest' && !goal && speed < 5 && !s.away;
      if (wantInteractive !== interactive) { interactive = wantInteractive; ui.btn.setAttribute('data-live', interactive ? 'true' : 'false'); }
      var calm = (name === 'idle' || name === 'sleep') && !reduced && !low();
      if (ui.host.classList.contains('is-calm') !== calm) ui.host.classList.toggle('is-calm', calm);
      if (name === 'sleep' !== ui.host.classList.contains('is-asleep')) ui.host.classList.toggle('is-asleep', name === 'sleep');
      return !settled;
    }

    function render(t) {
      var scale = 1, age = t - popAt;
      if (age < 480 && !reduced) scale = 0.25 + 0.75 * easeOutBack(age / 480);
      ui.btn.style.transform = 'translate3d(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px,0) scale(' + scale.toFixed(3) + ')';
      var prop = null;
      if (gesture && gesture.prop) {
        var k = reduced ? 1 : Math.min(clamp((t - gesture.start) / 220, 0, 1), clamp((gesture.until - t) / 220, 0, 1));
        prop = { name: gesture.prop, k: k };
      }
      applyJoints(rig, cur, facing, t / 1000, prop);
      if (st().bubble) placeBubble();
    }

    // ---------- bubble / ring / menu ----------
    function say(text, o) {
      o = o || {};
      var s = st();
      if (!s.started || !s.enabled || s.away || doc.hidden) return false;
      if (s.mode === 'quiet' && !o.force) return false;
      if (!o.force && typing()) return false;
      if (sheetOpen() && !o.force) return false;
      clearTimeout(bubbleTimer);
      ui.text.textContent = text;
      var icon = o.icon && ICONS[o.icon];
      ui.icon.innerHTML = icon || ''; ui.icon.style.display = icon ? '' : 'none';
      bubbleAction = o.action || null;
      ui.act.hidden = !bubbleAction;
      ui.act.textContent = o.actionLabel || '';
      bubbleSide = o.side || 'auto';
      bubbleKind = o.kind || 'tip';
      ui.bubble.classList.add('is-visible');
      bubbleW = ui.bubble.offsetWidth; bubbleH = ui.bubble.offsetHeight;
      store.set({ bubble: { text: text } });
      placeBubble();
      var ms = o.ms || clamp(1800 + text.length * 45, 2800, o.action ? 6500 : 4800);
      bubbleTimer = setTimeout(hideBubble, ms);
      return true;
    }
    function hideBubble() {
      clearTimeout(bubbleTimer);
      ui.bubble.classList.remove('is-visible');
      bubbleAction = null; ui.act.hidden = true;
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

    function showRing(target, ms) {
      var r = rectOf(target), br = '';
      try { br = win.getComputedStyle(target).borderRadius; } catch (e) {}
      ui.ring.style.cssText = 'left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px;border-radius:' + (br && br !== '0px' ? br : '14px');
      ui.ring.classList.add('is-on');
      clearTimeout(ringTimer);
      ringTimer = setTimeout(hideRing, ms || 3000);
    }
    function hideRing() { clearTimeout(ringTimer); ui.ring.classList.remove('is-on'); }

    function currentScreenId() { var a = doc.querySelector('.screen.active'); return a ? a.id : ''; }

    function refreshMenuLabels() {
      var s = st();
      ui.quietBtn.textContent = s.mode === 'quiet' ? 'Turn tips on' : 'Quiet mode';
      ui.quietBtn.setAttribute('aria-pressed', s.mode === 'quiet' ? 'true' : 'false');
    }
    function openMenu() {
      var s = st();
      if (!s.started || !s.enabled || s.away) return;
      cancelSeq(); hideBubble();
      ui.menuTip.textContent = SCREEN_TIPS[currentScreenId()] || 'Need a hand? Jump to a section.';
      refreshMenuLabels();
      ui.menu.hidden = false;
      var w = ui.menu.offsetWidth, h = ui.menu.offsetHeight, ar = layout.ar;
      var left = clamp(pos.x + SIZE - w, ar.left + 8, Math.max(ar.left + 8, ar.right - 8 - w));
      var top = pos.y - h - 10 >= 8 ? pos.y - h - 10 : pos.y + SIZE + 10;
      top = clamp(top, 8, layout.vh - h - 8);
      ui.menu.style.transform = 'translate3d(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px,0)';
      ui.menu.classList.add('is-open');
      ui.btn.setAttribute('aria-expanded', 'true');
      store.set({ menuOpen: true });
      if (s.mode !== 'quiet') playGesture('wave', { ms: 700, prio: 1 });
      else wake();
      try { var first = ui.menu.querySelector('button'); if (first && first.focus) first.focus({ preventScroll: true }); } catch (e) {}
    }
    function closeMenu(returnFocus) {
      if (!st().menuOpen) return;
      ui.menu.classList.remove('is-open'); ui.menu.hidden = true;
      ui.btn.setAttribute('aria-expanded', 'false');
      store.set({ menuOpen: false });
      if (returnFocus) { try { ui.btn.focus({ preventScroll: true }); } catch (e) {} }
    }
    function jump(where) {
      closeMenu();
      if (where === 'vacancies') callGlobal('showAllVacancies');
      else if (where === 'agencies') callGlobal('showAllAgencies');
      else if (where === 'scam') callGlobal('showScamCheck');
      else if (where === 'saved') { var b = doc.querySelector('.navbtn[data-tab="saved"]'); if (b) b.click(); }
    }

    // ---------- sequences ----------
    function cancelSeq() {
      seqToken++; hideRing();
      if (gesture && gesture.aim) gesture = null;
      if (mode === 'travel' && !goal) mode = 'rest';
    }
    // Move to a free contextual slot (only if it is near and we may walk), run fn on arrival
    function relocate(p, fn) {
      if (!p || low() || reduced) { if (p && (reduced || low())) { snapTo(p); } fn(!!p); return; }
      var d = Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y);
      if (d < 3) { fn(true); return; }
      var token = ++seqToken;
      mode = 'travel';
      moveTo(p, { kind: 'linear', speed: 120, done: function () { if (token === seqToken) fn(true); } });
    }

    // ---------- recruitment-specific moments ----------
    function aimAt(target) {
      var r = rectOf(target);
      return { dx: r.left + r.width / 2 - (pos.x + SIZE / 2), dy: r.top + r.height / 2 - (pos.y + SIZE * 0.42) };
    }

    function inViewport(r) { return r.top > 64 && r.bottom < layout.navTop - 8 && r.width > 4; }

    function vacancyOpened(card) {
      noteActivity();
      if (!allow('tip')) return;
      var t = now(), id = card && (card.getAttribute('data-vacancy-id') || card.id);
      if (t - lastOpenedAt < 4000 || (id && openedCards[id])) return;
      lastOpenedAt = t; if (id) openedCards[id] = 1;
      closeMenu(); cancelSeq();
      setTimeout(function () {
        if (!allow('tip') || !card) return;
        measure();
        var btn = card.querySelector('.vx-btn--primary'), warn = card.querySelector('.vx-m--warn');
        var today = isClosesToday(warn ? warn.textContent : '');
        var br = btn && visible(btn) ? rectOf(btn) : null;
        if (br && inViewport(br)) {
          var spot = contextSlot('beside', btn);
          var near = spot && (Math.abs(spot.x - pos.x) + Math.abs(spot.y - pos.y)) < 220;
          relocate(near ? spot : null, function () {
            var home = !near;
            if (!allow('tip')) return;
            playGesture('point', { ms: 3000, prio: 2, aim: aimAt(btn), done: function () { hideRing(); if (!home) goHome(); } });
            showRing(btn, 2800);
            say(today ? MSG.closesToday : MSG.opened, { ms: 3200, side: 'auto', kind: 'tip' });
          });
        } else if (today) {
          playGesture('headsup', { ms: 2000, prio: 2 });
          say(MSG.closesTodayNoBtn, { ms: 3000, icon: 'info' });
        }
      }, 360);
    }

    function savedCount() {
      try { if (win.savedSet && typeof win.savedSet.size === 'number') return win.savedSet.size; } catch (e) {}
      try { return (JSON.parse(lsGet('savedVacancies') || '[]') || []).length; } catch (e) { return 0; }
    }

    function filtersActive(n) {
      if (!allow('tip') || !(n > 0)) return;
      var t = now(); if (t - lastFilterAt < 25000) return; lastFilterAt = t;
      if (t - lastEmptyAt < 6000) return;
      closeMenu();
      playGesture('hold', { ms: 2800, prio: 2, prop: 'filter' });
      say(MSG.filters, { ms: 5200, action: 'clearFilters', actionLabel: 'Clear', icon: 'info' });
    }

    function emptyResults(kind, node) {
      if (!allow('tip')) return;
      var t = now(); if (t - lastEmptyAt < 8000) return; lastEmptyAt = t;
      closeMenu(); cancelSeq();
      var msg = kind === 'saved' ? MSG.emptySaved : MSG.empty;
      if (kind !== 'saved') {
        var q = doc.querySelector('.screen.active input[type="search"]');
        if (q && q.value) msg = MSG.emptySearch;
      }
      var spot = node ? contextSlot('inside', node) : null;
      relocate(spot, function (moved) {
        if (!allow('tip')) return;
        playGesture('think', { ms: DUR.think, prio: 2, done: function () { if (moved) goHome(); } });
        say(msg, { ms: 4600 });
      });
    }

    function newJobs() {
      if (!allow('tip') || sess('newJobs') >= 1) return;
      if (now() - startedAt < 9000) { setTimeout(newJobs, 9000); return; }
      sess('newJobs', 1);
      popAt = now();                                   // energetic entrance
      playGesture('greet', { ms: DUR.greet, prio: 2 });
      say(MSG.newJobs, { ms: 5200, action: 'vacancies', actionLabel: 'View' });
    }

    function goOffline() {
      if (!st().enabled || st().offline) return;
      store.set({ offline: true });
      ui.badge.hidden = false;
      ui.btn.setAttribute('aria-label', 'SA Recruiters guide, offline');
      if (!allow('tip')) return;
      closeMenu();
      playGesture('worry', { ms: DUR.worry, prio: 3, prop: 'offline' });
      say(MSG.offline, { ms: 5200, icon: 'wifi', force: false });
    }
    function goOnline() {
      if (!st().offline) return;
      store.set({ offline: false });
      ui.badge.hidden = true;
      ui.btn.setAttribute('aria-label', 'SA Recruiters guide');
      if (!allow('tip')) return;
      playGesture('wave', { ms: 900, prio: 3 });
      say(MSG.online, { ms: 2800 });
    }

    function profileIncomplete(percent, hint) {
      if (!allow('tip') || sess('profileTip') >= 1) return;
      sess('profileTip', 1);
      closeMenu();
      var p = Math.round(clamp(+percent || 0, 0, 100));
      playGesture('think', { ms: 2800, prio: 2 });
      say(hint ? (MSG.profile(p) + ' ' + hint) : MSG.profile(p), { ms: 5200 });
    }

    function screenEntered(id) {
      if (!live()) return;
      if (id === 'screen-saved') {
        var n = savedCount();
        if (n > 0 && now() - lastSavedAt > 60000 && allow('tip')) {
          lastSavedAt = now();
          setTimeout(function () { if (allow('tip') && currentScreenId() === 'screen-saved') { playGesture('headsup', { ms: 1800, prio: 1 }); say(MSG.savedScreen(n), { ms: 3000 }); } }, 500);
        }
      } else if (id === 'screen-account') {
        var card = doc.getElementById('account-signin-card');
        if (card && visible(card) && card.getAttribute('aria-hidden') !== 'true' && sess('guestTip') < 1) {
          sess('guestTip', 1);
          setTimeout(function () { if (allow('tip') && currentScreenId() === 'screen-account') { playGesture('think', { ms: 2600, prio: 1 }); say(MSG.guest, { ms: 4200 }); } }, 700);
        }
      }
    }

    // ---------- timers: calm idle life + occasional safety tip ----------
    function noteActivity() { lastActivity = now(); }
    function canIdle() { var s = st(); return live() && !s.menuOpen && mode === 'rest' && !gesture && !goal && !sheetOpen() && !s.bubble && !typing(); }
    function tick() {
      if (doc.hidden || !canRun()) return;
      var t = now(), s = st();
      if (s.mode === 'quiet') return;
      if (canIdle() && !reduced && !low() && t > blinkUntil + 3000 + rnd(0, 2500)) { blinkUntil = t + 130; wake(); }
      if (canIdle() && !reduced && !low() && !lookGoal && t - lastLookAt > 9000 && Math.random() < 0.05) {
        lastLookAt = t; lookGoal = rnd(8, 12) * (Math.random() < 0.5 ? 1 : -1); wake();
        setTimeout(function () { lookGoal = 0; wake(); }, 1000);
      }
      if (canIdle() && sess('dismissed') < 2 && sess('tips') < 3 && t - startedAt > 120000 && t - lastTipAt > nextTipGap && t - lastActivity > 5000) {
        lastTipAt = t; nextTipGap = rnd(180000, 260000);
        var i = sess('tips', 1) - 1;
        if (modeAllows(s.mode, 'tip')) showTip(i);
      }
    }
    function showTip(i) {
      var tip = TIPS[i % TIPS.length];
      if (!allow('tip')) return;
      playGesture('headsup', { ms: 2400, prio: 1 });
      say(tip.text, { icon: 'shield', action: tip.action || null, actionLabel: tip.actionLabel || '', ms: 5000 });
    }

    // ---------- public API ----------
    var api = {
      onAppOpen: function () {
        if (st().started) return;
        loadSettings();
        measure(); snapTo(layout.rest);
        facing = layout.slot.indexOf('left') === 0 ? 1 : -1;
        startedAt = now();
        store.set({ started: true });
        applyHostState();
        measure(); snapTo(layout.rest);
        var first = !settings.introSeen;
        popAt = first ? now() : -1e9;                  // quiet fade-in on later launches; pop only on the very first
        wake();
        if (!settings.enabled || settings.mode === 'quiet') return;
        if (first) {
          saveSettings({ introSeen: true });
          setTimeout(function () {
            if (!allow('tip')) return;
            playGesture('wave', { ms: 1000, prio: 3 });
            say(MSG.intro, { ms: 7500, force: true });
          }, 1200);
        }
      },

      // Gentle in-place step while the page scrolls (not on Home, never in Low / reduced motion / while typing)
      onScroll: function (direction, velocity) {
        noteActivity();
        var s = st();
        if (s.menuOpen) closeMenu();
        if (!live() || reduced || low() || sheetOpen() || typing()) return;
        if (s.mode !== 'full') return;
        if (currentScreenId() === 'screen-home') return;
        var t = now();
        if (t - lastScrollAt > 400) scrollSince = t;
        lastScrollAt = t;
        if (t - scrollSince < 500) return;             // only after half a second of continuous scrolling
        scrollV = velocity || 0; scrollDir = direction >= 0 ? 1 : -1;
        walkUntil = t + 450;
        wake();
        clearTimeout(api._walkTimer); api._walkTimer = setTimeout(wake, 500);
      },

      // a quiet look-around; no travelling
      onIdleBrowse: function () {
        if (!canIdle() || reduced || low()) return;
        lookGoal = rnd(9, 13) * (Math.random() < 0.5 ? 1 : -1); wake();
        setTimeout(function () { lookGoal = -lookGoal * 0.6; wake(); }, 800);
        setTimeout(function () { lookGoal = 0; wake(); }, 1700);
      },

      onApplyStep: function (label) {
        noteActivity();
        if (!allow('celebrate')) return;
        var t = now();
        if (t - lastStepAt < 900) return;
        lastStepAt = t;
        closeMenu(); cancelSeq();
        playGesture('cheer', { prio: 3 });
        say(stepMessage(label), { ms: 3200, kind: 'celebrate' });
        if (/apply/i.test(label || '') && !sess('payTip')) {
          setTimeout(function () { if (canIdle()) { sess('payTip', 1); showTip(0); } }, 6500);
        }
      },

      onVacancyOpened: function (card) { vacancyOpened(card); },

      onSaveVacancy: function () {
        noteActivity();
        if (!allow('celebrate')) return;
        closeMenu();
        var n = savedCount();
        playGesture('hold', { ms: DUR.hold, prio: 2, prop: 'bookmark', nod: true, sparkle: true });
        say(n > 0 ? MSG.savedCount(n) : MSG.saved, n > 0 ? { ms: 3400, action: 'saved', actionLabel: 'View', kind: 'celebrate' } : { ms: 2600, kind: 'celebrate' });
      },

      onEmptyResults: function (kind, node) { emptyResults(kind, node); },
      onFiltersActive: function (n) { filtersActive(n); },
      onNewJobs: function () { newJobs(); },
      onOffline: function () { goOffline(); },
      onOnline: function () { goOnline(); },
      onProfileIncomplete: function (p, hint) { profileIncomplete(p, hint); },

      say: function (text, o) { return say(text, o); },
      settings: function (patch) { if (patch) applySettings(patch); return normalizeSettings(settings); },
      openSettings: function () { openSettingsScreen(); },
      state: function () { return store.get(); },
      subscribe: function (fn) { return store.subscribe(fn); },
      _debug: function () { return { pos: { x: pos.x, y: pos.y }, mode: mode, gesture: gesture && gesture.name, prop: gesture && gesture.prop, facing: facing, joints: cur, layout: layout, raf: !!raf, settings: settings }; }
    };

    // ---------- settings application ----------
    function applyHostState() {
      var s = st();
      ui.host.classList.toggle('is-on', s.started && s.enabled);
      ui.host.classList.toggle('is-off', !s.enabled);
      ui.host.classList.toggle('is-quiet', s.mode === 'quiet');
      ui.host.setAttribute('data-intensity', s.intensity);
      ui.btn.tabIndex = s.enabled ? 0 : -1;
      refreshMenuLabels();
      renderSettingsCard();
    }
    function applySettings(patch) {
      var wasOn = settings.enabled, prevMode = settings.mode;
      saveSettings(patch);
      closeMenu();
      if (!settings.enabled) {
        seqToken++; hideRing(); hideBubble(); gesture = null; mode = 'rest'; goal = null;
        applyHostState();
        if (wasOn) { try { if (typeof win.showToast === 'function') win.showToast(MSG.guideOff); } catch (e) {} }
        return;
      }
      applyHostState();
      measure();
      if (!wasOn) { snapTo(layout.rest); popAt = now(); }
      if (settings.mode === 'quiet') {
        seqToken++; hideRing(); gesture = null; look = lookGoal = 0;
        if (prevMode !== 'quiet') say(MSG.quietOn, { ms: 2600, force: true });
        goHome();
      } else if (prevMode === 'quiet') popAt = now();
      wake();
    }
    function resetOnboarding() {
      saveSettings({ introSeen: false });
      if (!settings.enabled) saveSettings({ enabled: true });
      applyHostState();
      measure(); snapTo(layout.rest); popAt = now(); wake();
      setTimeout(function () {
        if (!allow('tip')) return;
        saveSettings({ introSeen: true });
        playGesture('wave', { ms: 1000, prio: 3 });
        say(MSG.intro, { ms: 7500, force: true });
      }, 500);
    }

    // ---------- settings card inside the Menu screen ----------
    var cardRefs = null;
    function switchRow(id, label, help) {
      var row = el('div', 'sa-guide-settings__row');
      var copy = el('div', 'sa-guide-settings__copy');
      var l = el('span', 'sa-guide-settings__label', label); l.id = id + '-l';
      copy.appendChild(l);
      if (help) copy.appendChild(el('span', 'sa-guide-settings__help', help));
      var sw = el('button', 'sa-guide-settings__switch'); sw.type = 'button'; sw.id = id;
      sw.setAttribute('role', 'switch'); sw.setAttribute('aria-labelledby', id + '-l'); sw.setAttribute('aria-checked', 'false');
      sw.appendChild(el('span', 'sa-guide-settings__knob'));
      row.appendChild(copy); row.appendChild(sw);
      return { row: row, sw: sw };
    }
    function buildSettingsCard() {
      var menu = doc.querySelector('#screen-menu .menu-scroll');
      if (!menu || doc.getElementById('sa-guide-settings')) return;
      var sec = el('section', 'sa-guide-settings'); sec.id = 'sa-guide-settings'; sec.setAttribute('aria-labelledby', 'sa-guide-settings-title');
      var h = el('h2', 'sa-guide-settings__title', 'Guide \u00b7 ' + NAME); h.id = 'sa-guide-settings-title';
      sec.appendChild(h);
      var on = switchRow('sa-guide-on', 'Guide', 'Your job-search helper');
      var quiet = switchRow('sa-guide-quiet', 'Quiet mode', 'No speech or reactions');
      var tips = switchRow('sa-guide-tips', 'Show tips only', 'Helpful tips, no celebrations');
      sec.appendChild(on.row); sec.appendChild(quiet.row); sec.appendChild(tips.row);
      var seg = el('div', 'sa-guide-settings__row sa-guide-settings__row--seg');
      var sl = el('span', 'sa-guide-settings__label', 'Animation'); sl.id = 'sa-guide-int-l';
      var grp = el('div', 'sa-guide-settings__seg'); grp.setAttribute('role', 'radiogroup'); grp.setAttribute('aria-labelledby', 'sa-guide-int-l');
      var optLow = el('button', 'sa-guide-settings__opt', 'Low'); optLow.type = 'button'; optLow.setAttribute('role', 'radio'); optLow.setAttribute('data-int', 'low');
      var optStd = el('button', 'sa-guide-settings__opt', 'Standard'); optStd.type = 'button'; optStd.setAttribute('role', 'radio'); optStd.setAttribute('data-int', 'standard');
      grp.appendChild(optLow); grp.appendChild(optStd); seg.appendChild(sl); seg.appendChild(grp); sec.appendChild(seg);
      var reset = el('button', 'sa-guide-settings__reset', 'Reset guide intro'); reset.type = 'button';
      sec.appendChild(reset);
      var anchor = menu.querySelector('.quick-access');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor.nextSibling); else menu.insertBefore(sec, menu.firstChild);

      on.sw.addEventListener('click', function () { applySettings({ enabled: !settings.enabled }); });
      quiet.sw.addEventListener('click', function () { applySettings({ mode: settings.mode === 'quiet' ? 'full' : 'quiet' }); });
      tips.sw.addEventListener('click', function () { applySettings({ mode: settings.mode === 'tips' ? 'full' : 'tips' }); });
      grp.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-int]'); if (b) applySettings({ intensity: b.getAttribute('data-int') }); });
      reset.addEventListener('click', function () { resetOnboarding(); });
      cardRefs = { sec: sec, on: on.sw, quiet: quiet.sw, tips: tips.sw, low: optLow, std: optStd };
      renderSettingsCard();
    }
    function renderSettingsCard() {
      if (!cardRefs) return;
      var s = settings;
      function setSw(b, v, dis) { b.setAttribute('aria-checked', v ? 'true' : 'false'); b.disabled = !!dis; b.classList.toggle('is-on', !!v); }
      setSw(cardRefs.on, s.enabled, false);
      setSw(cardRefs.quiet, s.mode === 'quiet', !s.enabled);
      setSw(cardRefs.tips, s.mode === 'tips', !s.enabled);
      cardRefs.low.setAttribute('aria-checked', s.intensity === 'low' ? 'true' : 'false');
      cardRefs.std.setAttribute('aria-checked', s.intensity === 'standard' ? 'true' : 'false');
      cardRefs.low.disabled = cardRefs.std.disabled = !s.enabled;
      cardRefs.sec.classList.toggle('is-disabled', !s.enabled);
    }
    function openSettingsScreen() {
      closeMenu();
      var tab = doc.querySelector('.navbtn[data-tab="menu"]');
      if (tab) tab.click();
      setTimeout(function () {
        var sec = doc.getElementById('sa-guide-settings');
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        var first = sec && sec.querySelector('button'); if (first && first.focus) first.focus({ preventScroll: true });
      }, 120);
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
        case 'filters': api.onFiltersActive(d.count); break;
        case 'newJobs': api.onNewJobs(); break;
        case 'offline': api.onOffline(); break;
        case 'online': api.onOnline(); break;
        case 'profile': api.onProfileIncomplete(d.percent, d.hint); break;
      }
    }

    // ============================================================
    // 6. ADAPTER (wires the app's DOM to the API above)
    // ============================================================
    var lastTop = (typeof WeakMap === 'function') ? new WeakMap() : null, lastT = lastTop && new WeakMap();
    var smoothV = 0, scanTimer = 0, lastScreen = '', lastPills = 0, lastConn = '', filterTimer = 0;

    function onAnyScroll(e) {
      var t = e.target, e2 = (t === doc || t === doc.documentElement || t === doc.body) ? (doc.scrollingElement || doc.documentElement) : t;
      if (!e2 || e2.nodeType !== 1 || ui.host.contains(e2) || !lastTop) return;
      var top = e2.scrollTop, prev = lastTop.get(e2);
      lastTop.set(e2, top);
      if (prev === undefined) return;
      var d = top - prev;
      if (Math.abs(d) < 1) return;
      var tm = now(), pt = lastT.get(e2) || tm - 16;
      lastT.set(e2, tm);
      smoothV = smoothV * 0.6 + (Math.abs(d) / Math.max(8, tm - pt) * 1000) * 0.4;
      if (e2.scrollHeight - e2.clientHeight < 120) return;
      api.onScroll(d > 0 ? 1 : -1, smoothV);
      clearTimeout(scanTimer); scanTimer = setTimeout(scan, 350);      // re-check safe slot once scrolling settles
    }

    function onDocClick(e) {
      var t = e.target;
      if (!t || !t.closest || ui.host.contains(t)) return;
      noteActivity();
      var head = t.closest('.vx-head');
      if (head) {
        var was = head.getAttribute('aria-expanded'), card = head.closest('.vac-card, [data-vacancy-id]');
        setTimeout(function () { if (head.getAttribute('aria-expanded') === 'true' && was !== 'true') api.onVacancyOpened(card); }, 40);
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

    function connState() { var c = doc.getElementById('connection-status'); return c ? (c.getAttribute('data-state') || '') : ''; }
    function onConnChange() {
      var s = connState();
      if (s === lastConn) return;
      var prev = lastConn; lastConn = s;
      if (s === 'offline') { goOffline(); return; }
      if (st().offline && s && s !== 'offline' && win.navigator.onLine !== false) goOnline();
      if (s === 'live' && prev && prev !== 'live') checkFreshJobs();
    }
    function checkFreshJobs() {
      var c = doc.getElementById('stat-vacancies');
      var n = c ? parseCount(c.textContent) : null;
      if (n === null || n <= 0) return;
      var prev = parseFloat(lsGet(KEY_LASTCOUNT) || '0');
      lsSet(KEY_LASTCOUNT, String(n));
      if (prev > 0 && n > prev * 1.005 && settings.introSeen) setTimeout(newJobs, 1500);
    }
    function onPillsChange() {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(function () {
        var n = doc.querySelectorAll('#vx-active .vx-pill').length;
        if (n > lastPills) filtersActive(n);
        lastPills = n;
      }, 600);
    }

    function scan() {
      scanTimer = 0;
      if (doc.hidden) return;
      measure();
      var id = currentScreenId();
      if (id !== lastScreen) {
        lastScreen = id; store.set({ screen: id });
        smoothV = 0;
        if (st().menuOpen) closeMenu();
        if (st().bubble && id !== 'screen-home') { /* keep short bubbles; they auto-hide */ }
        screenEntered(id);
      }
      if (mode === 'rest' && !goal && !gesture && (Math.abs(pos.x - layout.rest.x) > 0.6 || Math.abs(pos.y - layout.rest.y) > 0.6)) goHome();
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
        api.onEmptyResults(kind, n);
        break;
      }
    }
    function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(scan, 160); }

    function wireApp() {
      doc.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
      doc.addEventListener('click', onDocClick, true);
      ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) { doc.addEventListener(ev, noteActivity, { capture: true, passive: true }); });
      doc.addEventListener('keydown', function (e) { noteActivity(); if (e.target && e.target.closest && !ui.host.contains(e.target) && /^(input|textarea|select)$/i.test(e.target.tagName || '')) { lastKey = now(); } }, true);
      doc.addEventListener('focusin', function () { measure(); wake(); });
      doc.addEventListener('focusout', function () { setTimeout(function () { measure(); wake(); }, 160); });
      doc.addEventListener('transitionend', function (e) { if (e.target && e.target.classList && (e.target.classList.contains('sheet') || e.target.classList.contains('sheet-scrim'))) scheduleScan(); }, true);
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { measure(); wake(); } });
      doc.addEventListener('sa-guide', function (e) { dispatch(e.detail); });
      win.addEventListener('resize', scheduleScan);
      win.addEventListener('orientationchange', function () { setTimeout(scan, 250); });
      win.addEventListener('offline', function () { setTimeout(goOffline, 50); });
      win.addEventListener('online', function () { setTimeout(function () { if (connState() !== 'offline') goOnline(); }, 400); });
      if (win.visualViewport) win.visualViewport.addEventListener('resize', scheduleScan);

      if (win.IntersectionObserver) {
        try {
          new win.IntersectionObserver(function (list) {
            var v = list[list.length - 1].isIntersecting;
            if (v !== inView) { inView = v; if (v) wake(); }
          }).observe(ui.btn);
        } catch (e) {}
      }
      if (win.MutationObserver) {
        new win.MutationObserver(function (list) {
          if (doc.hidden) return;
          for (var i = 0; i < list.length; i++) { if (!ui.host.contains(list[i].target)) { scheduleScan(); return; } }
        }).observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-expanded'] });
        var toast = doc.getElementById('toast');
        if (toast) new win.MutationObserver(function () {
          var step = toastStep(toast.textContent);
          if (step) api.onApplyStep(step);
        }).observe(toast, { childList: true, characterData: true, subtree: true });
        var conn = doc.getElementById('connection-status');
        if (conn) { lastConn = connState(); new win.MutationObserver(onConnChange).observe(conn, { attributes: true, attributeFilter: ['data-state'] }); }
        var pills = doc.getElementById('vx-active');
        if (pills) new win.MutationObserver(onPillsChange).observe(pills, { childList: true });
      }
      setInterval(tick, 1000);
    }

    function wireUi() {
      ui.btn.addEventListener('click', function () { st().menuOpen ? closeMenu() : openMenu(); });
      ui.x.addEventListener('click', function () { var n = sess('dismissed', 1); hideBubble(); if (n >= 2) { /* two dismissals: stop automatic tips this session */ } });
      ui.act.addEventListener('click', function () {
        var a = bubbleAction; hideBubble();
        if (a === 'scam') callGlobal('showScamCheck');
        else if (a === 'vacancies') callGlobal('showAllVacancies');
        else if (a === 'clearFilters') callGlobal('clearVacancyFilters');
        else if (a === 'saved') jump('saved');
      });
      ui.menu.addEventListener('click', function (e) {
        var j = e.target.closest && e.target.closest('[data-jump]');
        if (j) { jump(j.getAttribute('data-jump')); return; }
        var act = e.target.closest && e.target.closest('[data-act]');
        if (!act) return;
        var kind = act.getAttribute('data-act');
        if (kind === 'quiet') applySettings({ mode: settings.mode === 'quiet' ? 'full' : 'quiet' });
        else if (kind === 'off') applySettings({ enabled: false });
        else if (kind === 'settings') openSettingsScreen();
      });
      doc.addEventListener('pointerdown', function (e) { if (st().menuOpen && !ui.host.contains(e.target)) closeMenu(); }, true);
      doc.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (st().menuOpen) { closeMenu(true); }
        else if (st().bubble) hideBubble();
      });
      store.subscribe(function (n, prev) {
        if (n.away !== prev.away) {
          ui.host.classList.toggle('is-away', n.away);
          if (n.away) { closeMenu(); hideBubble(); }
          else wake();
        }
        if (n.sheet && !prev.sheet) { hideBubble(); hideRing(); }       // sheets own the screen: bubbles hide
      });
    }

    function boot() {
      buildDom(); loadSettings(); wireUi(); buildSettingsCard(); measure(); snapTo(layout.rest);
      applyHostState();
      render(now());
      wireApp();
      lastScreen = currentScreenId();
      function go() { measure(); api.onAppOpen(); }
      function ready() { checkFreshJobsSeed(); setTimeout(go, 700); }
      function checkFreshJobsSeed() { /* first count is recorded when listings go live */ }
      if (doc.body.classList.contains('app-ready')) setTimeout(go, 600);
      else {
        var fired = false;
        var once = function () { if (fired) return; fired = true; ready(); };
        if (win.MutationObserver) {
          var mo = new win.MutationObserver(function () { if (doc.body.classList.contains('app-ready')) { mo.disconnect(); once(); } });
          mo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
        }
        setTimeout(once, 5000);
      }
    }

    return { api: api, boot: boot, store: store, _ui: ui };
  }

  // ---------- exports + auto start ----------
  var exported = { createGuide: createGuide, createStore: createStore, solveArm: solveArm, handPos: handPos, POSES: POSES, IDLE: IDLE, KEYS: KEYS,
    buildRig: buildRig, applyJoints: applyJoints, classifyEmpty: classifyEmpty, toastStep: toastStep, stepMessage: stepMessage,
    normalizeSettings: normalizeSettings, modeAllows: modeAllows, parseCount: parseCount, isClosesToday: isClosesToday,
    restSlots: restSlots, rectsOverlap: rectsOverlap, cadence: cadence, DUR: DUR, MSG: MSG, TIPS: TIPS, J: J, NAME: NAME };
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
