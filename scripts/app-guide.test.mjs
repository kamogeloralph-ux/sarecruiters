import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const G = require("../app-guide.js");
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("solveArm reaches its target with a bent elbow", () => {
  const [a, e] = G.solveArm(9, -16, 1);
  const t1 = a * Math.PI / 180, t2 = (a + e) * Math.PI / 180;
  const x = -Math.sin(t1) * 6 - Math.sin(t2) * 5.6;
  const y = -10 + Math.cos(t1) * 6 + Math.cos(t2) * 5.6;
  assert.ok(Math.hypot(x - 9, y + 16) < 0.1);
});

test("every pose returns every joint as a finite number", () => {
  for (const name of Object.keys(G.POSES)) {
    for (const t of [0, 0.3, 1.2, 1.9]) {
      const j = G.POSES[name](t, { phase: t * 5, speed: 400, aim: [1, -1], nod: true, sparkle: true });
      for (const k of G.KEYS) assert.ok(Number.isFinite(j[k]), name + "." + k);
    }
  }
});

test("the focused poses exist: idle, wave, point, cheer, think, headsup, sleep", () => {
  for (const n of ["idle", "wave", "point", "cheer", "think", "headsup", "sleep", "hold", "worry", "greet"]) assert.equal(typeof G.POSES[n], "function", n);
});

test("settings normalise to safe values", () => {
  assert.deepEqual(G.normalizeSettings(null), { enabled: true, mode: "full", intensity: "standard", introSeen: false });
  assert.equal(G.normalizeSettings({ mode: "weird" }).mode, "full");
  assert.equal(G.normalizeSettings({ intensity: "low" }).intensity, "low");
  assert.equal(G.normalizeSettings({ enabled: false }).enabled, false);
});

test("modes decide what Thando may do", () => {
  assert.equal(G.modeAllows("full", "celebrate"), true);
  assert.equal(G.modeAllows("tips", "celebrate"), false);
  assert.equal(G.modeAllows("tips", "tip"), true);
  assert.equal(G.modeAllows("quiet", "tip"), false);
});

test("empty-state classification ignores loading and non-search empties", () => {
  assert.equal(G.classifyEmpty("No roles match yet. Try widening", null), "search");
  assert.equal(G.classifyEmpty("Loading vacancies…", null), null);
  assert.equal(G.classifyEmpty("No employers yet", null), null);
  assert.equal(G.classifyEmpty("Use the star", "saved"), "saved");
  assert.equal(G.classifyEmpty("x", "manager"), null);
});

test("toast steps count successes only", () => {
  assert.equal(G.toastStep("Application saved to your profile"), "Apply tapped");
  assert.equal(G.toastStep("Could not save your application"), null);
  assert.equal(G.toastStep("Push alerts enabled"), null);
});

test("vacancy count and closing-date helpers", () => {
  assert.equal(G.parseCount("1,234"), 1234);
  assert.equal(G.parseCount("12.5K"), 12500);
  assert.equal(G.parseCount("…"), null);
  assert.equal(G.isClosesToday("Closes today"), true);
  assert.equal(G.isClosesToday("Closes in 3d"), false);
});

test("rest slots stay inside the app column and prefer the free side", () => {
  const ar = { left: 100, right: 620 };
  const slots = G.restSlots(ar, 700, "right");
  assert.equal(slots[0].name, "right");
  for (const s of slots) { assert.ok(s.x >= ar.left && s.x + 44 <= ar.right); assert.ok(s.y <= 700); }
  assert.equal(G.restSlots(ar, 700, "left")[0].name, "left");
  assert.ok(G.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 8, top: 8, right: 20, bottom: 20 }));
  assert.ok(!G.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 30, top: 0, right: 40, bottom: 10 }));
});

test("speech is short enough for two lines", () => {
  const msgs = [];
  for (const v of Object.values(G.MSG)) { if (typeof v === "string") msgs.push(v); }
  msgs.push(G.MSG.savedCount(12), G.MSG.profile(80));
  for (const t of G.TIPS) msgs.push(t.text);
  for (const m of msgs) assert.ok(m.length <= 70, m);
});

test("the guide has a name and is loaded and versioned by the app", () => {
  assert.equal(G.NAME, "Thando");
  assert.match(read("index.html"), /<script src="app-guide\.js\?v=[^"]+" defer><\/script>/);
  assert.match(read("index.html"), /app-guide\.css\?v=/);
  assert.match(read("generate-pages.js"), /'app-guide\.js'/);
  assert.match(read("generate-pages.js"), /'app-guide\.css'/);
});

test("the markup respects reduced motion and exposes accessible controls", () => {
  const js = read("app-guide.js"), css = read("app-guide.css");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(js, /aria-label', 'SA Recruiters guide'/);
  assert.match(js, /role', 'switch'/);
  assert.match(js, /IntersectionObserver/);
});

test("feature coach: every suggestion is short, has a button label and a target action", () => {
  for (const [id, f] of Object.entries(G.FEATURES)) {
    assert.ok(f.text.length <= 70, id);
    assert.ok(f.label && f.label.length <= 12, id);
    assert.ok(f.fn || f.special, id);
  }
  for (const order of Object.values(G.FEATURE_ORDER)) for (const id of order) assert.ok(G.FEATURES[id], id);
});

test("feature coach: key features are covered (CV Box upload, CV builder, learning)", () => {
  assert.equal(G.FEATURES.cvbox.fn, "openCvBoxApplication");
  assert.equal(G.FEATURES.cvbuild.fn, "openCvBuilderSheet");
  assert.equal(G.FEATURES.learn.arg, "learning-hub");
  assert.ok(G.FEATURE_ORDER["screen-home"].includes("cvbox"));
});

test("feature coach: chooser skips done / just-shown / seen features and only offers sign-in to guests", () => {
  const t = Date.now();
  assert.equal(G.chooseFeature("screen-home", {}, {}), "cvbox");
  assert.notEqual(G.chooseFeature("screen-home", { cvbox: { done: 1 } }, {}), "cvbox");
  assert.notEqual(G.chooseFeature("screen-home", { cvbox: { n: 1, last: t } }, { now: t }), "cvbox");
  assert.notEqual(G.chooseFeature("screen-home", {}, { seen: { cvbox: 1 } }), "cvbox");
  assert.notEqual(G.chooseFeature("screen-home", { cvbox: { n: 4 } }, {}), "cvbox");
  const noGuest = ["cvbox", "cvbuild", "learn"].reduce((m, k) => (m[k] = { done: 1 }, m), {});
  assert.equal(G.chooseFeature("screen-account", noGuest, { guest: false }), null);
  assert.equal(G.chooseFeature("screen-account", noGuest, { guest: true }), "signin");
  assert.equal(G.chooseFeature("screen-home", { cvbox: { done: 1 } }, { force: true, offset: 0 }) === "cvbox", false);
  assert.equal(G.chooseFeature("screen-unknown", {}, {}), "cvbox");
});

test("the coach greets on every launch and walks to the feature it points at", () => {
  const js = read("app-guide.js");
  assert.match(js, /function greetLaunch/);
  assert.match(js, /contextSlot\('beside', target\)/);
  assert.match(js, /Good morning/);
});
