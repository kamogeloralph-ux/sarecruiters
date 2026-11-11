import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

test('Home Take Your Next Step cards reuse the Quick Access card content and actions', () => {
  const ui = read('app-ui.js');
  const html = read('index.html');
  const homeMarkup = ui.slice(ui.indexOf('home-tools-grid'), ui.indexOf('target.setAttribute', ui.indexOf('home-tools-grid')));
  const quickMarkup = html.slice(html.indexOf('<section class="quick-access"'), html.indexOf('</section>', html.indexOf('<section class="quick-access"')));

  for (const marker of ['quick-card-candidates', 'quick-card-employers', 'Find jobs or upload a CV', 'Find candidates or post a vacancy', 'Browse jobs', 'Upload a CV', 'Browse CV Box', 'Post vacancy']) {
    assert.ok(homeMarkup.includes(marker), `Home card markup should include ${marker}`);
    assert.ok(quickMarkup.includes(marker), `Quick Access markup should include ${marker}`);
  }
  assert.match(homeMarkup, /openCvBoxApplication\(\)/);
  assert.match(quickMarkup, /openCvBoxApplication\(\)/);
  assert.match(read('styles.css'), /\.home-tools-grid \.home-tool-card\{[^}]*padding:10px 9px 9px/);
});

test('Need help and hamburger Looking for work actions share the CV Box application flow', () => {
  const html = read('index.html');
  const menuAction = html.match(/<button[^>]*onclick="closeSiteMenu\(\);openCvBoxApplication\(\)"[^>]*>[\s\S]*?Looking for work\?[\s\S]*?<\/button>/);
  const helpAction = html.match(/<button class="account-help-action"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(menuAction, 'Hamburger Looking for work action should open the CV Box application');
  assert.ok(helpAction, 'Account Need help finding work action should exist');
  assert.match(helpAction[0], /openCvBoxApplication\(\)/);
  assert.doesNotMatch(menuAction[0], /openJobSeekerSheet/);
  assert.doesNotMatch(helpAction[0], /openJobSeekerSheet/);
  assert.match(read('app-ui.js'), /export function openCvBoxApplication\(\)/);
});

test('saved vacancy alerts card is compact and matches centered account card width', () => {
  const css = read('styles.css');
  assert.match(css, /\.saved-alerts-panel\{width:min\(100%,420px\);box-sizing:border-box;margin:0 auto 14px;padding:12px/);
});
