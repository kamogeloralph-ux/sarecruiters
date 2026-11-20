// Source-level guards for the Scam Check feature (it replaced CV Pictures) and for the
// "Apply now button is blank" bug (blue text on a blue button).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('home has a Scam Check card and screen, wired to the Worker with the Turnstile token', () => {
  const html = read('index.html');
  assert.match(html, /class="stat-card stat-card-scamcheck" data-pin-first[^>]*onclick="showScamCheck\(\)"/);
  assert.match(html, /id="screen-scamcheck"/);
  assert.match(html, /<textarea id="scamcheck-input"/);
  assert.match(html, /id="scamcheck-turnstile"/);
  const ui = read('app-ui.js');
  assert.match(ui, /R2_WORKER_URL \+ '\/api\/ai\/scam-check'/);
  assert.match(ui, /headers\['cf-turnstile-response'\] = token/);
  assert.match(ui, /'scam-check': 'scamcheck'/);
  for (const name of ['showScamCheck', 'runScamCheck', 'resetScamCheck', 'shareScamResult']) {
    assert.match(ui, new RegExp(`^  ${name},$`, 'm'), `${name} must be on the window bridge for the inline onclick`);
  }
});

test('the result is built from escaped text only', () => {
  const ui = read('app-ui.js');
  const start = ui.indexOf('export function renderScamResult');
  const body = ui.slice(start, ui.indexOf('export async function runScamCheck'));
  assert.match(body, /escapeHtml\(v\.title/);
  assert.match(body, /escapeHtml\(v\.summary/);
  assert.doesNotMatch(body, /innerHTML\s*=\s*data\./);
});

test('CV Pictures are gone from the app, admin console and styles', () => {
  for (const file of ['index.html', 'app-ui.js', 'app-cards.js', 'app-data.js', 'app-forms.js', 'app-manager.js', 'admin.html', 'styles.css', 'mono.css', 'generate-pages.js']) {
    assert.doesNotMatch(read(file), /cvpic|CvPic|cv-pictures|CV pictures/i, `${file} still mentions CV pictures`);
  }
  const worker = read('Cloudflare-worker/worker.js');
  assert.match(worker, /CV pictures are no longer available\."\s*\}, 410/);
  assert.match(worker, /retired: true/);
});

test('footer links point at the Scam Check, not the old CV pictures section', () => {
  for (const file of ['1-province-hub.html', '2-vacancy.html', '3-agency.html', '4-contact.html', '5-post-a-job.html']) {
    assert.match(read(file), /<a href="\/\?section=scam-check">Scam check<\/a>/);
  }
});

test('the Apply now button keeps white text: the global link colour must not reach .vx-btn', () => {
  const mono = read('mono.css');
  assert.ok(!/\.screen-scroll a:not\(\.btn\):not\(\.vac-apply\)/.test(mono), 'a link-colour rule still reaches buttons');
  assert.match(mono, /\.screen-scroll a:not\(\.btn\):not\(\.vx-btn\):not\(\.vac-apply\)/);
  assert.match(mono, /a\.vx-btn--primary,[\s\S]*?\{color:#fff!important/);
});
