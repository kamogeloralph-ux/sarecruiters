import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../Cloudflare-worker/migrations/0003_d1_sync_indexes.sql', import.meta.url), 'utf8');
const postersMigration = readFileSync(new URL('../Cloudflare-worker/migrations/0004_public_posters.sql', import.meta.url), 'utf8');
const houseAdsMigration = readFileSync(new URL('../Cloudflare-worker/migrations/0008_house_ads.sql', import.meta.url), 'utf8');

test('D1 sync uses batched keyed upserts and stale-key cleanup', () => {
  assert.match(worker, /async function syncD1Table\(/);
  assert.match(worker, /await env\.DB\.batch\(chunk\.map\(/);
  assert.match(worker, /ON CONFLICT\(\$\{conflictColumn\}\) DO UPDATE/);
  assert.match(worker, /IS NOT excluded\./);
  assert.match(worker, /syncD1Table\(env, "app_settings"/);
  assert.doesNotMatch(worker, /replaceD1Table\(/);
});

test('D1 vacancy indexes cover sync watermarks, sources, owners, remote roles, and expiry', () => {
  for (const index of [
    'vacancies_source_created_id_idx',
    'vacancies_agency_created_id_idx',
    'vacancies_employer_created_id_idx',
    'vacancies_remote_created_id_idx',
    'vacancies_closing_date_idx'
  ]) {
    assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
  }
});

test('startup headline count comes from D1 without a per-request Supabase count', () => {
  assert.match(worker, /env\.DB\.prepare\("SELECT COUNT\(\*\) AS n FROM vacancies"\)/);
  assert.doesNotMatch(worker, /authoritativeVacancyCount/);
  assert.doesNotMatch(worker, /snapshot = \{ \.\.\.snapshot, counts: \{ \.\.\.snapshot\.counts, vacancies:/);
});

test('public startup and vacancy reads never fall back to D1', () => {
  const startup = worker.slice(worker.indexOf('async function startupResponse('), worker.indexOf('__name(startupResponse'));
  const vacancies = worker.slice(worker.indexOf('async function vacanciesResponse('), worker.indexOf('__name(vacanciesResponse'));
  assert.match(startup, /D1 fallback disabled/);
  assert.match(startup, /X-Data-Stale/);
  assert.doesNotMatch(startup, /loadStartupDataFromD1\(env\)/);
  assert.match(vacancies, /readPublicVacancySnapshot\(env\) \|\| await readPublicStartupSnapshot\(env\)/);
  assert.doesNotMatch(vacancies, /env\.DB\.prepare/);
});

test('public posters are mirrored for writes but served from R2 with edge caching', () => {
  assert.match(worker, /async function postersResponse\(request, env, origin\)/);
  assert.match(worker, /path === "\/api\/posters"/);
  assert.match(worker, /syncD1Table\(env, "employer_posters"/);
  assert.match(postersMigration, /CREATE TABLE IF NOT EXISTS employer_posters/);
  assert.match(postersMigration, /employer_posters_expires_at_idx/);
  const posters = worker.slice(worker.indexOf('async function postersResponse('), worker.indexOf('__name(postersResponse'));
  assert.match(posters, /schema=r2-v1/);
  assert.match(posters, /readPublicJsonSnapshot\(env, PUBLIC_POSTERS_SNAPSHOT_KEY, "posters"\)/);
  assert.doesNotMatch(posters, /supabaseGet|env\.DB\.prepare/);
});

test('vacancy deletion reconciliation is not run on every six-hour sync', () => {
  assert.match(worker, /VACANCY_RECONCILE_INTERVAL_SECONDS = 86400/);
  assert.match(worker, /vacancies_last_reconciled_at/);
});

test('house ads are mirrored to D1 for writes but public delivery is R2/cache-first', () => {
  assert.match(worker, /syncD1Table\(env, "house_ads"/);
  assert.match(houseAdsMigration, /CREATE TABLE IF NOT EXISTS house_ads/);
  const ads = worker.slice(worker.indexOf('async function houseAdsResponse('), worker.indexOf('__name(houseAdsResponse'));
  const events = worker.slice(worker.indexOf('async function houseAdEventResponse('), worker.indexOf('__name(houseAdEventResponse'));
  assert.match(ads, /schema=r2-v1/);
  assert.match(ads, /readPublicJsonSnapshot\(env, PUBLIC_HOUSE_ADS_SNAPSHOT_KEY, "ads"\)/);
  assert.doesNotMatch(ads, /supabaseGet|env\.DB\.prepare/);
  assert.match(events, /UPDATE house_ads SET/);
  assert.doesNotMatch(events, /supabaseGet|supabaseRpc/);
  assert.match(worker, /publicHouseAdCreativeUrl/);
});

test('CV Box reads active profiles live and never shares startup cache', () => {
  assert.match(worker, /async function cvBoxResponse\(/);
  assert.match(worker, /path === "\/api\/cv-box"/);
  assert.match(worker, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(worker, /pool_candidates_public/);
  assert.doesNotMatch(worker, /schema=edge-first-v14.*cv-box/);
  assert.match(worker, /return Number\.isSafeInteger\(value\) && value >= 0 \? value \+ 1 : 1/);
});
