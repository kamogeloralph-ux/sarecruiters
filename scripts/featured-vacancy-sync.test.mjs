// Regression guard for the "admin featured a vacancy but it never shows in the
// main app" bug.
//
// The public app paints from the committed static snapshot (data/startup.json)
// when staticDataEnabled is true. loadFeaturedVacancies() used to short-circuit
// on that snapshot — `if (window.__saStaticData) { ...; return; }` — so the
// Featured Vacancies rail stayed frozen on whatever the snapshot captured until
// the next scheduled static-data rebuild (Mon/Fri). An admin ticking "Feature
// this vacancy" writes straight to Supabase, so the change never surfaced.
//
// The fix seeds the rail from the snapshot for instant first paint, then always
// refreshes from the live database and re-renders. These source-level
// assertions catch a regression back to the early return.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const appDataSrc = read('../app-data.js');
const alertsSrc = read('../app-alerts.js');
const vacancyCss = read('../vacancy-v2.css');
const vacancyRendererSrc = read('../app-vacancy-v2.js');
const indexSrc = read('../index.html');

// Extract a top-level function body by name (brace-matched) so the assertions
// can't be satisfied by unrelated code elsewhere in the file.
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

const featuredFn = functionBody(appDataSrc, 'loadFeaturedVacancies');

test('loadFeaturedVacancies exists and is async', () => {
  assert.ok(featuredFn, 'loadFeaturedVacancies must be present in app-data.js');
  assert.match(appDataSrc, /async function loadFeaturedVacancies\(\)/);
});

test('loadFeaturedVacancies no longer early-returns the static snapshot', () => {
  assert.ok(featuredFn, 'loadFeaturedVacancies must be present');
  const returns = (featuredFn.match(/return featuredVacanciesCache;/g) || []).length;
  assert.equal(
    returns,
    1,
    'there must be exactly one return (at the end), not an early return right after the static seed'
  );
  const liveReadAt = featuredFn.indexOf(".from('vacancies')");
  const returnAt = featuredFn.indexOf('return featuredVacanciesCache;');
  assert.ok(
    liveReadAt > -1 && returnAt > liveReadAt,
    'the live Supabase read must run before returning (even when the snapshot is enabled)'
  );
});

test('loadFeaturedVacancies seeds from the snapshot, then refreshes live and re-renders', () => {
  assert.ok(featuredFn, 'loadFeaturedVacancies must be present');
  // Instant first paint from the committed snapshot…
  assert.match(
    featuredFn,
    /if \(window\.__saStaticData\) \{\s*featuredVacanciesCache = filterExpiredVacancies\(window\.__saStaticData\.featured_vacancies \|\| \[\]\);/,
    'the snapshot must still seed the cache for instant paint'
  );
  // …then the authoritative live read (featured = true, ordered)…
  assert.match(featuredFn, /\.eq\('is_featured', true\)/, 'must query is_featured = true');
  assert.match(featuredFn, /\.order\('featured_order'/, 'must honour featured_order');
  // …and a re-render of the rail once it resolves.
  assert.match(
    featuredFn,
    /renderAllVacanciesList\(\)/,
    'must re-render the overview so the freshly loaded featured rows appear'
  );
});

test('vacancy overview shows all eight sources before available roles and removes the featured rail', () => {
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
  assert.ok(sourcesAt >= 0 && rolesAt > sourcesAt, 'the eight sources must appear above available roles');
  assert.match(overview, /Browse jobs by source/);
  assert.match(overview, /Available roles/);
  assert.match(overview, /list\.slice\(0, 24\)\.map\(function \(v\) \{ return card\(v, agencyOf\(v\)\); \}\)/, 'available vacancy cards must remain visible below the sources');
  assert.doesNotMatch(overview, /Featured vacancies|vx-rail/, 'the vacancy overview must not render a featured rail');

  assert.match(vacancyCss, /\.vx-sources\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'mobile source cards must use a compact two-column grid');
  assert.match(vacancyCss, /\.vx-source\{display:flex;align-items:center/, 'source cards must use a clean compact row layout');
  assert.match(vacancyCss, /@media \(min-width:720px\)[\s\S]*?\.vx-sources\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, 'desktop source cards must use four columns');
  assert.match(indexSrc, /vacancy-v2\.css\?v=vx-source-first-1/, 'the vacancy stylesheet cache key must be refreshed');
  assert.match(indexSrc, /app-vacancy-v2\.js\?v=vx-source-first-1/, 'the vacancy renderer cache key must be refreshed');
  assert.match(indexSrc, /app-alerts\.js\?v=al-3/, 'the saved-search CTA script cache key must be refreshed');
});

test('the saved-search CTA is the modern card, not a bare emoji button', () => {
  assert.match(alertsSrc, /className = 'sa-alert-cta'/, 'app-alerts.js must use the sa-alert-cta class');
  assert.match(alertsSrc, /list\.appendChild\(b\)/, 'the alert CTA must stay below the source-first overview');
  assert.match(alertsSrc, /sa-alert-cta-icon/, 'the CTA must render an icon badge');
  assert.match(alertsSrc, /sa-alert-cta-title[^]*Email me new jobs/, 'the CTA must render a titled label');
  assert.doesNotMatch(alertsSrc, /className = 'vx-more'/, 'the CTA must not reuse the plain load-more button class');
});

test('vacancy-v2.css styles the saved-search CTA for both themes', () => {
  assert.match(vacancyCss, /\.sa-alert-cta\{/, 'the CTA base style must exist');
  assert.match(vacancyCss, /\.sa-alert-cta-icon\{/, 'the icon badge style must exist');
  assert.match(vacancyCss, /\.sa-alert-cta:focus-visible/, 'the CTA must keep a visible focus ring');
});
