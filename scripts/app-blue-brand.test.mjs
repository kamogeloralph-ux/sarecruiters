import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

test('app screens use the public-page blue and white palette in light mode', () => {
  const styles = read('styles.css');
  const brand = read('mono.css');
  const shell = read('index.html');

  assert.match(styles, /--m-ink:#1769cf/);
  assert.match(brand, /--bg:#fff;--bg-edge:#f7faff;--card:#fff/);
  assert.match(brand, /--accent:#1769cf/);
  assert.match(brand, /#screen-home \.screen-fixed,[\s\S]*?background:var\(--card\)!important/);
  assert.match(brand, /\.bottom-nav \.navbtn\.active[\s\S]*?color:var\(--m-ink\)!important/);
  assert.match(brand, /\.site-menu-nav-item\{border:1px solid var\(--border\)!important;background:var\(--card-2\)!important\}/);
  assert.match(shell, /\[data-theme="light"\] body\{background:#fff\}/);
});

test('dark mode remains available and shares the blue brand accent', () => {
  const brand = read('mono.css');
  const core = read('app-core.js');
  const shell = read('index.html');

  assert.match(brand, /html\[data-theme="dark"\]\{[\s\S]*?--accent:#5a9bff/);
  assert.match(core, /export function toggleTheme\(\)/);
  assert.match(core, /meta\.setAttribute\('content', '#1769cf'\)/);
  assert.match(shell, /content="#1769cf" id="meta-theme"/);
});

test('all app install icons are colored, maskable assets retain their purpose, and monochrome masks stay dedicated', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const icons = manifest.icons;
  const anyIcons = icons.filter((icon) => icon.purpose === 'any');
  const maskableIcons = icons.filter((icon) => icon.purpose === 'maskable');
  const monochromeIcons = icons.filter((icon) => icon.purpose === 'monochrome');

  assert.equal(manifest.background_color, '#ffffff');
  assert.equal(manifest.theme_color, '#1769cf');
  assert.deepEqual(anyIcons.map((icon) => icon.sizes), [
    '16x16', '32x32', '48x48', '72x72', '96x96', '128x128', '144x144', '152x152',
    '192x192', '256x256', '384x384', '512x512', '1024x1024'
  ]);
  assert.deepEqual(maskableIcons.map((icon) => icon.sizes), ['192x192', '256x256', '384x384', '512x512', '1024x1024']);
  assert.equal(monochromeIcons.length, 2);
  for (const icon of [...anyIcons, ...maskableIcons, ...monochromeIcons]) {
    assert.ok(existsSync(resolve(root, icon.src)), `Manifest icon should exist: ${icon.src}`);
  }
  for (const asset of ['favicon-v2.ico', 'icons/logo-96.webp', 'icons/logo-152.webp', 'icons/menu-logo-100.webp']) {
    assert.ok(existsSync(resolve(root, asset)), `App logo asset should exist: ${asset}`);
  }
  assert.match(read('sw.js'), /v2-icon-192\.png/);
  assert.match(read('index.html'), /href="icons\/v2-icon-512\.png"/);
});

test('app icons, support wording, and the site-menu trigger remain visible and operable', () => {
  const brand = read('mono.css');
  const shell = read('index.html');
  const ui = read('app-ui.js');
  const serviceWorker = read('sw.js');

  assert.match(brand, /\.app :is\([\s\S]*?svg\{\s*opacity:1!important;\s*stroke-width:2\.1!important/);
  assert.match(brand, /\.app \.bottom-nav \.navbtn svg\{display:block!important;width:25px!important;height:25px!important;stroke-width:2\.3!important\}/);
  assert.match(brand, /#screen-home \.site-menu-trigger span,.screen:not\(#screen-home\) \.site-menu-trigger span\{\s*display:block!important;[\s\S]*?width:22px!important;height:3px!important/);
  assert.match(brand, /#screen-home \.home-bottom-hero \.support-ticker-item,#screen-menu \.menu-hero \.support-ticker-item\{[\s\S]*?color:#1769cf!important;[\s\S]*?animation:none!important/);
  assert.match(brand, /height:44px!important;min-height:44px!important;padding:0!important;text-align:left!important/);
  assert.match(brand, /background:#fff!important;box-shadow:0 4px 12px rgba\(10,44,90,\.14\)!important/);
  assert.match(brand, /\[data-theme="light"\] \.bottom-nav \.navbtn\.active[\s\S]*?color:#1769cf!important/);
  assert.match(brand, /\[data-theme="dark"\] \.bottom-nav \.navbtn:not\(\.active\)[\s\S]*?color:#d5e2f1!important/);
  assert.equal((shell.match(/<button class="support-ticker" type="button"/g) || []).length, 2);
  assert.equal((shell.match(/Support the Directory/g) || []).length, 2);
  assert.equal((shell.match(/<button class=\"support-ticker\" type=\"button\"[^>]*onclick=\"openSupportSheet\(\)\"/g) || []).length, 2);
  assert.doesNotMatch(shell, /onclick=\"openContentSheet\('support'\)\"/);
  assert.doesNotMatch(shell, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/);
  assert.match(shell, /mono\.css\?v=visibility-2/);
  assert.match(brand, /#screen-home \.stat-icon\{[\s\S]*?border:1px solid rgba\(255,255,255,\.48\)!important;[\s\S]*?color:#fff!important;opacity:1!important/);
  assert.match(ui, /drawer\.classList\.add\('is-open'\)/);
  assert.match(ui, /backdrop\.classList\.add\('is-visible'\)/);
  assert.match(serviceWorker, /const VERSION = 'sa-recruiters-visibility1'/);
});
