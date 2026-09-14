import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAdzunaResults } from './sync-adzuna.mjs';

// Fixture modeled on Adzuna's documented /v1/api/jobs/{country}/search/{page}
// response shape. The module validates credentials at import time in
// production; this fixture test is intentionally run through the exported
// mapper only, in CI with dummy Supabase/Adzuna values.
test('maps Adzuna search results into vacancy records', () => {
  const payload = {
    results: [
      {
        id: 5012345678,
        title: 'Senior Backend Developer',
        description: 'Join a growing fintech team building payment infrastructure.',
        created: '2026-09-12T08:14:00Z',
        redirect_url: 'https://www.adzuna.co.za/land/ad/5012345678?se=abc123',
        salary_min: 45000,
        salary_max: 65000,
        salary_is_predicted: '0',
        contract_type: 'full_time',
        contract_time: 'permanent',
        company: { display_name: 'Datafin' },
        location: { display_name: 'Cape Town, Western Cape' },
      },
    ],
    count: 1,
  };

  const [job] = mapAdzunaResults(payload);
  assert.equal(job.id, 'adzuna-5012345678');
  assert.equal(job.title, 'Senior Backend Developer');
  assert.equal(job.company, 'Datafin');
  assert.equal(job.location, 'Cape Town, Western Cape');
  assert.equal(job.link, 'https://www.adzuna.co.za/land/ad/5012345678?se=abc123');
  assert.match(job.notes, /R45,000 - R65,000/);
  assert.match(job.notes, /permanent full_time/);
  assert.match(job.notes, /Posted 2026-09-12/);
  assert.match(job.notes, /payment infrastructure/);
});

test('marks predicted salaries and skips jobs missing a redirect_url or title', () => {
  const payload = {
    results: [
      {
        id: 1,
        title: 'Estimated Salary Role',
        redirect_url: 'https://www.adzuna.co.za/land/ad/1',
        salary_min: 20000,
        salary_max: 20000,
        salary_is_predicted: '1',
      },
      { id: 2, title: 'Missing link', redirect_url: null },
      { id: 3, title: '', redirect_url: 'https://www.adzuna.co.za/land/ad/3' },
    ],
  };

  const jobs = mapAdzunaResults(payload);
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].notes, /R20,000 \(estimated\)/);
});

test('returns an empty array for a malformed or empty payload', () => {
  assert.deepEqual(mapAdzunaResults({}), []);
  assert.deepEqual(mapAdzunaResults(null), []);
});
