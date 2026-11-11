// The HTML5 ad builders live in house-ad-html5.js (the app bundle) and, as a copy, in
// public-ads.js (static pages, a classic script). This test keeps the two identical and
// checks the generated documents are well-formed and safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esm = fs.readFileSync(path.join(root, 'house-ad-html5.js'), 'utf8');
const pub = fs.readFileSync(path.join(root, 'public-ads.js'), 'utf8');
const region = (src) => {
  const a = src.indexOf('/* @house-ad-docs:start */'), b = src.indexOf('/* @house-ad-docs:end */');
  assert.ok(a > -1 && b > a, 'markers missing');
  return src.slice(a + 26, b).replace(/^export function/gm, 'function').replace(/^\s+/gm, '').trim();
};

test('public-ads.js carries an identical copy of the ad builders', () => {
  assert.equal(region(pub), region(esm));
});

const mod = await import(path.join(root, 'house-ad-html5.js'));
const hostile = { id: 'x', advertiser_name: 'A <b>&"\'', title: '</h1><script>alert(1)</script>', message: '"><img src=x onerror=alert(1)>', ad_format: 'card' };

test('card document escapes every field and has the ad.size marker', () => {
  const doc = mod.buildHouseAdCardDocument(hostile, 'https://x.test/l.png?a=1&b="2"');
  assert.match(doc, /name="ad\.size"/);
  assert.ok(!/<script>alert/.test(doc) && !/<img src=x/.test(doc));
  assert.equal((doc.match(/<script>/g) || []).length, 1, 'only the built-in fit script');
  assert.ok(doc.includes('&lt;/h1&gt;&lt;script&gt;'));
});

test('card without a tagline has no tagline element; details become chips; single script', () => {
  const doc = mod.buildHouseAdCardDocument({ title: 'Hi', advertiser_name: 'Co', message: '', ad_details: '071 553 1005\nexample.co.za' }, 'https://x.test/l.png');
  assert.ok(!doc.includes('class="tag"'));
  assert.ok(doc.includes('class="chip'));
  assert.ok(doc.includes('071 553 1005'));
  assert.equal((doc.match(/<script>/g) || []).length, 1);
});

test('image document never crops and escapes the URL', () => {
  const doc = mod.buildHouseAdImageDocument('https://x.test/a.png?x="><script>1</script>');
  assert.match(doc, /object-fit:contain/);
  assert.ok(!doc.includes('"><script>1'));
});

test('kind detection', () => {
  assert.equal(mod.houseAdKind({}, 'https://x.test/a-1200x400.html'), 'html5');
  assert.equal(mod.houseAdKind({}, 'https://x.test/a.html?v=2'), 'html5');
  assert.equal(mod.houseAdKind({ ad_format: 'card' }, 'https://x.test/logo.png'), 'card');
  assert.equal(mod.houseAdKind({}, 'https://x.test/a.png'), 'image');
});
