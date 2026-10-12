import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');

test('admin vacancies are served by an authenticated D1 cursor endpoint', () => {
  assert.match(worker, /async function adminVacanciesResponse\(request, env, origin\)/);
  assert.match(worker, /if \(!await isAdminRequest\(request, env\)\) return json\(\{ error: "Unauthorized" \}/);
  assert.match(worker, /path === "\/api\/admin\/vacancies" && request\.method === "GET"/);
  assert.match(worker, /ORDER BY created_at DESC, id DESC LIMIT \?/);
  assert.match(worker, /created_at < \? OR \(created_at = \? AND id < \?\)/);
  for (const filter of ['q', 'location', 'source', 'agencyId', 'employerId', 'remote', 'experience']) {
    assert.match(worker, new RegExp(`const ${filter} =`), filter);
  }
  assert.match(worker, /include_expired/);
  assert.match(worker, /nextCursor/);
});

test('admin vacancy reads tolerate D1 mirrors without optional featured columns', () => {
  const start = worker.indexOf('async function adminVacanciesResponse');
  const end = worker.indexOf('async function syncStatusResponse', start);
  assert.ok(start >= 0 && end > start);
  const handler = worker.slice(start, end);
  assert.match(handler, /PRAGMA table_info\(vacancies\)/);
  assert.match(handler, /columns\.push\("is_featured", "featured_until", "featured_order"\)/);
  assert.match(handler, /using base admin columns/);
  assert.doesNotMatch(handler, /const columns = \[[\s\S]*?"source_type", "is_featured"/);
});

test('admin vacancy UI no longer uses Supabase/PostgREST for the bulk list', () => {
  const start = admin.indexOf('async function getVacancies(');
  const end = admin.indexOf('async function getAdminSubmissions(', start);
  assert.ok(start >= 0 && end > start);
  const loader = admin.slice(start, end);
  assert.match(loader, /\/api\/admin\/vacancies/);
  assert.match(loader, /cursor/);
  assert.doesNotMatch(loader, /supabaseClient\.from\(['"]vacancies/);
});

test('admin startup isolates each loader and reports failures instead of blanking the console', () => {
  assert.match(admin, /function runLoad\(key, task, apply\)/);
  assert.match(admin, /runLoad\('agencies', getAgencies/);
  assert.match(admin, /runLoad\('vacancies'/);
  assert.match(admin, /runLoad\('aux', getAdminAuxiliaryData/);
  assert.match(admin, /loadState\[key\] = 'failed'/, 'a failed loader must be marked failed, not silently turned into zero');
  assert.match(admin, /id="load-banner"/, 'failures must be visible with a retry');
  assert.match(admin, /fetchWithTimeout\(R2_WORKER_URL \+ '\/api\/admin\/vacancies/, 'worker requests must time out instead of hanging the dashboard');
});

test('admin agency sheet defines every field the edit and save code reads', () => {
  const start = admin.indexOf('function openAgencySheet(');
  const end = admin.indexOf('async function deleteAgency(', start);
  assert.ok(start >= 0 && end > start);
  const code = admin.slice(start, end);
  const ids = [...new Set([...code.matchAll(/getElementById\('([a-z]-[a-z-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length > 8);
  for (const id of ids) {
    assert.ok(admin.includes(`id="${id}"`), `agency sheet is missing #${id} (the Edit button would crash)`);
  }
});

test('admin console loads no third-party scripts', () => {
  const external = [...admin.matchAll(/<script[^>]+src="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
  assert.deepEqual(external, []);
});

test('public app-data has no Supabase table reads or public pool fallback', () => {
  assert.doesNotMatch(appData, /supabaseClient\.from\(['"](?:agencies|employers|branches|vacancies|app_settings|house_ads|posters|pool_candidates_public)['"]\)\s*\.select/);
  assert.doesNotMatch(appData, /Resilience fallback for a temporary Worker\/D1 outage/);
  assert.match(appData, /startup = await getStartupData\(\)/);
});
