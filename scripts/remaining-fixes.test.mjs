import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchFreshSeoSnapshot } from './refresh-seo-snapshot.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const data = read('../app-data.js');
const alerts = read('../app-alerts.js');
const worker = read('../Cloudflare-worker/worker.js');
const refreshWorkflow = read('../.github/workflows/deploy-pages.yml');
const ciWorkflow = read('../.github/workflows/test.yml');
const wrangler = read('../Cloudflare-worker/wrangler.toml');

test('admin employer/branch/vacancy mutations report delete errors rather than success', () => {
  for (const entity of ['employer', 'branch', 'vacancy']) {
    assert.match(data, new RegExp(`if \\(result\\.error\\) \\{ console\\.error\\('${entity} delete', result\\.error\\); return false; \\}`));
    assert.match(data, new RegExp(`export async function remove${entity[0].toUpperCase()}${entity.slice(1)}\\(id\\)[\\s\\S]*?return true;`));
  }
  assert.match(data, /console\.error\('employer upsert', result\.error\)/);
  assert.match(data, /console\.error\('branch upsert', result\.error\)/);
});

test('submitters are notified only after a successful status transition', () => {
  assert.match(worker, /async function sendSubmissionStatusEmail\(env, \{ to, name, kind, status \}\)/);
  assert.match(worker, /previous\.status !== affected\[0\]\.status[\s\S]*?kind: "job"/);
  assert.match(worker, /previous\.status !== affected\[0\]\.status[\s\S]*?kind: "seeker"/);
  assert.match(worker, /if \(!\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/.test\(recipient\)\) return;/);
});

test('apply clicks are tracked separately and applications require an explicit return confirmation', () => {
  assert.match(alerts, /trackEvent\('vacancy_apply_click'/);
  assert.match(alerts, /Did you apply for /);
  assert.match(alerts, /vacancy_application_reported/);
  assert.doesNotMatch(alerts, /trackEvent\('vacancy_apply_click'[\s\S]{0,500}?vacancy_applications'\)\.upsert/);
  assert.match(alerts, /data-vacancy-id/);
});

test('public CV/photo uploads are throttled and validate file signatures', () => {
  assert.match(worker, /async function publicUploadAllowed\(request, limit = 12\)/);
  assert.match(worker, /async function readUploadBytes\(request, maxBytes\)[\s\S]*?if \(total > maxBytes\)[\s\S]*?reader\.cancel\(\)/);
  assert.equal((worker.match(/readUploadBytes\(request, MAX_PHOTO_BYTES\)/g) || []).length, 2);
  assert.match(worker, /publicUploadAllowed\(request\)/);
  assert.match(worker, /file contents do not match a supported CV type/);
  assert.match(worker, /photo contents are not a valid JPEG or PNG image/);
});

test('deploy workflow refreshes and validates the SEO snapshot before generation', () => {
  assert.ok(refreshWorkflow.indexOf('scripts/refresh-seo-snapshot.mjs') < refreshWorkflow.indexOf('node generate-pages.js'));
  assert.ok(refreshWorkflow.indexOf('scripts/validate-static-snapshot.mjs') < refreshWorkflow.indexOf('node generate-pages.js'));
  assert.match(ciWorkflow, /npm test/);
  assert.match(wrangler, /crons = \["0 \*\/6 \* \* \*", "15,45 \* \* \* \*"\]/);
});

test('fresh SEO exporter paginates every row and refuses stale or malformed data', async () => {
  const now = new Date().toISOString();
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/startup')) return Response.json({ agencies: [{ id: 'a' }], branches: [], counts: { candidates: 0 }, generated_at: now });
    if (calls.length === 2) return Response.json({ vacancies: [{ id: '1' }, { id: '2' }], next_cursor: 'cursor-2' });
    return Response.json({ vacancies: [{ id: '3' }], next_cursor: null });
  };
  const snapshot = await fetchFreshSeoSnapshot(fakeFetch, 'https://worker.example');
  assert.equal(snapshot.vacancies.length, 3);
  assert.equal(calls.length, 3);
  assert.match(calls[2], /cursor=cursor-2/);

  const staleFetch = async () => Response.json({ agencies: [{ id: 'a' }], branches: [], generated_at: '2000-01-01T00:00:00Z' });
  await assert.rejects(fetchFreshSeoSnapshot(staleFetch, 'https://worker.example'), /stale or invalid/);
});
