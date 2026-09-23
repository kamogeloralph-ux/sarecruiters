import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHimalayasResults } from './sync-himalayas.mjs';

test('maps South Africa-eligible Himalayas jobs into remote vacancy records', () => {
  const [job] = mapHimalayasResults({
    jobs: [{
      guid: 'https://himalayas.app/companies/acme/jobs/platform-engineer-123',
      title: 'Platform Engineer',
      companyName: 'Acme Remote',
      applicationLink: 'https://himalayas.app/companies/acme/jobs/platform-engineer-123',
      locationRestrictions: ['South Africa', 'United Kingdom'],
      employmentType: 'Full-time',
      minSalary: 80000,
      maxSalary: 110000,
      salaryPeriod: 'annual',
      currency: 'USD',
      excerpt: 'Build reliable cloud infrastructure.',
    }],
  });
  assert.equal(job.id, 'himalayas-platform-engineer-123');
  assert.equal(job.company, 'Acme Remote');
  assert.equal(job.location, 'Remote · South Africa eligible');
  assert.equal(job.remote, 'Remote');
  assert.equal(job.source_type, 'himalayas');
  assert.match(job.notes, /USD 80,000 - 110,000 \(annual\)/);
  assert.match(job.notes, /Build reliable cloud infrastructure/);
});

test('uses guid fallback and skips jobs without a title or application link', () => {
  const jobs = mapHimalayasResults({
    jobs: [
      { guid: 'https://himalayas.app/jobs/data-analyst-456', title: 'Data Analyst' },
      { guid: 'https://himalayas.app/jobs/missing-title', title: '', applicationLink: 'https://example.com/job' },
      { title: 'Missing link' },
    ],
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'himalayas-data-analyst-456');
});

test('returns an empty array for malformed or empty payloads', () => {
  assert.deepEqual(mapHimalayasResults({}), []);
  assert.deepEqual(mapHimalayasResults(null), []);
});

test('carries expiresAt through as closing_date, and publishedAt is used for the (internal-only) freshness check', () => {
  const [job] = mapHimalayasResults({
    jobs: [{
      guid: 'https://himalayas.app/companies/acme/jobs/fresh-role',
      title: 'Fresh Role',
      companyName: 'Acme Remote',
      applicationLink: 'https://himalayas.app/companies/acme/jobs/fresh-role',
      publishedAt: '2026-09-18T00:00:00Z',
      expiresAt: '2026-10-18T00:00:00Z',
    }],
  }, new Date('2026-09-21T00:00:00Z'));
  assert.equal(job.closing_date, '2026-10-18');
  // postedText is intentionally NOT a field on the returned row -- there's
  // no such column in `vacancies`, and PostgREST rejects the whole upsert
  // batch (PGRST204) if an unrecognized key is present. It's only used
  // internally to feed isStaleVacancy, which the two tests below confirm.
  assert.equal(job.postedText, undefined);
});

test('skips a Himalayas job whose publishedAt is older than the max age', () => {
  const jobs = mapHimalayasResults({
    jobs: [{
      guid: 'https://himalayas.app/companies/acme/jobs/stale-role',
      title: 'Stale Role',
      applicationLink: 'https://himalayas.app/companies/acme/jobs/stale-role',
      publishedAt: '2026-01-01T00:00:00Z',
    }],
  }, new Date('2026-09-21T00:00:00Z'));
  assert.equal(jobs.length, 0);
});

test('skips a Himalayas job whose expiresAt has already passed', () => {
  const jobs = mapHimalayasResults({
    jobs: [{
      guid: 'https://himalayas.app/companies/acme/jobs/expired-role',
      title: 'Expired Role',
      applicationLink: 'https://himalayas.app/companies/acme/jobs/expired-role',
      publishedAt: '2026-09-18T00:00:00Z',
      expiresAt: '2026-09-01T00:00:00Z',
    }],
  }, new Date('2026-09-21T00:00:00Z'));
  assert.equal(jobs.length, 0);
});
