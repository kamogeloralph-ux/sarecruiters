import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, mapJoobleResults } from './sync-jooble.mjs';

const now = new Date('2026-11-19T10:00:00Z');

test('clean strips highlight tags and entities from Jooble snippets', () => {
  assert.equal(clean('Looking for a <b>driver</b>&nbsp;in Durban &amp; area'), 'Looking for a driver in Durban & area');
});

test('maps Jooble jobs into the shared vacancy shape', () => {
  const [job] = mapJoobleResults({ jobs: [{
    id: 123456789, title: '<b>Driver</b>', company: 'Acme Logistics', location: 'Durban', link: 'https://za.jooble.org/desc/123456789',
    snippet: 'Valid <b>code 10</b> licence required', salary: 'R8 000', type: 'Full-time', updated: '2026-11-18T00:00:00.0000000',
  }] }, now);
  assert.equal(job.id, 'jooble-123456789');
  assert.equal(job.title, 'Driver');
  assert.equal(job.source_type, 'jooble');
  assert.equal(job.link, 'https://za.jooble.org/desc/123456789');
  assert.match(job.notes, /R8 000 · Full-time · Posted 2026-11-18 · Valid code 10 licence required/);
});

test('drops incomplete, duplicate and stale listings', () => {
  const jobs = mapJoobleResults({ jobs: [
    { id: 1, title: 'A', link: 'https://x/1', updated: '2026-11-18' },
    { id: 1, title: 'A again', link: 'https://x/1b' },
    { id: 2, title: '', link: 'https://x/2' },
    { id: 3, title: 'No link' },
    { id: 4, title: 'Old', link: 'https://x/4', updated: '2026-08-01' },
  ] }, now);
  assert.deepEqual(jobs.map((j) => j.id), ['jooble-1']);
  assert.deepEqual(mapJoobleResults(null, now), []);
});

test('the API key is never printed', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./sync-jooble.mjs', import.meta.url), 'utf8');
  assert.ok(!/console\.\w+\([^)]*JOOBLE_API_KEY/.test(src.replace(/check JOOBLE_API_KEY|JOOBLE_API_KEY is required/g, '')));
});
