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

  // Explicit `now` close to the fixture's `created` date -- mapAdzunaResults
  // now checks posting age via isStaleVacancy, so leaving this on the real
  // wall clock would make the test start failing on its own once real time
  // passes Adzuna's 45-day staleness window.
  const [job] = mapAdzunaResults(payload, new Date('2026-09-21T00:00:00Z'));
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

test('skips a listing whose `created` date is older than Adzuna\'s max age', () => {
  const payload = {
    results: [{
      id: 999, title: 'Ancient Listing', created: '2026-01-01T00:00:00Z',
      redirect_url: 'https://www.adzuna.co.za/land/ad/999',
    }],
  };
  const jobs = mapAdzunaResults(payload, new Date('2026-09-21T00:00:00Z'));
  assert.equal(jobs.length, 0);
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

import { collectAdzunaJobs, adzunaSearchUrl, parseAdzunaCategories } from './sync-adzuna.mjs';

const NOW_ENGINE = new Date('2026-11-26T00:00:00Z');
const fakeJob = (id) => ({ id, title: `Job ${id}`, redirect_url: `https://www.adzuna.co.za/land/ad/${id}`, created: '2026-11-20T00:00:00Z' });
// Builds a fake Adzuna API: each category has `total` listings, served `perPage` at a time.
function fakeApi(totals, perPage = 50) {
  const seen = [];
  return {
    seen,
    fetchSearch: async ({ category, page }) => {
      seen.push(`${category}#${page}`);
      const total = totals[category] ?? 0;
      const start = (page - 1) * perPage;
      const n = Math.max(0, Math.min(perPage, total - start));
      return { count: total, results: Array.from({ length: n }, (_, i) => fakeJob(`${category}-${start + i}`)) };
    },
  };
}

test('builds a date-sorted, category-filtered search URL', () => {
  const url = new URL(adzunaSearchUrl({ country: 'za', appId: 'id', appKey: 'key', page: 2, perPage: 50, category: 'it-jobs', maxDaysOld: 30 }));
  assert.equal(url.pathname, '/v1/api/jobs/za/search/2');
  assert.equal(url.searchParams.get('category'), 'it-jobs');
  assert.equal(url.searchParams.get('sort_by'), 'date');
  assert.equal(url.searchParams.get('max_days_old'), '30');
  assert.equal(url.searchParams.get('results_per_page'), '50');
});

test('parses category tags and ignores malformed entries', () => {
  assert.deepEqual(parseAdzunaCategories({ results: [{ tag: 'it-jobs' }, { tag: 'it-jobs' }, { tag: 'Bad Tag!' }, {}] }), ['it-jobs']);
  assert.deepEqual(parseAdzunaCategories(null), []);
});

test('a call budget is spread round-robin so every category is reached before any goes deep', async () => {
  const api = fakeApi({ a: 500, b: 500, c: 500 });
  const result = await collectAdzunaJobs({ categories: ['a', 'b', 'c'], fetchSearch: api.fetchSearch, maxCalls: 5, delayMs: 0, now: NOW_ENGINE });
  assert.deepEqual(api.seen, ['a#1', 'b#1', 'c#1', 'a#2', 'b#2']);
  assert.equal(result.calls, 5);
  assert.equal(result.stopReason, 'call budget reached');
  assert.equal(result.jobs.length, 250);
});

test('a single run can now collect far more than the old 150-vacancy ceiling', async () => {
  const api = fakeApi({ a: 400, b: 400, c: 400 });
  const result = await collectAdzunaJobs({ categories: ['a', 'b', 'c'], fetchSearch: api.fetchSearch, maxCalls: 70, delayMs: 0, now: NOW_ENGINE });
  // 3 categories x 6 pages per category x 50 = 900 (old ceiling: 150 for the whole run)
  assert.equal(result.jobs.length, 900);
  assert.equal(result.stopReason, 'completed');
});

test('a category stops once its total is read, and duplicate ids are collapsed', async () => {
  const fetchSearch = async () => ({ count: 2, results: [fakeJob('same'), fakeJob('same'), fakeJob('other')] });
  const result = await collectAdzunaJobs({ categories: ['a'], fetchSearch, maxCalls: 10, perPage: 50, delayMs: 0, now: NOW_ENGINE });
  assert.equal(result.calls, 1);
  assert.deepEqual(result.jobs.map((j) => j.id).sort(), ['adzuna-other', 'adzuna-same']);
});

test('HTTP 429 stops the run but keeps what was collected; a bad category does not stop it', async () => {
  let n = 0;
  const fetchSearch = async ({ category }) => {
    n += 1;
    if (category === 'bad') { const e = new Error('Adzuna returned HTTP 400'); e.status = 400; throw e; }
    if (n >= 4) { const e = new Error('Adzuna returned HTTP 429'); e.status = 429; throw e; }
    return { count: 100, results: [fakeJob(`${category}-${n}`)] };
  };
  const result = await collectAdzunaJobs({ categories: ['a', 'bad', 'b', 'c'], fetchSearch, maxCalls: 50, perPage: 1, delayMs: 0, now: NOW_ENGINE });
  assert.equal(result.rateLimited, true);
  assert.equal(result.failures, 2);
  assert.equal(result.jobs.length, 2);
  assert.ok(result.categories.find((c) => c.tag === 'bad').failed);
});

test('rejected credentials are fatal and stop immediately', async () => {
  const fetchSearch = async () => { const e = new Error('Adzuna returned HTTP 401'); e.status = 401; throw e; };
  const result = await collectAdzunaJobs({ categories: ['a', 'b'], fetchSearch, maxCalls: 10, delayMs: 0, now: NOW_ENGINE });
  assert.equal(result.fatal, true);
  assert.equal(result.calls, 1);
});

test('the vacancy cap trims the final result', async () => {
  const api = fakeApi({ a: 500 });
  const result = await collectAdzunaJobs({ categories: ['a'], fetchSearch: api.fetchSearch, maxCalls: 10, maxVacancies: 60, delayMs: 0, now: NOW_ENGINE });
  assert.equal(result.jobs.length, 60);
});
