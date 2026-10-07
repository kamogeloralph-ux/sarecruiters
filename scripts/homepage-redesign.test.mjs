import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const ui = read('app-ui.js');
const cards = read('app-cards.js');
const sheets = read('app-sheets.js');
const vacancyV2 = read('app-vacancy-v2.js');
const css = read('styles.css');
const vacancyCss = read('vacancy-v2.css');

test('home replaces the direct agency feed with the job-search feed while retaining all five metric routes', () => {
  assert.match(html, /id="home-feed"/);
  assert.doesNotMatch(html, /id="hub-list"/);
  assert.match(html, /<h1 class="sr-only">South African recruitment agencies and job vacancies<\/h1>/);
  assert.match(html, /Job title, skill, company, or location/);
  for (const id of ['stat-agencies', 'stat-posters', 'stat-vacancies', 'stat-employers', 'stat-pool']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /onclick="showAllAgencies\(\)"/);
  assert.doesNotMatch(html, /Browse jobs by province|home-province-section|home-province-links/);
});

test('location filters and category shortcuts feed real vacancy results', () => {
  const provinces = ['gauteng', 'western-cape', 'kwazulu-natal', 'eastern-cape', 'free-state', 'limpopo', 'mpumalanga', 'north-west', 'northern-cape'];
  for (const location of [...provinces, 'remote']) {
    if (location === 'remote') assert.match(html, /data-home-location="remote"/);
    else assert.match(html, new RegExp(`<a class="home-filter-chip" href="/jobs/${location}/" aria-label="View [^"]+ public job listings">`));
  }
  assert.equal((html.match(/<a class="home-filter-chip" href="\/jobs\/(?:gauteng|western-cape|kwazulu-natal|eastern-cape|free-state|limpopo|mpumalanga|north-west|northern-cape)\/"/g) || []).length, 9);
  assert.match(ui, /querySelectorAll\('\.home-filter-chip\[data-home-location\]'\)/);
  assert.match(ui, /function setHomeLocationFilter\(/);
  assert.match(ui, /function homeVacancyMatchesLocation\(/);
  assert.match(ui, /function setHomeCategoryFilter\(/);
  assert.match(ui, /function homeVacancyMatchesCategory\(/);
  assert.match(ui, /function homeSourceVacancies\(/);
  assert.match(ui, /function renderHomeFeed\(/);
});

test('the homepage shows all eight source cards before retail-first roles', () => {
  assert.match(ui, /HOME_VACANCY_CARD_LIMIT = 8/);
  const homeRender = ui.slice(ui.indexOf('function renderHomeFeed()'), ui.indexOf('// Public section links'));
  const sourceMarkupPosition = homeRender.indexOf('homeVacancySourceMarkup()');
  const homeRolesPosition = homeRender.indexOf('home-jobs-section');
  assert.ok(sourceMarkupPosition >= 0 && homeRolesPosition > sourceMarkupPosition, 'source cards must render before available roles');
  assert.match(ui, /function homeVacancySourceMarkup\(\)/);
  assert.match(ui, /window\.vacancySourceSummary\(\)/);
  assert.match(ui, /order\.map\(function \(source\)/);
  assert.match(ui, /class="home-source-grid"/);
  assert.match(ui, /onclick="openVacancyFolder/);
  assert.ok(homeRolesPosition >= 0, 'the eight role cards must remain on the home screen');
  assert.doesNotMatch(homeRender, /Featured vacancies|home-featured|featuredMarkup|wireHomeFeaturedRailGestures/);
  assert.match(homeRender, /rows\.slice\(0, HOME_VACANCY_CARD_LIMIT\)/);
  assert.match(ui, /function ensureRetailPriorityVacancies\(/);
  assert.match(ui, /\.in\('source_type', \['retail'/);
  assert.match(ui, /isRetailPriorityVacancy\(b\)/);
  assert.match(homeRender, /onclick="openCommunity\(\)"/);
  assert.match(ui, /rows\.slice\(0, HOME_VACANCY_CARD_LIMIT\)/);
  assert.match(ui, /vacancyCard\(v, agency, \{ homePreview: true \}\)/);
  const overview = vacancyV2.slice(vacancyV2.indexOf('function renderOverview()'), vacancyV2.indexOf('/* ---------- folder post-processing'));
  const sourcesPosition = overview.indexOf('vx-source-section');
  const rolesPosition = overview.indexOf('vx-available-roles');
  assert.ok(rolesPosition >= 0 && sourcesPosition >= 0, 'the vacancy overview must render both source cards and roles');
  assert.match(overview, /html \+= sourcesMarkup \+ rolesMarkup;/, 'all eight sources must appear before available roles');
  assert.match(vacancyV2, /window\.retailPriorityPreviewRows/);
  assert.match(overview, /isRetailPriorityVacancy/);
  assert.match(overview, /Browse jobs by source/);
  assert.match(overview, /Available roles/);
  assert.doesNotMatch(overview, /Featured vacancies|vx-rail/);
});

test('home vacancy cards expose an application action, and the home search uses the new renderer', () => {
  assert.match(cards, /options\.homePreview/);
  assert.match(cards, /class="home-vacancy-apply"/);
  assert.match(vacancyV2, /if \(o\.homePreview\)/);
  assert.match(vacancyV2, /class="home-vacancy-apply"/);
  assert.match(vacancyV2, /homePreviewMarkup \+/);
  assert.match(html, /app-vacancy-v2\.js\?v=vx-retail-3/);
  assert.match(cards, /if \(typeof renderHomeFeed === 'function'\) \{\s*renderHomeFeed\(\);\s*return;/);
  assert.match(ui, /onclick="openHomeTalentPoolProfile\(\)"/);
  assert.match(ui, /onclick="openGeneralVacancySheet\(\)"/);
  assert.match(ui, /onclick="openPublicPosterSheet\(\)">Post a poster/);
  assert.match(ui, /jw-aluminium-banner\.webp/);
  assert.match(ui, /Feature your company here/);
  assert.match(ui, /function openCompanyFeatureInquiry\(/);
  assert.match(html, /id="sendpulse-feedback-only"/);
  assert.match(html, /body\.sendpulse-feedback-open sp-live-chat/);
  assert.doesNotMatch(html, /body:has\(#screen-home\.active\) sp-live-chat/);
  assert.match(html, /window\.__saStartSendPulse = start/);
  assert.match(html, /var feedbackObserver = null/);
  assert.match(html, /window\.__saSyncFeedbackChat = syncFeedback/);
  assert.equal((sheets.match(/window\.__saSyncFeedbackChat\(\)/g) || []).length, 2);
});

test('responsive styles cover the vacancy cards, categories, sponsored slot, and seeker/employer actions', () => {
  for (const selector of ['.home-source-grid', '.home-source-card', '.home-vacancy-grid', '.home-category-grid', '.home-sponsored', '.home-sponsored-art', '.home-tools-grid']) {
    assert.ok(css.includes(selector), `Missing homepage style: ${selector}`);
  }
  assert.match(css, /\.home-sponsored-art\{[^}]*height:auto/);
  assert.doesNotMatch(css, /home-featured-|featured-vacancies-rail/);
  assert.match(css, /\.home-source-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /#screen-home \.screen-scroll\{container-type:inline-size/);
  assert.match(css, /@container \(min-width:760px\)\{\s*#screen-home \.home-source-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(min-width:760px\)\{[\s\S]*\.home-vacancy-grid\{grid-template-columns:repeat\(2/);
  assert.match(vacancyCss, /\.vx-source\{display:flex;align-items:center/);
});

test('the homepage hero is square and compact, with a smaller search field and tighter spacing', () => {
  assert.match(css, /#screen-home \.screen-fixed\{\s*padding:12px 16px 16px;[\s\S]*?border-radius:0;/);
  assert.match(css, /#screen-home \.screen-fixed header\{padding:0 0 9px\}/);
  assert.match(css, /#screen-home \.search-mini \.search-inner\{height:48px/);
  assert.match(css, /#screen-home \.home-filter-row\{margin-bottom:7px/);
  assert.match(html, /styles\.css\?v=[^"]+/);
});
