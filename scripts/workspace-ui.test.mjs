import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const html = read('index.html');
const workspace = read('app-workspace.js');
const css = read('workspace-ui.css');
const vacancy = read('app-vacancy-v2.js');
const cards = read('app-cards.js');
const sheets = read('app-sheets.js');
const ui = read('app-ui.js');
const data = read('app-data.js');

function ids(source) {
  return [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

test('workspace navigation maps all six destinations to existing production transitions', () => {
  for (const destination of ['home', 'allvacancies', 'allagencies', 'pool', 'allemployers', 'saved']) {
    assert.match(html, new RegExp(`data-workspace-screen="${destination}"`));
    assert.match(workspace, new RegExp(`target === '${destination}'`));
  }
  assert.match(workspace, /window\.goBackHome/);
  assert.match(workspace, /window\.showAllVacancies/);
  assert.match(workspace, /window\.showAllAgencies/);
  assert.match(workspace, /window\.goPool/);
  assert.match(workspace, /window\.showAllEmployers/);
  assert.match(workspace, /renderSavedScreen/);
  assert.doesNotMatch(workspace, /location\.reload/);
});

test('workspace search forwards to the real vacancy keyword renderer', () => {
  assert.match(html, /id="workspace-global-search-input"/);
  assert.match(workspace, /byId\('allvacancies-search'\)/);
  assert.match(workspace, /renderAllVacanciesList/);
  for (const field of ['v.title', 'v.notes', 'v.location', 'v.company', 'a.name']) {
    assert.match(vacancy, new RegExp(field.replace('.', '\\.') + '[^\n]*join'));
  }
  assert.match(vacancy, /matchesWorkMode/);
  assert.match(vacancy, /allvacancies-location/);
});

test('directory and talent workspace actions use real production data paths', () => {
  assert.match(html, /id="allagencies-search"/);
  assert.match(html, /id="allemployers-search"/);
  assert.match(html, /id="pool-search"/);
  assert.match(ui, /export function showAllAgencies/);
  assert.match(cards, /export function showAllEmployers/);
  assert.match(sheets, /export function goPool/);
  assert.match(data, /agencies/);
  assert.match(data, /employers/);
});

test('saved role state emits a live event and keeps local plus remote persistence', () => {
  assert.match(cards, /localStorage\.setItem\('savedVacancies'/);
  assert.match(cards, /syncSavedVacancy\(key, nowSaved\)/);
  assert.match(cards, /sa-saved-change/);
  assert.match(workspace, /workspace-saved-count/);
  assert.match(workspace, /workspace-topbar-saved-count/);
  assert.match(html, /data-workspace-screen="saved"[\s\S]*?workspace-saved-count/);
});

test('workspace includes loading, empty, and error-capable production surfaces', () => {
  assert.match(html, /id="connection-status"[^>]*data-state="loading"/);
  assert.match(html, /id="allvacancies-list"/);
  assert.match(data, /vacancyScreenStateMarkup/);
  assert.match(css, /\.empty-state/);
  assert.match(css, /data-theme="dark"/);
});

test('responsive workspace keeps every core link visible without hiding workspace sections', () => {
  assert.match(css, /@media \(max-width: 1000px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /grid-template-columns: repeat\(2/);
  assert.doesNotMatch(css, /\.workspace-(?:nav|sidebar|topbar|content|metrics|overview)[^{]*\{[^}]*display:\s*none/);
  assert.equal(new Set(ids(html)).size, ids(html).length, 'index.html contains duplicate IDs');
});

test('workspace adds one stylesheet and one module entry without prototype reload/navigation code', () => {
  assert.equal((html.match(/workspace-ui\.css/g) || []).length, 2, 'normal and noscript stylesheet references are expected');
  assert.equal((html.match(/app\.bundle\.min\.js\?v=/g) || []).length, 1);
  assert.equal((read('app-entry.js').match(/app-workspace\.js/g) || []).length, 1);
  assert.doesNotMatch(workspace, /sa_preview_saved|ready to connect|location\.reload/);
});
