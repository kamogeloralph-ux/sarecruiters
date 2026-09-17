import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoardConfig, parseLeverJobs, parseGreenhouseJobs } from './scrape-career-boards.mjs';

test('parses compact and JSON board configuration', () => {
  assert.deepEqual(parseBoardConfig('lever:acme,greenhouse:globex'), [
    { type: 'lever', name: 'acme', label: 'acme' },
    { type: 'greenhouse', name: 'globex', label: 'globex' },
  ]);
  assert.deepEqual(parseBoardConfig('[{"type":"lever","name":"acme","label":"Acme Inc"}]'), [
    { type: 'lever', name: 'acme', label: 'Acme Inc' },
  ]);
});

test('normalizes Lever postings', () => {
  const [job] = parseLeverJobs([{ id: 'abc-123', text: 'Frontend Engineer', hostedUrl: 'https://jobs.lever.co/acme/abc-123', categories: { location: 'Cape Town', commitment: 'Full-time' }, descriptionPlain: 'Build products.' }], { type: 'lever', name: 'acme', label: 'Acme' });
  assert.equal(job.id, 'career-lever-acme-abc-123');
  assert.equal(job.company, 'Acme');
  assert.equal(job.location, 'Cape Town');
  assert.equal(job.employment_type, 'Full-time');
  assert.equal(job.notes, 'Build products.');
});

test('normalizes Greenhouse postings', () => {
  const [job] = parseGreenhouseJobs({ jobs: [{ id: 42, title: 'Data Analyst', absolute_url: 'https://boards.greenhouse.io/globex/jobs/42', location: { name: 'Remote - South Africa' }, content: '<p>Analyze data.</p>' }] }, { type: 'greenhouse', name: 'globex', label: 'Globex' });
  assert.equal(job.id, 'career-greenhouse-globex-42');
  assert.equal(job.company, 'Globex');
  assert.equal(job.location, 'Remote - South Africa');
  assert.equal(job.remote, 'Remote');
  assert.equal(job.notes, 'Analyze data.');
});

test('rejects malformed board payloads', () => {
  assert.deepEqual(parseLeverJobs(null, { type: 'lever', name: 'x', label: 'X' }), []);
  assert.deepEqual(parseGreenhouseJobs({}, { type: 'greenhouse', name: 'x', label: 'X' }), []);
});
