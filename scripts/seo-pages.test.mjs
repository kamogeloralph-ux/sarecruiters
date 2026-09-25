import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generator = readFileSync(new URL('../generate-pages.js', import.meta.url), 'utf8');
const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cards = readFileSync(new URL('../app-cards.js', import.meta.url), 'utf8');
const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../privacy/index.html', import.meta.url), 'utf8');
const legacyPrivacy = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
const faq = readFileSync(new URL('../faq/index.html', import.meta.url), 'utf8');
const terms = readFileSync(new URL('../terms/index.html', import.meta.url), 'utf8');
const rights = readFileSync(new URL('../know-your-rights/index.html', import.meta.url), 'utf8');
const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const contentManager = readFileSync(new URL('../content-manager.js', import.meta.url), 'utf8');
const appForms = readFileSync(new URL('../app-forms.js', import.meta.url), 'utf8');
const appUi = readFileSync(new URL('../app-ui.js', import.meta.url), 'utf8');
const appCore = readFileSync(new URL('../app-core.js', import.meta.url), 'utf8');
const appManagerEmployer = readFileSync(new URL('../app-manager-employer.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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

test('About page contains original SA Recruiters information sections', () => {
  assert.match(generator, /A better way to start your job search/);
  assert.match(generator, /For employers and hiring teams/);
  assert.match(generator, /For candidates/);
  assert.match(generator, /Quality, clarity and responsible browsing/);
  assert.match(generator, /page\.about \? 'AboutPage' : 'WebPage'/);
  assert.match(generator, /class="about-section"/);
});

test('privacy policy matches the guest app and current data providers', () => {
  assert.match(privacy, /you can browse public listings as a guest/i);
  assert.match(privacy, /IndexedDB/);
  assert.match(privacy, /Google sign-in/);
  assert.match(privacy, /Talent Pool/);
  assert.match(privacy, /Cloudflare/);
  assert.match(privacy, /BigDataCloud/);
  assert.match(privacy, /Resend/);
  assert.match(privacy, /Ask us to access, correct or delete/i);
  assert.match(privacy, /Last updated: 25 September 2026/);
  assert.match(privacy, /canonical.*privacy\//i);
  assert.match(legacyPrivacy, /location\.replace\('\/privacy\/'\)/);
});

test('FAQ and privacy are crawlable HTML routes', () => {
  assert.match(faq, /<h1>Frequently Asked Questions<\/h1>/);
  assert.match(faq, /Does the app work offline\?/);
  assert.match(faq, /href="\/privacy\/"/);
  assert.match(generator, /SITE_URL}\/privacy\//);
  assert.match(generator, /SITE_URL}\/faq\//);
});

test('Know Your Rights is a crawlable HTML resource page', () => {
  assert.match(rights, /<h1>Know Your Rights<\/h1>/);
  assert.match(rights, /Basic Conditions of Employment Act/);
  assert.match(rights, /Unemployment Insurance Fund/);
  assert.match(rights, /CCMA/);
  assert.match(homepage, /window.open\('\/know-your-rights\/',?'_blank',?'noopener'\)/);
  assert.match(generator, /SITE_URL}\/know-your-rights\//);
});

test('Terms page shares the standard legal-page visual system', () => {
  assert.match(terms, /<h1>Terms and Conditions<\/h1>/);
  assert.match(terms, /background:#0e1214/);
  assert.match(terms, /canonical.*terms\//i);
  assert.match(terms, /href="\/privacy\/">Privacy Policy/);
});

test('FAQ gives original safety, offline, Talent Pool and privacy guidance', () => {
  assert.match(content, /South African recruitment directory and jobs platform/);
  assert.match(content, /never pay someone just to apply/);
  assert.match(content, /Offline mode cannot fetch new vacancies/);
  assert.match(content, /What is the Talent Pool\?/);
  assert.match(content, /Privacy Policy/);
  assert.match(contentManager, /official-faq-v2/);
  assert.match(contentManager, /store\.faq = JSON\.parse/);
});

test('Learning Hub includes the official gov.za job-search guide', () => {
  assert.match(content, /lh-govza-finding-job/);
  assert.match(content, /https:\/\/www\.gov\.za\/issues\/finding-job-0/);
  assert.match(contentManager, /official-learning-hub-v1/);
  assert.match(contentManager, /store\['learning-hub'\] = learningArticles/);
});

test('app accent tokens are derived from the logo palette', () => {
  assert.match(styles, /--brand-blue:\s*#0b348a/);
  assert.match(styles, /--brand-green:\s*#007a5e/);
  assert.match(styles, /--brand-red:\s*#e52420/);
  assert.match(styles, /--brand-gold:\s*#f5b400/);
  assert.match(styles, /--accent:\s*var\(--brand-blue\)/);
  assert.match(styles, /--success:\s*var\(--brand-green\)/);
  assert.match(styles, /--danger:\s*var\(--brand-red\)/);
});

test('public directory sections expose stable share links and deep-link routing', () => {
  for (const section of ['vacancies', 'agencies', 'candidates', 'posters', 'employers']) {
    assert.match(appUi, new RegExp(section));
  }
  assert.match(appUi, /getSectionLink/);
  assert.match(appUi, /shareSectionLink/);
  assert.match(appUi, /section=' \+ encodeURIComponent\(section\)/);
  assert.match(appUi, /openDeepLinkedSection/);
  assert.match(appUi, /window\.__saRestoredScreen = screenBySection\[section\]/);
  assert.match(appUi, /screenBySection = \{/);
  assert.match(appManagerEmployer, /setTimeout\(openDeepLinkedSection, 120\)/);
  for (const section of ['vacancies', 'agencies', 'candidates', 'posters', 'employers']) {
    assert.ok(homepage.includes(`shareSectionLink('${section}')`), `missing ${section} share control`);
  }
});

test('homepage exposes an About action in the bottom navigation', () => {
  assert.match(homepage, /navbtn-about/);
  assert.match(homepage, /window\.open\('about\/',?'_blank',?'noopener'\)/);
  assert.match(homepage, />About<\/span>/);
});

test('Interview Tips includes the supplied YouTube video for listening', () => {
  assert.match(content, /id: 'iv-video-job-questions'/);
  assert.match(content, /youtube-nocookie\.com\/embed\/XShx_KTJSB8/);
  assert.match(content, /https:\/\/youtu\.be\/XShx_KTJSB8/);
  assert.match(content, /allowfullscreen/);
  assert.match(contentManager, /official-interview-video-v1/);
  assert.match(contentManager, /iv-video-job-questions/);
});

test('CV preparation includes the supplied first-CV video', () => {
  assert.match(content, /id: 'cv-video-first-cv'/);
  assert.match(content, /youtube-nocookie\.com\/embed\/JmWohrRhh-8/);
  assert.match(content, /https:\/\/youtu\.be\/JmWohrRhh-8/);
  assert.match(content, /How to Write Your First CV/);
  assert.match(contentManager, /official-cv-video-v1/);
  assert.match(contentManager, /cv-video-first-cv/);
});

test('vacancy statistic uses the shared startup count path', () => {
  assert.doesNotMatch(appData, /fetchLiveVacancyTotal/);
  assert.doesNotMatch(appData, /loadGateStats\(\);/);
  assert.match(appData, /cachedVacancyTotal/);
  assert.match(appData, /vacancyTotal:/);
});

test('offline launch bypasses network-only startup work', () => {
  assert.match(appData, /if \(navigator\.onLine === false\)/);
  assert.match(homepage, /<script async defer src="https:\/\/challenges\.cloudflare\.com\/turnstile/);
});

test('CV Builder offers selectable templates without regenerating the CV', () => {
  for (const template of ['ats', 'modern', 'graduate', 'trade', 'executive']) {
    assert.match(homepage, new RegExp(`value="${template}"`));
    assert.match(appForms, new RegExp(`${template}: true`));
    assert.match(styles, template === 'ats' ? /\.cvb-preview/ : new RegExp(`cvb-template-${template}`));
  }
  assert.match(homepage, /cvBuilderTemplateChanged/);
  assert.match(appForms, /renderCvBuilderResult\(window\.__cvBuilderLast\)/);
  assert.match(appForms, /template: normaliseCvTemplate/);
  assert.match(appForms, /provider: 'gemini'/);
});
