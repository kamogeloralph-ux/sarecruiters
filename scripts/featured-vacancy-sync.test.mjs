// Regression guard for removing the dedicated featured-vacancy sections and
// their redundant live query from the public app.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const appDataSrc = read('../app-data.js');
const cardsSrc = read('../app-cards.js');
const appCoreSrc = read('../app-core.js');
const uiSrc = read('../app-ui.js');
const alertsSrc = read('../app-alerts.js');
const vacancyCss = read('../vacancy-v2.css');
const sharedCss = read('../styles.css');
const vacancyRendererSrc = read('../app-vacancy-v2.js');
const indexSrc = read('../index.html');

function functionBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return '';
}

test('dedicated featured-vacancy sections and their extra startup query are removed', () => {
  const home = functionBody(uiSrc, 'renderHomeFeed');
  assert.ok(home, 'the home vacancy renderer must remain present');
  assert.doesNotMatch(home, /Featured vacancies|home-featured-vacancy|featuredMarkup|homeVacancyIsFeatured/);
  assert.match(home, /target\.innerHTML = '[\s\S]*homeVacancySourceMarkup\(\) \+\s*'<section class="home-jobs-section"/);
  assert.match(home, /var rows = matchingRows;/, 'featured listings remain eligible for normal retail-first role ordering');
  assert.match(home, /homeAvailableRolesMarkup\(rows\)/);
  assert.match(home, /onclick="openCommunity\(\)"/, 'the Interview Tips shortcut must remain on the home screen');

  assert.doesNotMatch(uiSrc, /career-featured-section|featured-vacancies-(?:heading|controls|rail|empty)|wireFeaturedRailGestures/);
  assert.doesNotMatch(sharedCss, /featured-vacancies-(?:heading|controls|rail|empty)|home-featured-vacancy/);
  assert.doesNotMatch(appDataSrc, /loadFeaturedVacancies|featuredVacanciesCache|featured_vacancies/);
  assert.doesNotMatch(appCoreSrc, /featuredVacanciesCache/);
});

test('vacancy overview shows all eight sources before retail-prioritized roles', () => {
  const summaryStart = vacancyRendererSrc.indexOf('function sourceSummary()');
  const summaryEnd = vacancyRendererSrc.indexOf('function renderOverview()', summaryStart);
  const summary = vacancyRendererSrc.slice(summaryStart, summaryEnd);
  const orderMatch = summary.match(/order: \[([^\]]+)\]/);
  assert.ok(orderMatch, 'the shared source summary must define the source order');
  assert.equal(orderMatch[1].split(',').length, 8, 'the overview must offer exactly eight sources');

  const start = vacancyRendererSrc.indexOf('function renderOverview()');
  const end = vacancyRendererSrc.indexOf('/* ---------- folder post-processing', start);
  const overview = vacancyRendererSrc.slice(start, end);
  const sourcesAt = overview.indexOf('vx-source-section');
  const rolesAt = overview.indexOf('vx-available-roles');
  assert.ok(rolesAt >= 0 && sourcesAt >= 0, 'the overview must contain the source grid and available roles');
  assert.match(overview, /html \+= sourcesMarkup \+ rolesMarkup;/, 'the eight source tiles must be rendered before available roles');
  assert.match(overview, /window\.ensureRetailPriorityVacancies\(\)/, 'the overview must load retail rows for prioritization');
  assert.match(overview, /isRetailPriorityVacancy/, 'retail roles must be sorted ahead of other roles');
  assert.match(vacancyRendererSrc, /window\.retailPriorityPreviewRows/);
  assert.match(overview, /Browse jobs by source/);
  assert.match(overview, /Available roles/);
  assert.match(overview, /list\.slice\(0, 24\)\.map\(function \(v\) \{ return card\(v, agencyOf\(v\)\); \}\)/, 'available vacancy cards must remain visible in the first overview section');
  assert.doesNotMatch(overview, /Featured vacancies|vx-rail/, 'the vacancy overview must not render a featured rail');

  assert.match(vacancyCss, /\.vx-sources\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'mobile source cards must use a compact two-column grid');
  assert.match(vacancyCss, /\.vx-source\{display:flex;align-items:center/, 'source cards must use a clean compact row layout');
  assert.match(vacancyCss, /@media \(min-width:720px\)[\s\S]*?\.vx-sources\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, 'desktop source cards must use four columns');
  assert.match(vacancyRendererSrc, /class="vx-preview"/, 'vacancy summaries should expose a short job-description preview');
  assert.match(vacancyRendererSrc, /class="vx-inline-apply"/, 'vacancies with a direct route should expose an apply action in the summary');
  assert.match(vacancyCss, /\.vx-org\{order:0/);
  assert.match(vacancyCss, /\.vx-inline-apply\{display:inline-flex/);
  assert.match(sharedCss, /#screen-allagencies #allagencies-list \.hub-summary/, 'agency typography and spacing should be scoped to the agency directory');
  assert.match(indexSrc, /styles\.css\?v=[^"]+/, 'the shared stylesheet cache key must be refreshed');
  assert.match(indexSrc, /vacancy-v2\.css\?v=vx-scan-2/, 'the vacancy stylesheet cache key must be refreshed');
  assert.match(indexSrc, /app-vacancy-v2\.js\?v=vx-retail-3/, 'the vacancy renderer cache key must be refreshed');
  assert.match(indexSrc, /app-alerts\.js\?v=al-4/, 'the saved-search CTA script cache key must be refreshed');
});

test('Home renders one deterministic daily featured vacancy poster', () => {
  assert.match(uiSrc, /function getDailyFeaturedPoster\(posters\)/);
  assert.match(uiSrc, /function renderHomeFeaturedPoster\(posters\)/);
  assert.match(uiSrc, /home-featured-poster-slot/);
  assert.match(uiSrc, /Date\.UTC\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\)/);
  assert.match(cardsSrc, /renderHomeFeaturedPoster\(posters\)/);
  assert.match(uiSrc, /id=\"home-featured-poster-slot\"/);
});

test('all vacancy filters are wired to the overview and folder render paths', () => {
  for (const id of ['allvacancies-search', 'allvacancies-location', 'allvacancies-industry', 'allvacancies-remote', 'allvacancies-exp', 'vx-posted', 'allvacancies-sort', 'vx-filter-toggle', 'vacancy-clear-filters']) {
    assert.match(indexSrc, new RegExp('id="' + id + '"'), id + ' control must exist');
  }
  for (const chip of ['fresh', 'remote', 'salary', 'saved', 'near']) {
    assert.match(indexSrc, new RegExp('data-vx="' + chip + '"'), chip + ' quick filter must exist');
  }
  assert.match(vacancyRendererSrc, /function matchesWorkMode\(/);
  assert.match(vacancyRendererSrc, /function matchesExperience\(/);
  assert.match(vacancyRendererSrc, /function postedWithin\(/);
  assert.match(vacancyRendererSrc, /if \(S\.salary && !hasSalary\(v\)\)/);
  assert.match(vacancyRendererSrc, /if \(S\.saved && !savedSet\.has\(v\.id\)\)/);
  assert.match(vacancyRendererSrc, /S\.sort === 'closing'/);
  assert.match(vacancyRendererSrc, /data-vxview/);
  assert.match(uiSrc, /remote\|telecommute\|work\[ -\]\?from\[ -\]\?home/);
  assert.match(uiSrc, /expFilter === 'entry'/);
});

test('the saved-search CTA is the modern card, not a bare emoji button', () => {
  assert.match(alertsSrc, /className = 'sa-alert-cta'/, 'app-alerts.js must use the sa-alert-cta class');
  assert.match(alertsSrc, /list\.appendChild\(b\)/, 'the CTA must stay below the source-first overview');
  assert.match(alertsSrc, /sa-alert-cta-icon/, 'the CTA must render an icon badge');
  assert.match(alertsSrc, /sa-alert-cta-title[^]*Email me new jobs/, 'the CTA must render a titled label');
  assert.doesNotMatch(alertsSrc, /className = 'vx-more'/, 'the CTA must not reuse the plain load-more button class');
});

test('vacancy-v2.css styles the saved-search CTA for both themes', () => {
  assert.match(vacancyCss, /\.sa-alert-cta\{/);
  assert.match(vacancyCss, /\.sa-alert-cta-icon\{/);
  assert.match(vacancyCss, /\.sa-alert-cta:focus-visible/);
});
