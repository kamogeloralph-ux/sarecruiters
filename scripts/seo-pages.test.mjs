import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generator = readFileSync(new URL('../generate-pages.js', import.meta.url), 'utf8');
const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cards = readFileSync(new URL('../app-cards.js', import.meta.url), 'utf8');
const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');

const pages = ['careers', 'apply', 'contact', 'register', 'candidates', 'about'];

test('generator defines stable crawlable landing pages', () => {
  for (const slug of pages) {
    assert.match(generator, new RegExp(`slug: '${slug}'`));
    assert.match(generator, new RegExp(`\\$\\{SITE_URL\\}/\\$\\{page\\.slug\\}/`));
  }
  assert.match(generator, /SEO_LANDING_PAGES\.forEach/);
  assert.match(generator, /sitemapUrls\.push\(`\$\{SITE_URL\}\/\$\{page\.slug\}\/`\)/);
});

test('static shell exposes the same primary navigation on every generated page', () => {
  for (const slug of pages) {
    assert.match(generator, new RegExp(`href="/${slug}/"`));
  }
  assert.match(generator, /class="sp-nav"/);
  assert.match(generator, /class="sp-footer-links"/);
});

test('homepage exposes normal anchor links for Google discovery', () => {
  for (const slug of pages) {
    assert.match(homepage, new RegExp(`href="${slug}/"`));
  }
  assert.match(homepage, /class="seo-site-footer"/);
  assert.match(homepage, /rel="canonical" href="https:\/\/sa-recruiters\.co\.za\/"/);
  assert.match(homepage, /application\/ld\+json/);
  assert.match(homepage, /"@type": "Organization"/);
  assert.match(homepage, /<h1 class="sr-only">South African recruitment agencies and job vacancies<\/h1>/);
  assert.ok(homepage.indexOf('<footer class="seo-site-footer"') < homepage.indexOf('</body>'));
});

test('landing pages link into existing vacancy and employer journeys', () => {
  assert.match(generator, /\/post-a-job\//);
  assert.match(generator, /\/browse\/category\/remote\//);
  assert.match(generator, /\/browse\/category\/government\//);
  assert.match(generator, /\/browse\/category\/internship\//);
});

test('generated listing output treats database values as untrusted', () => {
  assert.match(generator, /serializeJsonLd/);
  assert.match(generator, /replace\(\/<\//);
  assert.match(generator, /safeHttpUrl\(vacancy\.link\)/);
  assert.match(generator, /applicantLocationRequirements/);
});

test('JobPosting schema supplies validThrough and addressLocality fallbacks', () => {
  assert.match(generator, /SCHEMA_MAX_AGE_DAYS/);
  assert.match(generator, /created\.setUTCDate\(created\.getUTCDate\(\) \+ days\)/);
  assert.match(generator, /addressLocality: inferAddressLocality\(vacancy\.location\)/);
  assert.match(generator, /return 'South Africa';/);
});

test('homepage search debounces keystroke renders', () => {
  assert.match(homepage, /oninput="scheduleCachedSearch\(\)"/);
  assert.match(cards, /function scheduleCachedSearch\(\)/);
  assert.match(cards, /setTimeout\(function\(\)/);
  assert.match(cards, /filterAndRenderCached\(\);/);
});

test('vacancy statistic uses the shared startup count path', () => {
  assert.doesNotMatch(appData, /fetchLiveVacancyTotal/);
  assert.match(appData, /gateVacancyTotal\(payload\.agencies, payload\.vacancies, payload\.counts\)/);
  assert.match(appData, /same edge-cached startup count as the other cards/);
});
