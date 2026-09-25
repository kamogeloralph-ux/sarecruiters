import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generator = readFileSync(new URL('../generate-pages.js', import.meta.url), 'utf8');
const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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
});

test('landing pages link into existing vacancy and employer journeys', () => {
  assert.match(generator, /\/post-a-job\//);
  assert.match(generator, /\/browse\/category\/remote\//);
  assert.match(generator, /\/browse\/category\/government\//);
  assert.match(generator, /\/browse\/category\/internship\//);
});
