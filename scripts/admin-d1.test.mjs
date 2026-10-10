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

test('admin vacancy UI no longer uses Supabase/PostgREST for the bulk list', () => {
  const start = admin.indexOf('async function getVacancies()');
  const end = admin.indexOf('async function getAdminSubmissions()', start);
  assert.ok(start >= 0 && end > start);
  const loader = admin.slice(start, end);
  assert.match(loader, /\/api\/admin\/vacancies/);
  assert.match(loader, /cursor/);
  assert.doesNotMatch(loader, /supabaseClient\.from\(['"]vacancies/);
});

test('public app-data has no Supabase table reads or public pool fallback', () => {
  assert.doesNotMatch(appData, /supabaseClient\.from\(['"](?:agencies|employers|branches|vacancies|app_settings|house_ads|posters|pool_candidates_public)['"]\)\s*\.select/);
  assert.doesNotMatch(appData, /Resilience fallback for a temporary Worker\/D1 outage/);
  assert.match(appData, /startup = await getStartupData\(\)/);
});
