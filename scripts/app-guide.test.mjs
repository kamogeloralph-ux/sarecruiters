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
      const j = G.POSES[name](t, { phase: t * 5, speed: 400, aim: [1, -1] });
      for (const k of G.KEYS) assert.ok(Number.isFinite(j[k]), name + "." + k);
    }
  }
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

test("messages stay short enough for one line on a phone", () => {
  const all = [G.MSG.onboard, G.MSG.apply, G.MSG.done, G.MSG.empty, G.MSG.emptySaved, ...G.MSG.opened, ...G.MSG.saved, ...G.TIPS.map(t => t.text)];
  for (const m of all) {
    if (m === G.MSG.onboard) assert.equal(m, "Hi, I’m your SA Recruiters guide. Tap me anytime for help.");
    else assert.ok(m.length <= 46, m);
  }
});

test("guide is loaded by the app and versioned with the deploy", () => {
  assert.match(read("index.html"), /<script src="app-guide\.js\?v=[^"]+" defer><\/script>/);
  assert.match(read("index.html"), /app-guide\.css\?v=/);
  assert.match(read("generate-pages.js"), /'app-guide\.js'/);
  assert.match(read("generate-pages.js"), /'app-guide\.css'/);
});
