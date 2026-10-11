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

test('live public endpoints bypass snapshot and edge caches on fresh requests', () => {
  assert.match(worker, /const forceFresh = requestUrl\.searchParams\.get\("fresh"\) === "1"/);
  assert.match(worker, /refreshAndCache\(true\)/);
  assert.match(worker, /source: "supabase-live"/);
  assert.match(worker, /Live poster data unavailable/);
  assert.match(worker, /Live vacancy data unavailable/);
});

test('admin vacancy UI reads live authenticated Supabase pages and retains a Worker fallback', () => {
  const start = admin.indexOf('async function getVacancies()');
  const end = admin.indexOf('async function getAdminSubmissions()', start);
  assert.ok(start >= 0 && end > start);
  const loader = admin.slice(start, end);
  assert.match(loader, /supabaseClient\.from\('vacancies'\)/);
  assert.match(loader, /\.range\(page \* 1000/);
  assert.match(loader, /\/api\/admin\/vacancies/);
});

test('public and admin clients subscribe to database changes for immediate refreshes', () => {
  assert.match(appData, /sa-recruiters-public-live/);
  assert.match(appData, /table: 'employer_posters'/);
  assert.match(appData, /loadAll\(\{ fresh: true \}\)/);
  assert.match(admin, /sa-recruiters-admin-live/);
  assert.match(admin, /function scheduleAdminRealtimeRefresh/);
});

test('public app-data has no Supabase table reads or public pool fallback', () => {
  assert.doesNotMatch(appData, /supabaseClient\.from\(['"](?:agencies|employers|branches|vacancies|app_settings|house_ads|posters|pool_candidates_public)['"]\)\s*\.select/);
  assert.doesNotMatch(appData, /Resilience fallback for a temporary Worker\/D1 outage/);
  assert.match(appData, /startup = await getStartupData\(\)/);
});
