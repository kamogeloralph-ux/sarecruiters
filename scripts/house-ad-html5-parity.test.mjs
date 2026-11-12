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

test('picture ads have no automatic "Visit <site>" button, only an explicit cta_text', () => {
  const plain = mod.buildHouseAdImageDocument('https://x.test/jw.png', { target_url: 'https://www.jw.org/en/' });
  assert.ok(!/Visit/i.test(plain), 'no Visit text');
  assert.ok(!plain.includes('class="cta"'), 'no button element');
  const withCta = mod.buildHouseAdImageDocument('https://x.test/a.png', { cta_text: 'Join <now>' });
  assert.ok(withCta.includes('class="cta"') && withCta.includes('Join &lt;now&gt;'));
});

test('picture ads open AND close the curtains every cycle', () => {
  const doc = mod.buildHouseAdImageDocument('https://x.test/a.png', {});
  assert.match(doc, /class="hc hcl"/);
  assert.match(doc, /class="hc hcr"/);
  assert.match(doc, /@keyframes hcL\{0%,2%\{transform:none\}9%,86%\{transform:translateX\(-101%\)\}94%,100%\{transform:none\}\}/);
  assert.match(doc, /animation:hcL 11\.00s [^}]*infinite/);
  assert.match(doc, /prefers-reduced-motion/);
});

test('card ads get the same curtain cycle and report their replay length', () => {
  const doc = mod.buildHouseAdCardDocument({ title: 'Hello world', advertiser_name: 'Co', message: 'tag', ad_details: 'a@b.co.za' }, 'https://x.test/l.png');
  assert.match(doc, /class="hc hcl"/);
  assert.match(doc, /name="ad\.cycle" content="\d+\.\d\d"/);
  assert.equal((doc.match(/<script>/g) || []).length, 1, 'curtains add no script');
  assert.ok(!/class="hc/.test(mod.buildHouseAdCardDocument({ title: 'x' }, '', { curtain: false })));
});

test('hand-built HTML5 ads are wrapped with the curtain cycle in every section', () => {
  const src = '<!DOCTYPE html><html><head><meta name="ad.size" content="width=1200,height=400"></head><body><p>ad</p></body></html>';
  const doc = mod.houseAdWithCurtain(src, 12);
  assert.ok(doc.includes('<p>ad</p>') && doc.includes('class="hc hcl"') && doc.includes('name="ad.size"'));
  assert.match(doc, /name="ad\.cycle" content="12\.00"/);
  // Documents with no <head>/<body> tags are still wrapped.
  assert.ok(mod.houseAdWithCurtain('<p>bare</p>', 12).includes('class="hc hcr"'));
});

test('supplier creatives are self-contained HTML5 banners', () => {
  for (const file of ['jw-aluminium-1200x400.html', 'rolaz-electrical-1200x400.html']) {
    const doc = fs.readFileSync(path.join(root, 'assets', 'house-ads', file), 'utf8');
    assert.match(doc, /name="ad\.size" content="width=1200,height=400"/);
    assert.match(doc, /name="ad\.cycle" content="12\.00"/);
    assert.match(doc, /src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    assert.match(doc, /class="hc hcl"/);
    assert.match(doc, /class="hc hcr"/);
    assert.doesNotMatch(doc, /https?:\/\//, `${file} must not depend on an external asset`);
  }
});

test('every ad surface plays the curtain cycle (app slots, Ads list, static pages)', () => {
  const app = fs.readFileSync(path.join(root, 'app-data.js'), 'utf8');
  assert.match(app, /houseAdWithCurtain\(html, 12\)/);
  assert.match(app, /houseAdLoop\(frame, adDoc\)/);
  assert.match(pub, /houseAdWithCurtain\(html, 12\)/);
  assert.match(pub, /houseAdLoop\(htmlFrame, adDoc\)/);
});
