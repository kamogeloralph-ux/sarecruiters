import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../Cloudflare-worker/migrations/0003_d1_sync_indexes.sql', import.meta.url), 'utf8');
const postersMigration = readFileSync(new URL('../Cloudflare-worker/migrations/0004_public_posters.sql', import.meta.url), 'utf8');

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

test('public posters are mirrored to D1 and served by the Worker', () => {
  assert.match(worker, /async function postersResponse\(request, env, origin\)/);
  assert.match(worker, /path === "\/api\/posters"/);
  assert.match(worker, /syncD1Table\(env, "employer_posters"/);
  assert.match(postersMigration, /CREATE TABLE IF NOT EXISTS employer_posters/);
  assert.match(postersMigration, /employer_posters_expires_at_idx/);
});

test('vacancy deletion reconciliation is not run on every six-hour sync', () => {
  assert.match(worker, /VACANCY_RECONCILE_INTERVAL_SECONDS = 86400/);
  assert.match(worker, /vacancies_last_reconciled_at/);
});
