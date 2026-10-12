import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `expected source region ${startMarker}`);
  return source.slice(start, end);
}

test('admin D1 write-through is authenticated, allowlisted, and avoids a second Supabase row read', () => {
  const route = sourceBetween(worker, 'async function adminD1WriteThroughResponse(', '__name(adminD1WriteThroughResponse');
  assert.match(worker, /path === "\/api\/admin\/d1\/write-through" && request\.method === "POST"/);
  assert.match(route, /if \(!await isAdminRequest\(request, env\)\)/);
  assert.match(route, /D1_WRITE_THROUGH_SPECS\[table\]/);
  assert.match(route, /PRAGMA table_info\(\$\{table\}\)/);
  assert.match(route, /prepareD1WriteThroughUpsert\(/);
  assert.match(route, /env\.DB\.batch\(statements\)/);
  assert.match(route, /publicDataVersionBumpStatement\(env\)/);
  assert.doesNotMatch(route, /supabaseGet|supabaseRpc|\/rest\/v1/);
  for (const table of ['agencies', 'branches', 'vacancies', 'employers', 'app_settings', 'employer_posters', 'pool_candidates']) {
    assert.match(worker, new RegExp(`${table}: \\{ key:`));
  }
  assert.match(worker, /This projection deliberately excludes candidate contacts, CV links, and admin fields/);
});

test('the client sends the Supabase mutation representation through the admin Worker route', () => {
  assert.match(appData, /writeThroughD1Mirror\('vacancies', Object\.assign\(\{\}, v, result\.data \|\| \{\}\)\)/);
  assert.match(appData, /writeThroughD1Mirror\('agencies'/);
  assert.match(appData, /writeThroughD1Mirror\('app_settings'/);
  assert.match(appData, /writeThroughD1Mirror\(table, value, operation\)/);
  assert.match(admin, /writeThroughD1Mirror\('vacancies',Object\.assign\(\{\},v,result\.data\|\|\{\}\)\)/);
  assert.match(admin, /writeThroughD1Mirror\('employer_posters',result\.data\)/);
  assert.match(admin, /writeThroughD1Mirror\('pool_candidates'/);
  assert.match(worker, /row\.updated_at = new Date\(\)\.toISOString\(\)/);
});

test('public startup, vacancy and poster reads are versioned and bypass stale snapshots', () => {
  assert.match(worker, /const PUBLIC_DATA_VERSION_KEY = "public_data_version"/);
  assert.match(worker, /ON CONFLICT\(key\) DO UPDATE SET value = CAST\(CAST\(sync_meta\.value AS INTEGER\) \+ 1 AS TEXT\)/);
  assert.match(worker, /featured-vacancies-v11-employer-vacancies&version=\$\{dataVersion\}/);
  assert.match(worker, /employer_id IS NOT NULL OR source_type IS NULL OR source_type NOT IN/);
  assert.match(worker, /snapshot\.data_version\) === dataVersion/);
  assert.match(worker, /schema=d1-v6-versioned&version=\$\{dataVersion\}/);
  assert.match(worker, /data_version: dataVersion/);
  assert.match(worker, /snapshotFresh = !!\(snapshot && \(snapshotHasVersion \? Number\(snapshot\.data_version\) === dataVersion/);
  assert.match(worker, /SELECT \$\{columns\.join\(","\)\} FROM vacancies WHERE/);
  assert.match(worker, /Cache-Control", "no-store"/);
  const startup = sourceBetween(worker, 'async function startupResponse(', '__name(startupResponse');
  assert.match(startup, /loadStartupDataFromD1\(env\)/);
  assert.doesNotMatch(startup, /syncD1FromSupabase|syncD1AndPublishSnapshot/);
  const vacancyPage = sourceBetween(worker, 'async function vacanciesResponse(', '__name(vacanciesResponse');
  assert.doesNotMatch(vacancyPage, /syncD1FromSupabase|syncD1AndPublishSnapshot/);
  assert.match(vacancyPage, /__schema", "d1-v2-versioned"/);
  assert.match(vacancyPage, /await cache\.put\(cacheKey, response\.clone\(\)\)/);
});

test('browser boot prefers versioned Worker data, keeps static fallback, and vacancy pages try Worker first', () => {
  const startup = sourceBetween(appData, 'async function fetchStartupDataOnce()', '// ----- Deferred job descriptions -----');
  assert.ok(startup.indexOf("startupDataSource = 'worker'") < startup.indexOf("if (staticDataEnabled)"));
  const vacancyPage = sourceBetween(appData, 'async function fetchVacancyPageFromWorker(', 'async function fetchGeneralVacancyPage(');
  assert.ok(vacancyPage.indexOf("'/api/vacancies'") < vacancyPage.indexOf('if (window.__saStaticData)'));
  assert.match(html, /window\.__saStartupEarly=fetch\('https:\/\/sarecruiters-uploader\.kamogeloralph\.workers\.dev\/api\/startup',\{method:'GET',cache:'no-store'/);
  assert.match(appData, /startupDataSource = 'static'/);
});
