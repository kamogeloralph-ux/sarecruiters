import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { STEPS, canRefresh, refreshScreen } = require("../app-pull-refresh.js");
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

function fakeWindow(log, overrides = {}) {
  return new Proxy({}, {
    get: (t, name) => overrides[name] || ((...args) => { log.push([name, ...args]); return Promise.resolve(); }),
  });
}

test("every section except Home and the form screens can be pulled", () => {
  for (const id of ["screen-saved", "screen-account", "screen-allagencies", "screen-allbranches", "screen-allemployers",
    "screen-allads", "screen-allvacancies", "screen-pool", "screen-community", "screen-submissions"]) {
    assert.ok(canRefresh(id), id);
  }
  for (const id of ["screen-home", "screen-menu", "screen-scamcheck", "screen-smartmanager", "screen-manager", "screen-manager-employer", "screen-nope"]) {
    assert.equal(canRefresh(id), false, id);
  }
});

test("every screen in the app is either refreshable or deliberately excluded", () => {
  const ids = [...read("index.html").matchAll(/class="screen(?: active)?" id="(screen-[a-z-]+)"/g)].map((m) => m[1]);
  const excluded = new Set(["screen-home", "screen-menu", "screen-scamcheck", "screen-smartmanager", "screen-manager", "screen-manager-employer", "screen-manager-status"]);
  assert.ok(ids.length >= 15);
  for (const id of ids) assert.ok(canRefresh(id) || excluded.has(id), `${id} has no pull-to-refresh decision`);
  for (const id of Object.keys(STEPS)) assert.ok(ids.includes(id), `${id} is not a real screen`);
});

test("refresh runs the steps in order and resolves true", async () => {
  const log = [];
  assert.equal(await refreshScreen("screen-saved", fakeWindow(log)), true);
  assert.deepEqual(log.map((c) => c[0]), ["loadAll", "loadSavedVacanciesFromSupabase", "renderSaved"]);
  assert.deepEqual(log[0][1], { fresh: true });
});

test("vacancy folders are reset before the redraw", async () => {
  const log = [];
  await refreshScreen("screen-allvacancies", fakeWindow(log));
  const names = log.map((c) => c[0]);
  assert.ok(names.indexOf("set_generalVacancyQueryKey") < names.indexOf("renderAllVacanciesList"));
  assert.deepEqual(log[0], ["set_generalVacancyQueryKey", "__open__"]);
});

test("missing globals are skipped; failures reject; unknown screens do nothing", async () => {
  assert.equal(await refreshScreen("screen-pool", {}), true);
  await assert.rejects(refreshScreen("screen-pool", { loadPoolCandidates: () => { throw new Error("boom"); } }), /boom/);
  await assert.rejects(refreshScreen("screen-community", { communityLoad: () => Promise.reject(new Error("net")) }), /net/);
  assert.equal(await refreshScreen("screen-home", {}), false);
});

test("the script is loaded by the app and shipped with the deploy hash", () => {
  assert.match(read("index.html"), /<script src="app-pull-refresh\.js\?v=[^"]+" defer><\/script>/);
  assert.match(read("generate-pages.js"), /'app-pull-refresh\.js'/);
});
