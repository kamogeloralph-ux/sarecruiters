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
