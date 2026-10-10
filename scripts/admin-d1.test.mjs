import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');
const deployPages = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
const generatePages = readFileSync(new URL('../generate-pages.js', import.meta.url), 'utf8');

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
  const start = admin.indexOf('async function getVacancies()');
  const end = admin.indexOf('async function getAdminSubmissions()', start);
  assert.ok(start >= 0 && end > start);
  const loader = admin.slice(start, end);
  assert.match(loader, /\/api\/admin\/vacancies/);
  assert.match(loader, /cursor/);
  assert.doesNotMatch(loader, /supabaseClient\.from\(['"]vacancies/);
});

test('admin vacancy list renders its first D1 page immediately and reports later failures', () => {
  const loaderStart = admin.indexOf('async function getVacancies()');
  const loaderEnd = admin.indexOf('async function getAdminSubmissions()', loaderStart);
  const loader = admin.slice(loaderStart, loaderEnd);
  assert.match(loader, /var pageSize = 500/);
  assert.match(loader, /loadRemainingAdminVacancies\(all, authHdr, body\.next_cursor\)/);
  assert.match(loader, /adminVacancyLoadError = e\.message/);
  assert.match(loader, /function retryAdminVacancies\(\)/);

  const renderStart = admin.indexOf('function renderVacancies()');
  const renderEnd = admin.indexOf('function openVacancySheet(', renderStart);
  const renderer = admin.slice(renderStart, renderEnd);
  assert.match(renderer, /Loading vacancies/);
  assert.match(renderer, /Vacancies unavailable/);
  assert.match(renderer, /Retry loading vacancies/);
});

test('admin page changes deploy through Pages and bump the app service-worker version', () => {
  assert.match(deployPages, /^\s+- "admin\.html"$/m);
  assert.match(generatePages, /^\s+'admin\.html',?$/m);
});

test('public app-data has no Supabase table reads or public pool fallback', () => {
  assert.doesNotMatch(appData, /supabaseClient\.from\(['"](?:agencies|employers|branches|vacancies|app_settings|house_ads|posters|pool_candidates_public)['"]\)\s*\.select/);
  assert.doesNotMatch(appData, /Resilience fallback for a temporary Worker\/D1 outage/);
  assert.match(appData, /startup = await getStartupData\(\)/);
});
