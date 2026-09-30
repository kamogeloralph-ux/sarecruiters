import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scriptTags = html.match(/<script\b[^>]*>/g) || [];

test('no third-party CDN script is fetched for Supabase', () => {
  assert.ok(!/unpkg\.com/.test(html), 'unpkg.com must not be referenced from index.html');
  assert.ok(scriptTags.some((t) => /src="vendor\/supabase\.min\.js\?v=[^"]*"/.test(t) && /\bdefer\b/.test(t)), 'self-hosted supabase bundle with defer');
});

test('Turnstile is deferred (not async) and queued after the app bundle', () => {
  const ts = scriptTags.find((t) => /challenges\.cloudflare\.com\/turnstile/.test(t));
  assert.ok(ts && /\bdefer\b/.test(ts) && !/\basync\b/.test(ts));
  assert.ok(html.indexOf('challenges.cloudflare.com/turnstile') > html.indexOf('app.bundle.min.js'));
});

test('live chat is not in the initial HTML as a static script tag', () => {
  assert.ok(!scriptTags.some((t) => /src="https:\/\/cdn\.pulse\.is/.test(t)));
  assert.ok(/createElement\('script'\)[\s\S]{0,200}cdn\.pulse\.is\/livechat\/loader\.js/.test(html));
});

test('FAQ/content scripts are lazy (prefetch only) on the landing page', () => {
  assert.ok(!scriptTags.some((t) => /src="content(-manager)?\.js/.test(t)));
  assert.ok(/<link rel="prefetch" as="script" href="content\.js\?v=/.test(html));
  assert.ok(/window\.openContentSheet=stub/.test(html));
});

test('LCP logo is preloaded as webp and the snapshot download starts at parse time', () => {
  assert.ok(/<link rel="preload" as="image" href="icons\/logo-152\.webp"[^>]*fetchpriority="high"/.test(html));
  assert.ok(/window\.__saStartupEarly=fetch\('data\/startup\.json'/.test(html));
  for (const f of ['icons/logo-152.webp', 'icons/logo-96.webp', 'icons/menu-logo-100.webp']) assert.ok(fs.existsSync(new URL('../' + f, import.meta.url)), f);
});

test('render-blocking stylesheets are swapped in asynchronously', () => {
  const withoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const links = withoutNoscript.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || [];
  const blocking = links.filter((l) => !/media="print"/.test(l));
  assert.deepEqual(blocking, [], 'stylesheets that would block first paint');
});

test('below-the-fold images in index.html are lazy + async-decoded', () => {
  const imgs = (html.match(/<img\b[^>]*src="[^"]+"[^>]*>/g) || []).filter((t) => !/fetchpriority="high"/.test(t));
  for (const t of imgs) assert.ok(/loading="lazy"/.test(t) && /decoding="async"/.test(t), t.slice(0, 90));
});

test('logos ship a WebP srcset and are never lazy', () => {
  const hdr = html.match(/<img class="logo-svg"[^>]*>/)[0];
  assert.ok(/srcset="icons\/logo-96\.webp 96w, icons\/logo-152\.webp 152w"/.test(hdr) && /sizes="42px"/.test(hdr));
  assert.ok(!/loading="lazy"/.test(hdr) && /fetchpriority="high"/.test(hdr));
});

test('metric-matched fallback font is defined and used, and Google Fonts uses display=swap', () => {
  assert.ok(/font-family:'Inter Fallback'[^}]*font-display:swap/.test(html));
  assert.ok(/family=Inter:[^"]*display=swap/.test(html));
  assert.ok(/'Inter','Inter Fallback'/.test(fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8')));
});

test('supabase + upload origins are preconnected', () => {
  assert.ok(/<link rel="preconnect" href="https:\/\/ythznnktswgymerdcxky\.supabase\.co">/.test(html));
});

test('startup snapshot is lean and points at the deferred notes file', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../data/startup.json', import.meta.url), 'utf8'));
  assert.equal(d.notes_url, 'data/vacancy-notes.json');
  assert.ok(d.vacancies.every((v) => !v.notes));
  const notes = JSON.parse(fs.readFileSync(new URL('../data/vacancy-notes.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(notes).length > 0);
});
