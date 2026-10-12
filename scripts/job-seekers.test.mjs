import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const worker = read('../Cloudflare-worker/worker.js');
const admin = read('../admin.html');
const index = read('../index.html');
const sheets = read('../app-sheets.js');
const migration = read('../supabase/migrations/20261014_job_seeker_requests.sql');

test('job seeker table is locked down: insert only through the security-definer RPC', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.job_seeker_requests FROM anon, authenticated/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.public_submit_job_seeker/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.public_submit_job_seeker\([^)]*\) TO anon, authenticated/);
});

test('worker enforces Turnstile, consent and contact details before storing a request', () => {
  const start = worker.indexOf('path === "/api/submit/job-seeker"');
  assert.ok(start > 0);
  const handler = worker.slice(start, start + 6000);
  assert.match(handler, /verifyTurnstile\(request, env, origin, true\)/);
  assert.match(handler, /body\.consent !== true/);
  assert.match(handler, /!phone && !email/);
  assert.match(handler, /public_submit_job_seeker/);
  assert.match(handler, /\/\?section=talent-pool/, 'auto-reply links to the Talent Pool');
});

test('admin reads job seekers through the Worker and manages them via an admin-only route', () => {
  assert.match(worker, /jobSeekers: "job_seeker_requests"/);
  assert.match(worker, /admin\\\/job-seekers/);
  assert.match(admin, /adminApi\('POST','\/api\/admin\/job-seekers\//);
  assert.doesNotMatch(admin, /supabaseClient\.from\('job_seeker_requests'\)/);
});

test('app form never falls back to a direct Supabase insert and requires consent', () => {
  const start = sheets.indexOf('async function submitJobSeekerRequest()');
  const end = sheets.indexOf('// ===== TALENT POOL (public browse', start);
  const fn = sheets.slice(start, end);
  assert.match(fn, /submitViaWorker\('\/api\/submit\/job-seeker'/);
  assert.doesNotMatch(fn, /supabaseClient/);
  assert.match(fn, /payload\.consent/);
  assert.match(index, /onclick="openJobSeekerSheet\(\)"/);
  assert.match(index, /id="job-seeker-consent"/);
});

test('converting to the Talent Pool keeps private details out of the public bio', () => {
  const start = admin.indexOf('function seekerToTalentPool(id)');
  const end = admin.indexOf('async function linkSeekerToPool', start);
  const fn = admin.slice(start, end);
  assert.doesNotMatch(fn, /pc-about/, 'public bio must not be prefilled');
  assert.match(fn, /pc-notes/);
  assert.match(admin, /if\(poolSaved === false\) return;/);
  assert.match(admin, /if\(fromSeeker\) await linkSeekerToPool\(fromSeeker, id\)/);
});
