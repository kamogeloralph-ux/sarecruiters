import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const data = read('app-data.js');
const ui = read('app-ui.js');
const cards = read('app-cards.js');
const sheets = read('app-sheets.js');
const vacancyV2 = read('app-vacancy-v2.js');
const community = read('app-community.js');
const appManagerEmployer = read('app-manager-employer.js');
const css = read('styles.css');
const admin = read('admin.html');
const vacancyCss = read('vacancy-v2.css');
const sw = read('sw.js');
const headers = read('_headers');

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
  for (const location of provinces) {
    assert.match(html, new RegExp(`<a class="home-filter-chip" href="/jobs/${location}/" aria-label="View [^"]+ public job listings">`));
  }
  assert.doesNotMatch(html, /All South Africa/);
  assert.doesNotMatch(html, /data-home-location="remote"/);
  assert.equal((html.match(/<a class="home-filter-chip" href="\/jobs\/(?:gauteng|western-cape|kwazulu-natal|eastern-cape|free-state|limpopo|mpumalanga|north-west|northern-cape)\/"/g) || []).length, 9);
  assert.match(ui, /querySelectorAll\('\.home-filter-chip\[data-home-location\]'\)/);
  assert.match(ui, /function setHomeLocationFilter\(/);
  assert.match(ui, /function homeVacancyMatchesLocation\(/);
  assert.match(ui, /function setHomeCategoryFilter\(/);
  assert.match(ui, /window\.__saNormalizeStartupScreen = normalizeStartupScreen/);
  assert.match(ui, /document\.querySelectorAll\('\.screen'\)\.forEach\(function \(screen\)/, 'startup must normalize the visible screen to Home');
  assert.match(ui, /function homeVacancyMatchesCategory\(/);
  assert.match(ui, /function homeSourceVacancies\(/);
  assert.match(ui, /function renderHomeFeed\(/);
});

test('public retail preview reuses the Pages snapshot and prefers Worker reads over PostgREST', () => {
  assert.match(data, /startupDataSource = 'static'/);
  assert.match(data, /startupDataSource = 'worker'/);
  const retailLoader = ui.slice(ui.indexOf('function ensureRetailPriorityVacancies()'), ui.indexOf('window.ensureRetailPriorityVacancies'));
  assert.match(retailLoader, /startupDataSource === 'static'/);
  assert.match(retailLoader, /fetchVacancyPageFromWorker\(\{ source: retailSources\.join\(','\), limit: 50 \}\)/);
  const workerReadPosition = retailLoader.indexOf('var workerRead =');
  const postgrestFallbackPosition = retailLoader.indexOf('return readRetailFromPostgrest();');
  assert.ok(workerReadPosition >= 0 && postgrestFallbackPosition > workerReadPosition,
    'the D1-backed Worker read must be attempted before any PostgREST fallback');
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
  assert.match(ui, /\.in\('source_type', retailSources\)/);

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
  assert.match(ui, /house-ad-home-middle/);
  assert.match(ui, /showAllVacancies\('home'\)/);
  assert.doesNotMatch(html, /house-ad-home-top/);
  assert.match(html, /house-ad-home-bottom/);
  assert.doesNotMatch(data, /house-ad-home-top/);
  assert.match(data, /renderHouseAdSlot\('house-ad-home-middle', 'home', 'middle'\)/);
  assert.match(data, /renderHouseAdSlot\('house-ad-home-bottom', 'home', 'bottom'\)/);
  assert.match(admin, /value="home"/);
  assert.match(admin, /option value="middle"/);
  assert.match(html, /id="sendpulse-feedback-only"/);
  assert.match(html, /body\.sendpulse-feedback-open sp-live-chat/);
  assert.doesNotMatch(html, /body:has\(#screen-home\.active\) sp-live-chat/);
  assert.match(html, /window\.__saStartSendPulse = start/);
  assert.match(html, /var feedbackObserver = null/);
  assert.match(html, /window\.__saSyncFeedbackChat = syncFeedback/);
  assert.equal((sheets.match(/window\.__saSyncFeedbackChat\(\)/g) || []).length, 2);
});

test('bottom navigation keeps Interview Tips chat separate from Feedback', () => {
  const nav = html.slice(html.indexOf('<nav class="bottom-nav">'), html.indexOf('</nav>', html.indexOf('<nav class="bottom-nav">')));
  assert.match(nav, /id="nav-suggest"[^>]*onclick="openSuggestionSheet\(\)"[^>]*aria-label="Suggest or comment"/);
  assert.match(nav, /id="nav-community"[^>]*onclick="openCommunity\(\)"[^>]*aria-label="Open the Interview Tips community chat"/);
  assert.match(nav, /<span class="navbtn-label">Feedback<\/span>/);
  assert.match(nav, /<span class="navbtn-label">Tips chat<\/span>/);
  assert.match(nav, /id="nav-community"[\s\S]*?<path d="M10 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-1v3l-3-3"/,
    'the community action should use a multi-bubble discussion icon, not Feedback’s single bubble');
  assert.match(community, /screenId === 'screen-community' && button\.id === 'nav-community'/,
    'the dedicated community action should show as active while the community screen is open');
});
test('bottom navigation keeps inactive icons visible and source cards open their folders', () => {
  assert.match(css, /\.bottom-nav \.navbtn:not\(\.active\) svg\{[^}]*stroke:rgba\(255,255,255,\.9\)!important/);
  assert.match(css, /\[data-theme="light"\] \.bottom-nav \.navbtn:not\(\.active\) svg\{stroke:#53657d!important/);
  assert.match(ui, /window\.openVacancyFolder = openVacancyFolder/);
  assert.match(ui, /class="home-source-card" onclick="openVacancyFolder/);
  assert.match(ui, /function openVacancyFolder\(type\) \{[\s\S]*?showAllVacancies\('home'\)/);
});

test('Profile keeps Google sign-in visible for guests and hides it only for signed-in users', () => {
  assert.match(html, /id="account-signin-card"[^>]*aria-hidden="false"/);
  assert.match(html, /id="google-sign-in"[^>]*class="gsi-material-button"/);
  assert.match(ui, /signinCard\.hidden = !isGuest/);
  assert.match(ui, /signinCard\.setAttribute\('aria-hidden', isGuest \? 'false' : 'true'\)/);
  assert.match(ui, /quotaCard\.hidden = !isGuest/);
  assert.match(ui, /signoutGroup\.hidden = isGuest/);
  assert.match(css, /\.account-signin-card\[hidden\][^}]*display:none!important/);
});

test('home conversion sections use the compact Interview Tips card language', () => {
  assert.match(css, /#screen-account \.account-signin-card[\s\S]*?background:linear-gradient\(145deg,#eef6ff/);
  assert.match(css, /#screen-home \.quick-card[\s\S]*?border:1px solid var\(--it-line\)!important/);
  assert.match(css, /#screen-home \.spotlight-mini[\s\S]*?box-shadow:var\(--it-shadow\)!important/);
  assert.match(css, /#screen-home \.home-section-heading h2,[\s\S]*?#screen-home \.hf-head h2\{font-size:17px!important/);
});

test('Home and Menu community entries are labelled Tips Chat and use the chat icon', () => {
  assert.match(ui, /<h2 id="home-community-title">Tips Chat<\/h2>/);
  assert.match(html, /onclick="openCommunity\(\)"[^>]*>.*?Tips Chat/s);
  assert.match(ui, /home-community-icon[^>]*aria-hidden="true"><svg[^>]*>[\s\S]*?<path d="M10 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-1v3l-3-3"/);
  assert.match(html, /onclick="openCommunity\(\)"[^>]*>.*?<svg[^>]*>[\s\S]*?<path d="M10 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-1v3l-3-3"[\s\S]*?Tips Chat/s);
  assert.match(css, /\.home-community-icon svg\{width:21px;height:21px/);
});

test('Home Media uses the managed YouTube setting and admin keeps Track of the Day controls', () => {
  assert.match(ui, /id="home-media-section"/);
  assert.match(ui, /id="home-media-video"/);
  assert.match(ui, /https:\/\/www\.youtube\.com\/embed\/HV64XG91tE4\?rel=0/);
  assert.match(data, /media_youtube_url/);
  assert.match(data, /function youtubeEmbedUrl\(value\)/);
  assert.match(css, /\.home-media-section\{/);
  assert.match(admin, /id="sec-media"/);
  assert.match(admin, />Media<\/h2>/);
  assert.match(admin, /id="media-youtube-url"/);
  assert.match(admin, /function saveMediaYoutubeUrl\(\)/);
  assert.match(admin, /setAppSetting\('media_youtube_url'/);
  assert.match(admin, /Track of the Day/);
  assert.match(ui, /id="home-media-track-play"/);
  assert.match(ui, /onclick="toggleTrackPlay\(\)"/);
  assert.match(data, /function updateTrackPlayButtons\(\)/);
  assert.match(data, /home-media-track-title/);
  assert.match(ui, /id="track-audio"/);
  assert.doesNotMatch(html, /id="track-card"/);
  assert.doesNotMatch(ui, /function handleTrackCardKeydown\(event\)/);
});

test('production PWA worker provides a cached shell, offline fallback, and safe updates', () => {
  assert.match(sw, /const CACHE_NAME = VERSION \+ '-runtime'/);
  assert.match(sw, /\/offline\.html/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /networkFirst\(request, '\/'\)/);
  assert.match(sw, /caches\.match\('\/offline\.html'\)/);
  assert.match(sw, /request\.destination\)/);
  assert.match(sw, /event\.data\.type === 'SKIP_WAITING'/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.doesNotMatch(sw, /self\.registration\.unregister\(\)/);
  assert.match(appManagerEmployer, /navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)/);
  assert.match(appManagerEmployer, /registration\.addEventListener\('updatefound'/);
  assert.match(ui, /registration\.waiting\.postMessage\(\{ type: 'SKIP_WAITING' \}\)/);
  assert.match(html, /href="manifest\.json"/);
  assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/);
  assert.doesNotThrow(() => read('offline.html'), 'offline fallback must ship');
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

test('Home navigation returns locally without refreshing data, and the hero uses square corners', () => {
  assert.match(ui, /function refreshHome\(\)\s*\{[\s\S]*?goBackToHome\(\)/);
  const refreshBody = ui.slice(ui.indexOf('function refreshHome()'), ui.indexOf('// ===== Toast'));
  assert.doesNotMatch(refreshBody, /loadAll\(\{ fresh: true \}\)/);
  assert.match(css, /#screen-home \.screen-fixed,#screen-menu \.menu-hero\{border-radius:0!important/);
  assert.match(css, /#screen-home \.site-menu-trigger\{background:transparent!important/);
});

test('Home is one continuous scroll surface with founder and legal footer information', () => {
  assert.match(css, /#screen-home\{overflow-y:auto/);
  assert.match(css, /#screen-home\{overflow-y:auto[^}]*overscroll-behavior-y:auto/);
  assert.match(css, /\.app:has\(#screen-home\.active\)\{height:auto;min-height:100vh;overflow:visible\}/);
  assert.match(css, /#screen-home \.screen-scroll\{flex:0 0 auto;overflow:visible/);
  assert.match(html, /class="home-site-footer"/);
  assert.match(html, /founded by Ralph Kamogelo Chiloane/);
  assert.match(html, /href="\/privacy\/"/);
  assert.match(html, /href="\/terms\/"/);
});

test('Home includes the Talent Pool Spotlight section with live candidate loading', () => {
  assert.match(ui, /id="home-candidate-spotlight-deck"/);
  assert.match(ui, /id="home-spotlight-title"[^>]*>Meet our candidates/);
  assert.match(ui, /typeof loadCandidateSpotlight === 'function'\) loadCandidateSpotlight\(\)/);
  assert.match(data, /home-candidate-spotlight-deck/);
  assert.match(data, /candidateSpotlightList = list\.slice\(0, 10\);/);
  assert.match(css, /#screen-home \.spotlight-mini/);
});

test('Talent Pool Spotlight does not get stuck loading after Home re-renders', () => {
  assert.match(data, /var candidateSpotlightList = \[\];/);
  assert.match(data, /if \(candidateSpotlightLoaded\) \{[\s\S]*renderCandidateSpotlight\(candidateSpotlightList, menuTarget, homeTarget\)/);
  assert.match(data, /candidateSpotlightList = list\.slice\(0, 10\);/);
  assert.match(data, /candidateSpotlightLoaded = true;/);
});
