import test from 'node:test';
import assert from 'node:assert/strict';
import { mapJonssonJobs } from './sync-jonsson.mjs';

const baseJob = (overrides = {}) => ({
  id: 5036713101,
  title: 'Store Leader',
  company_name: 'Jonsson Workwear',
  first_published: '2026-11-16T06:58:55-05:00',
  updated_at: '2026-11-16T06:58:55-05:00',
  application_deadline: null,
  absolute_url: 'https://job-boards.eu.greenhouse.io/jonssonworkwear/jobs/5036713101',
  location: { name: 'Durban, KwaZulu-Natal, South Africa' },
  departments: [{ name: 'Retail' }],
  offices: [{ name: 'Durban', location: 'Durban, KwaZulu-Natal, South Africa' }],
  content: '<p>Lead the store team.</p>',
  ...overrides,
});

test('maps an in-scope Jonsson Greenhouse job into a retail vacancy', () => {
  const [job] = mapJonssonJobs({ jobs: [baseJob()] }, new Date('2026-11-23T00:00:00Z'));
  assert.equal(job.id, 'retail-jonsson-5036713101');
  assert.equal(job.company, 'Jonsson Workwear');
  assert.equal(job.source_type, 'retail');
  assert.equal(job.location, 'Durban, KwaZulu-Natal, South Africa');
  assert.match(job.notes, /Department: Retail/);
  assert.match(job.notes, /Lead the store team/);
});

test('keeps only requested departments and provinces', () => {
  const jobs = mapJonssonJobs({ jobs: [
    baseJob(),
    baseJob({ id: 2, location: { name: 'Polokwane, Limpopo, South Africa' } }),
    baseJob({ id: 3, departments: [{ name: 'Finance' }] }),
    baseJob({ id: 4, departments: [{ name: 'Technology' }], location: { name: 'Cape Town, Western Cape, South Africa' } }),
    baseJob({ id: 5, departments: [{ name: 'Manufacturing' }], location: { name: 'Nhlangano, Shiselweni, Eswatini' } }),
  ] }, new Date('2026-11-23T00:00:00Z'));
  assert.deepEqual(jobs.map((job) => job.id), ['retail-jonsson-5036713101', 'retail-jonsson-4']);
});

test('skips stale Greenhouse jobs using first_published', () => {
  const jobs = mapJonssonJobs({ jobs: [baseJob({ first_published: '2026-09-01T00:00:00Z' })] }, new Date('2026-11-23T00:00:00Z'));
  assert.deepEqual(jobs, []);
});
